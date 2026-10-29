// Adds secrets to the local .env without showing them on screen or in any log.
//   node scripts/env-secret.js google    prompt for GOOGLE_CLIENT_ID (visible) and GOOGLE_CLIENT_SECRET (hidden)
//   node scripts/env-secret.js session   generate SESSION_SECRET (refuses to replace an existing one unless --replace)
//   node scripts/env-secret.js production-db   paste the Neon PRODUCTION pooled string (hidden) into .env.production;
//                                       sslmode=require, prefer or missing becomes verify-full; any other sslmode is refused;
//                                       refuses the host in your local .env (dev branch) unless --force;
//                                       prints only the first part of the host and the sslmode
// Options: --file <path> (default: .env in the project root), --replace, --force (production-db only)
// Existing lines for the same name are replaced; all other lines are kept. The file is set to owner-only (600).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAFE_VALUE = /^[A-Za-z0-9._~+/=-]+$/;
const URL_VALUE = /^[A-Za-z0-9._~+/=:@?&%-]+$/; // connection strings: no spaces, quotes or #

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const AUTO_FIX = ['require', 'prefer']; // also a missing sslmode; these are rewritten to verify-full
// Neon's pooled and direct hosts for the same branch differ only by "-pooler", so compare without it.
const hostKey = host => String(host || '').toLowerCase().replace('-pooler.', '.');

// Reads DATABASE_URL from env-file text (for example the local .env) without printing it. Returns '' if absent.
export function envDatabaseUrl(text) {
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

// Checks a pasted production connection string. Never puts the string or password in a message.
// sslmode=require, sslmode=prefer or no sslmode is rewritten to verify-full; any other value except verify-full is refused.
// devUrl: the local .env DATABASE_URL; the same host is refused (likely the dev branch) unless force is true.
// Returns { value (the string to save), host, label (first part of the host), sslmode, changedFrom }.
export function checkProductionUrl(value, { devUrl = '', force = false } = {}) {
  if (!value || !URL_VALUE.test(value)) throw new Error('That does not look like a connection string (no spaces, quotes or # allowed). Nothing saved.');
  let url;
  try { url = new URL(value); } catch { throw new Error('That is not a valid connection string. Nothing saved.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('It must start with postgresql://. Nothing saved.');
  if (!url.password) throw new Error('It has no password; copy the full string from Neon. Nothing saved.');
  if (LOCAL_HOSTS.includes(url.hostname)) throw new Error('That is a local database, not production. Nothing saved.');
  if (!url.hostname.includes('-pooler.')) throw new Error('Use the pooled connection string (its host contains "-pooler"). Nothing saved.');
  const modes = url.searchParams.getAll('sslmode');
  if (modes.length > 1) throw new Error('It has more than one sslmode setting. Nothing saved.');
  const found = modes[0];
  let changedFrom = null;
  if (found === undefined || AUTO_FIX.includes(found)) {
    changedFrom = found === undefined ? 'no sslmode' : 'sslmode=' + found;
    url.searchParams.set('sslmode', 'verify-full');
  } else if (found !== 'verify-full') {
    throw new Error(`sslmode=${/^[a-z-]{1,20}$/.test(found) ? found : '(unrecognized)'} is not allowed; production needs sslmode=verify-full. Nothing saved.`);
  }
  let devHost = '';
  try { devHost = devUrl ? new URL(devUrl).hostname : ''; } catch {}
  if (!force && devHost && hostKey(devHost) === hostKey(url.hostname)) {
    throw new Error('Refused: this looks like the dev branch (same host as DATABASE_URL in your local .env). Nothing saved. Use --force only if you are sure.');
  }
  return { value: changedFrom ? url.toString() : value, host: url.hostname, label: url.hostname.split('.')[0], sslmode: 'verify-full', changedFrom };
}

// Returns new .env text with NAME=value set once (replacing any earlier NAME= lines in place).
export function upsertEnv(text, name, value, allowed = SAFE_VALUE) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid variable name.');
  if (!allowed.test(value)) throw new Error('Value has characters that are not allowed.');
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  let done = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith(name + '=')) { if (!done) { out.push(`${name}=${value}`); done = true; } }
    else out.push(line);
  }
  if (!done) out.push(`${name}=${value}`);
  return out.join('\n') + '\n';
}

export const hasVar = (text, name) => (text || '').split('\n').some(l => l.startsWith(name + '='));

function writeEnv(file, name, value, allowed) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, upsertEnv(text, name, value, allowed), { mode: 0o600 });
  chmodSync(file, 0o600);
}

// Reads one line from the terminal. When hidden, each character shows as * (Backspace removes one).
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!hidden) {
      stdout.write(question);
      stdin.resume(); stdin.setEncoding('utf8');
      stdin.once('data', d => { stdin.pause(); resolve(String(d).replace(/\r?\n$/, '')); });
      return;
    }
    let value = '';
    // Turn off terminal echo before showing the prompt, so nothing pasted can ever appear on screen.
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    stdout.write(question);
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(); resolve(value); return; }
        if (ch === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); stdout.write('\b \b'); } }
        else if (ch >= ' ') { value += ch; stdout.write('*'); }
      }
    };
    const finish = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const fileArg = args.indexOf('--file');
  const file = fileArg >= 0 ? args[fileArg + 1] : fileURLToPath(new URL('../.env', import.meta.url));
  const replace = args.includes('--replace');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';

  if (command === 'session') {
    if (hasVar(current, 'SESSION_SECRET') && !replace) {
      console.log('SESSION_SECRET is already set; nothing changed. Use --replace to make a new one (this signs everyone out).');
      return;
    }
    writeEnv(file, 'SESSION_SECRET', randomBytes(48).toString('base64url'));
    console.log('SESSION_SECRET generated and saved to .env (value not shown).');
    return;
  }

  if (command === 'production-db') {
    // Default target is .env.production (gitignored), never .env.
    const target = fileArg >= 0 ? file : fileURLToPath(new URL('../.env.production', import.meta.url));
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (hasVar(existing, 'DATABASE_URL') && !replace) {
      console.log(`${target.split('/').pop()} already has DATABASE_URL; nothing changed. Use --replace to overwrite it.`);
      return;
    }
    if (!process.stdin.isTTY) throw new Error('Run this in a terminal so the connection string can be pasted with hidden input.');
    const devEnv = fileURLToPath(new URL('../.env', import.meta.url));
    const devUrl = existsSync(devEnv) ? envDatabaseUrl(readFileSync(devEnv, 'utf8')) : '';
    const pasted = (await ask('Neon PRODUCTION pooled connection string (hidden, paste and press Return): ', { hidden: true })).trim();
    const { value, label, sslmode, changedFrom } = checkProductionUrl(pasted, { devUrl, force: args.includes('--force') });
    if (changedFrom) console.log(`Changed ${changedFrom} to sslmode=verify-full.`);
    writeEnv(target, 'DATABASE_URL', value, URL_VALUE);
    console.log(`Saved DATABASE_URL to ${target.split('/').pop()} (owner-only). Host: ${label} | sslmode: ${sslmode}`);
    return;
  }

  if (command === 'google') {
    if (!process.stdin.isTTY) throw new Error('Run this in a terminal so the secret can be typed with hidden input.');
    const id = (await ask('Google OAuth client ID (shown): ')).trim();
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('That does not look like a Google OAuth client ID (it ends with .apps.googleusercontent.com). Nothing saved.');
    const secret = (await ask('Google OAuth client secret (hidden, paste and press Return): ', { hidden: true })).trim();
    if (!secret || !SAFE_VALUE.test(secret) || secret.length < 10) throw new Error('That does not look like a client secret. Nothing saved.');
    writeEnv(file, 'GOOGLE_CLIENT_ID', id);
    writeEnv(file, 'GOOGLE_CLIENT_SECRET', secret);
    console.log(`GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET saved to .env (secret not shown, ${secret.length} characters).`);
    return;
  }

  console.log('Usage: node scripts/env-secret.js google | session | production-db [--replace] [--force] [--file <path>]');
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
