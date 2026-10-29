# HTT AI Hub Team Tree

Independent HTT project. Do not edit, use or reference the personal Command Center app.

## Status (keep this honest)

- Private shared app: Netlify (static hosting plus one Function) and Neon Postgres.
- **Live in production** at https://htt-ai-hub.netlify.app. Deployed by Cristina on 2026-10-29 with `netlify deploy --build --prod` from commit `bbbd950`. Manual CLI deploy: no GitHub repository is connected to Netlify, so there are no preview or branch deploys.
- **Database:** production Neon branch migrated, seeded and allowlisted by Cristina with `.env.production`. Details as reported by Cristina, not independently checked: migrations 001 and 002, seeded as version 1, three approved users and two admins. The dev branch is separate.
- **Sign-in:** Cristina signed in successfully on the live site. Setup as reported by Cristina, not independently checked: a separate production Google OAuth client in the HTT Google Cloud project (Internal audience, `openid` and `email` only).
- **Verified on the live site:** `/api/tree` returns 401 signed out, `/` redirects to the sign-in page, `/app.js` returns 401 signed out, `/auth/dev-login` returns 404.
- **Netlify variables (Production), as reported by Cristina, not independently checked:** `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `APP_ORIGIN`, `NODE_VERSION`.
- **Open, not verified:** Meagan and Lauren have not signed in, so Internal-audience sign-in for their accounts is untested. Live browser checks (Users screen, removing the leftover Newsletter open-position tile, persistence, two-window conflict, History, Export backup) may still be pending. Security headers on the public page were not confirmed. No independent review was done (Cristina chose to skip it). Code has not been pushed; the intended remote is `skinesti/htt-ai-hub` (private), pushed only on Cristina's explicit approval.
- Claude created, linked and deployed nothing: every Netlify, Neon and Google step was done by Cristina.
- Do not describe anything in "Open, not verified" as done until Cristina confirms it.
- Moving to HTT's own accounts: see MIGRATION.md.

## Project exception (from Cristina, 2026-10-28)

This supersedes the earlier HTT Drive, connector and account instructions for this project.

- Built under Cristina's personal accounts: Claude, private GitHub repository `skinesti/htt-ai-hub`, Netlify, Neon. Keep code, schema and configuration portable so it can move to HTT's GitHub, Netlify and Neon later with no rebuild. No account-specific values in code.
- HTT Google Drive is not part of this build. Do not access Google Drive, do not verify an HTT connector, do not create Google Docs. Leave the Senior Analyst Profile URL exactly as it is in the data. Do not open that link.
- `documents/` stays in the repo but is not deployed.

## Data

- The shared database is the data source of truth. It was seeded from `seed/htt-ai-hub-team-tree.json`.
- Do not "correct" people, titles, reporting lines or category memberships to match these docs. The docs govern design and behavior only.
- Preserve the JSON model and IDs: nodes (id, name, title, parent, secondaryParents, category, intro, x, y, kind), categories (id, name, members as ID lists, skills, artifacts), and the top-level flags.

## Design and behavior (preserve exactly)

- No emojis. Write "Web site" as two words with a capital W. No em dashes.
- One category-under-person view. Show is only a viewing filter: All Team plus human employees. AI assistants appear within teams.
- Person cards and category names are selections. All editing, adding, assigning, category removal, global deletion, skills and artifacts happen in the right-hand Team editor with explicit Save. Editor footers: Close, Cancel, Save.
- Use labeled checkboxes for memberships, never native multi-select. Unchecking removes only that assignment.
- Category memberships are ID lists, separate from reporting lines. Never duplicate a person record to assign them to another category. A person's own name is omitted from their own category cards.
- Team Members are humans; AI Assistants are typed AI profiles; open positions are neither. Add EE and Add AI choose existing people first, with a separate Create new profile action. Creating from a category carries the shown person's manager context.
- Top name tiles: #d0c7d5 with #3b2f45 text. EE bubbles: #d0c7d5 with #3b2f45 text. AI bubbles: #6e5f7a with white text. Only AI profiles have Profile links.
- Skills and Artifacts are category records (id, name, optional https URL, description) shown as connected bubbles. Add EE, Add AI, Add Skill on one line; Add Artifact on a second line.
- Senior Analyst is displayed beside Meagan with an arrow toward her.
- Category cards wrap into rows (this supersedes the earlier one-row, horizontal-scrolling rule, by Cristina's decision of 2026-10-28). Cards keep their exact width (220 px, 210 px on phones), size, colors, bubbles and buttons. Each row fits as many cards as the width allows, at most 6, centered, alphabetical left to right then down; fewer fit beside the open editor and on narrow screens, down to 1 on phones. No horizontal scrolling. All of a person's cards share the tallest card's height, as before, except on phones (650 px and narrower), where each card is only as tall as its own content.
- Zoom (Fit, 100%, 75%, 50%; default 100%) is a viewing preference stored per browser, like Show. It applies only to the tree area (CSS zoom on #teamGroups), never to the header or the right-hand panel (editor, History, Users). Fit makes the widest section's full row (up to 6 cards) fit the window, between 50% and 100%. Do not revive the old canvas view, its arrange controls or its #zoom element.
- The Editing selector groups people by type: Team (Team Member), AI Assistants (AI Assistant), Open Positions (Open position), then Categories, Skills and Artifacts. Empty person groups are hidden; option values and order are unchanged.
- A failed save rolls back, rebuilds the editor against the restored records and keeps the draft fields.

## Shared app rules

- `shared/model.js` holds `validate` and `normalize` for both browser and server. The server is authoritative. Keep the existing rules (cycles, references, https-only links, 250 nodes, 200 categories, 100 skills and 100 artifacts per category, 4000-character descriptions) plus field length limits, unknown-field rejection and the 2 MB body limit.
- Every save sends `baseVersion`. A version mismatch returns 409 with the latest data; the client shows the conflict in the editor, keeps the draft and loads the latest. No automatic merging. Undo, import and restore are normal versioned saves.
- Users screen: admin-only on the server (403 otherwise). No self switch-off or self admin change; the last active admin is protected by app code and a database trigger; users are never deleted; `user_audit` is append-only. Initial admins come only from the gitignored allowlist file via `scripts/allow-user.js`, never from source, tests or docs.
- `tree_revisions` is append-only (enforced by a database trigger). Restore creates a new revision with `restored_from`.
- Every app page, script and API route checks the session and the allowlist on the server. The public folder holds only the data-free sign-in page.
- The dev login exists only in `scripts/dev-server.js` (localhost only). `scripts/build-check.js` fails the build if it is reachable or enabled.

## Boundaries

- Never run git push, deploy, create or link Netlify sites or Neon projects, or set production environment variables. Cristina does these after approving a specific release. Local commits are fine.
- Never print or echo `.env`. Never put a secret in code, docs, chat or reports.
- Every remote Postgres connection string (local `.env`, Netlify, later HTT) uses `sslmode=verify-full`, never `require`.
- Approved emails live only in `seed/allowlist.local.json` (gitignored) or the `ALLOWLIST_EMAILS` variable. Never commit them.
- Test against the local Postgres (`npm run db:local`) or a Neon dev branch, never production. Do not change live data.
- Read `restart.md` and `backlog.md` at the start of a session.
