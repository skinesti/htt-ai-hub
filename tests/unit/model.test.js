import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, normalize, prepare, validate } from '../../shared/model.js';
import { SEED_RAW, seed } from '../helpers.js';

test('normalize(validate(seed)) equals the seed file data', () => {
  assert.deepEqual(normalize(validate(seed())), seed());
  assert.deepEqual(validate(normalize(seed())), seed());
});

test('prepare(seed) round trips to the exact seed file text', () => {
  assert.equal(JSON.stringify(prepare(seed()), null, 2), SEED_RAW.trimEnd());
});

const rejects = (mutate, message) => {
  const data = seed();
  mutate(data);
  assert.throws(() => prepare(data), { message });
};

test('rejects a reporting cycle', () => rejects(d => { d.nodes.find(n => n.id === 'meagan').parent = 'lauren'; }, 'Reporting cycle'));
test('rejects a non-https skill link', () => rejects(d => { d.categories[0].skills.push({ id: 's1', name: 'x', url: 'http://example.com', description: '' }); }, 'Invalid category'));
test('rejects a javascript: Profile link', () => rejects(d => { d.nodes.find(n => n.id === 'analyst').intro = 'javascript:alert(1)'; }, 'Invalid member'));
test('rejects a missing manager reference', () => rejects(d => { d.nodes[2].parent = 'nobody'; }, 'Missing manager'));
test('rejects a member id that does not exist', () => rejects(d => { d.categories[0].members.push('ghost'); }, 'Invalid category'));
test('rejects an unknown node field', () => rejects(d => { d.nodes[0].isAdmin = true; }, 'Unknown field in member'));
test('rejects an unknown top-level field', () => rejects(d => { d.extra = 1; }, 'Unknown field in backup'));
test('rejects an unknown skill field', () => rejects(d => { d.categories[8].skills[0].script = 'x'; }, 'Unknown field in category'));
test('rejects an overlong name', () => rejects(d => { d.nodes[0].name = 'x'.repeat(LIMITS.personName + 1); }, 'Text is too long'));
test('rejects a 4001-character description', () => rejects(d => { d.categories[8].skills[0].description = 'x'.repeat(4001); }, 'Invalid category'));
test('rejects more than 250 nodes', () => rejects(d => { for (let i = 0; i < 250; i++) d.nodes.push({ ...d.nodes[2], id: 'n' + i }); }, 'Invalid or oversized backup'));
test('rejects more than 100 artifacts in a category', () => rejects(d => { d.categories[0].artifacts = Array.from({ length: 101 }, (_, i) => ({ id: 'a' + i, name: 'a', url: '', description: '' })); }, 'Invalid category'));
test('rejects garbage input with a generic message', () => {
  assert.throws(() => prepare({ version: 1, nodes: [null], categories: 'x' }), { message: 'Invalid or oversized backup' });
  assert.throws(() => prepare('nope'), { name: 'ValidationError' });
});

test('legacy owner/collaborators backups still import (original migration)', () => {
  const d = seed();
  const c = d.categories[0];
  delete c.members; c.owner = 'meagan'; c.collaborators = ['cristina'];
  const out = prepare(d);
  assert.deepEqual(out.categories[0].members, ['meagan', 'cristina']);
  assert.equal('owner' in out.categories[0], false);
});

test('remote connection strings must use sslmode=verify-full', async () => {
  const { sslModeNote } = await import('../../server/db.js');
  const remote = mode => ['postgres://u', `p@ep-x-pooler.example.test/db${mode ? '?sslmode=' + mode : ''}`].join(':');
  assert.equal(sslModeNote(remote('verify-full')), null);
  assert.match(sslModeNote(remote('require')), /sslmode=verify-full \(found sslmode=require\)/);
  assert.match(sslModeNote(remote('')), /found no sslmode/);
  assert.equal(sslModeNote('postgres://postgres@127.0.0.1:54329/htt_dev'), null);
  assert.doesNotMatch(sslModeNote(remote('require')), /ep-x|:p@/);
});

test('category limit is 200: 200 categories pass, 201 are rejected', () => {
  const withCategories = total => {
    const d = seed();
    for (let i = d.categories.length; i < total; i++) d.categories.push({ id: 'extra-' + i, name: 'Extra ' + i, members: [], skills: [], artifacts: [] });
    return d;
  };
  assert.equal(LIMITS.categories, 200);
  assert.equal(prepare(withCategories(200)).categories.length, 200);
  assert.throws(() => prepare(withCategories(201)), { message: 'Invalid or oversized backup' });
  assert.equal(LIMITS.nodes, 250);
  assert.equal(LIMITS.skillsPerCategory, 100);
  assert.equal(LIMITS.artifactsPerCategory, 100);
});
