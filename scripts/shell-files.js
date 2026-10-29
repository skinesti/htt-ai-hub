// The signed-in app files, served only after the session check. Shared by the build and the dev server.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const SHELL_SOURCES = {
  '/': ['app/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app/app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app/app.css', 'text/css; charset=utf-8'],
  '/shared/model.js': ['shared/model.js', 'text/javascript; charset=utf-8']
};

export function readShell() {
  const shell = {};
  for (const [path, [file, type]] of Object.entries(SHELL_SOURCES)) shell[path] = { type, body: readFileSync(root + file, 'utf8') };
  return shell;
}
