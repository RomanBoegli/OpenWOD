import { readFile } from 'node:fs/promises';
import { expect, test } from '../fixtures';
import { fact, ownFile } from '../helpers';

test.describe('static backup', () => {
  test('Download backup writes the library as JSON, and a fresh browser restores it after a confirmation', async ({ page, browser }, testInfo) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(ownFile('Community circuit', 'community-circuit'));
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/community-circuit$/);
    await page.goto('/#/settings/general');
    const card = page.getByRole('region', { name: 'This browser' });
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download backup' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^openwod-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await readFile(await file.path() as string, 'utf8');
    const backup = JSON.parse(text) as { format: string; formatVersion: number; schemaVersion: number; workouts: { id: string }[] };
    expect(backup).toMatchObject({ format: 'openwod.export', formatVersion: 1, schemaVersion: 3 });
    expect(backup.workouts.map(workout => workout.id)).toEqual(['community-circuit']);

    // Another browser profile: its own empty library until the file comes back.
    const fresh = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const other = await fresh.newPage();
      await other.goto('/#/settings/general');
      const otherCard = other.getByRole('region', { name: 'This browser' });
      await expect(fact(otherCard, 'Saved workouts')).toHaveText('0');
      await otherCard.getByLabel('Backup file').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
      const dialog = other.getByRole('dialog', { name: 'Replace the library with this backup?' });
      await expect(dialog).toContainText('1 saved workout and 0 sessions');
      await dialog.getByRole('button', { name: 'Replace library' }).click();
      await expect(otherCard.getByRole('status')).toContainText('Restored 1 saved workout and 0 sessions from the backup of');
      await expect(fact(otherCard, 'Saved workouts')).toHaveText('1');
      await other.goto('/');
      await expect(other.getByRole('list', { name: 'Workouts' }).getByRole('listitem').filter({ hasText: 'Community circuit' })).toBeVisible();
    } finally { await fresh.close(); }
  });

  test('Keep data on this device asks the browser to persist the library and shows the answer', async ({ page, context }) => {
    await context.addInitScript(() => {
      let persisted = false;
      // On the prototype: WebKit ignores properties defined on the navigator.storage instance.
      Object.defineProperty(StorageManager.prototype, 'persisted', { configurable: true, value: async () => persisted });
      Object.defineProperty(StorageManager.prototype, 'persist', { configurable: true, value: async () => { persisted = true; return true; } });
    });
    await page.goto('/#/settings/general');
    const card = page.getByRole('region', { name: 'This browser' });
    await expect(fact(card, 'Kept on this device')).toHaveText('Not guaranteed');
    await expect(card).toContainText('Until the browser agrees to keep it');
    await card.getByRole('button', { name: 'Keep data on this device' }).click();
    await expect(card.getByRole('status')).toContainText('This browser now keeps the library until you clear the site’s data yourself.');
    await expect(fact(card, 'Kept on this device')).toHaveText('Yes');
    await expect(card.getByRole('button', { name: 'Keep data on this device' })).toHaveCount(0);
  });
});
