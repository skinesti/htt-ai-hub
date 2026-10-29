// LOCAL DEVELOPMENT AND TESTS ONLY. Not part of the Netlify build or function bundle.
// Serves public/ plus the same server routes as the Netlify Function, and adds a localhost-only
// dev login (/auth/dev-login?email=...) so tests can sign in without Google.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createGoogleProvider } from '../server/oidc.js';
import { findActiveUser } from '../server/store.js';
import { SECURITY_HEADERS } from '../server/http.js';
import { readShell } from './shell-files.js';

const DEPLOYED_MARKERS = ['NETLIFY', 'CONTEXT', 'NETLIFY_DEV', 'AWS_LAMBDA_FUNCTION_NAME', 'SITE_ID', 'DEPLOY_ID'];

export function assertLocalOnly(env = process.env) {
  const found = DEPLOYED_MARKERS.filter(name => env[name]);
  if (found.length || env.NODE_ENV === 'production') throw new Error('Dev server refuses to run in a deployed or production environment.');
}

function isLocalDatabase(url) {
  try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

export async function startDevServer({ port = 8888, databaseUrl = process.env.DATABASE_URL, allowRemoteDb = false, log = true } = {}) {
  assertLocalOnly();
  if (!databaseUrl) throw new Error('Set DATABASE_URL (for example from `npm run db:local`).');
  if (!isLocalDatabase(databaseUrl) && !allowRemoteDb) throw new Error('Dev server only uses a local database unless --allow-remote-db is passed. Never use production.');

  const origin = `http://localhost:${port}`;
  const config = { ...loadConfig({ ...process.env, DATABASE_URL: databaseUrl }), appOrigin: origin, sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('base64url') };
  const pool = createPool(databaseUrl);
  const app = createApp({ config, pool, providerFactory: createGoogleProvider, get shell() { return readShell(); } });
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) { res.writeHead(421).end(); return; }
      const url = new URL(req.url, origin);
      let response;
      if (url.pathname === '/auth/dev-login') {
        const user = await findActiveUser(pool, (url.searchParams.get('email') || '').trim().toLowerCase());
        response = user ? new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': await app.createSessionCookie(user.email) } })
          : new Response(JSON.stringify({ error: 'This account is not approved for this app.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      } else if (['/', '/app.js', '/app.css', '/shared/model.js', '/auth/login', '/auth/callback', '/auth/logout'].includes(url.pathname) || url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
        response = await app.handle(new Request(url, { method: req.method, headers: req.headers, body }));
      } else {
        const file = normalizePath(publicDir + decodeURIComponent(url.pathname));
        const data = file.startsWith(publicDir) ? await readFile(file).catch(() => null) : null;
        response = data ? new Response(data, { headers: { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' } }) : new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
      }
      const headers = {};
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') headers[key] = value; });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error('[dev] request failed', e.code || e.name);
      res.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  if (log) {
    console.log(`Dev server: ${origin} (local only).`);
    console.log(`Dev login (localhost only): ${origin}/auth/dev-login?email=<approved email>`);
    console.log(config.googleClientId && config.googleClientSecret
      ? `Google sign-in: ${origin}/auth/login (redirect URI ${origin}/auth/callback)`
      : 'Google sign-in: not configured (run `node scripts/env-secret.js google` to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env).');
    if (!process.env.SESSION_SECRET) console.log('Session secret: temporary for this run (run `node scripts/env-secret.js session` to keep sign-ins across restarts).');
  }
  return { origin, close: async () => { await new Promise(r => server.close(r)); await pool.end(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.find(a => a.startsWith('--port='));
  startDevServer({ port: portArg ? Number(portArg.split('=')[1]) : 8888, allowRemoteDb: process.argv.includes('--allow-remote-db') })
    .catch(e => { console.error(e.message); process.exit(1); });
}
