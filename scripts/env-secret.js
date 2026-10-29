// Adds secrets to the local .env without showing them on screen or in any log.
//   node scripts/env-secret.js google    prompt for GOOGLE_CLIENT_ID (visible) and GOOGLE_CLIENT_SECRET (hidden)
//   node scripts/env-secret.js session   generate SESSION_SECRET (refuses to replace an existing one unless --replace)
//   node scripts/env-secret.js production-db   paste the Neon PRODUCTION pooled string (hidden) into .env.production;
//                                       requires sslmode=verify-full; prints only the host and sslmode
// Options: --file <path> (default: .env in the project root), --replace
// Existing lines for the same name are replaced; all other lines are kept. The file is set to owner-only (600).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAFE_VALUE = /^[A-Za-z0-9._~+/=-]+$/;
const URL_VALUE = /^[A-Za-z0-9._~+/=:@?&%-]+$/; // connection strings: no spaces, quotes or #

// Checks a pasted production connection string. Returns { host, sslmode } (never the password) or throws.
export function checkProductionUrl(value) {
  if (!value || !URL_VALUE.test(value)) throw new Error('That does not look like a connection string (no spaces, quotes or # allowed). Nothing saved.');
  let url;
  try { url = new URL(value); } catch { throw new Error('That is not a valid connection string. Nothing saved.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('It must start with postgresql://. Nothing saved.');
  if (!url.password) throw new Error('It has no password; copy the full string from Neon. Nothing saved.');
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('That is a local database, not production. Nothing saved.');
  if (!url.hostname.includes('-pooler.')) throw new Error('Use the pooled connection string (its host contains "-pooler"). Nothing saved.');
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') throw new Error(`It must use sslmode=verify-full (found ${sslmode ? 'sslmode=' + sslmode : 'no sslmode'}). Nothing saved.`);
  return { host: url.hostname, sslmode };
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
    const value = (await ask('Neon PRODUCTION pooled connection string (hidden, paste and press Return): ', { hidden: true })).trim();
    const { host, sslmode } = checkProductionUrl(value);
    writeEnv(target, 'DATABASE_URL', value, URL_VALUE);
    console.log(`Saved DATABASE_URL to ${target.split('/').pop()} (owner-only). Host: ${host} | sslmode: ${sslmode}`);
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

  console.log('Usage: node scripts/env-secret.js google | session | production-db [--replace] [--file <path>]');
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
