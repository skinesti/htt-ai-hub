// Users screen in the browser: admin-only, right-hand panel, explicit Save, audit list.
import { test, expect } from '@playwright/test';
import { startStack } from './stack.js';
import { USERS } from '../helpers.js';

let stack;
test.beforeAll(async () => { process.env.ALLOWED_EMAIL_DOMAINS = 'example.test'; stack = await startStack(8892); });
test.afterAll(async () => { await stack?.close(); delete process.env.ALLOWED_EMAIL_DOMAINS; });

async function session(browser, email) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(email));
  await expect(page.locator('#status')).toContainText('Shared tree · Version');
  return page;
}

test('non-admins have no Users button and the API refuses them', async ({ browser }) => {
  const page = await session(browser, USERS.a);
  await expect(page.locator('#history')).toBeVisible();
  expect(await page.locator('#users').count()).toBe(0);
  expect(await page.locator('body').innerText()).not.toContain('Users');
  expect((await page.request.get(stack.origin + '/api/users')).status()).toBe(403);
});

test('an admin adds a user, switches them off, and sees the change recorded', async ({ browser }) => {
  const page = await session(browser, USERS.admin1);
  await page.click('#users');
  await expect(page.locator('#editorForm h2')).toHaveText('Users');
  await expect(page.locator('.revision-row[data-user="approved.one@example.test"]')).toContainText('Active');
  await page.getByRole('button', { name: 'Add user' }).first().click();
  await expect(page.locator('#editorForm h2')).toHaveText('Add user');
  await expect(page.locator('#editorForm')).toContainText('Use an address ending in @example.test.');

  await page.fill('#userName', 'Browser Added');
  await page.fill('#userEmail', 'browser.added@other.test');
  await page.click('#editorForm button[type=submit]');
  await expect(page.locator('#panelError')).toHaveText('Use an address ending in @example.test.');
  await expect(page.locator('#userName')).toHaveValue('Browser Added');

  await page.fill('#userEmail', 'Browser.Added@example.test');
  await page.click('#editorForm button[type=submit]');
  await expect(page.locator('#panelError')).toHaveText('User added.');
  await expect(page.locator('#userEmail')).toHaveValue('browser.added@example.test');
  await expect(page.locator('#userActive')).toBeChecked();
  await expect(page.locator('#userAdmin')).not.toBeChecked();

  await page.uncheck('#userActive');
  await page.click('#editorForm button[type=submit]');
  await expect(page.locator('#panelError')).toHaveText('User saved.');
  await page.getByRole('button', { name: 'Back to Users' }).click();
  await expect(page.locator('.revision-row[data-user="browser.added@example.test"]')).toContainText('Switched off · Added by Admin One');
  await expect(page.locator('.user-log')).toContainText('Switched off: Browser Added · by Admin One');
  await expect(page.locator('.user-log')).toContainText('Added: Browser Added · by Admin One');
});

test("an admin's own Active and Admin switches are locked", async ({ browser }) => {
  const page = await session(browser, USERS.admin1);
  await page.click('#users');
  await page.locator('.revision-row[data-user="admin.one@example.test"] .user-name').click();
  await expect(page.locator('#userActive')).toBeDisabled();
  await expect(page.locator('#userAdmin')).toBeDisabled();
  await expect(page.locator('#editorForm')).toContainText('You cannot switch yourself off or change your own admin access.');
});
