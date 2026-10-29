// Applies db/migrations/*.sql to DATABASE_URL. Safe to run more than once.
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../server/migrations.js';
import { openTarget } from './db-target.js';

const pool = openTarget();
try {
  const applied = await runMigrations(pool, fileURLToPath(new URL('../db/migrations/', import.meta.url)));
  console.log(applied.length ? 'Applied: ' + applied.join(', ') : 'Already up to date.');
} catch (e) {
  console.error('Migration failed:', e.code || e.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
