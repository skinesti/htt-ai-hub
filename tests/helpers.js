// Test helpers: throwaway databases on the local Postgres, and a fake OpenID provider with a real signing key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createApp } from '../server/app.js';
import { createPool } from '../server/db.js';
import { runMigrations } from '../server/migrations.js';
import { seedTree } from '../server/store.js';
import { applyAllowlistEntry } from '../server/users.js';
import { prepare } from '../shared/model.js';

export const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
export const SEED_RAW = readFileSync(new URL('../seed/htt-ai-hub-team-tree.json', import.meta.url), 'utf8');
export const seed = () => JSON.parse(SEED_RAW);
export const ORIGIN = 'https://team-tree.example.test';
export const USERS = { a: 'approved.one@example.test', b: 'approved.two@example.test', admin1: 'admin.one@example.test', admin2: 'admin.two@example.test', unlisted: 'not.listed@example.test' };

export async function createTestDatabase() {
  const name = `htt_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, '/' + name);
  const pool = createPool(url);
  await runMigrations(pool, fileURLToPath(new URL('../db/migrations/', import.meta.url)));
  await seedTree(pool, prepare(seed()));
  await applyAllowlistEntry(pool, { email: USERS.a, name: 'Tester One' });
  await applyAllowlistEntry(pool, { email: USERS.b, name: 'Tester Two' });
  await applyAllowlistEntry(pool, { email: USERS.admin1, name: 'Admin One', admin: true });
  await applyAllowlistEntry(pool, { email: USERS.admin2, name: 'Admin Two', admin: true });
  return {
    url, pool,
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    }
  };
}

export async function createFakeProvider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const provider = {
    authorizationEndpoint: 'https://idp.example.test/auth',
    issuers: ['https://idp.example.test'],
    jwks: createLocalJWKSet({ keys: [jwk] }),
    next: null, // claims for the next code exchange
    async exchangeCode() {
      const { claims, key = privateKey, header = { alg: 'RS256', kid: 'test' } } = provider.next;
      const idToken = await new SignJWT(claims).setProtectedHeader(header).setIssuedAt().setExpirationTime('5m').sign(key);
      return { idToken };
    }
  };
  return provider;
}

export const CONFIG = { databaseUrl: 'unused', sessionSecret: 'test-secret-'.padEnd(48, 'x'), googleClientId: 'client-123', googleClientSecret: 'shh', appOrigin: ORIGIN, allowedEmailDomains: 'example.test' };

export async function createTestApp() {
  const db = await createTestDatabase();
  const provider = await createFakeProvider();
  const shell = { '/': { type: 'text/html', body: '<!doctype html>app' }, '/app.js': { type: 'text/javascript', body: '//app' }, '/app.css': { type: 'text/css', body: '' }, '/shared/model.js': { type: 'text/javascript', body: '//model' } };
  const app = createApp({ config: CONFIG, pool: db.pool, provider, shell });
  const call = (path, { method = 'GET', cookie, body, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined || raw !== undefined) { h['content-type'] ??= 'application/json'; }
    return app.handle(new Request(ORIGIN + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }));
  };
  const write = (path, method, body, cookie, extra = {}) => call(path, { method, body, cookie, headers: { origin: ORIGIN, 'x-htt-request': '1', ...extra } });

  // Full sign-in through /auth/login and /auth/callback with the fake provider.
  async function signIn(email, overrides = {}) {
    const login = await call('/auth/login');
    const location = new URL(login.headers.get('location'));
    const oauthCookie = login.headers.getSetCookie().find(c => c.startsWith('__Host-htt_oauth=')).split(';')[0];
    const nonce = location.searchParams.get('nonce'), state = location.searchParams.get('state');
    provider.next = { claims: { iss: 'https://idp.example.test', aud: CONFIG.googleClientId, sub: 'sub-' + email, email, email_verified: true, nonce, ...overrides.claims }, ...overrides.token };
    const res = await call(`/auth/callback?code=fake-code&state=${overrides.state ?? state}`, { cookie: oauthCookie });
    const session = res.headers.getSetCookie().find(c => c.startsWith('__Host-htt_session=') && !c.includes('Max-Age=0'));
    return { res, location, cookie: session ? session.split(';')[0] : null };
  }
  return { app, db, provider, call, write, signIn };
}
