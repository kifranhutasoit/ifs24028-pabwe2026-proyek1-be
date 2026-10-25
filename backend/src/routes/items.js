// Endpoint barang preloved dan tawaran
const express = require('express');
const db = require('../db');
const { ok, fail, fileUrl, authMiddleware, uploadSingle, removeUploadedFile } = require('../middleware');

const router = express.Router();
router.use(authMiddleware);

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

const ITEM_SQL = `
  SELECT i.*, u.name AS author_name, u.photo AS author_photo
  FROM items i JOIN users u ON u.id = i.user_id`;

const toItem = (r) => ({
  id: r.id,
  user_id: r.user_id,
  title: r.title,
  description: r.description,
  price: r.price,
  is_sold: Boolean(r.is_sold),
  cover: fileUrl(r.cover),
  created_at: r.created_at,
  author: { id: r.user_id, name: r.author_name, photo: fileUrl(r.author_photo) }
});

function findItem(req, res) {
  const row = db.prepare(`${ITEM_SQL} WHERE i.id = ?`).get(req.params.id);
  if (!row) fail(res, 404, 'Barang tidak ditemukan');
  return row;
}

function findOwnItem(req, res) {
  const row = findItem(req, res);
  if (!row) return null;
  if (row.user_id !== req.user.id) {
    fail(res, 403, 'Anda tidak berhak mengubah barang ini');
    return null;
  }
  return row;
}

function validateItem(body) {
  const errors = [];
  if (!isText(body.title)) errors.push('Judul wajib diisi');
  else if (body.title.trim().length > 120) errors.push('Judul maksimal 120 karakter');
  if (body.description !== undefined && typeof body.description !== 'string') errors.push('Deskripsi harus berupa teks');
  if (!(Number.isInteger(body.price) && body.price >= 0)) errors.push('Harga harus bilangan bulat >= 0');
  return errors;
}

// Daftar barang. Query: is_me=1, is_sold=0|1
router.get('/', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.is_me === '1') {
    where.push('i.user_id = @me');
    params.me = req.user.id;
  }
  if (req.query.is_sold === '0' || req.query.is_sold === '1') {
    where.push('i.is_sold = @sold');
    params.sold = Number(req.query.is_sold);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = db.prepare(`${ITEM_SQL} ${clause} ORDER BY i.created_at DESC, i.id DESC`);
  const rows = where.length ? stmt.all(params) : stmt.all();
  return ok(res, 'Daftar barang', { items: rows.map(toItem) });
});

router.post('/', (req, res) => {
  const errors = validateItem(req.body);
  if (errors.length) return fail(res, 400, errors.join('; '));
  const { title, description = '', price } = req.body;
  const info = db
    .prepare('INSERT INTO items (user_id, title, description, price) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title.trim(), description, price);
  return ok(res, 'Barang berhasil ditambahkan', { item_id: Number(info.lastInsertRowid) }, 201);
});

router.get('/:id', (req, res) => {
  const row = findItem(req, res);
  if (!row) return null;
  const isOwner = row.user_id === req.user.id;
  const offers = db
    .prepare(
      `SELECT o.id, o.offer, o.created_at, o.user_id, u.name, u.email, u.photo
       FROM offers o JOIN users u ON u.id = o.user_id
       WHERE o.item_id = ? ORDER BY o.offer DESC, o.id`
    )
    .all(row.id)
    .map((o) => ({
      id: o.id,
      offer: o.offer,
      created_at: o.created_at,
      user: {
        id: o.user_id,
        name: o.name,
        photo: fileUrl(o.photo),
        // Email penawar hanya terlihat oleh penjual agar bisa dihubungi.
        ...(isOwner && { email: o.email })
      }
    }));
  const mine = offers.find((o) => o.user.id === req.user.id);
  return ok(res, 'Detail barang', {
    item: { ...toItem(row), offers, my_offer: mine ? { id: mine.id, offer: mine.offer } : null }
  });
});

router.put('/:id', (req, res) => {
  const row = findOwnItem(req, res);
  if (!row) return null;
  const errors = validateItem(req.body);
  if (errors.length) return fail(res, 400, errors.join('; '));
  const { title, description = '', price } = req.body;
  db.prepare('UPDATE items SET title = ?, description = ?, price = ? WHERE id = ?').run(
    title.trim(),
    description,
    price,
    row.id
  );
  return ok(res, 'Barang berhasil diperbarui');
});

router.put('/:id/sold', (req, res) => {
  const row = findOwnItem(req, res);
  if (!row) return null;
  if (typeof req.body.is_sold !== 'boolean') return fail(res, 400, 'is_sold harus berupa true atau false');
  db.prepare('UPDATE items SET is_sold = ? WHERE id = ?').run(req.body.is_sold ? 1 : 0, row.id);
  return ok(res, req.body.is_sold ? 'Barang ditandai terjual' : 'Barang dibuka kembali');
});

router.post(
  '/:id/cover',
  (req, res, next) => {
    // Pastikan barang milik pengguna sebelum file disimpan.
    if (!findOwnItem(req, res)) return null;
    return next();
  },
  uploadSingle('cover'),
  (req, res) => {
    if (!req.file) return fail(res, 400, 'File gambar wajib diisi');
    const row = db.prepare('SELECT cover FROM items WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE items SET cover = ? WHERE id = ?').run(req.file.filename, req.params.id);
    removeUploadedFile(row.cover);
    return ok(res, 'Foto barang berhasil diperbarui');
  }
);

router.delete('/:id', (req, res) => {
  const row = findOwnItem(req, res);
  if (!row) return null;
  db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
  removeUploadedFile(row.cover);
  return ok(res, 'Barang berhasil dihapus');
});

router.post('/:id/offers', (req, res) => {
  const row = findItem(req, res);
  if (!row) return null;
  if (row.user_id === req.user.id) return fail(res, 400, 'Tidak dapat menawar barang sendiri');
  if (row.is_sold) return fail(res, 400, 'Barang sudah terjual');
  const { offer } = req.body;
  if (!(Number.isInteger(offer) && offer > 0)) return fail(res, 400, 'Tawaran harus bilangan bulat > 0');
  if (db.prepare('SELECT 1 FROM offers WHERE item_id = ? AND user_id = ?').get(row.id, req.user.id)) {
    return fail(res, 400, 'Anda sudah mengajukan tawaran untuk barang ini');
  }
  db.prepare('INSERT INTO offers (item_id, user_id, offer) VALUES (?, ?, ?)').run(row.id, req.user.id, offer);
  return ok(res, 'Tawaran berhasil dikirim', null, 201);
});

router.delete('/:id/offers', (req, res) => {
  const row = findItem(req, res);
  if (!row) return null;
  const info = db.prepare('DELETE FROM offers WHERE item_id = ? AND user_id = ?').run(row.id, req.user.id);
  if (!info.changes) return fail(res, 404, 'Anda belum mengajukan tawaran');
  return ok(res, 'Tawaran berhasil dibatalkan');
});

module.exports = router;
