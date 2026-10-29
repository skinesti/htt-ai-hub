// Single Netlify Function serving the signed-in app shell, Google sign-in and the API.
// The public folder holds only the data-free sign-in page.
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { createPool } from '../../server/db.js';
import { createGoogleProvider } from '../../server/oidc.js';
import shell from '../../server/generated/shell.js';

let app;

export default async request => {
  app ??= createApp({ config: loadConfig(), getPool: createPool, providerFactory: createGoogleProvider, shell });
  return app.handle(request);
};

export const config = {
  path: ['/', '/app.js', '/app.css', '/shared/model.js', '/auth/login', '/auth/callback', '/auth/logout', '/api/*']
};
