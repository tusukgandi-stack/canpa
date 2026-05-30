# Leo Bot Telegram

Telegram bot all-in-one (single-user, owner-only) yang gabung 3 fitur:

1. **`/generate <n>`** — full flow: signup Canva + Leonardo OAuth + cek credit
2. **`/signup <n>`** — signup Canva aja (Leonardo opsional via toggle)
3. **`/login`** — login akun Canva yang udah ada via OTP, auto-join Business + Leonardo opsional

Plus utilitas: cek credit massal, list akun, download ZIP semua hasil, kontrol
proxy & settings.

---

## Setup awal

### 1. Bikin Telegram bot

1. Chat [@BotFather](https://t.me/BotFather) → `/newbot` → kasih nama → copy `token`
2. Chat [@userinfobot](https://t.me/userinfobot) → copy `Id` kamu (angka)

### 2. Edit `config.json`

Bot bakal auto-bikin `config.json` pas pertama jalan kalau file ga ada. Kalau
mau bikin manual, contoh isi minimal:

```json
{
  "telegramToken": "123456:ABC-your-bot-token",
  "ownerIds": [123456789],
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

Sisa setting bisa di-set lewat command Telegram setelah bot jalan:
- `/setapikey <hubify_api_key>`
- `/setcanva <canva_business_url>`
- `/addproxy <proxy_url>` (atau `/loadproxy` reply file `.txt`)

---

## Run lokal (dev)

```bash
npm install
node start.js
```

Di Windows, `headless: false` jalan di mode windowed — Chrome bakal kebuka
beneran. Itu normal dan disarankan biar Canva ga curiga.

---

## Deploy VPS Linux

Target: Ubuntu 22.04+. Chrome WAJIB jalan non-headless via Xvfb.

```bash
# 1. Node.js >= 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. Chrome + Xvfb
sudo apt install -y xvfb google-chrome-stable

# 3. Clone & install
git clone <repo> leobot-telegram
cd leobot-telegram
npm install

# 4. Edit config.json (telegramToken + ownerIds wajib)
nano config.json

# 5. Run via pm2
sudo npm i -g pm2
pm2 start "xvfb-run -a --server-args='-screen 0 1920x1080x24' node start.js" --name leobot
pm2 save
pm2 startup
```

---

## Commands

### Mode commands

| Command | Fungsi |
|---|---|
| `/generate <n>` | Full: signup Canva + Leonardo + cek credit |
| `/signup <n>` | Signup Canva aja (Leonardo per setting) |
| `/login` | Login akun yang udah ada (reply daftar email) |

### Settings

| Command | Fungsi |
|---|---|
| `/start` | Halo + ringkasan status |
| `/help` | List command lengkap |
| `/settings` | Tunjukin semua setting (key di-mask) |
| `/setapikey <key>` | Set API key Hubify |
| `/setcanva <url>` | Set Canva Business URL |
| `/setdomain <id\|random>` | Set domain ID Hubify |
| `/setconc <n>` | Set concurrency (1-20) |
| `/headless <on\|off>` | Toggle headless |
| `/addproxy <url>` | Tambah 1 proxy |
| `/listproxy` | List proxy (password di-mask) |
| `/clearproxy` | Hapus semua proxy |
| `/loadproxy` | Reply file `.txt` → bot parse |
| `/togglemode <mode> <key> <on\|off>` | Toggle setting per-mode |

### Akun

| Command | Fungsi |
|---|---|
| `/credits` | Cek credit Leonardo semua akun |
| `/list` | Daftar email akun |
| `/download` | Kirim ZIP `accounts/` |
| `/cancel` | Batalkan job aktif |
| `/log` | 50 baris log terakhir |

---

## Format proxy yang di-support

- `host:port`
- `host:port:user:pass`
- `user:pass@host:port`
- `http://host:port` / `http://user:pass@host:port`
- `socks5://...`

### DataImpulse sticky session

Kalau proxy host = `dataimpulse.com`, bot auto-inject `__sessid.<unique>` di
username biar tiap akun punya IP berbeda tapi sticky di akun yang sama.

Param DataImpulse berguna:
- `__cr.id` / `__cr.us` / `__cr.sg` → country target
- `__sessttl.5` → session lifetime menit

---

## Troubleshooting

| Gejala | Cara |
|---|---|
| "Canva server error" | Ganti proxy / country (DataImpulse: `__cr.id`) |
| OTP timeout | Cek API key Hubify (`/settings`) |
| Browser ga jalan di VPS | Cek Xvfb running, port :99 idle |
| Bot ga balas | Cek token + `ownerIds` + `pm2 logs leobot` |

---

## Constraint

- File-based, no database
- Telegram only, no web dashboard
- `headless: false` wajib di prod
- Single-user (whitelist `ownerIds`)

## Layout penyimpanan akun

Akun disimpan terpisah per kategori biar gampang dibedain:

```
accounts/
├─ generate/   ← /generate: Canva + Leonardo + credit (ada leonardo + credits)
├─ signup/     ← /signup: Canva only
└─ login/      ← /login: akun existing yang di-login ulang
```

Tiap kategori punya `emails.txt` sendiri. Tiap file `<email>.json` berisi
`storageState` (cookies+localStorage), dan khusus generate juga simpan
`leonardo.accessToken` + `creditRequest` biar `/credits` bisa cek cepat tanpa
buka browser.

Tiap job selesai (`/generate`, `/signup`, `/login`), bot langsung kirim detail
akun (email lengkap) di chat — ga perlu `/list` lagi. `/list` mengelompokkan
semua akun per kategori.
