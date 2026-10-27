import { expect, test } from '../fixtures';
import { BUNDLED, browserRows } from '../helpers';

test.describe('static library', () => {
  test('a saved workout stays in this browser across a reload, and the page never asks for /api', async ({ page, context }) => {
    const calls: string[] = [];
    context.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) calls.push(request.url()); });
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Browser check');
    await page.getByRole('combobox', { name: 'Section 1 slot 1 athlete A', exact: true }).fill('Burpees');
    await page.getByRole('combobox', { name: 'Section 1 slot 1 athlete B', exact: true }).fill('Air squats');
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
});
