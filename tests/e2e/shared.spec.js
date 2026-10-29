// Browser tests against the local dev server and a fresh local database.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStack } from './stack.js';
import { USERS, SEED_RAW } from '../helpers.js';

let stack;
test.beforeAll(async () => { stack = await startStack(8899); });
test.afterAll(async () => { await stack?.close(); });

async function session(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(email));
  await expect(page.locator('#status')).toContainText('Shared tree · Version');
  return page;
}
async function openPerson(page, id) {
  await page.selectOption('#showPerson', id);
  await page.click(`.compact-profile[data-person="${id}"] .name-button`);
  await expect(page.locator('#personTitle')).toBeVisible();
}
const title = (page, id) => page.locator(`.compact-profile[data-person="${id}"] .profile-title`);
const save = page => page.click('#editorForm button[type=submit]');
const revisions = async () => (await stack.db.pool.query('SELECT version, reason, restored_from, created_by, data FROM tree_revisions ORDER BY version')).rows;

test('signed-out visitors see only the sign-in page; app files and data are denied', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(stack.origin + '/');
  await expect(page).toHaveURL(/\/signin\.html$/);
  const text = await page.locator('body').innerText();
  for (const word of ['Meagan', 'Lauren', 'Cristina', 'Senior Analyst', 'Branding', 'Finance']) expect(text).not.toContain(word);
  for (const path of ['/app.js', '/app.css', '/shared/model.js', '/api/tree', '/api/revisions']) expect((await page.request.get(stack.origin + path)).status(), path).toBe(401);
});

test('an unlisted account is refused', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const res = await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(USERS.unlisted));
  expect(res.status()).toBe(403);
  await page.goto(stack.origin + '/');
  await expect(page).toHaveURL(/\/signin\.html$/);
});

test('an approved user saves; the change persists across two browser sessions and a reload', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  await openPerson(a, 'lauren');
  await a.fill('#personTitle', 'Persisted title');
  await save(a);
  await expect(a.locator('#panelError')).toHaveText('Saved. The tree has been updated.');
  await expect(title(a, 'lauren')).toHaveText('Persisted title');
  await expect(a.locator('#status')).toContainText('by Tester One');

  const b = await session(browser, USERS.b);
  await b.selectOption('#showPerson', 'lauren');
  await expect(title(b, 'lauren')).toHaveText('Persisted title');
  await a.reload();
  await a.selectOption('#showPerson', 'lauren');
  await expect(title(a, 'lauren')).toHaveText('Persisted title');
});

test('two sessions editing at once: second save gets a conflict, keeps the draft, then saves on retry', async ({ browser }) => {
  const a = await session(browser, USERS.a), b = await session(browser, USERS.b);
  await openPerson(a, 'lauren');
  await openPerson(b, 'lauren');
  const before = (await revisions()).length;

  await a.fill('#personTitle', 'From A');
  await save(a);
  await expect(a.locator('#panelError')).toHaveText('Saved. The tree has been updated.');

  await b.fill('#personTitle', 'From B');
  await save(b);
  await expect(b.locator('#panelError')).toContainText('Someone else saved changes while you were editing');
  await expect(b.locator('#personTitle')).toHaveValue('From B');
  await expect(title(b, 'lauren')).toHaveText('From A');
  let rows = await revisions();
  expect(rows.length).toBe(before + 1);
  expect(rows.at(-1).data.nodes.find(n => n.id === 'lauren').title).toBe('From A');

  await save(b);
  await expect(b.locator('#panelError')).toHaveText('Saved. The tree has been updated.');
  await expect(title(b, 'lauren')).toHaveText('From B');
  rows = await revisions();
  expect(rows.length).toBe(before + 2);
});

test('a failed save rolls back the tree and keeps the draft', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  await openPerson(a, 'lauren');
  const original = await title(a, 'lauren').innerText();
  await a.route('**/api/tree', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong. Please try again."}' }) : route.continue());
  await a.fill('#personTitle', 'Will fail');
  await save(a);
  await expect(a.locator('#panelError')).toHaveText('Something went wrong. Please try again.');
  await expect(a.locator('#personTitle')).toHaveValue('Will fail');
  await expect(title(a, 'lauren')).toHaveText(original);
  await a.unroute('**/api/tree');
  await save(a);
  await expect(a.locator('#panelError')).toHaveText('Saved. The tree has been updated.');
  await expect(title(a, 'lauren')).toHaveText('Will fail');
});

test('Undo is a normal versioned save', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  await openPerson(a, 'lauren');
  const original = await title(a, 'lauren').innerText();
  await a.fill('#personTitle', 'To be undone');
  await save(a);
  await expect(title(a, 'lauren')).toHaveText('To be undone');
  await a.click('#undo');
  await expect(a.locator('#status')).toHaveText('Last change undone.');
  await a.selectOption('#showPerson', 'lauren');
  await expect(title(a, 'lauren')).toHaveText(original);
  expect((await revisions()).at(-1).reason).toBe('undo');
});

test('window focus loads changes saved by someone else', async ({ browser }) => {
  const a = await session(browser, USERS.a), b = await session(browser, USERS.b);
  await b.selectOption('#showPerson', 'lauren');
  await openPerson(a, 'lauren');
  await a.fill('#personTitle', 'Seen on focus');
  await save(a);
  await expect(a.locator('#panelError')).toHaveText('Saved. The tree has been updated.');
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(title(b, 'lauren')).toHaveText('Seen on focus');
});

test('History lists who and when; restoring version 1 adds a new version and keeps history', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  const before = await revisions();
  await a.click('#history');
  await expect(a.locator('.revision-row').first()).toContainText('(current)');
  await expect(a.locator('.revision-row').last()).toContainText('Starting data · Seed data');
  await expect(a.locator('.revision-row').first()).toContainText('Tester');
  await a.locator('.revision-row').last().getByRole('button', { name: 'Restore this version' }).click();
  await expect(a.locator('.restore-confirm')).toContainText('Restore version 1?');
  await a.getByRole('button', { name: 'Restore version 1' }).click();
  await expect(a.locator('#panelError')).toHaveText(`Version 1 restored as version ${before.length + 1}.`);
  await expect(a.locator('.revision-row').first()).toContainText('Restored from version 1');
  const after = await revisions();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.at(-1)).toMatchObject({ reason: 'restore', restored_from: 1, created_by: USERS.a });
  expect(after.at(-1).data).toEqual(JSON.parse(SEED_RAW));
  await a.click('#closePanel');
  await a.selectOption('#showPerson', 'lauren');
  await expect(title(a, 'lauren')).toHaveText('Title to be confirmed');
});

test('Export downloads the current tree; Import asks for confirmation and saves a new version', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  const [download] = await Promise.all([a.waitForEvent('download'), a.click('#export')]);
  expect(download.suggestedFilename()).toBe('htt-ai-hub-team-tree.json');
  const exported = readFileSync(await download.path(), 'utf8');
  expect(exported).toBe(SEED_RAW.trimEnd());

  const before = (await revisions()).length;
  await a.setInputFiles('#file', fileURLToPath(new URL('../../seed/htt-ai-hub-team-tree.json', import.meta.url)));
  await expect(a.locator('#editorForm h2')).toHaveText('Import backup');
  expect((await revisions()).length).toBe(before);
  await a.getByRole('button', { name: 'Replace with backup' }).click();
  await expect(a.locator('#status')).toHaveText(`Backup imported as version ${before + 1}.`);
  const rows = await revisions();
  expect(rows.at(-1).reason).toBe('import');
  expect(rows.at(-1).data).toEqual(JSON.parse(SEED_RAW));
});

test('Sign out ends the session', async ({ browser }) => {
  const a = await session(browser, USERS.a);
  await a.click('#signOut');
  await expect(a).toHaveURL(/signin\.html\?signed-out=1$/);
  await expect(a.locator('#message')).toHaveText('You are signed out.');
  expect((await a.request.get(stack.origin + '/api/tree')).status()).toBe(401);
});
