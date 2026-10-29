// Release safety: production connection string rules, local secret collection, maintenance page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkProductionUrl, envDatabaseUrl } from '../../scripts/env-secret.js';
import { localSecretValues } from '../../scripts/secret-values.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const url = (host, query) => ['postgresql://owner', `pw-dummy-123@${host}/neondb${query}`].join(':');

const POOLED = 'ep-x-1-pooler.us-east-2.aws.neon.tech';
const noSecret = fn => { try { fn(); } catch (e) { assert.doesNotMatch(e.message, /pw-dummy-123|owner|ep-x|ep-dev/); return e; } assert.fail('expected a refusal'); };

test('production connection string must be a pooled Neon string; verify-full is kept as pasted', () => {
  const pasted = url(POOLED, '?sslmode=verify-full&channel_binding=require');
  assert.deepEqual(checkProductionUrl(pasted), { value: pasted, host: POOLED, label: 'ep-x-1-pooler', sslmode: 'verify-full', changedFrom: null });
  assert.throws(() => checkProductionUrl(url('ep-x-1.example.test', '?sslmode=verify-full')), /pooled connection string/);
  assert.throws(() => checkProductionUrl(url('127.0.0.1', '?sslmode=verify-full')), /local database/);
  assert.throws(() => checkProductionUrl('postgresql://owner@ep-x-pooler.example.test/db?sslmode=verify-full'), /no password/);
  assert.throws(() => checkProductionUrl('has space'), /does not look like/);
  noSecret(() => checkProductionUrl(url('ep-x.example.test', '?sslmode=verify-full')));
});

test('sslmode=require is rewritten to verify-full; other parameters and the password are kept', () => {
  const r = checkProductionUrl(url(POOLED, '?sslmode=require&channel_binding=require'));
  assert.equal(r.changedFrom, 'sslmode=require');
  assert.equal(r.value, url(POOLED, '?sslmode=verify-full&channel_binding=require'));
  assert.equal(new URL(r.value).password, 'pw-dummy-123');
  assert.equal(checkProductionUrl(url(POOLED, '?sslmode=prefer')).value, url(POOLED, '?sslmode=verify-full'));
});

test('a string with no sslmode gets sslmode=verify-full', () => {
  const r = checkProductionUrl(url(POOLED, '?channel_binding=require'));
  assert.equal(r.changedFrom, 'no sslmode');
  assert.equal(r.value, url(POOLED, '?channel_binding=require&sslmode=verify-full'));
  assert.equal(checkProductionUrl(url(POOLED, '')).value, url(POOLED, '?sslmode=verify-full'));
});

test('sslmode=disable and any other value are refused without showing the string', () => {
  for (const mode of ['disable', 'allow', 'verify-ca', 'bogus']) {
    const e = noSecret(() => checkProductionUrl(url(POOLED, '?sslmode=' + mode)));
    assert.match(e.message, new RegExp(`sslmode=${mode} is not allowed.*Nothing saved`));
  }
  assert.match(noSecret(() => checkProductionUrl(url(POOLED, '?sslmode=require&sslmode=disable'))).message, /more than one sslmode/);
});

test('the host in the local .env (dev branch) is refused unless --force', () => {
  const prod = url(POOLED, '?sslmode=verify-full');
  for (const devHost of [POOLED, 'ep-x-1.us-east-2.aws.neon.tech', 'EP-X-1-POOLER.us-east-2.aws.neon.tech']) {
    const devUrl = url(devHost, '?sslmode=verify-full');
    assert.match(noSecret(() => checkProductionUrl(prod, { devUrl })).message, /this looks like the dev branch/);
    assert.equal(checkProductionUrl(prod, { devUrl, force: true }).value, prod);
  }
  assert.equal(checkProductionUrl(prod, { devUrl: url('ep-dev-9-pooler.us-east-2.aws.neon.tech', '?sslmode=verify-full') }).value, prod);
  assert.equal(checkProductionUrl(prod, { devUrl: 'postgresql://localhost:54329/htt' }).value, prod);
  assert.equal(checkProductionUrl(prod, { devUrl: 'not a url' }).value, prod);
  const envText = ['# local', 'SESSION_SECRET=abc', `DATABASE_URL="${url(POOLED, '?sslmode=verify-full')}"`].join('\n');
  assert.equal(envDatabaseUrl(envText), url(POOLED, '?sslmode=verify-full'));
  assert.equal(envDatabaseUrl('SESSION_SECRET=abc'), '');
});

test('secret values come from .env and every .env.* file, including connection-string passwords; local databases are skipped', () => {
  const dir = root + '.tmp-test/';
  mkdirSync(dir, { recursive: true });
  const files = { '.env': `DATABASE_URL=${url('ep-dev-pooler.example.test', '?sslmode=verify-full')}\nSESSION_SECRET=dummy-session-value-1\nSHORT=abc\n`, '.env.production': `DATABASE_URL=${url('ep-prod-pooler.example.test', '?sslmode=verify-full')}\n`, '.env.local': 'DATABASE_URL=postgres://postgres@127.0.0.1:54329/htt_dev\n' };
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(dir + name, text);
    const found = localSecretValues(dir, {});
    const values = found.map(f => f.value);
    assert.ok(values.includes('pw-dummy-123'));
    assert.ok(values.includes('dummy-session-value-1'));
    assert.ok(found.some(f => f.source === '.env.production' && f.value.includes('ep-prod-pooler')));
    assert.ok(!values.includes('abc'));
    assert.ok(!values.some(v => v.includes('127.0.0.1')));
  } finally {
    for (const name of Object.keys(files)) if (existsSync(dir + name)) unlinkSync(dir + name);
    rmdirSync(dir);
  }
});

test('maintenance page has no functions, catches every address, and holds no app code', () => {
  const m = root + 'maintenance/';
  assert.deepEqual(readdirSync(m + 'no-functions'), ['.gitkeep']);
  assert.match(readFileSync(m + '_redirects', 'utf8'), /^\/\*\s+\/index\.html\s+200$/m);
  assert.match(readFileSync(m + '_headers', 'utf8'), /Cache-Control: no-store/);
  assert.deepEqual(readdirSync(m).sort(), ['_headers', '_redirects', 'index.html', 'maintenance.css', 'no-functions', 'robots.txt']);
  assert.doesNotMatch(readFileSync(m + 'index.html', 'utf8'), /<script|\/api\//);
});
