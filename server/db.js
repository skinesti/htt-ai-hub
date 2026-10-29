// Postgres access. Standard `pg` driver; works with Neon's pooled connection string or any Postgres.
import pg from 'pg';

pg.types.setTypeParser(20, value => Number(value)); // bigint counts as numbers

export function createPool(connectionString) {
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
