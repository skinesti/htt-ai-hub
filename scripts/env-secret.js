// Adds secrets to the local .env without showing them on screen or in any log.
//   node scripts/env-secret.js google    prompt for GOOGLE_CLIENT_ID (visible) and GOOGLE_CLIENT_SECRET (hidden)
//   node scripts/env-secret.js session   generate SESSION_SECRET (refuses to replace an existing one unless --replace)
// Options: --file <path> (default: .env in the project root), --replace
// Existing lines for the same name are replaced; all other lines are kept. The file is set to owner-only (600).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAFE_VALUE = /^[A-Za-z0-9._~+/=-]+$/;

// Returns new .env text with NAME=value set once (replacing any earlier NAME= lines in place).
export function upsertEnv(text, name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid variable name.');
  if (!SAFE_VALUE.test(value)) throw new Error('Value has characters that are not allowed.');
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

function writeEnv(file, name, value) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, upsertEnv(text, name, value), { mode: 0o600 });
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

  console.log('Usage: node scripts/env-secret.js google | session [--replace] [--file <path>]');
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
