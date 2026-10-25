// Koneksi SQLite menggunakan node:sqlite bawaan (kompatibel di Node 22.13+/24 dan Bun)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { seedDatabase } = require('./seed');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

function resolveDatabasePath(rawPath) {
  const target = rawPath || path.join(__dirname, '..', 'operin.db');
  if (target === ':memory:') {
    return ':memory:';
  }
  const resolved = path.resolve(process.cwd(), target);
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return resolved;
  } catch {
    return path.join(os.tmpdir(), 'operin.db');
  }
}

function createDatabase(customPath) {
  const resolvedDbPath = resolveDatabasePath(customPath || process.env.DB_PATH);
  const rawDb = new DatabaseSync(resolvedDbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');

  const wrapper = {
    dbPath: resolvedDbPath,
    exec: (sql) => rawDb.exec(sql),
    prepare: (sql) => rawDb.prepare(sql),
    transaction: (fn) => (...args) => {
      rawDb.exec('BEGIN');
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => rawDb.close()
  };

  wrapper.exec(schemaSql);
  seedDatabase(wrapper);
  return wrapper;
}

const db = createDatabase();
db.createDatabase = createDatabase;
db.resolveDatabasePath = resolveDatabasePath;

module.exports = db;
