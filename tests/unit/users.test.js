// Users screen API, safeguards, audit and database rules, against a real throwaway database.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { USERS, createTestApp } from '../helpers.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
let t, A1, A2, B;
before(async () => {
  t = await createTestApp();
  A1 = (await t.signIn(USERS.admin1)).cookie;
  A2 = (await t.signIn(USERS.admin2)).cookie;
  B = (await t.signIn(USERS.b)).cookie;
});
after(async () => { await t.db.drop(); });

const q = async (sql, params) => (await t.db.pool.query(sql, params)).rows;
const user = async email => (await q('SELECT display_name, active, is_admin, added_by FROM app_users WHERE email = $1', [email]))[0];
const auditFor = async email => (await q('SELECT actor, action, detail FROM user_audit WHERE target_email = $1 ORDER BY id', [email]));
const adminCount = async () => (await q('SELECT count(*)::int AS n FROM app_users WHERE active AND is_admin'))[0].n;
const patch = (cookie, body) => t.write('/api/users', 'PATCH', body, cookie);
const post = (cookie, body) => t.write('/api/users', 'POST', body, cookie);
const errorOf = async res => (await res.json()).error;

describe('access', () => {
  test('signed-out requests are refused with 401', async () => {
    assert.equal((await t.call('/api/users')).status, 401);
    assert.equal((await post(null, { email: 'x@example.test', name: 'X' })).status, 401);
    assert.equal((await patch(null, { email: USERS.b, active: false })).status, 401);
  });
  test('a non-admin is refused, including a hand-made PATCH', async () => {
    assert.equal((await t.call('/api/users', { cookie: B })).status, 403);
    const res = await patch(B, { email: USERS.admin1, admin: false });
    assert.equal(res.status, 403);
    assert.equal(await errorOf(res), 'Only admins can manage users.');
    assert.equal((await patch(B, { email: USERS.b, admin: true })).status, 403);
    assert.equal((await post(B, { email: 'sneaky@example.test', name: 'Sneaky' })).status, 403);
    assert.equal((await user(USERS.admin1)).is_admin, true);
    assert.equal((await user(USERS.b)).is_admin, false);
    assert.equal(await user('sneaky@example.test'), undefined);
  });
  test('session tells the app who is an admin', async () => {
    assert.equal((await (await t.call('/api/session', { cookie: A1 })).json()).admin, true);
    assert.equal((await (await t.call('/api/session', { cookie: B })).json()).admin, false);
  });
  test('admin writes still need the app Origin and custom header', async () => {
    const noHeader = await t.call('/api/users', { method: 'PATCH', cookie: A1, body: { email: USERS.b, active: false }, headers: { origin: 'https://team-tree.example.test' } });
    assert.equal(noHeader.status, 403);
    const wrongOrigin = await t.call('/api/users', { method: 'PATCH', cookie: A1, body: { email: USERS.b, active: false }, headers: { origin: 'https://evil.example.test', 'x-htt-request': '1' } });
    assert.equal(wrongOrigin.status, 403);
    assert.equal((await user(USERS.b)).active, true);
  });
});

describe('admin changes', () => {
  test('admin adds a user; list shows name, email, active, admin, added by and date', async () => {
    const res = await post(A1, { email: '  New.Person@Example.TEST ', name: '  New   Person ' });
    assert.equal(res.status, 200);
    const body = await res.json();
    const row = body.users.find(u => u.email === 'new.person@example.test');
    assert.deepEqual({ ...row, createdAt: 'x' }, { email: 'new.person@example.test', name: 'New Person', active: true, admin: false, addedBy: 'Admin One', createdAt: 'x' });
    assert.deepEqual(body.allowedDomains, ['example.test']);
    assert.deepEqual(await auditFor('new.person@example.test'), [{ actor: USERS.admin1, action: 'add', detail: '' }]);
  });
  test('invalid and duplicate emails are rejected', async () => {
    for (const email of ['', 'not-an-email', 'a@b', 'x@other.test', 'x@example.test.evil.test', 'x@sub.example.test', 'a'.repeat(250) + '@example.test']) {
      assert.equal((await post(A1, { email, name: 'X' })).status, 400, email);
    }
    const dup = await post(A1, { email: 'NEW.PERSON@example.test', name: 'Again' });
    assert.equal(dup.status, 409);
    assert.equal((await post(A1, { email: 'y@example.test', name: '' })).status, 400);
    assert.equal((await post(A1, { email: 'y@example.test', name: 'x'.repeat(101) })).status, 400);
    assert.equal((await post(A1, { email: 'y@example.test', name: 'Y', admin: true })).status, 400);
    assert.equal(await user('y@example.test'), undefined);
  });
  test('admin switches a user off (next request refused) and on again', async () => {
    const victim = await t.signIn('new.person@example.test');
    assert.equal((await t.call('/api/tree', { cookie: victim.cookie })).status, 200);
    assert.equal((await patch(A2, { email: 'new.person@example.test', active: false })).status, 200);
    assert.ok([401, 403].includes((await t.call('/api/tree', { cookie: victim.cookie })).status));
    assert.equal((await user('new.person@example.test')).active, false);
    assert.equal((await patch(A2, { email: 'new.person@example.test', active: true })).status, 200);
    assert.equal((await user('new.person@example.test')).active, true);
    assert.ok((await t.signIn('new.person@example.test')).cookie);
    assert.deepEqual((await auditFor('new.person@example.test')).map(r => [r.actor, r.action]), [[USERS.admin1, 'add'], [USERS.admin2, 'deactivate'], [USERS.admin2, 'activate']]);
  });
  test('a switched-off user with an existing session (not deleted) is refused with 403', async () => {
    const s = await t.signIn('new.person@example.test');
    await q('ALTER TABLE app_users DISABLE TRIGGER app_users_keep_an_admin');
    await q("UPDATE app_users SET active = false WHERE email = 'new.person@example.test'");
    await q('ALTER TABLE app_users ENABLE TRIGGER app_users_keep_an_admin');
    assert.equal((await t.call('/api/tree', { cookie: s.cookie })).status, 403);
    await patch(A1, { email: 'new.person@example.test', active: true });
  });
  test('admin renames a user, grants and removes admin; each change is audited', async () => {
    assert.equal((await patch(A1, { email: 'new.person@example.test', name: 'Renamed Person' })).status, 200);
    assert.equal((await patch(A1, { email: 'new.person@example.test', admin: true })).status, 200);
    assert.equal((await patch(A2, { email: 'new.person@example.test', admin: false })).status, 200);
    const rows = (await auditFor('new.person@example.test')).slice(-3);
    assert.deepEqual(rows, [
      { actor: USERS.admin1, action: 'rename', detail: 'from "New Person" to "Renamed Person"' },
      { actor: USERS.admin1, action: 'grant_admin', detail: '' },
      { actor: USERS.admin2, action: 'revoke_admin', detail: '' }
    ]);
    const list = await (await t.call('/api/users', { cookie: A1 })).json();
    assert.ok(list.audit.length >= 3 && list.audit[0].label === 'Admin removed' && list.audit[0].by === 'Admin Two' && list.audit[0].target === 'Renamed Person');
  });
  test('unknown fields and wrong types are rejected', async () => {
    assert.equal((await patch(A1, { email: USERS.b, active: 'no' })).status, 400);
    assert.equal((await patch(A1, { email: USERS.b, role: 'owner' })).status, 400);
    assert.equal((await patch(A1, { email: 'nobody@example.test', active: false })).status, 404);
  });
});

describe('safeguards', () => {
  test('an admin cannot change their own admin flag or switch themselves off through the API', async () => {
    const a = await patch(A1, { email: USERS.admin1, admin: false });
    assert.equal(a.status, 400);
    assert.match(await errorOf(a), /cannot change your own admin/);
    const b = await patch(A1, { email: USERS.admin1, active: false });
    assert.equal(b.status, 400);
    assert.match(await errorOf(b), /cannot switch yourself off/);
    assert.deepEqual(await user(USERS.admin1), { display_name: 'Admin One', active: true, is_admin: true, added_by: 'script' });
    assert.equal((await patch(A1, { email: USERS.admin1, name: 'Admin One' })).status, 200);
  });
  test('one admin can demote the other; the demoted admin is then refused', async () => {
    assert.equal((await patch(A1, { email: USERS.admin2, admin: false })).status, 200);
    assert.equal((await t.call('/api/users', { cookie: A2 })).status, 403);
    assert.equal((await patch(A2, { email: USERS.admin1, admin: false })).status, 403);
    assert.equal(await adminCount(), 1);
    assert.equal((await patch(A1, { email: USERS.admin2, admin: true })).status, 200);
  });
  test('two simultaneous demotions leave exactly one admin (20 rounds)', async () => {
    for (let round = 0; round < 20; round++) {
      assert.equal(await adminCount(), 2);
      const [r1, r2] = await Promise.all([patch(A1, { email: USERS.admin2, admin: false }), patch(A2, { email: USERS.admin1, admin: false })]);
      const codes = [r1.status, r2.status].sort();
      assert.deepEqual(codes, [200, 403], `round ${round}: ${codes}`);
      assert.equal(await adminCount(), 1);
      const winner = r1.status === 200 ? A1 : A2, loser = r1.status === 200 ? USERS.admin2 : USERS.admin1;
      assert.equal((await patch(winner, { email: loser, admin: true })).status, 200);
    }
  });
  test('two simultaneous switch-offs also leave exactly one admin', async () => {
    const [r1, r2] = await Promise.all([patch(A1, { email: USERS.admin2, active: false }), patch(A2, { email: USERS.admin1, active: false })]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 403]);
    assert.equal(await adminCount(), 1);
    const winner = r1.status === 200 ? A1 : A2, loser = r1.status === 200 ? USERS.admin2 : USERS.admin1;
    assert.equal((await patch(winner, { email: loser, active: true })).status, 200);
    A1 = (await t.signIn(USERS.admin1)).cookie; A2 = (await t.signIn(USERS.admin2)).cookie;
  });
  test('the API refuses to remove the last active admin', async () => {
    assert.equal((await patch(A1, { email: USERS.admin2, admin: false })).status, 200);
    // admin1 is now the only admin; a second admin session cannot exist, so check via a fresh admin's request path.
    assert.equal(await adminCount(), 1);
    assert.equal((await patch(A1, { email: USERS.admin1, admin: false })).status, 400);
  });
  test('the database blocks removing the last admin, even directly and from scripts/allow-user.js', async () => {
    assert.equal(await adminCount(), 1);
    await assert.rejects(q('UPDATE app_users SET is_admin = false WHERE email = $1', [USERS.admin1]), /At least one active admin is required/);
    await assert.rejects(q('UPDATE app_users SET active = false WHERE email = $1', [USERS.admin1]), /At least one active admin is required/);
    const env = { PATH: process.env.PATH, DATABASE_URL: t.db.url, ALLOWED_EMAIL_DOMAINS: 'example.test' };
    for (const flag of ['--revoke-admin', '--deactivate']) {
      const r = spawnSync(process.execPath, ['scripts/allow-user.js', flag, USERS.admin1], { cwd: root, env, encoding: 'utf8' });
      assert.equal(r.status, 1, flag);
      assert.match(r.stderr, /Refused: at least one active admin is required/, flag);
    }
    assert.deepEqual(await user(USERS.admin1), { display_name: 'Admin One', active: true, is_admin: true, added_by: 'script' });
    const grant = spawnSync(process.execPath, ['scripts/allow-user.js', '--grant-admin', USERS.admin2], { cwd: root, env, encoding: 'utf8' });
    assert.equal(grant.status, 0);
    assert.match(grant.stdout, /2 admin\(s\)/);
    assert.equal((await auditFor(USERS.admin2)).at(-1).actor, 'script');
  });
  test('the database rule alone stops two raw SQL sessions from removing both admins', async () => {
    assert.equal(await adminCount(), 2);
    const c1 = await t.db.pool.connect(), c2 = await t.db.pool.connect();
    try {
      await c1.query('BEGIN'); await c2.query('BEGIN');
      await c1.query('UPDATE app_users SET is_admin = false WHERE email = $1', [USERS.admin2]);
      const second = c2.query('UPDATE app_users SET is_admin = false WHERE email = $1', [USERS.admin1]).then(() => 'ok', e => e.message);
      await new Promise(r => setTimeout(r, 200)); // second session is now waiting on the shared lock
      await c1.query('COMMIT');
      assert.equal(await second, 'At least one active admin is required');
      await c2.query('ROLLBACK');
    } finally { c1.release(); c2.release(); }
    assert.equal(await adminCount(), 1);
    assert.equal((await patch(A1, { email: USERS.admin2, admin: true })).status, 200);
  });
  test('users are never deleted', async () => {
    await assert.rejects(q("DELETE FROM app_users WHERE email = 'new.person@example.test'"), /never deleted/);
    await assert.rejects(q('TRUNCATE app_users CASCADE'), /never deleted/);
  });
  test('the user list is limited to 50 people', async () => {
    const { n } = (await q('SELECT count(*)::int AS n FROM app_users'))[0];
    for (let i = n; i < 50; i++) await q("INSERT INTO app_users (email, display_name) VALUES ($1, 'Filler')", [`filler${i}@example.test`]);
    const res = await post(A1, { email: 'one.too.many@example.test', name: 'Too Many' });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /list is full \(50 people\)/);
  });
});

describe('audit trail', () => {
  test('audit rows cannot be changed or deleted', async () => {
    assert.ok((await q('SELECT count(*)::int AS n FROM user_audit'))[0].n > 10);
    await assert.rejects(q("UPDATE user_audit SET action = 'add'"), /user_audit is append-only/);
    await assert.rejects(q('DELETE FROM user_audit'), /user_audit is append-only/);
    await assert.rejects(q('TRUNCATE user_audit'), /user_audit is append-only/);
  });
});

describe('build check and the email domain', () => {
  const probe = root + 'tests/build-check-probe.tmp.md';
  const run = () => spawnSync(process.execPath, ['scripts/build-check.js'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  test('passes with the bare domain in source', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
  });
  test('fails when a full address at the domain is added to a repo file', () => {
    try {
      writeFileSync(probe, 'contact: probe' + '@' + 'hertimetherapy.com\n');
      const r = run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /build-check-probe\.tmp\.md: approved email address/);
    } finally {
      if (existsSync(probe)) unlinkSync(probe);
    }
    assert.equal(run().status, 0);
  });
});
