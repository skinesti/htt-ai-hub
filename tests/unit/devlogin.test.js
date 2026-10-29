import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertLocalOnly, startDevServer } from '../../scripts/dev-server.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('dev server refuses to run in any deployed or production environment', () => {
  for (const env of [{ NETLIFY: 'true' }, { CONTEXT: 'production' }, { CONTEXT: 'deploy-preview' }, { NODE_ENV: 'production' }, { AWS_LAMBDA_FUNCTION_NAME: 'x' }, { SITE_ID: 'x' }]) {
    assert.throws(() => assertLocalOnly(env), /refuses/, JSON.stringify(env));
  }
  assert.doesNotThrow(() => assertLocalOnly({}));
});

test('dev server refuses a non-local database', async () => {
  await assert.rejects(startDevServer({ databaseUrl: ['postgres://u', 'p@db.example.test/x'].join(':'), log: false }), /local database/);
});

test('the Netlify function and server code contain no dev login', () => {
  const files = [...readdirSync(root + 'netlify/functions').map(f => 'netlify/functions/' + f), ...readdirSync(root + 'server').filter(f => f.endsWith('.js')).map(f => 'server/' + f)];
  for (const f of files) assert.doesNotMatch(readFileSync(root + f, 'utf8'), /dev-login|dev-server/, f);
});

test('the build fails when a dev login variable is set', () => {
  const run = env => spawnSync(process.execPath, ['scripts/build-check.js'], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const bad = run({ DEV_LOGIN: '1' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /dev login is not allowed/);
  assert.equal(run({}).status, 0);
});
