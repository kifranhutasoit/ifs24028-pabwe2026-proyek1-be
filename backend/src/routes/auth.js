// Endpoint autentikasi: register, login, logout
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { ok, fail, getJwtSecret } = require('../middleware');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!isText(name)) return fail(res, 400, 'Nama wajib diisi');
  if (!isText(email) || !EMAIL_RE.test(email.trim())) return fail(res, 400, 'Email tidak valid');
  if (typeof password !== 'string' || password.length < 6) return fail(res, 400, 'Kata sandi minimal 6 karakter');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim())) {
    return fail(res, 400, 'Email sudah terdaftar');
  }
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name.trim(), email.trim(), bcrypt.hashSync(password, 10));
  return ok(res, 'Pendaftaran berhasil, silakan masuk', { id: Number(info.lastInsertRowid) }, 201);
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = isText(email) ? db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) : null;
  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash)) {
    return fail(res, 401, 'Email atau kata sandi salah');
  }
  const token = jwt.sign({ sub: user.id }, getJwtSecret(), { expiresIn: '7d' });
  return ok(res, 'Berhasil masuk', { token });
});

// Token bersifat stateless: logout cukup menghapus token di sisi klien.
router.post('/logout', (_req, res) => ok(res, 'Berhasil keluar'));

module.exports = router;
