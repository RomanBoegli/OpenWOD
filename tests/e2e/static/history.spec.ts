import { expect, test } from '../fixtures';
import { advance, ready } from '../helpers';

test.describe('static logbook', () => {
  test('a finished workout shows in the Logbook, and a corrected score keeps the earlier value', async ({ page }) => {
    await page.goto('/#/wod/cindy/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000.125);
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await advance(page, 1_200_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    // The old History address opens the Logbook under Settings.
    await page.goto('/#/history');
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Logbook' })).toHaveAttribute('aria-current', 'page');
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

  test('the header opens the Logbook, and a deleted session is gone for good, from the overview too', async ({ page }) => {
    for (let run = 0; run < 2; run++) {
      // A hash change alone would keep the finished player on screen.
      await page.goto('/#/wod/cindy/play'); if (run) await page.reload(); await ready(page);
      await page.getByRole('button', { name: 'Start workout', exact: true }).click();
      await advance(page, 10_000.125);
      for (let round = 0; round <= run; round++) await page.getByRole('button', { name: 'Round', exact: true }).click();
      await advance(page, 1_200_000);
      await expect(page.getByRole('status')).toHaveText('Workout complete');
    }
    await page.goto('/#/');
    await page.getByRole('link', { name: 'Logbook' }).click();
    await expect(page).toHaveURL(/#\/settings\/logbook$/);
    const rows = page.getByRole('list', { name: 'Sessions' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    // One outcome, once: the capped chip, and no "capped" or repeated time in the score line.
    await expect(rows.first()).toContainText('2 rounds');
    await expect(rows.first().getByText('Capped', { exact: true })).toHaveCount(1);
    await expect(rows.first()).not.toContainText('· capped');
    await rows.first().getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this session?' });
    await expect(dialog).toContainText('deleted for good from this browser');
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('1 round');
    await page.reload();
    await expect(rows).toHaveCount(1);
    await page.goto('/#/wod/cindy');
    const past = page.getByRole('region', { name: 'Past sessions' }).getByRole('listitem');
    await expect(past).toHaveCount(1);
    await expect(past.first()).not.toContainText('2 rounds');
    await expect(past.first()).not.toContainText('· capped');
    await expect(page.getByRole('main')).toContainText('Done once');
  });
});
