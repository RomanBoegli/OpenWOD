import { expect, test } from './fixtures';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src/schema';
import { advance, PLAYER, ready } from './helpers';

const own = (id: string, title: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title, sharing: undefined });

test.describe('household server', () => {
  test('a saved workout reaches the server, shows on a fresh page, and an archive removes it', async ({ page, api }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Household check');
    const lane = page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true });
    await lane.fill('Burpees');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true }).fill('Air squats');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/household-check$/);
    const stored = await api.get<{ workouts: { id: string; revision: number }[] }>('/api/v1/workouts');
    expect(stored.workouts.map(item => [item.id, item.revision])).toEqual([['household-check', 1]]);
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').filter({ hasText: 'Household check' })).toBeVisible();
    await page.goto('/#/wod/household-check');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove workout' }).click();
    await expect.poll(async () => (await api.get<{ workouts: unknown[] }>('/api/v1/workouts')).workouts.length).toBe(0);
    expect((await api.get<{ workouts: unknown[] }>('/api/v1/workouts?includeArchived=1')).workouts).toHaveLength(1);
  });

  test('a concurrent edit is caught: the editor offers to overwrite and the next revision lands', async ({ page, api }) => {
    expect((await api.put('/api/v1/workouts/race', { document: own('race', 'Race') })).status).toBe(201);
    await page.goto('/#/wod/race/edit');
    await page.getByLabel('Title', { exact: true }).fill('Race edited here');
    expect((await api.put('/api/v1/workouts/race', { document: own('race', 'Race edited elsewhere', 2) }, 1)).status).toBe(200);
    await page.getByRole('button', { name: 'Save changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Saved elsewhere since you opened it' });
    await expect(dialog).toContainText('Revision 2');
    await dialog.getByRole('button', { name: 'Overwrite with mine' }).click();
    await expect(page).toHaveURL(/#\/wod\/race$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race edited here');
    const stored = await api.get<{ revision: number; document: Workout }>('/api/v1/workouts/race');
    expect(stored.revision).toBe(3);
    expect(stored.document.title).toBe('Race edited here');
  });

  test('history lists sessions newest first, repeats one, and corrects a score keeping the earlier value', async ({ page, api }) => {
    await page.goto('/#/wod/cindy/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000.125); // Real browser clocks include fractional milliseconds in event timestamps.
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await advance(page, 1_200_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect.poll(async () => (await api.get<{ sessions: { outcome: string }[] }>('/api/v1/sessions')).sessions.length).toBe(1);
    await page.goto('/#/history');
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
    const session = (await api.get<{ sessions: { id: string; revision: number }[] }>('/api/v1/sessions')).sessions[0];
    expect(session.revision).toBe(2);
    const full = await api.get<{ corrections: { previousResults: { counter: { rounds: number } }[]; note: string }[] }>(`/api/v1/sessions/${session.id}`);
    expect(full.corrections[0].previousResults[0].counter.rounds).toBe(2);
    expect(full.corrections[0].note).toBe('Miscounted');
    await row.getByRole('link', { name: 'Repeat' }).click();
    await expect(page).toHaveURL(/#\/wod\/cindy\/play$/);
  });

  test('AT-24: the server going away mid-session changes nothing in the player, and the result uploads afterwards', async ({ page, api }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await page.route('**/api/**', route => route.abort('connectionrefused'));
    await advance(page, 60_000);
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:30');
    await advance(page, 1_140_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByText(/change(s)? waiting/)).toBeVisible();
    await page.unroute('**/api/**');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => (await api.get<{ sessions: unknown[] }>('/api/v1/sessions')).sessions.length, { timeout: 20_000 }).toBe(1);
    await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);
  });

  test('DAT-11: a JSON export restores through Settings → General after a confirmation, replacing the library', async ({ page, api }) => {
    expect((await api.put('/api/v1/workouts/kept', { document: own('kept', 'Kept') })).status).toBe(201);
    const backup = await api.get<{ format: string; workouts: unknown[] }>('/api/v1/export');
    expect(backup.format).toBe('openwod.export');
    expect((await api.put('/api/v1/workouts/later', { document: own('later', 'Added later') })).status).toBe(201);
    await page.goto('/#/settings/general');
    const card = page.getByRole('region', { name: 'Household server' });
    await expect(card.getByText('Connected')).toBeVisible();
    const file = card.getByLabel('Backup file');
    await file.setInputFiles({ name: 'not-a-backup.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await expect(card.getByRole('alert')).toContainText('This file is not an OpenWOD export.');
    await file.setInputFiles({ name: 'openwod-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const dialog = page.getByRole('dialog', { name: 'Replace the library with this backup?' });
    await expect(dialog).toContainText('1 saved workout and 0 sessions');
    await expect(dialog).toContainText('for every device');
    await expect(dialog).toContainText('/data/backups');
    await dialog.getByRole('button', { name: 'Replace library' }).click();
    await expect(card.getByRole('status')).toContainText('Restored 1 saved workout and 0 sessions from the backup of');
    const stored = await api.get<{ workouts: { id: string }[] }>('/api/v1/workouts');
    expect(stored.workouts.map(item => item.id)).toEqual(['kept']);
    await page.goto('/');
    const workouts = page.getByRole('list', { name: 'Workouts' });
    await expect(workouts.getByRole('listitem').filter({ hasText: 'Kept' })).toBeVisible();
    await expect(workouts.getByRole('listitem').filter({ hasText: 'Added later' })).toHaveCount(0);
  });

  test('a settings change on one device reaches the other devices of the household', async ({ page, browser, api }) => {
    await page.goto('/#/settings');
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(async () => (await api.get<{ document?: { theme?: string } }>('/api/v1/settings')).document?.theme).toBe('dark');

    const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      await other.addInitScript(value => { window.__openwodScope = value; }, api.scope);
      const phone = await other.newPage();
      await phone.goto('/#/settings');
      await expect(phone.locator('html')).toHaveAttribute('data-theme', 'dark');
      await phone.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).check();
      await expect.poll(async () => (await api.get<{ document?: { theme?: string } }>('/api/v1/settings')).document?.theme).toBe('light');
    } finally { await other.close(); }

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' })).toBeChecked();
  });
});
