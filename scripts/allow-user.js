// Manages the app allowlist from the command line (setup and admin recovery). Never deletes anyone.
//   node scripts/allow-user.js                     add or switch on everyone in seed/allowlist.local.json or ALLOWLIST_EMAILS
//   node scripts/allow-user.js --deactivate <email>   switch one account off and end its sessions
//   node scripts/allow-user.js --activate <email>     switch one account back on
//   node scripts/allow-user.js --grant-admin <email>  make one account an admin (recovery)
//   node scripts/allow-user.js --revoke-admin <email> remove admin from one account
// seed/allowlist.local.json is gitignored: [{ "email": "...", "name": "...", "admin": true }]
//   "admin": true only ever grants admin; the file never removes it.
// ALLOWLIST_EMAILS format: "Name <email>, Name <email>" (no admin flag; use --grant-admin).
// Emails must end in an allowed domain (ALLOWED_EMAIL_DOMAINS, default hertimetherapy.com).
// The database refuses any change that would leave no active admin; this script does not bypass it.
import { existsSync, readFileSync } from 'node:fs';
import { HttpError } from '../server/http.js';
import { allowedDomains, applyAllowlistEntry, cleanEmail, cleanName, countAdmins, scriptSetFlag } from '../server/users.js';
import { openTarget } from './db-target.js';

const FLAGS = { '--deactivate': ['active', false], '--activate': ['active', true], '--grant-admin': ['admin', true], '--revoke-admin': ['admin', false] };

function loadList() {
  const file = new URL('../seed/allowlist.local.json', import.meta.url);
  if (process.env.ALLOWLIST_EMAILS) {
    return process.env.ALLOWLIST_EMAILS.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
      const m = entry.match(/^(.*)<(.+)>$/);
      return m ? { name: m[1].trim(), email: m[2] } : { name: '', email: entry };
    });
  }
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  throw new HttpError(400, 'No allowlist found. Create seed/allowlist.local.json or set ALLOWLIST_EMAILS.');
}

const [flag, target] = process.argv.slice(2);
const domains = allowedDomains();
const pool = openTarget();
try {
  if (FLAGS[flag]) {
    const [field, value] = FLAGS[flag];
    const email = cleanEmail(target, domains);
    const found = await scriptSetFlag(pool, email, field, value);
    console.log(found ? 'Done.' : 'No such account; nothing changed.');
  } else if (flag) {
    throw new HttpError(400, 'Unknown option. See the comments at the top of scripts/allow-user.js.');
  } else {
    const list = loadList().map(u => ({ email: cleanEmail(u.email, domains), name: cleanName(u.name), admin: u.admin === true }));
    if (!list.length) throw new HttpError(400, 'The allowlist is empty.');
    for (const entry of list) await applyAllowlistEntry(pool, entry);
  }
  const counts = await countAdmins(pool);
  console.log(`Allowlist updated: ${counts.active} active account(s), ${counts.admins} admin(s).`);
} catch (e) {
  if (e instanceof HttpError) console.error('Refused:', e.message);
  else if (e.code === '23514' && /active admin/.test(e.message)) console.error('Refused: at least one active admin is required.');
  else console.error('Allowlist update failed:', e.code || e.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
