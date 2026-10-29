# Moving to HTT's own accounts

A checklist for moving the app from Cristina's personal GitHub, Netlify and Neon to HTT-owned accounts. No code changes are expected. Never put a value, connection string or email in this file or any committed file.

What moves and what does not: the Export backup carries the current tree only. History (earlier versions), the user list and the user audit trail stay in the old database. Keep the old Neon project read-only until the new site is confirmed, so its history remains available.

## Before you start

- [ ] Sign in to the live app as an admin and use Export backup. Keep the file somewhere private (it holds team data).
- [ ] Note the approved users and admins on the Users screen. The new database starts with only the people in `seed/allowlist.local.json`.
- [ ] Optional: publish the maintenance page on the old site so nobody edits during the move (see README, "Maintenance page").

## 1. Repository

- [ ] Create a private repository in HTT's GitHub organization.
- [ ] Add it as a remote and push (Cristina runs every push herself).
- [ ] Give access only to the people who need it.
- [ ] Archive or delete `skinesti/htt-ai-hub` only after the new site is confirmed.

## 2. Database (new Neon project)

- [ ] Create a Neon project in HTT's account. Keep a separate dev branch for testing.
- [ ] Copy the production pooled connection string into a local env file with hidden input (it refuses the dev branch host in `.env` and sets `sslmode=verify-full`):

  ```
  node scripts/env-secret.js production-db --replace
  ```
- [ ] Run the migrations:

  ```
  node --env-file=.env.production scripts/migrate.js
  ```
- [ ] Load the tree from the Export backup as version 1 (the file must pass the shared rules unchanged):

  ```
  node --env-file=.env.production scripts/seed.js <path to the export file>
  ```

  If it is refused, seed the original file instead (`node --env-file=.env.production scripts/seed.js`), then after step 4 sign in and use Import backup with the export file.
- [ ] Load the approved users and admins:

  ```
  node --env-file=.env.production scripts/allow-user.js
  ```

## 3. Google sign-in (new redirect address)

- [ ] In the HTT Google Cloud project, add the new site's address to the production OAuth client: `https://<new site>/auth/callback`. Or create a new Web application client (Internal audience, scopes `openid` and `email` only) with only that redirect URI.
- [ ] Remove the old redirect URI once the old site is retired.
- [ ] At handover, make sure Meagan is an Owner of the Google Cloud project.

## 4. Netlify site

- [ ] Create a site in HTT's Netlify team. Connect the HTT repository, or keep manual CLI deploys.
- [ ] Set the Production variables (names in ENVIRONMENT.md): `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (generate a new one), `APP_ORIGIN` (the new address, no trailing slash), `NODE_VERSION`.
- [ ] Deploy: `netlify deploy --build --prod`. The build check and bundle check must pass.

## 5. Confirm, then retire the old setup

- [ ] Signed out: `/api/tree` and `/app.js` return 401, `/` goes to the sign-in page, `/auth/dev-login` returns 404.
- [ ] Each approved user signs in. An admin opens the Users screen.
- [ ] Save a change, reload in another window, check History.
- [ ] Take a fresh Export backup from the new site.
- [ ] Publish the maintenance page on the old site (or delete the old site), then retire the old Neon project and Google redirect URI.
