// Postgres access. Standard `pg` driver; works with Neon's pooled connection string or any Postgres.
import pg from 'pg';

pg.types.setTypeParser(20, value => Number(value)); // bigint counts as numbers

// Remote connection strings must use sslmode=verify-full (encrypted and certificate-checked).
// Returns a note naming the setting only, or null when the string is fine or local.
export function sslModeNote(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { return null; }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) return null;
  const mode = url.searchParams.get('sslmode');
  return mode === 'verify-full' ? null : `DATABASE_URL should use sslmode=verify-full (found ${mode ? 'sslmode=' + mode : 'no sslmode'}).`;
}

export function createPool(connectionString) {
  const note = sslModeNote(connectionString);
  if (note) console.warn('[db] ' + note);
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  pool.on('error', error => console.error('[db] idle client error', error.code || error.name));
  return pool;
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
