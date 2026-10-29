# HTT AI Hub · Team Tree

A private, shared team tree for Her Time Therapy: people, AI assistants, categories, skills and artifacts, edited in a right-hand Team editor.

## Status

- **Local only.** Built and tested on this computer. Nothing is deployed.
- No Netlify site, Neon project or Google OAuth client is connected yet. Google sign-in has only been tested against a local stand-in.
- Built under Cristina's personal accounts (private GitHub `skinesti/htt-ai-hub`, Netlify, Neon) by project exception, and kept portable so it can move to HTT accounts without a rebuild. HTT Google Drive is not part of this build.

## How it works

- **Stack:** static sign-in page plus one Netlify Function (Node), and a Postgres database (Neon). Plain SQL migrations. No Supabase, no Netlify Identity.
- **Sign-in:** Google (OpenID Connect, scopes `openid email`). The server checks the verified email against the `app_users` allowlist. Sessions are random tokens in a signed, HttpOnly, Secure, SameSite=Lax cookie, stored hashed in the database, and expire after 7 days. Sign out ends the session on the server.
- **Private by default:** the only public files are the sign-in page, its CSS and script, and `robots.txt`. The app page, scripts and data are served only to signed-in, approved users. Everything is `no-store` and `noindex`.
- **Shared data:** one current tree document (JSONB) with a version number, plus an append-only history of every version (who, when, why).
- **No silent overwrites:** each save sends the version it started from. If someone else saved first, the server refuses (409) and returns the latest data. The editor shows a conflict message, keeps the draft and loads the latest; save again to apply.
- **Backup and restore:** Export backup downloads the current tree as JSON. Import backup checks the file, asks for confirmation in the editor, then saves it as a new version. History lists every version; any approved user can restore one, which saves it as a new version. Nothing is deleted.
- **Users screen (admins only):** add people (name and an address in the allowed domain), switch them on or off, rename them, and grant or remove admin. Nobody can switch themselves off or change their own admin access, the last active admin can never be removed (also enforced by the database, so scripts and direct SQL cannot do it either), users are never deleted, and the list is limited to 50. Every change is recorded in an append-only audit table and shown under Recent changes. Admins are set initially with `scripts/allow-user.js` (`"admin": true` in the gitignored allowlist file), which also handles recovery with `--grant-admin`.
- **Layout:** each person's category cards wrap into rows instead of one scrolling row (this replaces the earlier one-row rule). Cards keep their exact size and look; each row holds as many as fit, at most 6, centered and alphabetical, reading left to right then down. Typical results with the editor closed / open: 1440 to 1512 px wide: 6 / 4; 1024 px: 4 / 2; phones: 1. There is no horizontal scrolling. A person's cards share the tallest card's height, except on phones, where each card is only as tall as its content.
- **Zoom:** Fit, 100%, 75% or 50% in the header (default 100%). It scales only the tree, never the header or the right-hand panel. Fit shrinks the tree just enough for the widest row of up to 6 cards to fit the window, never below 50% or above 100%. The choice is remembered in this browser, like Show.
- **Editing selector:** people are grouped as Team, AI Assistants and Open Positions (empty groups hidden), followed by Categories, Skills and Artifacts.
- **Limits:** up to 250 people and positions, 200 categories, 100 skills and 100 artifacts per category, 4000-character descriptions, 2 MB per save.
- **Browser storage** only remembers the Show and Zoom choices. Older browser-saved copies of the tree are not read.

## Repository layout

| Path | Purpose |
|---|---|
| `app/` | The signed-in app: `index.html`, `app.js`, `app.css` (original design) |
| `shared/model.js` | Validation and normalization used by both browser and server |
| `public/` | Data-free sign-in page (the only static files deployed) |
| `netlify/functions/app.mjs` | Serves the app after the session check, sign-in and the API |
| `server/` | Routes, sessions, Google sign-in, database queries |
| `db/migrations/` | Plain SQL schema |
| `scripts/` | Migrate, seed, allowlist, build check, local database and dev server |
| `seed/htt-ai-hub-team-tree.json` | Starting data (loaded as version 1) |
| `documents/` | Senior Analyst introduction source files (kept in the repo, not deployed) |
| `tests/` | Unit and API tests (`node --test`) and browser tests (Playwright) |
| `ENVIRONMENT.md` | Environment variable names |

## API

All routes need a signed-in, approved user (401 signed out, 403 not approved). Requests that change data also need the app's own Origin and the `X-HTT-Request: 1` header.

| Route | Purpose |
|---|---|
| `GET /auth/login`, `GET /auth/callback` | Google sign-in (state, nonce, PKCE) |
| `POST /auth/logout` | Sign out |
| `GET /api/session` | Who is signed in |
| `GET /api/tree` | Current tree, version, who and when |
| `GET /api/tree/version` | Current version only |
| `PUT /api/tree` | Save `{ baseVersion, data, reason }` (`save`, `undo` or `import`) |
| `GET /api/users` | Admins only: users, recent changes, allowed domains |
| `POST /api/users` | Admins only: add `{ email, name }` |
| `PATCH /api/users` | Admins only: change `{ email, name?, active?, admin? }` for someone else |
| `GET /api/revisions` | History: version, who, when, reason, restored from |
| `GET /api/revisions/:version` | One past version |
| `POST /api/revisions/:version/restore` | Restore `{ baseVersion }` as a new version |

## Local development

Requires Node 20+ and PostgreSQL client tools (`initdb`, `pg_ctl`).

```sh
npm install
npm run db:local                      # throwaway Postgres in .local/ on 127.0.0.1:54329
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/htt_dev
npm run migrate && npm run seed && npm run allow-users
npm run dev                           # http://localhost:8888
```

Sign in locally at `http://localhost:8888/auth/dev-login?email=<approved email>`. The dev login exists only in `scripts/dev-server.js`, binds to localhost and refuses to run on Netlify or with a non-local database. The build check fails if it is enabled or reachable from deployed code.

Tests: `npm test` (needs the local Postgres running) and `npm run test:e2e` (browser tests, including the UI comparison with the original).

## Maintenance page

`maintenance/` is a data-free offline page with no functions. Publishing it over the app takes the app offline: every address shows the page, and nothing can reach the database. Data, users, history and Netlify settings are untouched. Publish it only when you decide to take the app offline, from the project folder:

```sh
netlify deploy --prod --dir=maintenance --functions=maintenance/no-functions
```

To bring the app back, publish the last app deploy in Netlify (Deploys, choose it, "Publish deploy"), or run `netlify deploy --build --prod` again.

## Data notes

The seed JSON is the source of truth for people and categories. Some older notes described different data; the JSON was kept as is:

- Meagan's title is "CEO & Founder".
- Cristina reports to Meagan.
- Newsletter is assigned to Lauren.
- Branding exists (Meagan, Lauren, Cristina) with the HTT Color Palette artifact.
- Client Care is not present.
- Meagan is also a member of Web Site and Admin.
- Senior Analyst's Profile link is the Google Doc URL in the JSON.

## Earlier history

The browser-only preview this was built from is in the first commit. `review-notes.md` records the earlier editor review of that preview; it is not release approval.
