// Compares the shared app with the original browser-only app (baseline commit), same data, same widths.
// Tree and editor panel must show no visible difference (exact pixel counts are reported). The header is expected to differ only by the added
// History and Sign out controls and the status text; its screenshots are saved for review.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startOriginal, startStack } from './stack.js';
import { SEED_RAW, USERS } from '../helpers.js';

const OUT = new URL('../../.local/ui-compare/', import.meta.url);
let stack, original;
test.beforeAll(async () => { mkdirSync(OUT, { recursive: true }); stack = await startStack(8896); original = await startOriginal(8897); });
test.afterAll(async () => { await stack?.close(); await original?.close(); });

async function openOriginal(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(raw => { try { localStorage.setItem('htt-ai-hub-horizontal-members-v4', raw); } catch {} }, SEED_RAW);
  const page = await context.newPage();
  await page.goto(original.origin + '/');
  await expect(page.locator('.person-group').first()).toBeVisible();
  return page;
}
async function openShared(browser, width) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(USERS.a));
  await expect(page.locator('#status')).toContainText('Shared tree · Version 1');
  return page;
}
function diff(name, a, b) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  writeFileSync(new URL(name + '-original.png', OUT), a);
  writeFileSync(new URL(name + '-shared.png', OUT), b);
  if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: `${A.width}x${A.height} vs ${B.width}x${B.height}`, pixels: Infinity };
  // exact: any channel difference at all. pixels: visible difference (pixelmatch default threshold).
  const out = new PNG({ width: A.width, height: A.height });
  const exact = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0 });
  const pixels = pixelmatch(A.data, B.data, out.data, A.width, A.height);
  if (exact) { writeFileSync(new URL(name + '-diff.png', OUT), PNG.sync.write(out)); test.info().annotations.push({ type: 'antialias', description: name + ': ' + exact + ' pixels differ by a few color levels' }); }
  return { pixels };
}

for (const width of [1440, 1024, 390]) {
  test(`tree and editor match the original at ${width}px`, async ({ browser }) => {
    const o = await openOriginal(browser, width), s = await openShared(browser, width);
    // Cards now wrap instead of scrolling, so the tree is compared card by card: same sections, same
    // cards in the same order, and every card the same size with no visible pixel difference.
    const structure = page => page.locator('#teamGroups .person-group').evaluateAll(els => els.map(e => [...e.querySelectorAll('.compact-category')].map(c => c.dataset.category)));
    for (const view of ['meagan', 'lauren', 'cristina', '']) {
      await o.selectOption('#showPerson', view); await s.selectOption('#showPerson', view);
      await o.mouse.move(0, 0); await s.mouse.move(0, 0);
      const so = await structure(o), ss = await structure(s);
      expect(ss, `sections and card order, view ${view || 'All Team'}`).toEqual(so);
      for (let i = 0; i < so.length; i++) {
        for (let j = 0; j < so[i].length; j++) {
          const pick = page => page.locator('#teamGroups .person-group').nth(i).locator('.compact-category').nth(j);
          const result = diff(`${width}-${view || 'all'}-s${i}-${so[i][j]}`, await pick(o).screenshot(), await pick(s).screenshot());
          expect(result, `card ${so[i][j]} in section ${i}, view ${view || 'All Team'}`).toEqual({ pixels: 0 });
        }
      }
    }
    await o.selectOption('#showPerson', 'meagan'); await s.selectOption('#showPerson', 'meagan');
    await o.click('.compact-profile[data-person="meagan"] .name-button');
    await s.click('.compact-profile[data-person="meagan"] .name-button');
    await expect(s.locator('#personTitle')).toBeVisible();
    await o.mouse.move(0, 0); await s.mouse.move(0, 0); // no hover styles in screenshots
    expect(diff(`${width}-person-editor`, await o.locator('#editPanel').screenshot(), await s.locator('#editPanel').screenshot()), 'person editor').toEqual({ pixels: 0 });
    await o.click('#closePanel'); await s.click('#closePanel'); // the panel covers the tree at phone width in both versions
    await o.locator('.compact-category[data-category="category-9"] .category-name').first().click();
    await s.locator('.compact-category[data-category="category-9"] .category-name').first().click();
    await expect(s.locator('#categoryName')).toBeVisible();
    await o.mouse.move(0, 0); await s.mouse.move(0, 0); // no hover styles in screenshots
    expect(diff(`${width}-category-editor`, await o.locator('#editPanel').screenshot(), await s.locator('#editPanel').screenshot()), 'category editor').toEqual({ pixels: 0 });
    await o.click('#closePanel'); await s.click('#closePanel');
    const header = diff(`${width}-header`, await o.locator('header').screenshot(), await s.locator('header').screenshot());
    test.info().annotations.push({ type: 'header', description: JSON.stringify(header) });
  });
}
