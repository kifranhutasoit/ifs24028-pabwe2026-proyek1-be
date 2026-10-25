// Pengujian REST API Oper.in (integration test dengan fetch bawaan, dapat dijalankan Vitest maupun bun:test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

// Set environment pengujian sebelum meng-import app dan db (tidak bergantung pada .env)
const testUploadDir = path.join(os.tmpdir(), `operin-test-uploads-${Date.now()}`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-operin-ci-2026';
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = testUploadDir;
delete process.env.PUBLIC_URL;

const { describe, test, expect, beforeAll, afterAll } =
  typeof Bun !== 'undefined' ? require('bun:test') : globalThis;

const app = require('../src/app');
const db = require('../src/db');
const { seedDatabase } = require('../src/seed');
const { errorHandler, getJwtSecret, getUploadDir, removeUploadedFile, fileUrl } = require('../src/middleware');

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082',
    'hex'
  )
);

describe('Oper.in REST API', () => {
  let server;
  let origin = '';
  let base = '';
  let counter = 0;

  beforeAll(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${server.address().port}`;
        base = `${origin}/api/v1`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testUploadDir, { recursive: true, force: true });
  });

  async function call(method, url, { token, body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method,
      headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined)
    });
    return { status: res.status, json: await res.json() };
  }

  async function signup(label) {
    counter += 1;
    const email = `${label}${counter}@del.ac.id`;
    const name = `${label} ${counter}`;
    await call('POST', '/auth/register', { body: { name, email, password: 'rahasia1' } });
    const { json } = await call('POST', '/auth/login', { body: { email, password: 'rahasia1' } });
    return { token: json.data.token, email, name };
  }

  const createItem = async (token, extra = {}) =>
    (await call('POST', '/items', { token, body: { title: 'Kipas Angin', price: 60000, ...extra } })).json.data.item_id;

  const imageForm = (field, type = 'image/png', name = 'foto.png', bytes = PNG_BYTES) => {
    const form = new FormData();
    form.append(field, new Blob([bytes], { type }), name);
    return form;
  };

  // ---------- umum ----------
  test('health check, endpoint /api tak dikenal, dan JSON rusak', async () => {
    let r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe('ok');

    r = await call('GET', '/tidak-ada');
    expect(r.status).toBe(404);
    expect(r.json.status).toBe('fail');

    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{rusak'
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('JSON tidak valid');
  });

  test('rute non-API tanpa build frontend mengembalikan 404 JSON', async () => {
    if (app.resolveFrontendDist()) return; // build frontend tersedia, rute ditangani SPA
    const res = await fetch(`${origin}/halaman-apa-saja`);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe('fail');
  });

  test('resolveFrontendDist mencari folder build yang memiliki index.html', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operin-dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    expect(app.resolveFrontendDist([dir])).toBe(dir);
    expect(app.resolveFrontendDist([path.join(dir, 'kosong')])).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('CORS mengikuti CLIENT_URL', () => {
    const previous = process.env.CLIENT_URL;
    delete process.env.CLIENT_URL;
    expect(app.isOriginAllowed('http://apa-saja.test')).toBe(true);
    process.env.CLIENT_URL = 'http://localhost:5173, http://localhost:4173';
    expect(app.isOriginAllowed('http://localhost:4173')).toBe(true);
    expect(app.isOriginAllowed('http://jahat.test')).toBe(false);
    expect(app.isOriginAllowed(undefined)).toBe(true);
    if (previous === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous;
  });

  test('origin yang tidak diizinkan ditolak dengan 403', async () => {
    const previous = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'http://localhost:5173';
    const res = await fetch(`${base}/health`, { headers: { Origin: 'http://jahat.test' } });
    expect(res.status).toBe(403);
    if (previous === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous;
  });

  // ---------- auth ----------
  test('register, login, dan logout', async () => {
    let r = await call('POST', '/auth/register', { body: { name: 'Sari', email: 'sari@del.ac.id', password: 'rahasia1' } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('success');

    r = await call('POST', '/auth/register', { body: { name: 'Sari', email: 'SARI@del.ac.id', password: 'rahasia1' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('Email sudah terdaftar');

    r = await call('POST', '/auth/login', { body: { email: 'sari@del.ac.id', password: 'rahasia1' } });
    expect(r.status).toBe(200);
    expect(typeof r.json.data.token).toBe('string');

    r = await call('POST', '/auth/login', { body: { email: 'sari@del.ac.id', password: 'salah' } });
    expect(r.status).toBe(401);
    r = await call('POST', '/auth/login', { body: { email: 'tidak@ada.id', password: 'rahasia1' } });
    expect(r.status).toBe(401);
    r = await call('POST', '/auth/login', { body: {} });
    expect(r.status).toBe(401);

    r = await call('POST', '/auth/logout');
    expect(r.status).toBe(200);
  });

  test('validasi register', async () => {
    const bodies = [
      { name: ' ', email: 'a@b.co', password: 'rahasia1' },
      { name: 'A', email: 'bukan-email', password: 'rahasia1' },
      { name: 'A', email: 'a@b.co', password: '123' },
      { name: 'A', email: 'a@b.co' }
    ];
    for (const body of bodies) {
      const r = await call('POST', '/auth/register', { body });
      expect(r.status).toBe(400);
    }
  });

  test('endpoint terproteksi menolak token yang tidak sah', async () => {
    expect((await call('GET', '/items')).status).toBe(401);
    expect((await call('GET', '/items', { token: 'ngawur' })).status).toBe(401);
    const orphan = jwt.sign({ sub: 987654 }, getJwtSecret());
    const r = await call('GET', '/users/me', { token: orphan });
    expect(r.status).toBe(401);
    expect(r.json.message).toBe('Pengguna tidak ditemukan');
  });

  // ---------- users ----------
  test('profil, daftar pengguna, ubah data, dan kata sandi', async () => {
    const budi = await signup('Budi');
    let r = await call('GET', '/users/me', { token: budi.token });
    expect(r.json.data.user.email).toBe(budi.email);
    expect(r.json.data.user.photo).toBe('');

    r = await call('GET', '/users', { token: budi.token });
    expect(r.json.data.users.length).toBeGreaterThanOrEqual(1);

    r = await call('PUT', '/users/me', { token: budi.token, body: { name: 'Budi S', email: 'budi.s@del.ac.id' } });
    expect(r.status).toBe(200);
    r = await call('PUT', '/users/me', { token: budi.token, body: { name: 'Budi S', email: 'sari@del.ac.id' } });
    expect(r.status).toBe(400);
    r = await call('PUT', '/users/me', { token: budi.token, body: { name: '', email: 'x@y.co' } });
    expect(r.status).toBe(400);
    r = await call('PUT', '/users/me', { token: budi.token, body: { name: 'Budi', email: 'bukan' } });
    expect(r.status).toBe(400);

    const pw = (body) => call('PUT', '/users/password', { token: budi.token, body });
    expect((await pw({ password: 'salah', new_password: 'baru123', new_password_confirmation: 'baru123' })).status).toBe(400);
    expect((await pw({ password: 'rahasia1', new_password: '123', new_password_confirmation: '123' })).status).toBe(400);
    expect((await pw({ password: 'rahasia1', new_password: 'baru123', new_password_confirmation: 'beda' })).status).toBe(400);
    expect((await pw({ password: 'rahasia1', new_password: 'baru123', new_password_confirmation: 'baru123' })).status).toBe(200);
    r = await call('POST', '/auth/login', { body: { email: 'budi.s@del.ac.id', password: 'baru123' } });
    expect(r.status).toBe(200);
  });

  test('unggah foto profil: format, ukuran, dan penggantian file lama', async () => {
    const u = await signup('Foto');
    let r = await call('POST', '/users/me/photo', { token: u.token, form: imageForm('photo') });
    expect(r.status).toBe(200);
    r = await call('GET', '/users/me', { token: u.token });
    const first = r.json.data.user.photo;
    expect(first).toMatch(/^\/uploads\/.+\.png$/);
    expect((await fetch(origin + first)).status).toBe(200);

    r = await call('POST', '/users/me/photo', { token: u.token, form: imageForm('photo', 'image/jpeg', 'baru.jpg') });
    expect(r.status).toBe(200);
    expect((await fetch(origin + first)).status).not.toBe(200); // file lama terhapus

    r = await call('POST', '/users/me/photo', { token: u.token, form: imageForm('photo', 'text/plain', 'x.txt', Buffer.from('x')) });
    expect(r.status).toBe(400);
    r = await call('POST', '/users/me/photo', { token: u.token, form: new FormData() });
    expect(r.status).toBe(400);
    r = await call('POST', '/users/me/photo', { token: u.token, form: imageForm('photo', 'image/png', 'besar.png', Buffer.alloc(2 * 1024 * 1024 + 1)) });
    expect(r.status).toBe(413);
    r = await call('POST', '/users/me/photo', { token: u.token, form: imageForm('salah') });
    expect(r.status).toBe(400);
  });

  // ---------- items ----------
  test('CRUD barang dan hak akses penjual', async () => {
    const seller = await signup('Penjual');
    const other = await signup('Lain');

    let r = await call('POST', '/items', { token: seller.token, body: { title: 'Kipas Angin', description: '**Kencang**', price: 60000 } });
    expect(r.status).toBe(201);
    const id = r.json.data.item_id;

    for (const body of [{ title: ' ', price: 1 }, { title: 'X', price: -5 }, { title: 'X', price: 1.5 }, { title: 'X'.repeat(121), price: 1 }, { title: 'X', price: 1, description: 5 }]) {
      expect((await call('POST', '/items', { token: seller.token, body })).status).toBe(400);
    }

    r = await call('GET', `/items/${id}`, { token: other.token });
    const item = r.json.data.item;
    expect(item.title).toBe('Kipas Angin');
    expect(item.is_sold).toBe(false);
    expect(item.author.name).toBe(seller.name);
    expect(item.my_offer).toBeNull();
    expect(item.cover).toBe('');

    expect((await call('PUT', `/items/${id}`, { token: other.token, body: { title: 'X', price: 1 } })).status).toBe(403);
    expect((await call('PUT', `/items/${id}`, { token: seller.token, body: { title: 'Kipas Mini', price: 50000 } })).status).toBe(200);
    expect((await call('PUT', `/items/${id}`, { token: seller.token, body: { title: '', price: 1 } })).status).toBe(400);
    expect((await call('GET', `/items/${id}`, { token: seller.token })).json.data.item.title).toBe('Kipas Mini');

    expect((await call('DELETE', `/items/${id}`, { token: other.token })).status).toBe(403);
    expect((await call('DELETE', `/items/${id}`, { token: seller.token })).status).toBe(200);
    expect((await call('GET', `/items/${id}`, { token: seller.token })).status).toBe(404);
    expect((await call('PUT', `/items/${id}`, { token: seller.token, body: { title: 'X', price: 1 } })).status).toBe(404);
    expect((await call('DELETE', `/items/${id}`, { token: seller.token })).status).toBe(404);
  });

  test('filter daftar barang: milik saya dan status terjual', async () => {
    const a = await signup('Filtera');
    const b = await signup('Filterb');
    const a1 = await createItem(a.token, { title: 'A1', price: 1000 });
    await createItem(a.token, { title: 'A2', price: 1000 });
    await createItem(b.token, { title: 'B1', price: 1000 });
    await call('PUT', `/items/${a1}/sold`, { token: a.token, body: { is_sold: true } });

    let r = await call('GET', '/items?is_me=1', { token: a.token });
    expect(r.json.data.items.map((i) => i.title).sort()).toEqual(['A1', 'A2']);
    r = await call('GET', '/items?is_me=1&is_sold=1', { token: a.token });
    expect(r.json.data.items.map((i) => i.title)).toEqual(['A1']);
    r = await call('GET', '/items?is_sold=0', { token: a.token });
    expect(r.json.data.items.every((i) => i.is_sold === false)).toBe(true);
    r = await call('GET', '/items?is_sold=abc', { token: a.token });
    expect(r.json.data.items.length).toBeGreaterThanOrEqual(3);
  });

  test('tandai terjual dan buka kembali', async () => {
    const s = await signup('Sold');
    const o = await signup('Soldo');
    const id = await createItem(s.token, { title: 'Buku', price: 5000 });

    expect((await call('PUT', `/items/${id}/sold`, { token: o.token, body: { is_sold: true } })).status).toBe(403);
    expect((await call('PUT', `/items/${id}/sold`, { token: s.token, body: { is_sold: 'ya' } })).status).toBe(400);
    expect((await call('PUT', '/items/999999/sold', { token: s.token, body: { is_sold: true } })).status).toBe(404);
    expect((await call('PUT', `/items/${id}/sold`, { token: s.token, body: { is_sold: true } })).status).toBe(200);
    expect((await call('GET', `/items/${id}`, { token: s.token })).json.data.item.is_sold).toBe(true);
    const r = await call('PUT', `/items/${id}/sold`, { token: s.token, body: { is_sold: false } });
    expect(r.json.message).toBe('Barang dibuka kembali');
  });

  test('unggah foto barang hanya oleh penjual, foto lama dihapus saat diganti atau barang dihapus', async () => {
    const s = await signup('Cover');
    const o = await signup('Covero');
    const id = await createItem(s.token, { title: 'Meja', price: 100000 });

    expect((await call('POST', `/items/${id}/cover`, { token: o.token, form: imageForm('cover') })).status).toBe(403);
    expect((await call('POST', '/items/999999/cover', { token: s.token, form: imageForm('cover') })).status).toBe(404);
    expect((await call('POST', `/items/${id}/cover`, { token: s.token, form: new FormData() })).status).toBe(400);
    expect((await call('POST', `/items/${id}/cover`, { token: s.token, form: imageForm('cover') })).status).toBe(200);

    const first = (await call('GET', `/items/${id}`, { token: s.token })).json.data.item.cover;
    expect(first).toMatch(/^\/uploads\/.+\.png$/);
    expect((await fetch(origin + first)).status).toBe(200);

    expect((await call('POST', `/items/${id}/cover`, { token: s.token, form: imageForm('cover', 'image/webp', 'baru.webp') })).status).toBe(200);
    expect((await fetch(origin + first)).status).not.toBe(200);

    const second = (await call('GET', `/items/${id}`, { token: s.token })).json.data.item.cover;
    expect((await call('DELETE', `/items/${id}`, { token: s.token })).status).toBe(200);
    expect((await fetch(origin + second)).status).not.toBe(200);
  });

  // ---------- offers ----------
  test('tawaran: aturan, visibilitas email, dan pembatalan', async () => {
    const seller = await signup('Tawars');
    const buyer = await signup('Tawarb');
    const id = await createItem(seller.token, { title: 'Lemari', price: 80000 });
    const offer = (token, body) => call('POST', `/items/${id}/offers`, { token, body });

    expect((await offer(seller.token, { offer: 70000 })).status).toBe(400);
    expect((await offer(buyer.token, { offer: 0 })).status).toBe(400);
    expect((await offer(buyer.token, { offer: 12.5 })).status).toBe(400);
    expect((await offer(buyer.token, { offer: 70000 })).status).toBe(201);
    expect((await offer(buyer.token, { offer: 75000 })).json.message).toBe('Anda sudah mengajukan tawaran untuk barang ini');
    expect((await call('POST', '/items/999999/offers', { token: buyer.token, body: { offer: 1 } })).status).toBe(404);

    let item = (await call('GET', `/items/${id}`, { token: buyer.token })).json.data.item;
    expect(item.offers.length).toBe(1);
    expect(item.my_offer.offer).toBe(70000);
    expect(item.offers[0].user.email).toBeUndefined();

    item = (await call('GET', `/items/${id}`, { token: seller.token })).json.data.item;
    expect(item.offers[0].user.email).toBe(buyer.email);
    expect(item.my_offer).toBeNull();

    expect((await call('DELETE', `/items/${id}/offers`, { token: seller.token })).status).toBe(404);
    expect((await call('DELETE', '/items/999999/offers', { token: buyer.token })).status).toBe(404);
    expect((await call('DELETE', `/items/${id}/offers`, { token: buyer.token })).status).toBe(200);

    await call('PUT', `/items/${id}/sold`, { token: seller.token, body: { is_sold: true } });
    const r = await offer(buyer.token, { offer: 70000 });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('Barang sudah terjual');
  });

  test('tawaran diurutkan dari yang tertinggi dan ikut terhapus bersama barang', async () => {
    const s = await signup('Urut');
    const b1 = await signup('Urutb');
    const b2 = await signup('Urutc');
    const id = await createItem(s.token, { title: 'Sepatu', price: 30000 });
    await call('POST', `/items/${id}/offers`, { token: b1.token, body: { offer: 10000 } });
    await call('POST', `/items/${id}/offers`, { token: b2.token, body: { offer: 25000 } });

    const item = (await call('GET', `/items/${id}`, { token: s.token })).json.data.item;
    expect(item.offers.map((o) => o.offer)).toEqual([25000, 10000]);

    expect((await call('DELETE', `/items/${id}`, { token: s.token })).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS total FROM offers WHERE item_id = ?').get(id).total).toBe(0);
  });
});

describe('Middleware dan utilitas', () => {
  const mockRes = () => {
    const res = { code: 0, body: null };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };

  test('errorHandler menyembunyikan detail error 500 di production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const spy = console.error;
    console.error = () => {};
    const res = mockRes();
    errorHandler(new Error('rahasia internal'), {}, res, () => {});
    console.error = spy;
    process.env.NODE_ENV = previous;
    expect(res.code).toBe(500);
    expect(res.body.message).toBe('Terjadi kesalahan pada server');
  });

  test('errorHandler memakai status dan pesan error, serta membersihkan file upload', () => {
    const name = 'sisa-upload.png';
    fs.writeFileSync(path.join(getUploadDir(), name), 'x');
    const err = new Error('Tidak boleh');
    err.status = 403;
    const res = mockRes();
    errorHandler(err, { file: { filename: name } }, res, () => {});
    expect(res.code).toBe(403);
    expect(res.body.message).toBe('Tidak boleh');
    expect(fs.existsSync(path.join(getUploadDir(), name))).toBe(false);

    const generic = mockRes();
    const spy = console.error;
    console.error = () => {};
    errorHandler({}, {}, generic, () => {});
    console.error = spy;
    expect(generic.code).toBe(500);
  });

  test('getJwtSecret memakai env, atau kunci acak jika kosong', () => {
    expect(getJwtSecret()).toBe('test-secret-operin-ci-2026');
    const previous = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(getJwtSecret().length).toBeGreaterThanOrEqual(32);
    process.env.JWT_SECRET = previous;
  });

  test('fileUrl dan removeUploadedFile', () => {
    expect(fileUrl('')).toBe('');
    expect(fileUrl('a.png')).toBe('/uploads/a.png');
    process.env.PUBLIC_URL = 'https://operin.example.com/';
    expect(fileUrl('a.png')).toBe('https://operin.example.com/uploads/a.png');
    delete process.env.PUBLIC_URL;
    expect(removeUploadedFile('')).toBe(false);
    expect(removeUploadedFile('tidak-ada.png')).toBe(false);
    expect(removeUploadedFile('../../etc/passwd')).toBe(false);
  });

  test('getUploadDir membuat folder dan jatuh ke tmp bila tidak dapat ditulis', () => {
    const custom = path.join(os.tmpdir(), `operin-custom-${Date.now()}`);
    expect(getUploadDir(custom)).toBe(custom);
    expect(fs.existsSync(custom)).toBe(true);
    fs.rmSync(custom, { recursive: true, force: true });

    const blocker = path.join(os.tmpdir(), `operin-file-${Date.now()}`);
    fs.writeFileSync(blocker, 'x');
    const fallback = getUploadDir(path.join(blocker, 'dalam'));
    expect(fallback).toBe(path.join(os.tmpdir(), 'operin-uploads'));
    fs.rmSync(blocker, { force: true });
  });

  test('seedDatabase mengisi data awal sekali saja dan dilewati saat NODE_ENV=test', () => {
    const fresh = db.createDatabase(':memory:');
    expect(fresh.prepare('SELECT COUNT(*) AS total FROM users').get().total).toBe(0);
    expect(seedDatabase(fresh)).toBe(false);
    expect(seedDatabase(fresh, { force: true })).toBe(true);
    expect(fresh.prepare('SELECT COUNT(*) AS total FROM users').get().total).toBe(3);
    expect(fresh.prepare('SELECT COUNT(*) AS total FROM items').get().total).toBe(6);
    expect(fresh.prepare('SELECT COUNT(*) AS total FROM offers').get().total).toBe(4);
    expect(seedDatabase(fresh, { force: true })).toBe(false);
    fresh.close();
  });

  test('resolveDatabasePath menangani memori, path kustom, dan folder yang tidak dapat ditulis', () => {
    expect(db.resolveDatabasePath(':memory:')).toBe(':memory:');
    const custom = path.join(os.tmpdir(), `operin-db-${Date.now()}`, 'x.db');
    expect(db.resolveDatabasePath(custom)).toBe(custom);
    fs.rmSync(path.dirname(custom), { recursive: true, force: true });

    const blocker = path.join(os.tmpdir(), `operin-dbfile-${Date.now()}`);
    fs.writeFileSync(blocker, 'x');
    expect(db.resolveDatabasePath(path.join(blocker, 'dalam', 'x.db'))).toBe(path.join(os.tmpdir(), 'operin.db'));
    fs.rmSync(blocker, { force: true });

    expect(db.resolveDatabasePath()).toMatch(/operin\.db$/);
  });
});
