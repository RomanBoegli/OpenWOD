import { expect, test } from '../fixtures';
import { fact, ownFile } from '../helpers';

test.describe('static settings', () => {
  test('Settings → General describes this browser’s library and counts what it holds', async ({ page }) => {
    await page.goto('/#/settings/general');
    const card = page.getByRole('region', { name: 'This browser' });
    await expect(card).toContainText('live in this browser’s storage (IndexedDB) on this device');
    await expect(fact(card, 'Library format')).toHaveText('Version 3');
    await expect(fact(card, 'Saved workouts')).toHaveText('0');
    await expect(fact(card, 'Sessions')).toHaveText('0');
    await expect(fact(card, 'Storage used')).not.toHaveText('');
    await expect(card.getByRole('button', { name: 'Download backup' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Restore from backup' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Household server' })).toHaveCount(0);

    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(ownFile('Community circuit', 'community-circuit'));
    await page.getByRole('button', { name: 'Save and edit' }).click();
    await expect(page).toHaveURL(/#\/wod\/community-circuit\/edit$/);
    await page.goto('/#/settings/general');
    await expect(fact(card, 'Saved workouts')).toHaveText('1');
    await expect(card).toContainText('(1 workout and 0 sessions now)');
  });
});
