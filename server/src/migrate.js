import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const applied = await pool.query('SELECT filename FROM schema_migrations');
const done = new Set(applied.rows.map((r) => r.filename));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (done.has(file)) continue;
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log('jalan:', file);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gagal:', file, err.message);
    process.exitCode = 1;
    break;
  } finally {
    client.release();
  }
}

await pool.end();
console.log('migrasi selesai');