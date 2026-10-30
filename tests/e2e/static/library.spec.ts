import { expect, test } from '../fixtures';
import { BUNDLED, browserRows } from '../helpers';

test.describe('static library', () => {
  test('a saved workout stays in this browser across a reload, and the page never asks for /api', async ({ page, context }) => {
    const calls: string[] = [];
    context.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) calls.push(request.url()); });
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Browser check');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true }).fill('Burpees');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true }).fill('Air Squats');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/browser-check$/);
    expect((await browserRows<{ id: string; revision: number }>(page, 'workouts')).map(row => [row.id, row.revision])).toEqual([['browser-check', 1]]);
    await page.goto('/');
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED + 1);
    await page.reload();
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED + 1);
    await expect(list.getByRole('listitem').filter({ hasText: 'Browser check' })).toBeVisible();
    await page.goto('/#/wod/browser-check');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Browser check');
    expect(calls).toEqual([]);
  });

  test('BLD-14: the tile between two sections sets a timed rest after an AMRAP, and the last section has no tile', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Rest between');
    await page.getByLabel('Block 1 format').selectOption('amrap');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true }).fill('Burpees');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true }).fill('Air Squats');
    await expect(page.getByRole('group', { name: /^Between block/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add block' }).click();
    await page.getByLabel('Block title').nth(1).fill('Finisher');
    await page.getByRole('combobox', { name: 'Block 2 movement 1 athlete A', exact: true }).fill('Burpees');
    await page.getByRole('combobox', { name: 'Block 2 movement 1 athlete B', exact: true }).fill('Air Squats');
    const tile = page.getByRole('group', { name: 'Between block 1 and 2' });
    await expect(page.getByRole('group', { name: /^Between block/ })).toHaveCount(1);
    await expect(tile.getByLabel('After block 1')).toHaveValue('ready');
    await expect(tile.getByLabel('Rest', { exact: true })).toHaveCount(0);
    await tile.getByLabel('After block 1').selectOption('rest');
    await expect(tile.getByLabel('Rest', { exact: true })).toHaveValue('01:00');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/rest-between$/);
    await expect(page.getByRole('listitem', { name: 'Between block 1 and 2' })).toHaveText('ThenRest 01:00, then continues');
    // The rest ends the AMRAP's task list, and the section continues on its own.
    const stored = JSON.stringify(await browserRows(page, 'workouts'));
    expect(stored).toContain('"transitionAfter":"automatic"');
    expect(stored).toContain('{"id":"s1-rest","type":"rest","kind":"blockRest","durationMs":60000}');
  });
});
