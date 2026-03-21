# Panzek Deploy CLI

CLI interaktif untuk deploy dan maintenance project Laravel di server. Fokusnya bukan hanya menjalankan command, tetapi membuat alur deploy, update, setup database, setup Nginx, dan Cloudflare Tunnel terasa rapi saat dipakai langsung di terminal.

## Preview

![Preview terminal Panzek Deploy CLI](./assets/terminal-preview.svg?v=2)

## Fitur Utama

- Wizard interaktif berbasis `@clack/prompts`
- Tampilan terminal yang sudah dipoles dengan panel, summary card, katalog project, dan execution plan
- Deploy Laravel dari repository Git
- Update project yang sudah ada dengan memilih dari daftar project terdeteksi
- Setup database MySQL/MariaDB beserta user otomatis
- Dukungan login admin database via `sudo` socket, login biasa, dan login dengan `--ssl=off`
- Setup Nginx lengkap dengan validasi config dan rollback bila gagal
- Setup Cloudflare Tunnel dengan `cloudflared` named tunnel tanpa IPv4 publik
- Retry per langkah saat gagal tanpa mengulang wizard dari awal
- Error card dengan potongan output, kemungkinan penyebab, dan saran tindak lanjut
- Mode `dry-run` untuk pratinjau alur sebelum eksekusi

## Instalasi

Install global dari npm:

```bash
npm install -g panzek-deploy-cli
```

Install global dari source lokal:

```bash
npm install -g .
```

Atau jalankan langsung dari folder project:

```bash
npm install
npm start
```

## Panduan Global

Jika sudah terinstall secara global, command yang dipakai adalah:

```bash
panzek-deploy
```

Untuk update versi global:

```bash
npm install -g panzek-deploy-cli@latest
```

Untuk hapus instalasi global:

```bash
npm uninstall -g panzek-deploy-cli
```

Jika command `panzek-deploy` belum terbaca, cek lokasi binary global npm:

```bash
npm bin -g
```

Pastikan hasil path tersebut sudah masuk ke `PATH` shell Anda.

## Menjalankan

Jika terpasang global:

```bash
panzek-deploy
```

Jika dijalankan dari folder source:

```bash
node index.js
```

## Menu Utama

### 1. Deploy Laravel

Flow ini dipakai untuk project baru atau deployment ulang dari repository Git.

Yang dikerjakan:

- pilih mode `Jalankan langsung` atau `Pratinjau`
- clone atau update repository
- siapkan `.env`
- jalankan langkah build bawaan atau custom
- buat database dan user MySQL/MariaDB
- update kredensial database ke `.env`
- jalankan `key:generate`, `migrate`, `optimize:clear`, dan `optimize`
- rapikan permission Laravel

### 2. Setup Nginx

Flow ini membuat virtual host untuk project Laravel.

Yang dikerjakan:

- validasi domain, path project, dan versi PHP-FPM
- generate config Nginx
- salin ke `sites-available`
- aktifkan lewat `sites-enabled`
- jalankan `nginx -t`
- reload service Nginx
- rollback config bila validasi atau reload gagal

### 3. Setup Cloudflare

Flow ini fokus ke `cloudflared` named tunnel agar service bisa dipublish tanpa IPv4 publik.

Yang dikerjakan:

- login `cloudflared tunnel login`
- create named tunnel
- generate config ingress
- validate ingress
- create DNS route ke hostname publik
- optional install dan start service `cloudflared`

### 4. Update Project

Flow ini dipakai untuk project yang sudah ada di server.

Yang dikerjakan:

- scan project Git dari lokasi umum seperti `/var/www` dan folder kerja saat ini
- tampilkan katalog project yang terdeteksi
- pilih project dari daftar
- jalankan `git fetch`, `git checkout`, dan `git pull`
- jalankan `composer install`, `npm install`, dan `npm run build` bila relevan
- untuk Laravel, lanjut `migrate`, `optimize:clear`, `optimize`, dan perbaikan permission

## Kebutuhan Umum

- Node.js 18+
- `git`
- `composer`
- `npm`
- `php`
- `mysql` atau `mariadb` client

## Repository

[https://github.com/darksoul729/panzek-deploy-cli](https://github.com/darksoul729/panzek-deploy-cli)

## Lisensi

[MIT](./LICENSE)
