// Shared helper for the database scripts: reads DATABASE_URL and describes the target without credentials.
import { createPool } from '../server/db.js';

export function openTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set. Example: node --env-file=.env scripts/migrate.js'); process.exit(1); }
  let label;
  try { const u = new URL(url); label = `${u.hostname}${u.pathname}`; } catch { console.error('DATABASE_URL is not a valid connection string.'); process.exit(1); }
  console.log('Database:', label);
  return createPool(url);
}
