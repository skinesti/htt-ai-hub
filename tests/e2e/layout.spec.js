// Wrapping layout and Zoom: cards per row, order, no sideways scrolling, zoom only on the tree.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startStack } from './stack.js';
import { USERS } from '../helpers.js';

const OUT = new URL('../../.local/layout/', import.meta.url);
let stack;
test.beforeAll(async () => { mkdirSync(OUT, { recursive: true }); stack = await startStack(8890); });
test.afterAll(async () => { await stack?.close(); });

async function open(browser, width, storage) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(stack.origin + '/auth/dev-login?email=' + encodeURIComponent(USERS.a));
  await expect(page.locator('#status')).toContainText('Shared tree · Version');
  return page;
}
// Per section: card names in DOM order, rows (cards grouped by top edge), visual order.
const measure = page => page.evaluate(() => [...document.querySelectorAll('#teamGroups .grouped-categories')].map(row => {
  const cards = [...row.querySelectorAll('.compact-category')].map(c => ({ name: c.querySelector('.category-name').textContent, r: c.getBoundingClientRect() }));
  const tops = [...new Set(cards.map(c => Math.round(c.r.top)))].sort((a, b) => a - b);
  const visual = [...cards].sort((a, b) => Math.round(a.r.top) - Math.round(b.r.top) || a.r.left - b.r.left).map(c => c.name);
  return { names: cards.map(c => c.name), perRow: tops.map(t => cards.filter(c => Math.round(c.r.top) === t).length), visual, rowScrolls: row.scrollWidth > row.clientWidth + 1 };
}));
const pageScrollsSideways = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const zoomOf = (page, selector) => page.locator(selector).first().evaluate(e => e.currentCSSZoom);

const EXPECT_MEAGAN = { 1440: [6, 4], 1470: [6, 4], 1512: [6, 4], 1024: [4, 2], 390: [1, 1] }; // [closed, open]
const report = {};

for (const width of [1440, 1470, 1512, 1024, 390]) {
  test(`layout at ${width}px: rows, order, no sideways scrolling, editor closed and open`, async ({ browser }) => {
    const page = await open(browser, width);
    for (const view of ['meagan', 'lauren', 'cristina', '']) {
      await page.selectOption('#showPerson', view);
      for (const editorOpen of [false, true]) {
        if (editorOpen) { await page.click('#editTeam'); await expect(page.locator('#editPanel')).toBeVisible(); }
        await page.mouse.move(0, 0);
        const sections = await measure(page);
        for (const s of sections) {
          expect(s.names).toEqual([...s.names].sort((a, b) => a.localeCompare(b)));
          expect(s.visual).toEqual(s.names);
          expect(Math.max(...s.perRow)).toBeLessThanOrEqual(6);
          expect(s.rowScrolls).toBe(false);
        }
        expect(await pageScrollsSideways(page)).toBe(false);
        const label = `${width}-${view || 'all'}-${editorOpen ? 'editor-open' : 'editor-closed'}`;
        report[label] = sections.map(s => s.perRow.join('+')).join(' | ');
        if ([1440, 1024, 390].includes(width)) await page.screenshot({ path: new URL(label + '.png', OUT).pathname, fullPage: true });
        if (view === 'meagan') expect(sections[0].perRow[0], label).toBe(EXPECT_MEAGAN[width][editorOpen ? 1 : 0]);
        if (editorOpen) { await page.click('#closePanel'); await expect(page.locator('#editPanel')).toBeHidden(); }
      }
    }
    writeFileSync(new URL(`rows-${width}.json`, OUT), JSON.stringify(Object.fromEntries(Object.entries(report).filter(([k]) => k.startsWith(width + '-'))), null, 1));
  });
}

test('zoom levels scale only the tree; editor and header never scale; choice survives reload', async ({ browser }) => {
  const page = await open(browser, 1024);
  await page.selectOption('#showPerson', 'meagan');
  await expect(page.locator('#zoomLevel')).toHaveValue('1');
  const fixed = async () => ({ h1: await page.locator('header h1').evaluate(e => e.getBoundingClientRect().height), headerZoom: await zoomOf(page, 'header') });
  const base = await fixed();
  const expectations = { '1': [1, 4], '0.75': [0.75, 5], '0.5': [0.5, 6] };
  for (const [value, [zoom, perRow]] of Object.entries(expectations)) {
    await page.selectOption('#zoomLevel', value);
    expect(await zoomOf(page, '#teamGroups .compact-category')).toBeCloseTo(zoom, 3);
    expect((await measure(page))[0].perRow[0]).toBe(perRow);
    expect(await fixed()).toEqual(base);
    await page.click('#editTeam');
    await expect(page.locator('#personName')).toBeVisible();
    expect(await zoomOf(page, '#editPanel')).toBe(1);
    expect(await zoomOf(page, '#personName')).toBe(1);
    expect(await page.locator('#editPanel').evaluate(e => e.getBoundingClientRect().width)).toBe(380);
    await page.click('#closePanel');
    expect(await pageScrollsSideways(page)).toBe(false);
  }
  // Fit: the widest section's full row (up to 6 cards) fits the window, never above 100%.
  await page.selectOption('#zoomLevel', 'fit');
  const fit = await zoomOf(page, '#teamGroups .compact-category');
  expect(fit).toBeCloseTo(1024 / (6 * 220 + 5 * 10 + 48), 2);
  expect((await measure(page))[0].perRow[0]).toBe(6);
  await page.selectOption('#showPerson', 'lauren');
  expect(await zoomOf(page, '#teamGroups .compact-category')).toBe(1);
  // Choice survives a reload.
  await page.selectOption('#zoomLevel', '0.75');
  await page.reload();
  await expect(page.locator('#status')).toContainText('Shared tree · Version');
  await expect(page.locator('#zoomLevel')).toHaveValue('0.75');
  expect(await zoomOf(page, '#teamGroups .compact-category')).toBeCloseTo(0.75, 3);
  await page.selectOption('#zoomLevel', 'fit');
  await page.reload();
  await expect(page.locator('#zoomLevel')).toHaveValue('fit');
});

test('Fit recalculates when the editor opens, and has a 50% floor on phones', async ({ browser }) => {
  const wide = await open(browser, 1440);
  await wide.selectOption('#showPerson', 'meagan');
  await wide.selectOption('#zoomLevel', 'fit');
  expect(await zoomOf(wide, '#teamGroups .compact-category')).toBeCloseTo(1440 / 1418 > 1 ? 1 : 1440 / 1418, 2);
  await wide.click('#editTeam');
  await expect(wide.locator('#personName')).toBeVisible();
  await expect.poll(() => zoomOf(wide, '#teamGroups .compact-category')).toBeCloseTo((1440 - 380) / 1418, 2);
  expect((await measure(wide))[0].perRow[0]).toBe(6);
  expect(await zoomOf(wide, '#editPanel')).toBe(1);

  const phone = await open(browser, 390);
  await phone.selectOption('#showPerson', 'meagan');
  await phone.selectOption('#zoomLevel', 'fit');
  expect(await zoomOf(phone, '#teamGroups .compact-category')).toBe(0.5);
  expect((await measure(phone))[0].perRow[0]).toBe(3);
  expect(await pageScrollsSideways(phone)).toBe(false);
});
