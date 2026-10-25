# Oper.in Backend API

REST API untuk **Oper.in: Platform Jual-Beli Barang Preloved IT Del**. Dibangun dengan Express.js dan SQLite lewat `node:sqlite` bawaan, sehingga berjalan di Bun maupun Node 22.13+/24 tanpa native addon.

Dependensi dipasang dari root repositori (`bun install`). Daftar endpoint, skema database, dan variabel lingkungan ada di [README root](../README.md).

## Menjalankan dari root repositori

```bash
bun install
cp .env.example .env
bun run start            # http://localhost:5000/api/v1
bun run test             # tes otomatis + coverage
```

## Isi folder

| Path | Fungsi |
| :--- | :--- |
| `src/app.js` | Konfigurasi Express (CORS, rute, penyajian SPA) |
| `src/server.js` | Entry point: muat `.env`, jalankan server |
| `src/db.js`, `schema.sql`, `seed.js` | Koneksi SQLite, skema, data awal |
| `src/middleware.js` | JWT, upload gambar maks. 2 MB (JPG, PNG, WEBP, GIF), error handler |
| `src/routes/` | `auth.js`, `users.js`, `items.js` |
| `tests/api.test.js` | Integration test seluruh endpoint |
| `uploads/` | Foto yang diunggah (isinya tidak ikut Git) |

## Akun demo

`demo@operin.id` / `demo12345` (juga `sari@operin.id` dan `budi@operin.id`).
