// Entry point server HTTP Oper.in (dapat dijalankan dengan Bun maupun Node 22.13+/24)
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Muat file .env dari folder kerja, backend/, atau root repo jika belum dimuat otomatis
function loadEnvIfNeeded() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '../..', '.env')
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnvIfNeeded();

if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
  console.warn('[PERINGATAN] JWT_SECRET belum diisi. Memakai kunci bawaan; isi JWT_SECRET di production.');
  process.env.JWT_SECRET = 'operin-default-jwt-secret-2026';
}

// Bangun aset frontend otomatis jika belum ada, agar satu server cukup untuk deployment
function ensureFrontendBuild() {
  if (process.env.NODE_ENV === 'test') return;
  const rootDir = path.resolve(__dirname, '../..');
  const distIndex = path.join(rootDir, 'frontend', 'dist', 'index.html');
  if (fs.existsSync(distIndex) || !fs.existsSync(path.join(rootDir, 'frontend', 'index.html'))) return;
  for (const cmd of ['bun run build', 'npm run build']) {
    try {
      console.log(`Membangun aset frontend (${cmd})...`);
      execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
      return;
    } catch {
      // coba perintah berikutnya; API tetap berjalan walau build gagal
    }
  }
}

ensureFrontendBuild();

const app = require('./app');
const db = require('./db');

const PORT = Number(process.env.PORT) || 5000;

try {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM items').get();
  const server = app.listen(PORT, () => {
    console.log(`Oper.in API berjalan di http://localhost:${PORT}`);
    console.log(`Lokasi database : ${db.dbPath}`);
    console.log(`Data tersedia   : ${total} barang`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[ERROR] Port ${PORT} sedang digunakan aplikasi lain. Ubah PORT di file .env.`);
    } else {
      console.error(`[ERROR] Gagal menjalankan server: ${err.message}`);
    }
    process.exit(1);
  });
} catch (err) {
  console.error(`[ERROR] Terjadi kegagalan saat inisialisasi server: ${err.message}`);
  process.exit(1);
}
