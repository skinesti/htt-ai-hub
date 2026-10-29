// Build gate. Fails the build (exit 1) when:
//  - the dev login is enabled or its code is reachable from deployable files
//  - a secret, connection string or approved email appears in any repo or deployable file
//  - team names or categories appear in any publicly served file
// Findings name the file and rule only, never the matched text.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const flag = (file, rule) => problems.push(`${relative(root, file) || file}: ${rule}`);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const read = file => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

// 1. Dev login must never be switchable on in a build.
for (const name of ['DEV_LOGIN', 'ENABLE_DEV_LOGIN']) if (process.env[name]) problems.push(`environment: ${name} is set; dev login is not allowed in a build`);

const deployable = [
  ...walk(join(root, 'public')), ...walk(join(root, 'netlify')), ...walk(join(root, 'server')),
  ...walk(join(root, 'shared')), ...walk(join(root, 'app')), join(root, 'netlify.toml'),
  ...process.argv.slice(2).flatMap(dir => walk(dir))
];
for (const file of deployable) {
  const text = read(file);
  if (/dev-login|devLogin|startDevServer|scripts\/dev-server/i.test(text)) flag(file, 'dev login code or reference in deployable file');
}

// 2. Secrets and private data anywhere in the repo or build output.
let repoFiles;
try { repoFiles = execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map(f => join(root, f)); }
catch { repoFiles = walk(root).filter(f => !/node_modules|\.git\/|\.local\//.test(f)); }
const secretValues = ['DATABASE_URL', 'SESSION_SECRET', 'GOOGLE_CLIENT_SECRET'].map(n => process.env[n]).filter(v => v && v.length >= 8);
const envFile = join(root, '.env');
if (existsSync(envFile)) for (const m of read(envFile).matchAll(/postgres(?:ql)?:\/\/[^\s'"]+/g)) secretValues.push(m[0]);
if (existsSync(envFile)) for (const line of read(envFile).split('\n')) {
  const m = line.match(/^(SESSION_SECRET|GOOGLE_CLIENT_SECRET|DATABASE_URL)=(.+)$/);
  if (m && m[2].trim().length >= 8) secretValues.push(m[2].trim());
}
const allowFile = join(root, 'seed/allowlist.local.json');
const approvedEmails = existsSync(allowFile) ? JSON.parse(read(allowFile)).map(u => String(u.email).toLowerCase()) : [];
const PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s'"@/]+:[^\s'"@/]+@/i, 'connection string with password'],
  [/npg_[A-Za-z0-9]{8,}/, 'Neon password'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google client secret'],
  [/@hertimetherapy\.com/i, 'approved email address']
];
for (const file of new Set([...repoFiles, ...deployable])) {
  if (file.endsWith('build-check.js') || file.endsWith('allowlist.local.json') || /\.(docx|png)$/i.test(file)) continue;
  const text = read(file);
  // Third-party libraries contain PEM markers as parsing constants; they are still checked for real secret values below.
  for (const [re, rule] of PATTERNS) if (!(file.includes('/node_modules/') && rule === 'private key') && re.test(text)) flag(file, rule);
  if (secretValues.some(v => text.includes(v))) flag(file, 'secret value from environment or .env');
  if (approvedEmails.some(e => text.toLowerCase().includes(e))) flag(file, 'approved email address');
}

// 3. Public static files must not contain team data.
const seed = JSON.parse(read(join(root, 'seed/htt-ai-hub-team-tree.json')));
const terms = [...seed.nodes.flatMap(n => [n.id, n.name]), ...seed.categories.map(c => c.name), ...seed.categories.flatMap(c => [...c.skills, ...c.artifacts].map(i => i.name))]
  .filter(t => t && t.length >= 4);
for (const file of walk(join(root, 'public'))) {
  const text = read(file);
  for (const term of new Set(terms)) if (new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) { flag(file, 'team data in a public file'); break; }
}

if (problems.length) {
  console.error('Build check failed:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`Build check passed: ${deployable.length} deployable files and ${repoFiles.length} repo files scanned.`);
