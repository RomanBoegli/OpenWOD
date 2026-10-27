import { expect, test } from '../fixtures';
import { advance, ready } from '../helpers';

test.describe('static history', () => {
  test('a finished workout shows in History, and a corrected score keeps the earlier value', async ({ page }) => {
    await page.goto('/#/wod/cindy/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000.125);
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await advance(page, 1_200_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await page.goto('/#/history');
    await expect(page.getByRole('main')).toContainText('Every session played in this browser, newest first.');
    const row = page.getByRole('list', { name: 'Sessions' }).getByRole('listitem').first();
    await expect(row).toContainText('Cindy');
    await expect(row).toContainText('Capped');
    await expect(row).toContainText('2 rounds');
    await row.getByRole('button', { name: 'Correct score' }).click();
    const dialog = page.getByRole('dialog', { name: /Correct the score/ });
    await dialog.getByLabel('Rounds').fill('3');
    await dialog.getByLabel('Note').fill('Miscounted');
    await dialog.getByRole('button', { name: 'Save correction' }).click();
    await expect(row).toContainText('3 rounds');
    await expect(row).toContainText('Corrected');
    // The correction survives a reload and the dialog shows what was there before.
    await page.reload();
    await expect(row).toContainText('3 rounds');
    await row.getByRole('button', { name: 'Correct score' }).click();
    await expect(dialog).toContainText(/Before .*2 rounds.*\(Miscounted\)/);
  });
});
