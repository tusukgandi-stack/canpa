# Deploy VPS (Ubuntu 22.04+ / Debian 12)

Panduan deploy bot di VPS Linux supaya jalan 24/7. Bot wajib jalan
**non-headless** (`headless: false`) di prod karena Canva detect headless
keras banget. Solusi: pakai **Xvfb** (virtual display) supaya Chrome bisa
"buka window" di server tanpa monitor.

Untuk dev di laptop, baca [DEPLOY-LOCAL.md](./DEPLOY-LOCAL.md).

---

## 1. Spek VPS minimum

| Resource | Rekomendasi |
|---|---|
| RAM | 2 GB (4 GB lebih nyaman buat concurrency tinggi) |
| CPU | 2 vCPU |
| Disk | 10 GB |
| OS | Ubuntu 22.04 LTS / 24.04 LTS / Debian 12 |
| Bandwidth | unmetered atau ≥1 TB |

Provider yang udah ke-tested: DigitalOcean, Vultr, Hetzner, Contabo.

> **Catatan:** RAM 1 GB cukup buat concurrency 1-2, tapi Chrome boros memory.
> Kalau OOM, naikkan swap atau upgrade RAM.

---

## 2. Initial server setup

### 2.1 SSH ke VPS

```bash
ssh root@<vps_ip>
```

### 2.2 Bikin user non-root (rekomendasi)

```bash
adduser leobot
usermod -aG sudo leobot
# copy SSH key supaya bisa login langsung
rsync --archive --chown=leobot:leobot ~/.ssh /home/leobot
su - leobot
```

Sisa langkah jalan sebagai user `leobot`.

### 2.3 Update + tools dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

---

## 3. Install dependencies

### 3.1 Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node -v   # harus v20.x atau lebih
```

### 3.2 Google Chrome

Wajib Chrome stable (bukan Chromium / Snap), karena `playwright-core` pakai
`channel: "chrome"`.

```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
google-chrome --version
```

### 3.3 Xvfb (virtual display)

```bash
sudo apt install -y xvfb
xvfb-run --help
```

### 3.4 PM2 (process manager)

```bash
sudo npm install -g pm2
pm2 -v
```

---

## 4. Clone + install project

```bash
cd ~
git clone <your-repo-url> leobot-telegram
cd leobot-telegram
npm install
```

---

## 5. Konfigurasi

### 5.1 Bikin Telegram bot

Lihat [DEPLOY-LOCAL.md § 3](./DEPLOY-LOCAL.md#3-bikin-telegram-bot) untuk dapetin token dan user ID.

### 5.2 Edit `config.json`

```bash
nano config.json
```

Isi minimal:

```json
{
  "telegramToken": "PASTE_TOKEN_DARI_BOTFATHER",
  "ownerIds": [PASTE_USER_ID_KAMU],
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

> **`headless: false` wajib** di VPS. Xvfb bakal kasih virtual display.

Save: `Ctrl+O` → `Enter` → `Ctrl+X`.

---

## 6. Test sekali manual

```bash
xvfb-run -a --server-args="-screen 0 1920x1080x24" node start.js
```

Output yang bener:

```
[2026-05-29 10:00:00] [bot] Boot. owners=987654321
[2026-05-29 10:00:00] [bot] accounts dir: /home/leobot/leobot-telegram/accounts
```

Buka Telegram, chat bot kamu, kirim `/start`. Harusnya dibalik. 

Stop dengan `Ctrl+C` setelah confirm jalan.

---

## 7. Run via PM2 (auto-restart + auto-start saat boot)

### 7.1 Start bot

```bash
cd ~/leobot-telegram
pm2 start "xvfb-run -a --server-args='-screen 0 1920x1080x24' node start.js" \
  --name leobot
```

Cek status:

```bash
pm2 status
pm2 logs leobot          # tail log live
pm2 logs leobot --lines 100   # 100 baris terakhir
```

### 7.2 Save PM2 state

```bash
pm2 save
```

### 7.3 Auto-start saat reboot VPS

```bash
pm2 startup
```

PM2 bakal print 1 perintah `sudo` panjang. **Copy-paste perintah itu**, jalanin
sekali (registers PM2 sebagai systemd service).

```bash
# contoh output (jangan copy ini, copy yang muncul di terminal kamu):
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u leobot --hp /home/leobot
```

Setelah itu, kapan pun VPS reboot, bot otomatis nyala.

---

## 8. Operasional

### Restart bot

```bash
pm2 restart leobot
```

### Update bot

```bash
cd ~/leobot-telegram
git pull
npm install
pm2 restart leobot
```

`config.json` dan `accounts/` aman karena `.gitignore`.

### Lihat resource usage

```bash
pm2 monit            # interactive dashboard
pm2 status           # quick view
htop                 # process tree (install: sudo apt install htop)
```

### Lihat akun yang ke-save

```bash
ls accounts/                          # list file
cat accounts/emails.txt               # master email list
```

Atau dari Telegram: `/list` dan `/download` (download ZIP).

### Stop bot

```bash
pm2 stop leobot
```

### Delete bot dari PM2

```bash
pm2 delete leobot
pm2 save
```

---

## 9. Hardening (rekomendasi keras)

### 9.1 SSH key only (matiin password login)

```bash
sudo nano /etc/ssh/sshd_config
```

Set:
```
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl restart sshd
```

### 9.2 Firewall (UFW)

```bash
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status
```

Bot ga butuh open port (long-polling Telegram, outbound only).

### 9.3 Fail2ban

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

### 9.4 Lindungi `config.json`

File ini berisi `telegramToken` + Hubify key + proxy passwords.
Pastikan permission ketat:

```bash
chmod 600 config.json
```

---

## 10. Skala vertical (kalau bot lambat)

| Gejala | Solusi |
|---|---|
| Job ngambil lama, RAM penuh | Turunin `/setconc 2` atau upgrade RAM |
| Chrome zombie processes numpuk | `pkill chrome` (bot biasanya bersih sendiri di finally; ini emergency) |
| Disk penuh karena `accounts/` | `/download` → simpan ke laptop, lalu `rm accounts/*.json` |
| Bot ga balas command | `pm2 logs leobot --lines 50`, cari error. Atau `pm2 restart leobot` |

---

## 11. Backup `accounts/` rutin

Akun di folder `accounts/` adalah aset paling penting. Set cron job harian:

```bash
crontab -e
```

Tambah baris:
```
0 3 * * * cd /home/leobot/leobot-telegram && tar czf ~/backups/accounts-$(date +\%Y\%m\%d).tar.gz accounts/
```

Bikin folder dulu:
```bash
mkdir -p ~/backups
```

Atau kirim backup ke cloud (rclone ke S3/GDrive/Dropbox).

---

## 12. Multi-bot di 1 VPS (advanced)

Mau jalanin >1 bot Telegram di 1 VPS? Tinggal clone repo lagi ke folder beda,
isi `config.json` masing-masing dengan token+ownerIds beda, terus:

```bash
cd ~/leobot-telegram-2
pm2 start "xvfb-run -a --server-args='-screen 0 1920x1080x24' node start.js" \
  --name leobot2
pm2 save
```

Tiap bot dapet display server Xvfb sendiri (`-a` = auto-pick port).

---

## 13. Troubleshooting

### Bot ga balas chat sama sekali

```bash
pm2 logs leobot --lines 100
```

Cek:
- `Unauthorized: invalid token` → token salah, edit `config.json`
- `Boot. owners=...` ga muncul → file `config.json` ga ke-load (cek path & permissions)
- Ga ada log baru pas chat → user kamu bukan owner. Cek `ownerIds` di `config.json`

### "Canva server error setelah OTP" di semua akun

IP VPS ke-flag oleh Canva. Pakai proxy residential:

```
/addproxy http://user:pass@gateway.dataimpulse.com:823
```

Untuk DataImpulse, pakai param country di username:

```
/addproxy http://user__cr.id:pass@gateway.dataimpulse.com:823
```

(`id` = Indonesia, `us` = USA, `sg` = Singapore. Daftar lengkap di dashboard
DataImpulse.)

### "Tunggu OTP timeout" di semua akun

Cek API key Hubify:

```
/settings
```

Kalau key kosong / salah, set ulang:

```
/setapikey <hubify_api_key_yang_baru>
```

### Chrome ga jalan / `Failed to launch browser`

```bash
# Cek Chrome ada
which google-chrome
google-chrome --version

# Cek Xvfb ada
which xvfb-run

# Test manual
xvfb-run -a google-chrome --headless --dump-dom https://example.com
```

Kalau error "Permission denied", cek apakah user `leobot` punya akses ke
`/usr/bin/google-chrome` (default sih bisa).

### VPS reboot, bot ga nyala

```bash
pm2 list                    # masih ada?
pm2 resurrect               # restore dari pm2.save
sudo systemctl status pm2-leobot   # cek service
```

Kalau ga ada service, ulang `pm2 startup` (langkah 7.3).

### Out of memory

```bash
free -h                              # cek RAM
sudo dmesg | grep -i 'killed process'   # ada OOM kill?
```

Solusi:
- Turunin `/setconc 1` atau `2`
- Tambah swap:
  ```bash
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

---

## 14. Quick reference — perintah PM2

| Perintah | Fungsi |
|---|---|
| `pm2 start ... --name leobot` | Start bot |
| `pm2 stop leobot` | Stop |
| `pm2 restart leobot` | Restart |
| `pm2 delete leobot` | Hapus dari PM2 |
| `pm2 logs leobot` | Tail log live |
| `pm2 logs leobot --lines 100 --nostream` | Last 100 log baris (no follow) |
| `pm2 monit` | Interactive dashboard |
| `pm2 save` | Simpan state PM2 |
| `pm2 resurrect` | Restore state PM2 |
| `pm2 startup` | Setup auto-start |

---

## 15. Recap setup VPS lengkap (one-liner)

Kalau mau setup VPS baru dari zero, sequence ini bisa dipake referensi:

```bash
# 1. Login VPS, jadi user leobot
# 2. Install dependencies
sudo apt update && sudo apt install -y curl git build-essential xvfb
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
sudo npm install -g pm2

# 3. Clone + install
git clone <your-repo-url> ~/leobot-telegram
cd ~/leobot-telegram
npm install

# 4. Edit config.json (telegramToken + ownerIds)
nano config.json
chmod 600 config.json

# 5. Run
pm2 start "xvfb-run -a --server-args='-screen 0 1920x1080x24' node start.js" --name leobot
pm2 save
pm2 startup    # ikuti instruksi yang muncul
```

Done. Cek `/start` di Telegram, kalau dibalik berarti udah jalan.
