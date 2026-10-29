// Editing selector groups people by type: Team, AI Assistants, Open Positions, then Categories, Skills, Artifacts.
import { test, expect } from '@playwright/test';
import { startStack } from './stack.js';
import { USERS } from '../helpers.js';

let stack;
test.beforeAll(async () => { stack = await startStack(8889); });
test.afterAll(async () => { await stack?.close(); });

const groups = page => page.locator('#editingTarget optgroup').evaluateAll(gs => gs.map(g => ({ label: g.label, options: [...g.children].map(o => [o.value, o.textContent]) })));
const group = (all, label) => all.find(g => g.label === label);

test('people are grouped by type, empty groups hidden, selection works as before', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(USERS.a));
  await expect(page.locator('#status')).toContainText('Shared tree · Version');
  await page.click('#editTeam');
  await expect(page.locator('#personName')).toBeVisible(); // the editor opens after a quick version check
  let all = await groups(page);
  expect(all.map(g => g.label)).toEqual(['Team', 'AI Assistants', 'Open Positions', 'Categories', 'Skills', 'Artifacts']);
  expect(group(all, 'Team').options).toEqual([['person:meagan', 'Meagan'], ['person:lauren', 'Lauren'], ['person:cristina', 'Cristina']]);
  expect(group(all, 'AI Assistants').options).toEqual([['person:analyst', 'Senior Analyst']]);
  expect(group(all, 'Open Positions').options).toEqual([['person:lauren-assistant', 'Newsletter']]);
  expect(group(all, 'Team').options.map(o => o[0])).not.toContain('person:lauren-assistant');
  expect(group(all, 'Categories').options.length).toBe(11);

  await page.selectOption('#editingTarget', 'person:analyst');
  await expect(page.locator('#editorForm h2')).toHaveText('Senior Analyst');
  await expect(page.locator('#personKind')).toHaveValue('ai');
  await page.selectOption('#editingTarget', 'category:category-7');
  await expect(page.locator('#categoryName')).toHaveValue('Newsletter');
  await page.selectOption('#editingTarget', 'skill:category-9:c994b6a1-8f44-4ef7-bd3b-18165fdb0282');
  await expect(page.locator('#skillName')).toHaveValue('htt-product-builder');

  // Changing a person's type moves them to the matching group after saving; empty groups disappear.
  await page.selectOption('#editingTarget', 'person:lauren-assistant');
  await expect(page.locator('#editorForm h2')).toHaveText('Newsletter');
  await page.selectOption('#personKind', 'employee');
  await page.click('#editorForm button[type=submit]');
  await expect(page.locator('#panelError')).toHaveText('Saved. The tree has been updated.');
  all = await groups(page);
  expect(all.map(g => g.label)).toEqual(['Team', 'AI Assistants', 'Categories', 'Skills', 'Artifacts']);
  expect(group(all, 'Team').options.map(o => o[0])).toEqual(['person:meagan', 'person:lauren', 'person:cristina', 'person:lauren-assistant']);
  await expect(page.locator('#editingTarget')).toHaveValue('person:lauren-assistant');

  await page.selectOption('#personKind', 'unassigned');
  await page.click('#editorForm button[type=submit]');
  // The earlier success message is still showing, so wait for the selector itself to change.
  await expect.poll(async () => (await groups(page)).map(g => g.label)).toEqual(['Team', 'AI Assistants', 'Open Positions', 'Categories', 'Skills', 'Artifacts']);
  all = await groups(page);
  expect(group(all, 'Open Positions').options).toEqual([['person:lauren-assistant', 'Newsletter']]);
  expect(group(all, 'Team').options.map(o => o[0])).not.toContain('person:lauren-assistant');
});
