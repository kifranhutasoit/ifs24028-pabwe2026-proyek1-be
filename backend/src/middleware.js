// Middleware autentikasi JWT, upload file (multer), dan error handler global
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./db');

const RUNTIME_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');
const SERVER_ERROR_MSG = 'Terjadi kesalahan pada server';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// Format respons seragam: { status: 'success' | 'fail', message, data }
const ok = (res, message, data = null, code = 200) => res.status(code).json({ status: 'success', message, data });
const fail = (res, code, message) => res.status(code).json({ status: 'fail', message, data: null });

function getJwtSecret() {
  return process.env.JWT_SECRET || RUNTIME_FALLBACK_KEY;
}

// Pastikan direktori upload dapat ditulis oleh user non-root di container Alpine
function getUploadDir(customDir) {
  const defaultDir = path.join(__dirname, '..', 'uploads');
  const resolved = path.resolve(process.cwd(), customDir || process.env.UPLOAD_DIR || defaultDir);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
    return resolved;
  } catch {
    const fallback = path.join(os.tmpdir(), 'operin-uploads');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

// Alamat publik file upload. Relatif ("/uploads/x.png") kecuali PUBLIC_URL diisi.
function fileUrl(name) {
  if (!name) return '';
  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return `${base}/uploads/${name}`;
}

// Hapus file dari folder upload dengan aman jika ada
function removeUploadedFile(filename) {
  if (!filename) return false;
  try {
    const filePath = path.join(getUploadDir(), path.basename(filename));
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

const multerInstance = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, getUploadDir()),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${IMAGE_EXT[file.mimetype]}`)
  }),
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) return cb(null, true);
    const err = new Error('File harus berupa gambar (JPG, PNG, WEBP, atau GIF)');
    err.status = 400;
    return cb(err, false);
  },
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

function uploadSingle(fieldName) {
  return (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'Ukuran file terlalu besar. Maksimal 2 MB');
      if (err instanceof multer.MulterError) return fail(res, 400, `Kesalahan upload file: ${err.message}`);
      return fail(res, err.status || 400, err.message || 'Gagal mengunggah file');
    });
  };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return fail(res, 401, 'Akses ditolak. Token tidak ditemukan');
  }
  try {
    const payload = jwt.verify(header.slice(7), getJwtSecret());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return fail(res, 401, 'Pengguna tidak ditemukan');
    req.user = user;
    return next();
  } catch {
    return fail(res, 401, 'Token tidak valid atau sudah kedaluwarsa');
  }
}

function errorHandler(err, req, res, _next) {
  if (req.file && req.file.filename) removeUploadedFile(req.file.filename);
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'JSON tidak valid');

  const statusCode = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  if (statusCode === 500 && process.env.NODE_ENV !== 'test') console.error(err);
  const message = statusCode === 500 && isProd ? SERVER_ERROR_MSG : err.message || SERVER_ERROR_MSG;
  return fail(res, statusCode, message);
}

module.exports = {
  ok,
  fail,
  fileUrl,
  authMiddleware,
  uploadSingle,
  errorHandler,
  getUploadDir,
  removeUploadedFile,
  getJwtSecret
};
