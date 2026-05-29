# Deploy Local (Windows / macOS / Linux dev machine)

Panduan ini buat ngejalanin Leo Bot Telegram di laptop/PC kamu sendiri buat
testing atau dev. Kalau mau deploy 24/7 di server, baca [DEPLOY-VPS.md](./DEPLOY-VPS.md).

---

## 1. Prasyarat

| Tool | Versi minimum | Cek versi |
|---|---|---|
| Node.js | 20.x | `node -v` |
| npm | 10.x (bundled) | `npm -v` |
| Google Chrome | terbaru | buka chrome → about |
| Git | apa aja | `git --version` |

### Install Node.js 20+

- **Windows / macOS:** download dari https://nodejs.org/en/download (LTS)
- **Linux (apt):** 
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt install -y nodejs
  ```

### Install Google Chrome

Bot pakai `playwright-core` dengan `channel: "chrome"`, jadi Chrome harus
ter-install di sistem (bukan Chromium download Playwright).

- **Windows / macOS:** install dari https://google.com/chrome
- **Linux:**
  ```bash
  wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
  echo "deb http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
  sudo apt update && sudo apt install -y google-chrome-stable
  ```

---

## 2. Setup project

```bash
git clone <your-repo-url> leobot-telegram
cd leobot-telegram
npm install
```

Hasilnya: `node_modules/` terisi (~50 MB, 100+ paket).

---

## 3. Bikin Telegram bot

### 3.1 Dapetin bot token

1. Buka Telegram, chat **[@BotFather](https://t.me/BotFather)**
2. Kirim `/newbot`
3. Kasih nama (contoh: `Leo Bot Personal`)
4. Kasih username (harus unik, ending `bot`, contoh: `leobot_yourname_bot`)
5. **Copy token** yang dikasih BotFather. Format kayak gini:
   ```
   8123456789:AAEhBOweik6ad9r-ABC-xyz_definitely-fake
   ```

### 3.2 Dapetin user ID kamu

1. Chat **[@userinfobot](https://t.me/userinfobot)**
2. Kirim apa aja (`hi`, `/start`, dll)
3. Bot bakal balik info kamu, **copy `Id`** (angka, biasanya 9-10 digit)

### 3.3 Isi `config.json`

`config.json` di-auto-buat sekali jalan pertama kalau belum ada. Edit pakai
text editor (notepad / vscode / nano):

```json
{
  "telegramToken": "8123456789:AAEhBOweik6ad9r-ABC-xyz_paste_disini",
  "ownerIds": [987654321],
  "apiKey": "",
  "canvaBusinessUrl": "",
  "domainId": null,
  "headless": false,
  "proxies": [],
  "concurrency": 3,
  "deleteInboxAfter": false,
  "modes": {
    "generate": { "enableLeonardo": true },
    "signup": { "enableLeonardo": false },
    "login": { "enableLeonardo": false, "joinBusiness": true }
  }
}
```

`telegramToken` dan `ownerIds` wajib. Sisa setting bisa di-set lewat command
Telegram setelah bot jalan.

---

## 4. Jalankan bot

```bash
node start.js
```

Output yang bener:

```
[2026-05-29 10:00:00] [bot] Boot. owners=987654321
[2026-05-29 10:00:00] [bot] accounts dir: D:\...\leobot-telegram\accounts
```

Bot udah aktif. Buka Telegram, chat bot kamu (cari pakai username yang dibikin
di BotFather), kirim `/start`. Harusnya dibalik dengan status overview.

### Kalau gagal boot

| Pesan | Solusi |
|---|---|
| `❌ telegramToken kosong` | Belum isi token di `config.json` |
| `❌ ownerIds kosong` | Belum isi `ownerIds` di `config.json` |
| `401: Unauthorized: invalid token` | Token salah / udah di-revoke. Cek BotFather → /token |
| `ETIMEDOUT` saat boot | Koneksi ke Telegram di-block (firewall/proxy lokal). Pakai VPN atau VPS |

---

## 5. Setup awal lewat Telegram

Setelah bot jalan, semua setting bisa di-edit lewat chat:

```
/setapikey <hubify_api_key>
/setcanva https://www.canva.com/brand/join?token=...
/addproxy http://user:pass@gateway.dataimpulse.com:823
/setconc 3
/headless off
```

Cek hasil:
```
/settings
```

---

## 6. Catatan untuk Windows

### `headless: false` di Windows

Chrome bakal kebuka beneran (window-nya nongol). Itu **disarankan** karena
Canva detect `headless: true` dengan keras dan banyak akun bakal gagal.
Jangan kaget kalau lihat banyak window Chrome muncul saat `/generate 5`.

### Auto-start saat boot Windows (opsional)

Pakai Task Scheduler:

1. Win+R → `taskschd.msc`
2. Action → Create Basic Task
3. Trigger: At log on
4. Action: Start program → `node`
5. Arguments: `start.js`
6. Start in: path ke folder `leobot-telegram`

Atau pakai `pm2-windows-service` (sama kayak VPS, lihat DEPLOY-VPS.md).

---

## 7. Stop bot

Di terminal: `Ctrl+C` (Windows) atau `Ctrl+C` (mac/linux).

Bot graceful-shutdown — kalau ada job yang lagi jalan, browser bakal di-close
dan akun yang udah complete tetep ke-save.

---

## 8. Workflow harian

```bash
# Pagi: nyalain bot
node start.js

# Sambil bot jalan, di Telegram:
# /generate 10        — bikin 10 akun Canva+Leonardo
# /credits            — refresh credit semua akun
# /list               — daftar akun
# /download           — dapetin ZIP

# Malam: stop
# Ctrl+C di terminal
```

Akun-akun tersimpan di folder `accounts/<email>.json` plus master `emails.txt`.

---

## 9. Troubleshooting umum

| Gejala | Cek |
|---|---|
| Bot ga balas chat | Cek `pm2 logs` / terminal output. Kemungkinan token salah / userId salah |
| `/generate` keluar tapi semua akun fail "Canva server error" | Ganti proxy / country, terutama kalau dari IP datacenter besar |
| OTP timeout terus | Cek API key Hubify pakai `/settings`. Cek juga subscription Hubify masih aktif |
| Chrome ga kebuka | Install Chrome stable (bukan Chromium). `playwright-core` butuh `channel: chrome` |
| Chrome muncul tapi langsung crash | Update Chrome ke versi terbaru |
| `ECONNRESET` saat polling Hubify | Internet flaky atau Hubify lagi maintenance. Bot auto-retry |

---

## 10. Update bot

```bash
git pull
npm install
# restart: Ctrl+C, terus node start.js
```

`config.json` dan `accounts/` ga ke-overwrite karena udah di-`.gitignore`.
