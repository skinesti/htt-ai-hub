// Collects values that must never appear in deployed output: every value in .env and any .env.* file
// in the project root, the password part of any connection string, and secret variables in the
// current environment. Callers compare against these and report file names only, never values.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_NAMES = ['DATABASE_URL', 'SESSION_SECRET', 'GOOGLE_CLIENT_SECRET'];
const MIN = 8;

export function localSecretValues(root, env = process.env) {
  const found = []; // [{ value, source }]
  const add = (value, source) => {
    if (typeof value !== 'string') return;
    const v = value.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^postgres(ql)?:\/\//i.test(v)) {
      let u; try { u = new URL(v); } catch {}
      if (u && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) return; // local test databases are not secrets
      if (u && u.password && u.password.length >= MIN) found.push({ value: decodeURIComponent(u.password), source });
    }
    if (v.length >= MIN) found.push({ value: v, source });
  };
  const files = existsSync(root) ? readdirSync(root).filter(f => f === '.env' || f.startsWith('.env.')) : [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
      if (m) add(m[1], file);
    }
    for (const m of text.matchAll(/postgres(?:ql)?:\/\/[^\s'"]+/g)) add(m[0], file); // also catch strings outside NAME= lines
  }
  for (const name of SECRET_NAMES) add(env[name], 'environment variable ' + name);
  return found;
}
