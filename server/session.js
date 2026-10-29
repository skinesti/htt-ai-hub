// Signed session and sign-in cookies. Session tokens are random; only their hash is stored server-side.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-htt_session';
export const OAUTH_COOKIE = '__Host-htt_oauth';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_SECONDS = 10 * 60;

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = token => createHash('sha256').update(token).digest();

const sign = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');

export function signValue(secret, value) { return value + '.' + sign(secret, value); }

export function verifySigned(secret, signed) {
  if (typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const value = signed.slice(0, i), given = Buffer.from(signed.slice(i + 1)), expected = Buffer.from(sign(secret, value));
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}

export function sealState(secret, state) {
  return signValue(secret, Buffer.from(JSON.stringify(state)).toString('base64url'));
}

export function openState(secret, sealed, now = Date.now()) {
  const value = verifySigned(secret, sealed);
  if (!value) return null;
  try {
    const state = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return state && typeof state.exp === 'number' && state.exp > now ? state : null;
  } catch { return null; }
}
