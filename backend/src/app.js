// Konfigurasi aplikasi Express (tanpa app.listen agar dapat diuji langsung)
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { ok, fail, getUploadDir, errorHandler } = require('./middleware');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const itemRoutes = require('./routes/items');

const NOT_FOUND_MESSAGE = 'Endpoint tidak ditemukan';

const app = express();

app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Pengecekan origin CORS, dapat dikonfigurasi lewat CLIENT_URL (dipisah koma)
function isOriginAllowed(origin) {
  if (!origin) return true;
  const allowed = new Set(
    (process.env.CLIENT_URL || '*')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return allowed.has('*') || allowed.has(origin);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      const err = new Error(`Origin ${origin} tidak diizinkan oleh kebijakan CORS`);
      err.status = 403;
      return callback(err);
    }
  })
);

app.use(express.json());

// File foto yang diunggah
app.use('/uploads', express.static(getUploadDir(), { maxAge: '7d' }));

app.get('/api/v1/health', (_req, res) => ok(res, 'Oper.in API berjalan normal', { status: 'ok' }));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/items', itemRoutes);

// Rute /api/* yang tidak dikenal
app.use('/api', (_req, res) => fail(res, 404, NOT_FOUND_MESSAGE));

// Cari hasil build frontend (frontend/dist atau dist)
function resolveFrontendDist(customCandidates) {
  const candidates = customCandidates || [
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, '../../dist')
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || null;
}

// Satu server: sajikan SPA Vue jika hasil build tersedia
const initialDistDir = resolveFrontendDist();
if (initialDistDir) {
  app.use('/assets', express.static(path.join(initialDistDir, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(initialDistDir, { index: false, maxAge: '1h' }));
}

app.get('*', (req, res, next) => {
  // File upload/aset yang tidak ada harus 404, bukan index.html
  if (req.path.startsWith('/uploads/') || req.path.startsWith('/assets/')) return next();
  const activeDistDir = resolveFrontendDist();
  if (!activeDistDir) return next();
  res.setHeader('Cache-Control', 'no-cache');
  return res.sendFile(path.join(activeDistDir, 'index.html'));
});

app.use((_req, res) => fail(res, 404, NOT_FOUND_MESSAGE));
app.use(errorHandler);

app.isOriginAllowed = isOriginAllowed;
app.resolveFrontendDist = resolveFrontendDist;

module.exports = app;
