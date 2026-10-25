// Endpoint pengguna: daftar, profil, foto, dan kata sandi
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { ok, fail, fileUrl, authMiddleware, uploadSingle, removeUploadedFile } = require('../middleware');

const router = express.Router();
router.use(authMiddleware);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, photo: fileUrl(u.photo) });

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY name').all();
  return ok(res, 'Daftar pengguna', { users: rows.map(publicUser) });
});

router.get('/me', (req, res) => ok(res, 'Profil pengguna', { user: publicUser(req.user) }));

router.put('/me', (req, res) => {
  const { name, email } = req.body;
  if (!isText(name)) return fail(res, 400, 'Nama wajib diisi');
  if (!isText(email) || !EMAIL_RE.test(email.trim())) return fail(res, 400, 'Email tidak valid');
  const used = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), req.user.id);
  if (used) return fail(res, 400, 'Email sudah dipakai pengguna lain');
  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), email.trim(), req.user.id);
  return ok(res, 'Profil berhasil diperbarui');
});

router.post('/me/photo', uploadSingle('photo'), (req, res) => {
  if (!req.file) return fail(res, 400, 'File foto wajib diisi');
  db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(req.file.filename, req.user.id);
  removeUploadedFile(req.user.photo);
  return ok(res, 'Foto profil berhasil diperbarui');
});

router.put('/password', (req, res) => {
  const { password, new_password, new_password_confirmation } = req.body;
  if (typeof password !== 'string' || !bcrypt.compareSync(password, req.user.password_hash)) {
    return fail(res, 400, 'Kata sandi saat ini salah');
  }
  if (typeof new_password !== 'string' || new_password.length < 6) {
    return fail(res, 400, 'Kata sandi baru minimal 6 karakter');
  }
  if (new_password !== new_password_confirmation) return fail(res, 400, 'Konfirmasi kata sandi tidak sama');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  return ok(res, 'Kata sandi berhasil diubah');
});

module.exports = router;
