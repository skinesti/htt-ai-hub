import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertEnv } from '../../scripts/env-secret.js';
import { startDevServer } from '../../scripts/dev-server.js';
import { createTestDatabase } from '../helpers.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('upsertEnv adds, replaces once and keeps other lines', () => {
  assert.equal(upsertEnv('', 'A_B', 'x1'), 'A_B=x1\n');
  assert.equal(upsertEnv('DATABASE_URL=keep\nA_B=old\n', 'A_B', 'new'), 'DATABASE_URL=keep\nA_B=new\n');
  assert.equal(upsertEnv('A_B=1\nX=2\nA_B=3', 'A_B', 'z'), 'A_B=z\nX=2\n');
  assert.throws(() => upsertEnv('', 'A_B', 'has space'), /not allowed/);
  assert.throws(() => upsertEnv('', 'A_B', 'line\nbreak'), /not allowed/);
});

test('session secret is generated once, kept, and not printed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htt-env-')), file = join(dir, '.env');
  writeFileSync(file, 'DATABASE_URL=keep-me\n');
  const run = (...a) => spawnSync(process.execPath, ['scripts/env-secret.js', 'session', '--file', file, ...a], { cwd: root, encoding: 'utf8' });
  const first = run();
  const value = readFileSync(file, 'utf8').match(/^SESSION_SECRET=(.+)$/m)[1];
  assert.ok(value.length >= 60);
  assert.ok(!first.stdout.includes(value) && !first.stderr.includes(value));
  assert.match(readFileSync(file, 'utf8'), /^DATABASE_URL=keep-me$/m);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(run().stdout, /already set; nothing changed/);
  assert.equal(readFileSync(file, 'utf8').match(/^SESSION_SECRET=(.+)$/m)[1], value);
});

test('google prompt refuses to run without a terminal', () => {
  const r = spawnSync(process.execPath, ['scripts/env-secret.js', 'google', '--file', '/dev/null'], { cwd: root, input: 'x\n', encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run this in a terminal/);
});

test('dev server starts real Google sign-in against localhost when configured', async () => {
  const db = await createTestDatabase();
  const saved = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = '123-abc.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'not-a-real-secret';
  const server = await startDevServer({ port: 8893, databaseUrl: db.url, log: false });
  try {
    const res = await fetch(server.origin + '/auth/login', { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost:8893/auth/callback');
    assert.equal(loc.searchParams.get('scope'), 'openid email');
    assert.equal(loc.searchParams.get('client_id'), '123-abc.apps.googleusercontent.com');
    assert.ok(!loc.toString().includes('not-a-real-secret'));
    const cb = await fetch(server.origin + '/auth/callback?code=x&state=forged', { redirect: 'manual' });
    assert.equal(cb.headers.get('location'), '/signin.html?error=failed');
    // fetch ignores a custom Host header, so use node:http to send one the dev login must refuse.
    const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 8893, path: '/auth/dev-login?email=x', headers: { host: 'evil.example.test' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    assert.equal(status, 421);
  } finally {
    await server.close(); await db.drop();
    for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
