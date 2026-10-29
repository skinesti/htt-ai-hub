// Manages the app allowlist. Never deletes anyone.
//   node scripts/allow-user.js                 add/activate everyone in seed/allowlist.local.json or ALLOWLIST_EMAILS
//   node scripts/allow-user.js --deactivate a@b  turn off one account and end its sessions
//   node scripts/allow-user.js --activate a@b    turn one account back on
// seed/allowlist.local.json is gitignored: [{ "email": "...", "name": "..." }]
// ALLOWLIST_EMAILS format: "Name <email>, Name <email>" or "email, email"
import { existsSync, readFileSync } from 'node:fs';
import { setUserActive, upsertUser } from '../server/store.js';
import { openTarget } from './db-target.js';

const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

function loadList() {
  const file = new URL('../seed/allowlist.local.json', import.meta.url);
  if (process.env.ALLOWLIST_EMAILS) {
    return process.env.ALLOWLIST_EMAILS.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
      const m = entry.match(/^(.*)<(.+)>$/);
      return m ? { name: m[1].trim(), email: m[2] } : { name: '', email: entry };
    });
  }
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  console.error('No allowlist found. Create seed/allowlist.local.json or set ALLOWLIST_EMAILS.');
  process.exit(1);
}

const [flag, target] = process.argv.slice(2);
const pool = openTarget();
try {
  if (flag === '--deactivate' || flag === '--activate') {
    const email = (target || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('Give one email address.');
    const found = await setUserActive(pool, email, flag === '--activate');
    console.log(found ? `Account ${flag === '--activate' ? 'activated' : 'deactivated'}.` : 'No such account; nothing changed.');
  } else {
    const list = loadList().map(u => ({ email: String(u.email || '').trim().toLowerCase(), name: String(u.name || '').trim() }));
    if (!list.length || list.some(u => !EMAIL.test(u.email))) throw new Error('Allowlist has an invalid email.');
    for (const user of list) await upsertUser(pool, user);
    console.log(`Allowlist updated: ${list.length} active account(s).`);
  }
} catch (e) {
  console.error('Allowlist update failed:', e.message && !/postgres/i.test(e.message) ? e.message : e.code || e.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
