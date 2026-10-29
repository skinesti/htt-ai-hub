# Environment variables

Names only. Never commit values. Set production values in Netlify (site settings, environment variables, Functions scope). Locally, keep values in `.env` (gitignored) as `NAME=value` lines.

| Name | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Netlify Functions; local scripts | Postgres connection string. Server only. On Neon use the pooled connection string and set `sslmode=verify-full` (not `require`) in every copy: `.env`, Netlify and any HTT environment later. Neon's other parameters, such as `channel_binding=require`, can stay. The app logs a warning naming the setting (never the value) when a remote string lacks `verify-full`. |
| `SESSION_SECRET` | Netlify Functions | Random string, at least 32 characters, used to sign cookies. Changing it signs everyone out. |
| `GOOGLE_CLIENT_ID` | Netlify Functions | Google OAuth client ID (Web application). |
| `GOOGLE_CLIENT_SECRET` | Netlify Functions | Google OAuth client secret. |
| `APP_ORIGIN` | Netlify Functions | The app's exact origin, for example `https://example.netlify.app` (no trailing slash). Used for the sign-in redirect and the Origin check. |
| `ALLOWLIST_EMAILS` | Local script only (optional) | Alternative to `seed/allowlist.local.json` for `scripts/allow-user.js`. Format: `Name <email>, Name <email>`. |

Google OAuth client settings: authorized redirect URI `<APP_ORIGIN>/auth/callback`; scopes `openid` and `email` only.

Not used in any deployed code: the dev login. It has no variable; it exists only in `scripts/dev-server.js`. The build fails if `DEV_LOGIN` or `ENABLE_DEV_LOGIN` is set.
