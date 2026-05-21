# Panzek Deploy CLI

CLI interaktif untuk deploy dan maintenance project Laravel di server.

Fokus utama:
- deploy Laravel end-to-end
- setup Nginx + rollback aman
- setup Cloudflare Tunnel
- bootstrap dependency server
- mode CI/non-interactive yang bisa diparse mesin

## Preview

![Preview terminal Panzek Deploy CLI](./assets/terminal-preview.svg?v=2)

## Fitur Utama

- Wizard interaktif berbasis `@clack/prompts`
- Fetch-style header di terminal
- Action langsung via `--action`
- `--mode normal|dry-run` untuk kontrol mode tanpa prompt
- `--output json` (JSONL strict) untuk CI/pipeline
- `--theme amber|ocean|mono|auto`
- `--preview-theme` untuk lihat preset tema
- Retry per langkah dengan `--max-retries`
- Deploy Laravel dari repo Git
- Setup database MySQL/MariaDB + update `.env`
- Setup Nginx + validasi + rollback
- Setup Cloudflare Tunnel (`cloudflared`)
- Bootstrap server dependency lintas package manager
- Fix permission Laravel
- Preflight check readiness server

## Instalasi

Install global dari npm:

```bash
npm install -g panzek-deploy-cli
```

Install global dari source lokal:

```bash
npm install -g .
```

Jalankan dari source:

```bash
npm install
npm start
```

## Menjalankan

Global:

```bash
panzek-deploy
```

Dari source:

```bash
node index.js
```

## Opsi CLI

```bash
panzek-deploy --help
```

- `--action <nama>`: `deploy-laravel`, `setup-nginx`, `setup-cloudflare`, `update-project`, `setup-server`, `fix-permissions`, `preflight`
- `--mode <normal|dry-run>`
- `--dry-run`
- `--theme <amber|ocean|mono|auto>`
- `--preview-theme`
- `--output <table|json>`
- `--no-color`
- `--max-retries <angka>` (default `3`)
- `--yes`
- `--non-interactive`
- `--config <path>` (default `./panzek.config.json`)
- `--report-json <path>`
- `--no-banner`

Contoh:

```bash
panzek-deploy --action preflight --non-interactive
panzek-deploy --action preflight --output json --no-color
panzek-deploy --action deploy-laravel --non-interactive --config ./panzek.config.json --report-json ./report.json
panzek-deploy --preview-theme
```

Catatan output JSON:
- Saat `--output json` aktif, output ditulis sebagai JSON line (`jsonl`) agar aman diparse pipeline.

## Konfigurasi Non-Interactive

Contoh:

```json
{
  "workflows": {
    "deploy-laravel": {
      "repo": "https://github.com/acme/laravel-app.git",
      "branch": "main",
      "targetDir": "/var/www/laravel-app",
      "steps": [
        "composer install --no-dev --optimize-autoloader",
        "npm install",
        "npm run build"
      ],
      "database": {
        "enabled": true,
        "dbName": "laravel_app",
        "dbUser": "laravel_user",
        "dbPassword": "secret"
      }
    },
    "setup-nginx": {
      "domain": "app.example.com",
      "appPath": "/var/www/laravel-app",
      "phpVersion": "8.3"
    },
    "setup-cloudflare": {
      "tunnelName": "app-tunnel",
      "hostname": "app.example.com",
      "serviceUrl": "http://localhost:80",
      "configPath": "/etc/cloudflared/app.yml",
      "installService": true,
      "runLogin": false
    },
    "update-project": {
      "projectPath": "/var/www/laravel-app"
    }
  }
}
```

Template siap pakai:
- `./panzek.config.ci.example.json`

## Workflow

1. `deploy-laravel`
- clone/update repo
- setup `.env`
- build steps
- setup DB
- artisan post-deploy
- fix permission

2. `setup-nginx`
- validasi domain/path/php-fpm
- generate config
- `nginx -t`
- reload service
- rollback jika gagal

3. `setup-cloudflare`
- create named tunnel
- ingress validate
- DNS route
- optional install/start service

4. `update-project`
- scan project Git
- pull + build + artisan (jika Laravel)

5. `setup-server`
- deteksi dependency
- install package wajib/opsional (`apt`, `dnf`, `yum`, `apk`, `pacman`)

6. `fix-permissions`
- normalisasi permission Laravel

7. `preflight`
- readiness check tanpa perubahan sistem

## Log, Report, Exit Code

Log sesi:

```bash
/tmp/panzek/logs/panzek-<timestamp>.log
```

Exit code:
- `0` sukses
- `1` runtime error
- `2` validasi arg/config gagal
- `3` dependency wajib tidak tersedia
- `4` workflow gagal

## Keamanan

- Nilai sensitif dimasking di log/report
- Pola password/token dibersihkan dari output report

## Kebutuhan Umum

- Node.js `>=18`
- `git`
- `composer`
- `npm`
- `php`
- `mysql`/`mariadb` client

## Publish npm v2.0.0

Berikut langkah rilis mayor ke npm sebagai versi `2.0.0`.

1. Pastikan login npm:

```bash
npm whoami
```

Kalau belum login:

```bash
npm login
```

2. Pastikan branch bersih dan test lolos:

```bash
git status
npm run check
npm test
```

3. Naikkan versi package:

```bash
npm version 2.0.0
```

Perintah ini otomatis:
- update `package.json`
- update `package-lock.json`
- bikin git tag `v2.0.0`

4. Push commit + tag:

```bash
git push origin main
git push origin v2.0.0
```

5. Publish ke npm:

```bash
npm publish --access public
```

6. Verifikasi versi live:

```bash
npm view panzek-deploy-cli version
```

Harus keluar `2.0.0`.

### Quick Path (sekali jalan)

```bash
npm run check && npm test && npm version 2.0.0 && git push origin main --follow-tags && npm publish --access public
```

## Repository

[https://github.com/darksoul729/panzek-deploy-cli](https://github.com/darksoul729/panzek-deploy-cli)

## Lisensi

[MIT](./LICENSE)
