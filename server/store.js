// Database queries for users, sessions, the current tree and its append-only history.
import { transaction } from './db.js';
import { hashToken, randomToken, SESSION_SECONDS } from './session.js';
import { canonical } from '../shared/model.js';

const displayName = (name, email) => name || (email === 'seed' ? 'Seed data' : (email || '').split('@')[0]);

export async function findActiveUser(pool, email) {
  const { rows } = await pool.query('SELECT email, display_name FROM app_users WHERE email = $1 AND active', [email]);
  return rows[0] ? { email: rows[0].email, name: displayName(rows[0].display_name, rows[0].email) } : null;
}

export async function createSession(pool, email) {
  const token = randomToken();
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query(`INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [hashToken(token), email, SESSION_SECONDS]);
  return token;
}

// Returns { status: 'none' } | { status: 'inactive' } | { status: 'ok', user }.
export async function lookupSession(pool, token) {
  if (!token) return { status: 'none' };
  const { rows } = await pool.query(
    `SELECT s.email, u.display_name, u.active, u.is_admin FROM sessions s LEFT JOIN app_users u ON u.email = s.email
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]);
  if (!rows[0]) return { status: 'none' };
  if (!rows[0].active) return { status: 'inactive' };
  return { status: 'ok', user: { email: rows[0].email, name: displayName(rows[0].display_name, rows[0].email), admin: rows[0].is_admin === true } };
}

export async function deleteSession(pool, token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

const SELECT_CURRENT = `SELECT t.version, t.data, t.updated_at, t.updated_by, u.display_name
  FROM tree_current t LEFT JOIN app_users u ON u.email = t.updated_by WHERE t.id = 1`;

const currentRow = row => row && {
  version: row.version, data: canonical(row.data), updatedAt: row.updated_at.toISOString(), updatedBy: displayName(row.display_name, row.updated_by)
};

export async function getCurrent(db) {
  const { rows } = await db.query(SELECT_CURRENT);
  return currentRow(rows[0]);
}

export async function getVersion(pool) {
  const { rows } = await pool.query('SELECT version FROM tree_current WHERE id = 1');
  return rows[0] ? rows[0].version : null;
}

// Optimistic save: writes only when baseVersion matches, together with the revision row.
// Returns { ok: true, current } or { ok: false, latest } (version conflict).
export async function saveTree(pool, { baseVersion, data, email, reason, restoredFrom = null }) {
  return transaction(pool, async client => {
    const updated = await client.query(
      `UPDATE tree_current SET data = $1, version = version + 1, updated_at = now(), updated_by = $2
       WHERE id = 1 AND version = $3 RETURNING version`, [data, email, baseVersion]);
    if (!updated.rowCount) return { ok: false };
    const version = updated.rows[0].version;
    await client.query('INSERT INTO tree_revisions (version, data, created_by, reason, restored_from) VALUES ($1, $2, $3, $4, $5)', [version, data, email, reason, restoredFrom]);
    return { ok: true, current: await getCurrent(client) };
  }).then(async result => result.ok ? result : { ok: false, latest: await getCurrent(pool) });
}

export async function listRevisions(pool, limit = 200) {
  const { rows } = await pool.query(
    `SELECT r.version, r.created_at, r.created_by, r.reason, r.restored_from, u.display_name
     FROM tree_revisions r LEFT JOIN app_users u ON u.email = r.created_by ORDER BY r.version DESC LIMIT $1`, [limit]);
  return rows.map(r => ({ version: r.version, createdAt: r.created_at.toISOString(), by: displayName(r.display_name, r.created_by), reason: r.reason, restoredFrom: r.restored_from }));
}

export async function getRevision(pool, version) {
  const { rows } = await pool.query(
    `SELECT r.version, r.data, r.created_at, r.created_by, r.reason, r.restored_from, u.display_name
     FROM tree_revisions r LEFT JOIN app_users u ON u.email = r.created_by WHERE r.version = $1`, [version]);
  const r = rows[0];
  return r ? { version: r.version, data: canonical(r.data), createdAt: r.created_at.toISOString(), by: displayName(r.display_name, r.created_by), reason: r.reason, restoredFrom: r.restored_from } : null;
}

// First load only. Refuses when a tree already exists so live data is never replaced.
export async function seedTree(pool, data) {
  return transaction(pool, async client => {
    const existing = await client.query('SELECT version FROM tree_current WHERE id = 1 FOR UPDATE');
    if (existing.rowCount) return { seeded: false, version: existing.rows[0].version };
    await client.query(`INSERT INTO tree_revisions (version, data, created_by, reason) VALUES (1, $1, 'seed', 'seed')`, [data]);
    await client.query(`INSERT INTO tree_current (id, version, data, updated_by) VALUES (1, 1, $1, 'seed')`, [data]);
    return { seeded: true, version: 1 };
  });
}

// User management (allowlist, admins, audit) lives in server/users.js.
