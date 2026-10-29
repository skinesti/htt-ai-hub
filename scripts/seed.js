// Loads seed/htt-ai-hub-team-tree.json as revision 1. Refuses if a tree already exists.
// The file must pass the shared rules unchanged; nothing is "corrected".
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { prepare } from '../shared/model.js';
import { seedTree } from '../server/store.js';
import { openTarget } from './db-target.js';

const file = process.argv[2] || new URL('../seed/htt-ai-hub-team-tree.json', import.meta.url);
const raw = JSON.parse(readFileSync(file, 'utf8'));
let data;
try { data = prepare(raw); } catch (e) { console.error('Seed file rejected:', e.message); process.exit(1); }
if (!isDeepStrictEqual(data, raw)) { console.error('Seed file would change during validation; not loaded.'); process.exit(1); }

const pool = openTarget();
try {
  const result = await seedTree(pool, data);
  console.log(result.seeded ? 'Seeded as version 1.' : `Already has data at version ${result.version}; nothing changed.`);
} catch (e) {
  console.error('Seed failed:', e.code || e.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
