# Environment variables

Names only. Never commit values. Set production values in Netlify (site settings, environment variables, Functions scope). Locally, keep values in `.env` (gitignored) as `NAME=value` lines.

| Name | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Netlify Functions; local scripts | Postgres connection string. Server only. On Neon use the pooled connection string and set `sslmode=verify-full` (not `require`) in every copy: `.env`, Netlify and any HTT environment later. Neon's other parameters, such as `channel_binding=require`, can stay. The app logs a warning naming the setting (never the value) when a remote string lacks `verify-full`. |
| `SESSION_SECRET` | Netlify Functions | Random string, at least 32 characters, used to sign cookies. Changing it signs everyone out. |
| `GOOGLE_CLIENT_ID` | Netlify Functions | Google OAuth client ID (Web application). |
| `GOOGLE_CLIENT_SECRET` | Netlify Functions | Google OAuth client secret. |
| `APP_ORIGIN` | Netlify Functions | The app's exact origin, for example `https://example.netlify.app` (no trailing slash). Used for the sign-in redirect and the Origin check. |
| `ALLOWED_EMAIL_DOMAINS` | Netlify Functions; local scripts (optional) | Comma-separated email domains allowed on the Users screen and in `scripts/allow-user.js`. Leave unset to allow only the HTT domain. Set it only to allow other domains on purpose. |
| `ALLOWLIST_EMAILS` | Local script only (optional) | Alternative to `seed/allowlist.local.json` for `scripts/allow-user.js`. Format: `Name <email>, Name <email>`. Cannot mark admins; use `--grant-admin`. |

Google OAuth client settings: application type Web application; authorized redirect URI `<APP_ORIGIN>/auth/callback`; scopes `openid` and `email` only. An Internal audience limits sign-in to the HTT Google Workspace; the app's allowlist still decides who gets in.

## Local Google sign-in

- Redirect URI to register for local testing: `http://localhost:8888/auth/callback` (open the app at `localhost`, not `127.0.0.1`).
- Store the client ID and secret without showing the secret: `node scripts/env-secret.js google` (hidden input, shows asterisks, writes `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env`, sets the file to owner-only).
- Create a session secret: `node scripts/env-secret.js session` (generated, never shown; refuses to replace an existing one unless `--replace`).
- Run: `node --env-file=.env scripts/dev-server.js --allow-remote-db`, then open `http://localhost:8888/`. The dev server sets `APP_ORIGIN` to `http://localhost:8888` itself; the dev login stays available on localhost only.
- Use Chrome locally; the sign-in cookies are `Secure`, which Chrome allows on `http://localhost`.

Not used in any deployed code: the dev login. It has no variable; it exists only in `scripts/dev-server.js`. The build fails if `DEV_LOGIN` or `ENABLE_DEV_LOGIN` is set.
