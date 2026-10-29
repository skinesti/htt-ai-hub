// All server routes. Used by the Netlify Function and by the local dev server.
// Every app page, script and API route checks the session and the allowlist first.
import { ConfigError, requireConfig } from './config.js';
import { HttpError, checkCsrf, cookie, error, json, parseCookies, readJson, redirect, respond } from './http.js';
import { OAUTH_COOKIE, OAUTH_SECONDS, SESSION_COOKIE, SESSION_SECONDS, openState, randomToken, sealState, signValue, verifySigned } from './session.js';
import { authorizationUrl, verifyIdToken } from './oidc.js';
import * as store from './store.js';
import { ValidationError, prepare } from '../shared/model.js';

const SHELL_PATHS = ['/', '/app.js', '/app.css', '/shared/model.js'];
const SAVE_REASONS = ['save', 'undo', 'import'];
const SIGNIN = '/signin.html';

// options: { config, pool | getPool(), provider | providerFactory(config), shell: { path: { type, body } } }
export function createApp(options) {
  const { config } = options;
  let pool = options.pool, provider = options.provider;
  const db = () => {
    if (!pool) { requireConfig(config, ['databaseUrl']); pool = options.getPool(config.databaseUrl); }
    return pool;
  };
  const oidc = () => {
    requireConfig(config, ['googleClientId', 'googleClientSecret', 'appOrigin', 'sessionSecret']);
    return provider ??= options.providerFactory(config);
  };

  const sessionToken = request => verifySigned(config.sessionSecret, parseCookies(request)[SESSION_COOKIE]);
  const sessionCookie = token => cookie(SESSION_COOKIE, signValue(config.sessionSecret, token), SESSION_SECONDS);
  const clearCookie = name => cookie(name, '', 0);

  async function authenticate(request) {
    requireConfig(config, ['sessionSecret', 'appOrigin']);
    const token = sessionToken(request);
    if (!token) return { status: 'none' }; // signed out: no database needed
    return store.lookupSession(db(), token);
  }

  async function requireUser(request) {
    const session = await authenticate(request);
    if (session.status === 'none') throw new HttpError(401, 'Please sign in.');
    if (session.status !== 'ok') throw new HttpError(403, 'This account is not approved for this app.');
    return session.user;
  }

  async function serveShell(request, path) {
    const session = await authenticate(request);
    if (session.status !== 'ok') {
      if (path === '/') return redirect(session.status === 'none' ? SIGNIN : SIGNIN + '?error=denied');
      return error(session.status === 'none' ? 401 : 403, 'Please sign in.');
    }
    const file = options.shell[path];
    if (!file) return error(404, 'Not found.');
    return respond(file.body, { type: file.type });
  }

  async function login() {
    oidc();
    const state = randomToken(), nonce = randomToken(), verifier = randomToken(48);
    const sealed = sealState(config.sessionSecret, { state, nonce, verifier, exp: Date.now() + OAUTH_SECONDS * 1000 });
    const location = authorizationUrl(provider, { clientId: config.googleClientId, redirectUri: config.appOrigin + '/auth/callback', state, nonce, verifier });
    return redirect(location, [cookie(OAUTH_COOKIE, sealed, OAUTH_SECONDS)]);
  }

  async function callback(request, url) {
    oidc();
    const clear = [clearCookie(OAUTH_COOKIE)];
    const saved = openState(config.sessionSecret, parseCookies(request)[OAUTH_COOKIE]);
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (!saved || !code || !state || state !== saved.state || url.searchParams.get('error')) return redirect(SIGNIN + '?error=failed', clear);
    let email;
    try {
      const { idToken } = await provider.exchangeCode({ code, verifier: saved.verifier, redirectUri: config.appOrigin + '/auth/callback' });
      email = await verifyIdToken(provider, idToken, { clientId: config.googleClientId, nonce: saved.nonce });
    } catch (e) {
      console.error('[auth] sign-in could not be verified', e.code || e.name);
      return redirect(SIGNIN + '?error=failed', clear);
    }
    const user = await store.findActiveUser(db(), email);
    if (!user) { console.warn('[auth] sign-in refused for an account not on the allowlist'); return redirect(SIGNIN + '?error=denied', clear); }
    const token = await store.createSession(db(), user.email);
    return redirect('/', [...clear, sessionCookie(token)]);
  }

  async function logout(request) {
    requireConfig(config, ['sessionSecret', 'appOrigin']);
    checkCsrf(request, config.appOrigin);
    await store.deleteSession(db(), sessionToken(request));
    return respond(null, { status: 204, cookies: [clearCookie(SESSION_COOKIE)] });
  }

  async function prepared(data) {
    try { return prepare(data); }
    catch (e) { if (e instanceof ValidationError) throw new HttpError(400, e.message); throw new HttpError(400, 'Invalid data.'); }
  }

  const isVersion = v => Number.isInteger(v) && v >= 1 && v < 2 ** 31;

  async function api(request, url) {
    const path = url.pathname, method = request.method;
    if (method !== 'GET' && method !== 'HEAD') checkCsrf(request, config.appOrigin || '');
    const user = await requireUser(request);
    const pool = db();

    if (path === '/api/session' && method === 'GET') return json({ name: user.name, email: user.email });

    if (path === '/api/tree' && method === 'GET') {
      const current = await store.getCurrent(pool);
      return current ? json(current) : error(503, 'The shared tree has not been set up yet.');
    }
    if (path === '/api/tree/version' && method === 'GET') {
      const version = await store.getVersion(pool);
      return version ? json({ version }) : error(503, 'The shared tree has not been set up yet.');
    }
    if (path === '/api/tree' && method === 'PUT') {
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['baseVersion', 'data', 'reason'].includes(k))) throw new HttpError(400, 'Invalid request.');
      const reason = body.reason ?? 'save';
      if (!isVersion(body.baseVersion) || !SAVE_REASONS.includes(reason)) throw new HttpError(400, 'Invalid request.');
      const data = await prepared(body.data);
      const result = await store.saveTree(pool, { baseVersion: body.baseVersion, data, email: user.email, reason });
      if (!result.ok) return result.latest ? json({ error: 'conflict', latest: result.latest }, 409) : error(503, 'The shared tree has not been set up yet.');
      return json(result.current);
    }
    if (path === '/api/revisions' && method === 'GET') return json({ revisions: await store.listRevisions(pool) });

    const match = path.match(/^\/api\/revisions\/(\d{1,9})(\/restore)?$/);
    if (match) {
      const version = Number(match[1]);
      if (!match[2] && method === 'GET') {
        const revision = await store.getRevision(pool, version);
        return revision ? json(revision) : error(404, 'That version was not found.');
      }
      if (match[2] && method === 'POST') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Object.keys(body).some(k => k !== 'baseVersion') || !isVersion(body.baseVersion)) throw new HttpError(400, 'Invalid request.');
        const revision = await store.getRevision(pool, version);
        if (!revision) return error(404, 'That version was not found.');
        let data;
        try { data = prepare(revision.data); } catch { throw new HttpError(400, 'That version cannot be restored.'); }
        const result = await store.saveTree(pool, { baseVersion: body.baseVersion, data, email: user.email, reason: 'restore', restoredFrom: version });
        if (!result.ok) return result.latest ? json({ error: 'conflict', latest: result.latest }, 409) : error(503, 'The shared tree has not been set up yet.');
        return json(result.current);
      }
    }
    if (['/api/session', '/api/tree', '/api/tree/version', '/api/revisions'].includes(path) || match) return error(405, 'Not allowed.');
    return error(404, 'Not found.');
  }

  async function handle(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    try {
      if (SHELL_PATHS.includes(path)) return method === 'GET' || method === 'HEAD' ? await serveShell(request, path) : error(405, 'Not allowed.');
      if (path === '/auth/login') return method === 'GET' ? await login() : error(405, 'Not allowed.');
      if (path === '/auth/callback') return method === 'GET' ? await callback(request, url) : error(405, 'Not allowed.');
      if (path === '/auth/logout') return method === 'POST' ? await logout(request) : error(405, 'Not allowed.');
      if (path.startsWith('/api/')) return await api(request, url);
      return error(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      if (e instanceof ConfigError) { console.error('[config]', e.message); return error(500, 'The server is not configured yet.'); }
      console.error('[server] request failed', e.code || e.name);
      return error(500, 'Something went wrong. Please try again.');
    }
  }

  // Exposed for the local dev server's dev login only.
  return { handle, createSessionCookie: async email => sessionCookie(await store.createSession(db(), email)), db };
}
