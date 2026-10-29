// Google sign-in (OpenID Connect, authorization code flow with PKCE). Scopes: openid email.
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const GOOGLE = Object.freeze({
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com']
});

export const pkceChallenge = verifier => createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(provider, { clientId, redirectUri, state, nonce, verifier }) {
  const url = new URL(provider.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
    state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account'
  }).toString();
  return url.toString();
}

// Verifies signature, issuer, audience, expiry and nonce. Returns the lowercased, Google-verified email.
export async function verifyIdToken(provider, idToken, { clientId, nonce }) {
  const { payload } = await jwtVerify(idToken, provider.jwks, { issuer: provider.issuers, audience: clientId, algorithms: ['RS256'], clockTolerance: 60 });
  if (!nonce || payload.nonce !== nonce) throw new Error('nonce mismatch');
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw new Error('email not verified');
  return payload.email.trim().toLowerCase();
}

export function createGoogleProvider(config) {
  return {
    ...GOOGLE,
    jwks: createRemoteJWKSet(new URL(GOOGLE.jwksUri)),
    async exchangeCode({ code, verifier, redirectUri }) {
      const res = await fetch(GOOGLE.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, code_verifier: verifier, redirect_uri: redirectUri, client_id: config.googleClientId, client_secret: config.googleClientSecret, grant_type: 'authorization_code' })
      });
      if (!res.ok) throw new Error('token exchange failed: ' + res.status);
      const body = await res.json();
      if (typeof body.id_token !== 'string') throw new Error('token exchange returned no id_token');
      return { idToken: body.id_token };
    }
  };
}
