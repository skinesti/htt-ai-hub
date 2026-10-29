// Starts a fresh local database and the dev server for browser tests, plus a static server for the original app.
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDatabase } from '../helpers.js';
import { startDevServer } from '../../scripts/dev-server.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

export async function startStack(port) {
  const db = await createTestDatabase();
  const server = await startDevServer({ port, databaseUrl: db.url, log: false });
  return { origin: server.origin, db, async close() { await server.close(); await db.drop(); } };
}

// Serves the original browser-only app exactly as committed in the baseline commit.
export async function startOriginal(port) {
  const dir = root + '.local/original/';
  mkdirSync(dir, { recursive: true });
  const base = execSync('git rev-list --max-parents=0 HEAD', { cwd: root, encoding: 'utf8' }).trim();
  for (const f of ['index.html', 'app.js']) writeFileSync(dir + f, execSync(`git show ${base}:${f}`, { cwd: root }));
  const server = createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    try { res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(readFileSync(dir + name)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { origin: `http://localhost:${port}`, close: () => new Promise(r => server.close(r)) };
}
