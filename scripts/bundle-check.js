// Scans the FINISHED deploy output: every function zip and the publish folder. Fails if any value from
// .env / .env.* (or a secret environment variable) appears, or if dev login code is present.
// Runs automatically after Netlify packages the functions (plugins/bundle-check), and can be run by hand:
//   node scripts/bundle-check.js [functionsDistDir] [publishDir]
// Reports file names and the source file only, never the values.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSecretValues } from './secret-values.js';

const DEV_LOGIN = /dev-login|startDevServer|scripts\/dev-server/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function checkBundle({ root, functionsDist, publishDir }) {
  const secrets = localSecretValues(root);
  const problems = [];
  const zips = existsSync(functionsDist) ? readdirSync(functionsDist).filter(f => f.endsWith('.zip')).map(f => join(functionsDist, f)) : [];
  if (!zips.length) problems.push(`no function bundle found in ${relative(root, functionsDist) || functionsDist}`);
  const targets = [
    ...zips.map(zip => ({ name: relative(root, zip), text: execFileSync('unzip', ['-p', zip], { maxBuffer: 512 * 1024 * 1024 }).toString('latin1') })),
    ...walk(publishDir).map(file => ({ name: relative(root, file), text: readFileSync(file).toString('latin1') }))
  ];
  for (const { name, text } of targets) {
    for (const { value, source } of secrets) if (text.includes(value)) problems.push(`${name}: contains a value from ${source}`);
    if (DEV_LOGIN.test(text)) problems.push(`${name}: contains dev login code`);
  }
  return { problems: [...new Set(problems)], scanned: targets.length, compared: secrets.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = checkBundle({ root, functionsDist: process.argv[2] || join(root, '.netlify/functions'), publishDir: process.argv[3] || join(root, 'public') });
  if (result.problems.length) { console.error('Bundle check failed:\n - ' + result.problems.join('\n - ')); process.exit(1); }
  console.log(`Bundle check passed: ${result.scanned} deployed items scanned against ${result.compared} local values.`);
}
