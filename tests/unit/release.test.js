// Release safety: production connection string rules, local secret collection, maintenance page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkProductionUrl } from '../../scripts/env-secret.js';
import { localSecretValues } from '../../scripts/secret-values.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const url = (host, query) => ['postgresql://owner', `pw-dummy-123@${host}/neondb${query}`].join(':');

test('production connection string must be a pooled Neon string with sslmode=verify-full', () => {
  assert.deepEqual(checkProductionUrl(url('ep-x-1-pooler.us-east-2.aws.neon.tech', '?sslmode=verify-full&channel_binding=require')), { host: 'ep-x-1-pooler.us-east-2.aws.neon.tech', sslmode: 'verify-full' });
  assert.throws(() => checkProductionUrl(url('ep-x-1-pooler.example.test', '?sslmode=require')), /must use sslmode=verify-full \(found sslmode=require\)/);
  assert.throws(() => checkProductionUrl(url('ep-x-1.example.test', '?sslmode=verify-full')), /pooled connection string/);
  assert.throws(() => checkProductionUrl(url('127.0.0.1', '?sslmode=verify-full')), /local database/);
  assert.throws(() => checkProductionUrl('postgresql://owner@ep-x-pooler.example.test/db?sslmode=verify-full'), /no password/);
  assert.throws(() => checkProductionUrl('has space'), /does not look like/);
  for (const bad of [url('ep-x-pooler.example.test', '?sslmode=require'), url('ep-x.example.test', '?sslmode=verify-full')]) {
    try { checkProductionUrl(bad); } catch (e) { assert.doesNotMatch(e.message, /pw-dummy-123|owner/); }
  }
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
