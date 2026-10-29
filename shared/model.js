// Shared data rules for the HTT AI Hub Team Tree.
// Used by the browser (served at /shared/model.js) and by the server, which is authoritative.
// validate() and normalize() keep the original app's rules and messages; the strict field and
// length checks were added for the shared server version.

export const LIMITS = Object.freeze({
  nodes: 250,
  categories: 50,
  skillsPerCategory: 100,
  artifactsPerCategory: 100,
  description: 4000,
  id: 100,
  personName: 200,
  title: 200,
  categoryName: 100,
  itemName: 200,
  treeName: 200,
  url: 2048,
  structure: 50,
  bodyBytes: 2000000
});

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}
const fail = message => { throw new ValidationError(message); };

const KEYS = Object.freeze({
  top: ['version', 'name', 'nodes', 'categories', 'structure', 'layoutVersion', 'reviewerPlacementRestored', 'andreaRemoved'],
  topRequired: ['version', 'nodes', 'categories'],
  node: ['id', 'name', 'title', 'parent', 'secondaryParents', 'category', 'intro', 'x', 'y', 'kind'],
  category: ['id', 'name', 'members', 'skills', 'artifacts'],
  item: ['id', 'name', 'url', 'description']
});

const SENIOR_ANALYST_TEMPLATE = { id: 'analyst', name: 'Senior Analyst', title: 'Independent review', parent: 'meagan', secondaryParents: [], category: null, intro: 'documents/Senior%20Analyst%20Introduction.docx', x: 1225, y: 30, kind: 'ai' };

export function validLink(url) {
  if (!url) return true;
  if (url === 'documents/Senior%20Analyst%20Introduction.docx') return true;
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

function validArtifacts(items) {
  return Array.isArray(items) && items.length <= LIMITS.artifactsPerCategory && new Set(items.map(a => a.id)).size === items.length &&
    items.every(a => typeof a.id === 'string' && typeof a.name === 'string' && a.name.trim() && typeof a.description === 'string' &&
      a.description.length <= LIMITS.description && typeof a.url === 'string' && (!a.url || /^https:\/\//i.test(a.url)) && validLink(a.url));
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function onlyKeys(obj, allowed, what) {
  if (!isObject(obj)) fail('Invalid ' + what);
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail('Unknown field in ' + what);
}
function maxLen(value, limit) { if (typeof value === 'string' && value.length > limit) fail('Text is too long'); }

// Original rules, then strict shape and length checks. Returns data unchanged on success.
export function validate(data) {
  if (!isObject(data)) fail('Invalid or oversized backup');
  if (data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.categories) || data.nodes.length > LIMITS.nodes || data.categories.length > LIMITS.categories) fail('Invalid or oversized backup');
  if (data.nodes.some(n => !isObject(n)) || data.categories.some(c => !isObject(c))) fail('Invalid or oversized backup');
  const ids = new Set(data.nodes.map(n => n.id)), cats = new Set(data.categories.map(c => c.id));
  if (ids.size !== data.nodes.length || cats.size !== data.categories.length) fail('Duplicate IDs');
  for (const c of data.categories) {
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.members) || new Set(c.members).size !== c.members.length || c.members.some(id => !ids.has(id)) ||
      !Array.isArray(c.skills) || c.skills.length > LIMITS.skillsPerCategory || c.skills.some(s => !isObject(s)) || new Set(c.skills.map(s => s.id)).size !== c.skills.length ||
      c.skills.some(s => typeof s.id !== 'string' || typeof s.name !== 'string' || !s.name.trim() || typeof s.description !== 'string' || s.description.length > LIMITS.description || typeof s.url !== 'string' || (s.url && !/^https:\/\//i.test(s.url)) || !validLink(s.url)) ||
      (Array.isArray(c.artifacts) && c.artifacts.some(a => !isObject(a))) || !validArtifacts(c.artifacts)) fail('Invalid category');
  }
  for (const n of data.nodes) {
    if (!['employee', 'ai', 'unassigned'].includes(n.kind) || typeof n.id !== 'string' || typeof n.name !== 'string' || typeof n.title !== 'string' || typeof n.intro !== 'string' || !validLink(n.intro) ||
      !Number.isFinite(n.x) || !Number.isFinite(n.y) || n.x < 0 || n.y < 0 || n.x > 100000 || n.y > 100000) fail('Invalid member');
    if (n.parent !== null && !ids.has(n.parent)) fail('Missing manager');
    if (n.category !== null && !cats.has(n.category)) fail('Missing category');
    if (!Array.isArray(n.secondaryParents) || n.secondaryParents.length > 1 || n.secondaryParents.some(p => !ids.has(p) || p === n.parent)) fail('Invalid additional manager');
  }
  const byId = new Map(data.nodes.map(n => [n.id, n])), pending = new Set(), done = new Set();
  function visit(id) {
    if (pending.has(id)) fail('Reporting cycle');
    if (done.has(id)) return;
    pending.add(id);
    const n = byId.get(id);
    for (const p of [n.parent, ...n.secondaryParents].filter(Boolean)) visit(p);
    pending.delete(id); done.add(id);
  }
  data.nodes.forEach(n => visit(n.id));

  // Strict checks added for the shared version.
  onlyKeys(data, KEYS.top, 'backup');
  if (data.name !== undefined && typeof data.name !== 'string') fail('Invalid or oversized backup');
  if (data.structure !== undefined && typeof data.structure !== 'string') fail('Invalid or oversized backup');
  if (data.layoutVersion !== undefined && !Number.isInteger(data.layoutVersion)) fail('Invalid or oversized backup');
  for (const flag of ['reviewerPlacementRestored', 'andreaRemoved']) if (data[flag] !== undefined && typeof data[flag] !== 'boolean') fail('Invalid or oversized backup');
  maxLen(data.name, LIMITS.treeName); maxLen(data.structure, LIMITS.structure);
  for (const n of data.nodes) {
    onlyKeys(n, KEYS.node, 'member');
    if (n.id.length < 1) fail('Invalid member');
    maxLen(n.id, LIMITS.id); maxLen(n.name, LIMITS.personName); maxLen(n.title, LIMITS.title); maxLen(n.intro, LIMITS.url);
  }
  for (const c of data.categories) {
    onlyKeys(c, KEYS.category, 'category');
    if (c.id.length < 1) fail('Invalid category');
    maxLen(c.id, LIMITS.id); maxLen(c.name, LIMITS.categoryName);
    for (const item of [...c.skills, ...c.artifacts]) {
      onlyKeys(item, KEYS.item, 'category');
      maxLen(item.id, LIMITS.id); maxLen(item.name, LIMITS.itemName); maxLen(item.url, LIMITS.url);
    }
  }
  return data;
}

// Original migration steps. Mutates and returns data.
export function normalize(data) {
  try {
    if (!data.andreaRemoved) {
      const ids = new Set(data.nodes.filter(n => n.id === 'andrea').map(n => n.id));
      for (const n of data.nodes) { if (ids.has(n.parent)) n.parent = null; n.secondaryParents = (n.secondaryParents || []).filter(id => !ids.has(id)); }
      data.nodes = data.nodes.filter(n => !ids.has(n.id));
      for (const c of data.categories) {
        if (Array.isArray(c.members)) c.members = c.members.filter(id => !ids.has(id));
        if (ids.has(c.owner)) delete c.owner;
        if (c.collaborators) c.collaborators = c.collaborators.filter(id => !ids.has(id));
      }
      data.andreaRemoved = true;
    }
    const obsolete = data.nodes.filter(n => ['lauren-assistant', 'cristina-assistant'].includes(n.id) && (!n.kind || n.kind === 'unassigned') &&
      ['Assistant or employee', 'Position to be defined'].includes(n.name) && n.title === 'To be defined' && !data.categories.some(c => (c.members || []).includes(n.id)) &&
      !data.nodes.some(x => x.parent === n.id || (x.secondaryParents || []).includes(n.id))).map(n => n.id);
    data.nodes = data.nodes.filter(n => !obsolete.includes(n.id));
    for (const c of data.categories) {
      if (!Array.isArray(c.skills)) c.skills = [];
      if (!Array.isArray(c.artifacts)) c.artifacts = [];
      if (/^web\s*site$/i.test(c.name.trim())) c.name = 'Web Site';
      if (!Array.isArray(c.members)) c.members = [c.owner, ...(c.collaborators || []), ...data.nodes.filter(n => n.category === c.id).map(n => n.id)].filter(id => data.nodes.some(n => n.id === id));
      c.members = [...new Set(c.members)];
      delete c.owner; delete c.collaborators;
    }
    for (const n of data.nodes) {
      n.category = null;
      if (!n.kind) n.kind = n.id === 'analyst' ? 'ai' : n.id.endsWith('-assistant') ? 'unassigned' : 'employee';
      if (n.kind === 'unassigned' && n.name === 'Assistant or employee') n.name = 'Position to be defined';
    }
    if (data.structure !== 'category-members-v3') { data.structure = 'category-members-v3'; delete data.layoutVersion; }
    // Originally applied once at page load; now part of normalize so client and server agree.
    if (!data.reviewerPlacementRestored) {
      let reviewer = data.nodes.find(n => n.id === 'analyst') || data.nodes.find(n => n.kind === 'ai' && n.name === 'Senior Analyst');
      if (!reviewer) { reviewer = structuredClone(SENIOR_ANALYST_TEMPLATE); data.nodes.push(reviewer); }
      reviewer.parent = 'meagan';
      reviewer.secondaryParents = (reviewer.secondaryParents || []).filter(id => id !== 'meagan');
      reviewer.kind = 'ai';
      data.reviewerPlacementRestored = true;
    }
    return data;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid or oversized backup');
  }
}

// Validate a copy and return it in the original key order (Postgres JSONB does not keep key order).
export function prepare(data) {
  return canonical(validate(normalize(structuredClone(data))));
}

const pick = (obj, keys) => { const out = {}; for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]; return out; };
export function canonical(data) {
  const out = pick(data, KEYS.top);
  out.nodes = data.nodes.map(n => pick(n, KEYS.node));
  out.categories = data.categories.map(c => ({ ...pick(c, KEYS.category), skills: c.skills.map(s => pick(s, KEYS.item)), artifacts: c.artifacts.map(a => pick(a, KEYS.item)) }));
  return out;
}
