// Data awal Oper.in: akun demo, barang contoh, dan beberapa tawaran
const bcrypt = require('bcryptjs');

const DEMO_PASSWORD = 'demo12345';

const USERS = [
  { name: 'Demo Pengguna', email: 'demo@operin.id' },
  { name: 'Sari Simbolon', email: 'sari@operin.id' },
  { name: 'Budi Sitorus', email: 'budi@operin.id' }
];

// owner = indeks pada USERS
const ITEMS = [
  { owner: 1, title: 'Kipas Angin Mini USB', price: 45000, sold: 0, description: 'Kipas portabel, **masih kencang**. Cocok untuk kamar asrama.\n- Kabel USB lengkap\n- Baterai awet' },
  { owner: 1, title: 'Buku Algoritma dan Struktur Data', price: 60000, sold: 0, description: 'Edisi terbaru, ada sedikit coretan pensil.' },
  { owner: 2, title: 'Lemari Plastik 3 Susun', price: 80000, sold: 0, description: 'Muat banyak pakaian. *Ambil di asrama.*' },
  { owner: 2, title: 'Kalkulator Scientific Casio fx-350', price: 120000, sold: 0, description: 'Fungsi normal, baterai baru diganti.' },
  { owner: 0, title: 'Rak Buku Kayu Kecil', price: 70000, sold: 0, description: 'Dijual karena pindah kos.' },
  { owner: 0, title: 'Headset Gaming', price: 90000, sold: 1, description: 'Sudah terjual ke teman satu angkatan.' }
];

// item = indeks pada ITEMS, buyer = indeks pada USERS
const OFFERS = [
  { item: 0, buyer: 2, offer: 40000 },
  { item: 0, buyer: 0, offer: 42000 },
  { item: 2, buyer: 1, offer: 70000 },
  { item: 3, buyer: 0, offer: 100000 }
];

// Mengisi database hanya jika masih kosong. Dilewati pada NODE_ENV=test kecuali force=true.
function seedDatabase(db, { force = false } = {}) {
  if (!force && process.env.NODE_ENV === 'test') return false;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM users').get();
  if (total > 0) return false;

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
  const insertItem = db.prepare(
    'INSERT INTO items (user_id, title, description, price, is_sold) VALUES (?, ?, ?, ?, ?)'
  );
  const insertOffer = db.prepare('INSERT INTO offers (item_id, user_id, offer) VALUES (?, ?, ?)');

  db.transaction(() => {
    const userIds = USERS.map((u) => Number(insertUser.run(u.name, u.email, hash).lastInsertRowid));
    const itemIds = ITEMS.map((i) =>
      Number(insertItem.run(userIds[i.owner], i.title, i.description, i.price, i.sold).lastInsertRowid)
    );
    for (const o of OFFERS) insertOffer.run(itemIds[o.item], userIds[o.buyer], o.offer);
  })();
  return true;
}

module.exports = { seedDatabase, DEMO_PASSWORD };
