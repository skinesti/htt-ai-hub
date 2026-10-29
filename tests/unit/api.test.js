import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { createApp } from '../../server/app.js';
import { createPool } from '../../server/db.js';
import { CONFIG, ORIGIN, SEED_RAW, USERS, createTestApp, seed } from '../helpers.js';

let t, A, B;
before(async () => {
  t = await createTestApp();
  A = (await t.signIn(USERS.a)).cookie;
  B = (await t.signIn(USERS.b)).cookie;
});
after(async () => { await t.db.drop(); });

const getTree = async (cookie = A) => (await t.call('/api/tree', { cookie })).json();
const count = async table => Number((await t.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
const edited = (data, title) => { const d = structuredClone(data); d.nodes.find(n => n.id === 'lauren').title = title; return d; };

describe('signed out', () => {
  test('API reads and writes are denied with 401', async () => {
    for (const path of ['/api/tree', '/api/tree/version', '/api/revisions', '/api/revisions/1', '/api/session']) assert.equal((await t.call(path)).status, 401, path);
    assert.equal((await t.write('/api/tree', 'PUT', { baseVersion: 1, data: seed() })).status, 401);
    assert.equal((await t.write('/api/revisions/1/restore', 'POST', { baseVersion: 1 })).status, 401);
  });
  test('app page redirects to sign-in and app files are denied', async () => {
    const page = await t.call('/');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/signin.html');
    for (const path of ['/app.js', '/app.css', '/shared/model.js']) assert.equal((await t.call(path)).status, 401, path);
  });
  test('a forged or tampered session cookie is denied', async () => {
    assert.equal((await t.call('/api/tree', { cookie: '__Host-htt_session=abc.def' })).status, 401);
    assert.equal((await t.call('/api/tree', { cookie: A.slice(0, -2) + 'xx' })).status, 401);
  });
});

describe('sign-in', () => {
  test('login redirect uses openid email scope, state, nonce and PKCE', async () => {
    const { location } = await t.signIn(USERS.a);
    assert.equal(location.searchParams.get('scope'), 'openid email');
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.searchParams.get('redirect_uri'), ORIGIN + '/auth/callback');
    assert.ok(location.searchParams.get('state') && location.searchParams.get('nonce'));
  });
  test('session cookie is HttpOnly, Secure, SameSite and expires in 7 days', async () => {
    const { res } = await t.signIn(USERS.a);
    const c = res.headers.getSetCookie().find(x => x.startsWith('__Host-htt_session='));
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=604800/);
  });
  test('an unlisted Google account is refused and gets no session', async () => {
    const sessions = await count('sessions');
    const { res, cookie } = await t.signIn(USERS.unlisted);
    assert.equal(res.headers.get('location'), '/signin.html?error=denied');
    assert.equal(cookie, null);
    assert.equal(await count('sessions'), sessions);
  });
  test('approved email in different case is accepted', async () => {
    const { cookie } = await t.signIn(USERS.a.toUpperCase());
    assert.ok(cookie);
  });
  test('unverified email, wrong nonce, wrong audience, wrong key and wrong state all fail', async () => {
    const other = (await generateKeyPair('RS256')).privateKey;
    for (const o of [{ claims: { email_verified: false } }, { claims: { nonce: 'nope' } }, { claims: { aud: 'other-client' } }, { claims: { iss: 'https://evil.example.test' } }, { token: { key: other } }, { state: 'forged' }]) {
      const { res, cookie } = await t.signIn(USERS.a, o);
      assert.equal(res.headers.get('location'), '/signin.html?error=failed', JSON.stringify(Object.keys(o)));
      assert.equal(cookie, null);
    }
  });
  test('a deactivated account with a live session gets 403', async () => {
    const { cookie } = await t.signIn(USERS.b);
    await t.db.pool.query('UPDATE app_users SET active = false WHERE email = $1', [USERS.b]);
    assert.equal((await t.call('/api/tree', { cookie })).status, 403);
    assert.equal((await t.call('/', { cookie })).headers.get('location'), '/signin.html?error=denied');
    await t.db.pool.query('UPDATE app_users SET active = true WHERE email = $1', [USERS.b]);
  });
  test('sign out ends the session on the server', async () => {
    const { cookie } = await t.signIn(USERS.a);
    assert.equal((await t.call('/api/session', { cookie })).status, 200);
    const out = await t.write('/auth/logout', 'POST', {}, cookie);
    assert.equal(out.status, 204);
    assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal((await t.call('/api/session', { cookie })).status, 401);
  });
});

describe('approved user', () => {
  test('reads the shared tree and the app page', async () => {
    const tree = await getTree();
    assert.equal(tree.version, 1);
    assert.deepEqual(tree.data, seed());
    assert.equal((await t.call('/', { cookie: A })).status, 200);
    assert.equal((await (await t.call('/api/session', { cookie: A })).json()).name, 'Tester One');
  });
  test('saves, and the other user sees the change', async () => {
    const tree = await getTree();
    const res = await t.write('/api/tree', 'PUT', { baseVersion: tree.version, data: edited(tree.data, 'Saved by A'), reason: 'save' }, A);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, tree.version + 1);
    assert.equal(body.updatedBy, 'Tester One');
    const seenByB = await getTree(B);
    assert.equal(seenByB.data.nodes.find(n => n.id === 'lauren').title, 'Saved by A');
  });
});

describe('concurrency', () => {
  test('a stale save gets 409 with the latest data and changes nothing', async () => {
    const start = await getTree();
    const revisions = await count('tree_revisions');
    assert.equal((await t.write('/api/tree', 'PUT', { baseVersion: start.version, data: edited(start.data, 'A wins') }, A)).status, 200);
    const res = await t.write('/api/tree', 'PUT', { baseVersion: start.version, data: edited(start.data, 'B would overwrite') }, B);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.latest.version, start.version + 1);
    assert.equal(body.latest.data.nodes.find(n => n.id === 'lauren').title, 'A wins');
    assert.equal((await getTree()).data.nodes.find(n => n.id === 'lauren').title, 'A wins');
    assert.equal(await count('tree_revisions'), revisions + 1);
  });
  test('ten simultaneous saves from the same version: exactly one wins', async () => {
    const start = await getTree();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => t.write('/api/tree', 'PUT', { baseVersion: start.version, data: edited(start.data, 'race ' + i) }, i % 2 ? A : B)));
    const codes = results.map(r => r.status).sort();
    assert.deepEqual(codes, [200, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    assert.equal((await getTree()).version, start.version + 1);
  });
});

describe('history and restore', () => {
  test('restore v1 creates a new revision and keeps history intact', async () => {
    const before = await (await t.call('/api/revisions', { cookie: A })).json();
    const snapshot = (await t.db.pool.query('SELECT version, data, created_by, reason FROM tree_revisions ORDER BY version')).rows;
    const current = await getTree();
    const res = await t.write('/api/revisions/1/restore', 'POST', { baseVersion: current.version }, B);
    assert.equal(res.status, 200);
    const restored = await res.json();
    assert.equal(restored.version, current.version + 1);
    assert.deepEqual(restored.data, seed());
    const list = (await (await t.call('/api/revisions', { cookie: A })).json()).revisions;
    assert.equal(list.length, before.revisions.length + 1);
    assert.deepEqual(list[0], { version: restored.version, createdAt: list[0].createdAt, by: 'Tester Two', reason: 'restore', restoredFrom: 1 });
    const after = (await t.db.pool.query('SELECT version, data, created_by, reason FROM tree_revisions ORDER BY version')).rows;
    assert.deepEqual(after.slice(0, snapshot.length), snapshot);
  });
  test('restore from a stale version gets 409', async () => {
    const current = await getTree();
    assert.equal((await t.write('/api/revisions/2/restore', 'POST', { baseVersion: current.version - 1 }, A)).status, 409);
  });
  test('missing revision gets 404', async () => {
    const current = await getTree();
    assert.equal((await t.write('/api/revisions/99999/restore', 'POST', { baseVersion: current.version }, A)).status, 404);
  });
  test('the database refuses to change or delete history', async () => {
    await assert.rejects(t.db.pool.query('UPDATE tree_revisions SET reason = $1 WHERE version = 1', ['save']), /append-only/);
    await assert.rejects(t.db.pool.query('DELETE FROM tree_revisions WHERE version = 1'), /append-only/);
    await assert.rejects(t.db.pool.query('TRUNCATE tree_revisions CASCADE'), /append-only/);
  });
});

describe('server validation', () => {
  const put = async (data, extra = {}) => { const v = (await getTree()).version; return t.write('/api/tree', 'PUT', { baseVersion: v, data, ...extra }, A); };
  test('rejects a reporting cycle', async () => {
    const d = (await getTree()).data; d.nodes.find(n => n.id === 'meagan').parent = 'lauren';
    const res = await put(d); assert.equal(res.status, 400); assert.equal((await res.json()).error, 'Reporting cycle');
  });
  test('rejects a bad link', async () => {
    const d = (await getTree()).data; d.categories[0].artifacts.push({ id: 'x', name: 'x', url: 'http://insecure.example.test', description: '' });
    assert.equal((await put(d)).status, 400);
  });
  test('rejects an unknown field and an unknown body key', async () => {
    const d = (await getTree()).data; d.nodes[0].role = 'admin';
    assert.equal((await put(d)).status, 400);
    assert.equal((await put((await getTree()).data, { sneaky: true })).status, 400);
    assert.equal((await put((await getTree()).data, { reason: 'restore' })).status, 400);
  });
  test('rejects a body over 2 MB with 413', async () => {
    const d = (await getTree()).data; d.name = 'x'.repeat(2100000);
    assert.equal((await put(d)).status, 413);
  });
  test('rejects oversized content within the body limit', async () => {
    const d = (await getTree()).data; d.nodes[0].title = 'x'.repeat(5000);
    assert.equal((await put(d)).status, 400);
  });
  test('nothing was saved by any rejected request', async () => {
    const tree = await getTree();
    assert.deepEqual(tree.data, seed());
  });
});

describe('request protection and headers', () => {
  test('writes need the app Origin, the custom header and JSON', async () => {
    const v = (await getTree()).version, body = { baseVersion: v, data: seed() };
    assert.equal((await t.call('/api/tree', { method: 'PUT', cookie: A, body, headers: { 'x-htt-request': '1' } })).status, 403);
    assert.equal((await t.call('/api/tree', { method: 'PUT', cookie: A, body, headers: { origin: 'https://evil.example.test', 'x-htt-request': '1' } })).status, 403);
    assert.equal((await t.call('/api/tree', { method: 'PUT', cookie: A, body, headers: { origin: ORIGIN } })).status, 403);
    assert.equal((await t.call('/api/tree', { method: 'PUT', cookie: A, raw: JSON.stringify(body), headers: { origin: ORIGIN, 'x-htt-request': '1', 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await t.call('/auth/logout', { method: 'POST', cookie: A })).status, 403);
  });
  test('API and app responses are no-store, noindex and carry a CSP', async () => {
    for (const res of [await t.call('/api/tree', { cookie: A }), await t.call('/', { cookie: A }), await t.call('/api/tree')]) {
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
    }
  });
  test('server failures return generic messages without details', async () => {
    const broken = createApp({ config: CONFIG, pool: createPool(['postgres://user', 'pw-should-not-leak@127.0.0.1:1/nope'].join(':')), provider: t.provider, shell: {} });
    const res = await broken.handle(new Request(ORIGIN + '/api/tree', { headers: { cookie: A } }));
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /pw-should-not-leak|127\.0\.0\.1|ECONNREFUSED/);
    const unconfigured = createApp({ config: { ...CONFIG, sessionSecret: '' }, pool: t.db.pool, provider: t.provider, shell: {} });
    const r2 = await unconfigured.handle(new Request(ORIGIN + '/api/tree'));
    assert.equal(r2.status, 500);
    assert.deepEqual(await r2.json(), { error: 'The server is not configured yet.' });
  });
});

describe('backup round trip', () => {
  test('export text matches the seed file, and importing it back saves an identical tree', async () => {
    const tree = await getTree();
    assert.equal(JSON.stringify(tree.data, null, 2), SEED_RAW.trimEnd());
    const res = await t.write('/api/tree', 'PUT', { baseVersion: tree.version, data: JSON.parse(SEED_RAW), reason: 'import' }, A);
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify((await getTree()).data, null, 2), SEED_RAW.trimEnd());
    const latest = (await (await t.call('/api/revisions', { cookie: A })).json()).revisions[0];
    assert.equal(latest.reason, 'import');
  });
});
