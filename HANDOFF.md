# HANDOFF — Leo Bot Telegram

Dokumen ini buat lanjut kerja di sesi baru. Kasih file ini ke asisten di awal
sesi (drag/attach atau paste isinya) biar dia langsung paham konteksnya.

---

## Apa ini

Telegram bot single-user (owner-only) buat otomasi akun Canva + Leonardo. Gabung
3 fungsi: generate (Canva+Leonardo+credit), signup (Canva only), login (akun
existing). Pakai Playwright + Chrome non-headless, file-based (no DB).

- **Repo GitHub:** https://github.com/tusukgandi-stack/canpa.git (branch `main`)
- **Lokasi lokal (dev):** `d:\lazivo\hasil akhir\leonard\leobot-telegram`
- **VPS (prod):** Ubuntu, user `leobot`, path `/home/leobot/canpa`, jalan via
  `pm2` (nama proses: `leobot`) + `xvfb-run` (non-headless wajib).
- **Stack:** Node ESM >=20, `telegraf` (bot), `playwright-core` + Chrome channel,
  `archiver` (zip). Owner ID: `1269254705`.

## Status: SUDAH JALAN DI PRODUKSI ✅

Bot udah deploy & berfungsi end-to-end (generate/signup/login/credits/list/
download semua works). Terakhir di-tes generate 20 akun: sukses, dengan catatan
success rate ~45% karena throttle (lihat "Known issues" di bawah).

---

## Arsitektur singkat

```
start.js                     entry: load config, validasi token/owner, bot.launch()
config.json                  SECRET (gitignored) — token, apiKey, dst
config.example.json          template kosong (di-commit)
src/
  bot.js                     factory: middleware (log+auth) + register commands + setMyCommands
  auth.js                    ownerOnly middleware (whitelist ownerIds)
  jobs.js                    state 1-job-aktif + AbortController + detach() fire-and-forget
  progress.js                ProgressReporter (edit 1 pesan, throttle 1s, handle 429)
  logger.js                  log/warn/error + ring buffer 200 baris (buat /log)
  keyboards.js               semua inline keyboard (menu, count picker, settings, proxy, confirm)
  pending-input.js           state "nunggu user ketik value" per chat
  error-format.js            kategorisasi error per akun
  commands/
    menu.js                  /menu + ROUTER callback_query (semua tombol) + handler pending-input
    start.js                 /start (+ keyboard), /help
    generate.js              /generate <n> + runGenerate()  [detach]
    signup.js                /signup <n> + runSignup()       [detach, Canva only]
    login.js                 /login flow + runLoginJob()     [detach, multi-stage + confirm]
    credits.js               /credits + runCredits()         [detach]
    checkseats.js            /checkseats + runCheckSeats()    [detach] cek sisa seat tiap link
    list.js                  /list (group per kategori)
    download.js              /download (zip)
    cancel.js                /cancel
    log.js                   /log
    settings.js              /settings /setapikey /setdomain /setconc /headless /togglemode
                             + multi-link: /addlink /listlinks /removelink /clearlinks
                             /setseatlimit /setchecker
    proxy.js                 /addproxy /listproxy /clearproxy /loadproxy
  services/
    config.js                load/save/update config; ACCOUNTS_DIR & CONFIG_FILE
                             BISA di-override via env LEOBOT_ACCOUNTS_DIR / LEOBOT_CONFIG_FILE
                             multi-link: canvaBusinessLinks[] + canvaSeatLimit + checkerEmail
                             (auto-migrasi canvaBusinessUrl string lama → array)
    business.js              multi-link Business: assignLinks (fill-then-next),
                             commitJoins (counter +1, 1x tulis), reconcileJoins (set akurat)
    hubify.js                client Hubify Mail (createInbox, fetchOtp, deleteInbox)
    proxy.js                 parser multi-format, toLaunchProxy, withUniqueSession (DataImpulse sticky)
    concurrency.js           runWithConcurrency (worker pool + AbortSignal)
    accounts.js              saveAccount(record, category), scanAccounts, rebuildEmailsFile, zipAccounts
    playwright-helpers.js    helpers Playwright + doLeonardoOAuth (retry) + detectCanvaError + capture credit
                             + readTeamMemberCount (baca angka anggota dari settings/people)
    canva-signup.js          signupOne() — flow signup (dipakai generate & signup), param inviteUrl
    canva-login.js           loginOne()  — flow login akun existing, param inviteUrl
    canva-seats.js           checkSeats() — checker login 1x, keliling tiap tim, baca member count
                             session checker disimpan di accounts/_checker.json (di-skip scan)
    leonardo-credits.js      checkOneCredits() (token-first, fallback browser) + sumCredits()
scripts/                     smoke test (lihat di bawah)
```

## Keputusan desain penting (JANGAN diubah tanpa alasan)

1. **`/signup` = Canva ONLY.** Ga ada Business join, ga ada Leonardo, ga ada
   credit. Toggle `modes.signup` SUDAH DIHAPUS dari config. `/generate` =
   full (Canva + Business + Leonardo + credit).
2. **Storage dipisah per kategori subfolder:**
   `accounts/generate/`, `accounts/signup/`, `accounts/login/`. Tiap folder ada
   `emails.txt` sendiri. File lama di root `accounts/` tetap kebaca (auto infer
   kategori). `saveAccount(record, category)` & `rebuildEmailsFile(category)`.
3. **Detail akun (email UNMASKED) dikirim di akhir tiap job** — ga perlu /list.
   Progress per-akun tetap mask (`tam****@hu***`).
4. **Job FIRE-AND-FORGET** lewat `detach()` di `jobs.js`. WAJIB. Alasan: Telegraf
   polling loop `await Promise.all(updates.map(handleUpdate))` + `handlerTimeout
   90000ms`. Kalau job di-await langsung, loop ke-blok (command lain + /cancel
   mati) + muncul error "Promise timed out after 90000ms". Semua command yang
   manggil job panjang HARUS pakai `detach(() => runX(...))`.
5. **Cuma akun sukses yang di-save.** Service `throw` kalau gagal → caller skip
   saveAccount. Akun gagal (OTP timeout/Canva tolak/OAuth gagal) ga ke-disk.
6. **Semua reply plain text** (NO `parse_mode: Markdown`). Pernah kena bug 400
   "can't parse entities" karena URL/key ngandung `_`. Jangan pakai Markdown
   buat nampilin data dinamis (email, url, proxy, log).
7. **Menu = inline keyboard** (nempel di pesan). Count picker: 1/3/5/10/20 +
   Custom (ketik bebas, max 50). Login tetap paste email manual.
8. **Multi-link Canva Business.** Config `canvaBusinessLinks: [{url, joined}]`
   (bukan lagi string tunggal `canvaBusinessUrl` — auto-migrasi dari yg lama).
   1 link = 1 tim, kapasitas `canvaSeatLimit` (default 100). Strategi join:
   **FILL-THEN-NEXT** (link pertama yg masih ada slot dipakai sampe penuh, baru
   lanjut). Assign per-akun di awal job (`assignLinks`), counter `joined`
   di-update 1x di akhir job (`commitJoins`) buat hindari race antar worker.
   Cek seat (`/checkseats`): 1 akun CHECKER (`checkerEmail`, Hubify-managed)
   login 1x, keliling tiap tim, baca angka anggota dari `settings/people`.
   Session checker di `accounts/_checker.json` (di-skip scanAccounts krn prefix
   `_`). Checker makan 1 seat/tim. `/checkseats` reconcile counter `joined` ke
   angka live.

## Hal yang udah dikerjain (changelog sesi-sesi sebelumnya)

- Step 1-8: setup, service layer, Playwright services, bot skeleton, settings,
  mode commands + ProgressReporter, account commands, polish.
- Apply `PROMPT-update-telegram.md` (12 poin): detectCanvaError multi-kategori,
  fix Leonardo OAuth (retry klik Canva sampai navigasi consent), extract token
  Leonardo, capture credit di tab sama, fix auto-join Business.
- Display credit + tokens + model tokens (dulu cuma apiCredit).
- Menu tombol + callback router + setMyCommands.
- Fix bug 400 Markdown (semua reply jadi plain text).
- Split storage per kategori + detail akun unmasked di akhir job.
- Fix performa: job fire-and-forget (no 90s timeout, /cancel jalan), retry
  Leonardo OAuth 1x, fix abort-listener leak (MaxListenersExceededWarning),
  setMaxListeners(0) di signal.
- Multi-link Canva Business: `canvaBusinessUrl` (string) → `canvaBusinessLinks`
  (array {url,joined}) + auto-migrasi. Assign fill-then-next, commitJoins di
  akhir job. Command /addlink /listlinks /removelink /clearlinks /setseatlimit
  /setchecker + menu "Canva Links". Fitur cek seat: /checkseats (checker login
  1x, baca jumlah anggota tiap tim dari settings/people, reconcile counter).
  Smoke baru: smoke-business.js, smoke-seats.js.
- Fix OTP narik kode LAMA: inbox yg dipakai ulang (login/checker) sering masih
  nyimpen OTP lama dari attempt sebelumnya; endpoint /otp balikin yg terbaru-yg-
  ADA, bukan nunggu yg baru. Fix: `peekOtpTimestamp()` catat baseline receivedAt
  SEBELUM submit email, `fetchOtp(..., {after})` tolak OTP yg receivedAt <=
  baseline → tunggu yg fresh. Dipasang di login, signup, & seat checker.
  Smoke baru: smoke-otp.js.

## Known issues / yang BELUM dikerjain (kandidat next)

1. **Success rate rendah pas generate banyak (mis. 20).** Penyebab: semua akun
   dari 1 IP VPS tanpa proxy → Hubify & Leonardo throttle. Gejala: OTP timeout,
   "Leonardo OAuth gagal (persist:user kosong)". SOLUSI yang disarankan:
   - Pasang proxy residential (fitur DataImpulse sticky per-akun udah ada,
     tinggal `/addproxy` atau `/loadproxy`). File `proxy.txt` ada di parent dir.
   - Atau turunin concurrency (`/setconc 2`).
   - User PUNYA `proxy.txt` di `d:\lazivo\hasil akhir\leonard\proxy.txt` — belum
     dipasang/dites.
2. (opsional) OTP timeout 20s mungkin kependekan kalau Hubify lambat — bisa
   dipertimbangkan dinaikin, tapi hati-hati jgn bikin job kelamaan.

## Testing — cara verifikasi (PENTING)

Smoke test ada di `scripts/`. Jalanin dari folder project:
```
node scripts/smoke-step2.js      # services murni (proxy, concurrency, config, accounts)
node scripts/smoke-step3.js      # import semua service
node scripts/smoke-step4.js      # bot skeleton + auth + /start /help
node scripts/smoke-helpers.js    # detectCanvaError, OAuth retry, token, credits
node scripts/smoke-step8.js      # FULL integration semua command (mock chromium+fetch)
node scripts/smoke-menu.js       # tombol/callback flow
node scripts/smoke-cancel.js     # fire-and-forget + /cancel + no listener leak
node scripts/smoke-business.js   # multi-link assign/commit/reconcile + migrasi config
node scripts/smoke-seats.js      # readMemberCount + checkSeats + /checkseats (mock browser)
node scripts/smoke-otp.js        # fetchOtp baseline — tolak OTP lama, tunggu fresh
```
Semua HARUS exit 0. **Smoke test pakai folder TEMP terisolasi** (env
LEOBOT_ACCOUNTS_DIR/LEOBOT_CONFIG_FILE di-set sebelum import) — JANGAN PERNAH
bikin test yang nyentuh `accounts/` atau `config.json` asli. (Pernah kejadian
akun & config user ke-hapus gara2 test lama backup→restore yang gagal di tengah.)

Mock pattern: `chromium.launch` di-ganti fake browser, `globalThis.fetch`
di-ganti buat Hubify. Job sekarang fire-and-forget jadi test pakai `waitJob()`
(poll isJobActive) sebelum assert.

## Deploy / update VPS

```bash
cd ~/canpa
git pull
pm2 restart leobot
pm2 logs leobot --lines 200 --nostream   # cek log
```
Run pertama kali: `cp config.example.json config.json` lalu isi `telegramToken`
+ `ownerIds` + `apiKey`. Jalan via:
`pm2 start "xvfb-run -a --server-args='-screen 0 1920x1080x24' node start.js" --name leobot`

## Aturan kerja (penting buat asisten sesi baru)

- Kerjain bertahap, test tiap perubahan, jangan sekaligus.
- JANGAN sentuh `config.json` user (ada secret). `.gitignore` udah cover.
- JANGAN bikin smoke test yang nulis ke `accounts/` atau `config.json` asli —
  WAJIB pakai env isolasi ke temp dir.
- Sebelum push: `git status --short`, pastikan `config.json` & `accounts/` GA
  ke-stage. Push ke `origin main` (kredensial user udah tersimpan).
- Reply bot plain text, no Markdown buat data dinamis.
- Arsitektur Telegram jangan diubah; fokus logic.
- Commit message singkat, deskriptif.

## Git
- Remote: `origin` = https://github.com/tusukgandi-stack/canpa.git
- Commit terakhir: fix fire-and-forget + retry OAuth + listener leak (`f81d26b`).
- user.name `Masean24`, email `ramadhandaris24@gmail.com`.
