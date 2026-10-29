// Applies plain SQL files in db/migrations in name order, each once, each in its own transaction.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transaction } from './db.js';

export async function runMigrations(pool, dir) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map(r => r.name)), applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await transaction(pool, async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
