// Approved-user management: rules, queries and the admin-only changes behind the Users screen.
// Every change runs in one transaction with its audit rows, under the same advisory lock as the
// database's last-admin rule, and rechecks that the person acting is still an active admin.
import { transaction } from './db.js';
import { HttpError } from './http.js';

export const USER_LIMIT = 50;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const DEFAULT_DOMAINS = ['hertimetherapy.com'];
const ADMIN_LOCK = 727001;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function allowedDomains(value = process.env.ALLOWED_EMAIL_DOMAINS) {
  const list = String(value || '').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return list.length ? list : DEFAULT_DOMAINS;
}

export function cleanEmail(raw, domains) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!domains.some(d => email.endsWith('@' + d))) throw new HttpError(400, 'Use an address ending in ' + domains.map(d => '@' + d).join(' or ') + '.');
  return email;
}

export function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Enter a name.');
  if (name.length > NAME_MAX) throw new HttpError(400, `Use a name of ${NAME_MAX} characters or fewer.`);
  return name;
}

const ACTION_LABEL = { add: 'Added', activate: 'Switched on', deactivate: 'Switched off', grant_admin: 'Made admin', revoke_admin: 'Admin removed', rename: 'Renamed' };
const who = (name, email) => name || (email === 'script' ? 'Script' : (email || '').split('@')[0]);

export async function listUsers(db) {
  const users = await db.query(
    `SELECT u.email, u.display_name, u.active, u.is_admin, u.created_at, u.added_by, a.display_name AS added_by_name
     FROM app_users u LEFT JOIN app_users a ON a.email = u.added_by ORDER BY lower(u.display_name), u.email`);
  const audit = await db.query(
    `SELECT l.action, l.detail, l.created_at, l.actor, l.target_email, a.display_name AS actor_name, t.display_name AS target_name
     FROM user_audit l LEFT JOIN app_users a ON a.email = l.actor LEFT JOIN app_users t ON t.email = l.target_email
     ORDER BY l.created_at DESC, l.id DESC LIMIT 20`);
  return {
    users: users.rows.map(u => ({ email: u.email, name: u.display_name, active: u.active, admin: u.is_admin, addedBy: u.added_by ? who(u.added_by_name, u.added_by) : '', createdAt: u.created_at.toISOString() })),
    audit: audit.rows.map(r => ({ action: r.action, label: ACTION_LABEL[r.action], detail: r.detail, at: r.created_at.toISOString(), by: who(r.actor_name, r.actor), target: who(r.target_name, r.target_email) })),
    limit: USER_LIMIT
  };
}

const audit = (client, actor, target, action, detail = '') =>
  client.query('INSERT INTO user_audit (actor, target_email, action, detail) VALUES ($1, $2, $3, $4)', [actor, target, action, detail.slice(0, 300)]);

async function lockAndCheckActor(client, actorEmail) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
  const { rows } = await client.query('SELECT active, is_admin FROM app_users WHERE email = $1', [actorEmail]);
  if (!rows[0] || !rows[0].active || !rows[0].is_admin) throw new HttpError(403, 'Only admins can manage users.');
}

const renameDetail = (from, to) => `from "${from}" to "${to}"`;

export async function addUser(pool, { actorEmail, email, name }) {
  await transaction(pool, async client => {
    await lockAndCheckActor(client, actorEmail);
    const { rows } = await client.query('SELECT count(*)::int AS n, bool_or(email = $1) AS exists FROM app_users', [email]);
    if (rows[0].exists) throw new HttpError(409, 'That person is already on the list. Switch them on instead.');
    if (rows[0].n >= USER_LIMIT) throw new HttpError(400, `The list is full (${USER_LIMIT} people).`);
    await client.query('INSERT INTO app_users (email, display_name, active, is_admin, added_by) VALUES ($1, $2, true, false, $3)', [email, name, actorEmail]);
    await audit(client, actorEmail, email, 'add');
  });
}

// changes: { name?, active?, admin? }. Returns the number of changes made.
export async function updateUser(pool, { actorEmail, email, changes }) {
  return transaction(pool, async client => {
    await lockAndCheckActor(client, actorEmail);
    const { rows } = await client.query('SELECT display_name, active, is_admin FROM app_users WHERE email = $1 FOR UPDATE', [email]);
    const target = rows[0];
    if (!target) throw new HttpError(404, 'That person is not on the list.');
    const next = {
      name: changes.name ?? target.display_name,
      active: changes.active ?? target.active,
      admin: changes.admin ?? target.is_admin
    };
    const self = email === actorEmail;
    if (self && next.active !== target.active) throw new HttpError(400, 'You cannot switch yourself off. Ask another admin.');
    if (self && next.admin !== target.is_admin) throw new HttpError(400, 'You cannot change your own admin access. Ask another admin.');
    const losesAdmin = target.active && target.is_admin && !(next.active && next.admin);
    if (losesAdmin) {
      const others = await client.query('SELECT count(*)::int AS n FROM app_users WHERE active AND is_admin AND email <> $1', [email]);
      if (!others.rows[0].n) throw new HttpError(400, 'At least one active admin is required.');
    }
    const actions = [];
    if (next.name !== target.display_name) actions.push(['rename', renameDetail(target.display_name, next.name)]);
    if (next.active !== target.active) actions.push([next.active ? 'activate' : 'deactivate', '']);
    if (next.admin !== target.is_admin) actions.push([next.admin ? 'grant_admin' : 'revoke_admin', '']);
    if (!actions.length) return 0;
    await client.query('UPDATE app_users SET display_name = $2, active = $3, is_admin = $4, updated_at = now() WHERE email = $1', [email, next.name, next.active, next.admin]);
    if (!next.active) await client.query('DELETE FROM sessions WHERE email = $1', [email]);
    for (const [action, detail] of actions) await audit(client, actorEmail, email, action, detail);
    return actions.length;
  });
}

// Script path (scripts/allow-user.js and test fixtures): add or switch on, optionally grant admin.
// The allowlist file only ever grants admin; it never removes it.
export async function applyAllowlistEntry(pool, { email, name, admin = false }, actor = 'script') {
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
    const { rows } = await client.query('SELECT display_name, active, is_admin FROM app_users WHERE email = $1 FOR UPDATE', [email]);
    const current = rows[0];
    if (!current) {
      await client.query('INSERT INTO app_users (email, display_name, active, is_admin, added_by) VALUES ($1, $2, true, $3, $4)', [email, name, !!admin, actor]);
      await audit(client, actor, email, 'add');
      if (admin) await audit(client, actor, email, 'grant_admin');
      return;
    }
    const nextAdmin = current.is_admin || !!admin;
    await client.query('UPDATE app_users SET display_name = $2, active = true, is_admin = $3, updated_at = now() WHERE email = $1', [email, name, nextAdmin]);
    if (current.display_name !== name) await audit(client, actor, email, 'rename', renameDetail(current.display_name, name));
    if (!current.active) await audit(client, actor, email, 'activate');
    if (nextAdmin && !current.is_admin) await audit(client, actor, email, 'grant_admin');
  });
}

// Script recovery flags. No app-level last-admin check here: the database rule is the guard.
export async function scriptSetFlag(pool, email, flag, value, actor = 'script') {
  return transaction(pool, async client => {
    const column = flag === 'admin' ? 'is_admin' : 'active';
    const { rows } = await client.query(`SELECT ${column} AS v FROM app_users WHERE email = $1 FOR UPDATE`, [email]);
    if (!rows[0]) return false;
    if (rows[0].v === value) return true;
    await client.query(`UPDATE app_users SET ${column} = $2, updated_at = now() WHERE email = $1`, [email, value]);
    if (flag === 'active' && !value) await client.query('DELETE FROM sessions WHERE email = $1', [email]);
    await audit(client, actor, email, flag === 'admin' ? (value ? 'grant_admin' : 'revoke_admin') : (value ? 'activate' : 'deactivate'));
    return true;
  });
}

export async function countAdmins(pool) {
  const { rows } = await pool.query('SELECT count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE active AND is_admin)::int AS admins FROM app_users');
  return rows[0];
}
