// Response helpers, security headers and request checks.
import { LIMITS } from '../shared/model.js';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': CSP
});

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function respond(body, { status = 200, type = 'application/json; charset=utf-8', headers = {}, cookies = [] } = {}) {
  const h = new Headers({ ...SECURITY_HEADERS, ...headers });
  if (body !== null && type) h.set('Content-Type', type);
  for (const cookie of cookies) h.append('Set-Cookie', cookie);
  const payload = body === null ? null : type.startsWith('application/json') ? JSON.stringify(body) : body;
  return new Response(payload, { status, headers: h });
}

export const json = (body, status = 200, extra = {}) => respond(body, { status, ...extra });
export const error = (status, message, extra = {}) => respond({ error: message }, { status, ...extra });
export const redirect = (location, cookies = []) => respond(null, { status: 302, headers: { Location: location }, cookies });

// State-changing requests must come from the app's own origin and carry the custom header.
export function checkCsrf(request, appOrigin) {
  if (request.headers.get('origin') !== appOrigin) throw new HttpError(403, 'Request blocked.');
  if (request.headers.get('x-htt-request') !== '1') throw new HttpError(403, 'Request blocked.');
}

export async function readJson(request, limit = LIMITS.bodyBytes) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'This change is too large to save.');
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length > limit) throw new HttpError(413, 'This change is too large to save.');
  try { return JSON.parse(buffer.toString('utf8')); } catch { throw new HttpError(400, 'Invalid request.'); }
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
