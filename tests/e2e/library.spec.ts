import { expect, test } from './fixtures';
import { BUNDLED, partnerCircuit, bundledCount, ready, communityFile, openFilters } from './helpers';
import { serialiseWorkoutFile } from '../../packages/domain/src';
import { bundledWorkouts } from '../../packages/domain/src/bundled';

test.describe('library', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor(); });

  test('lists bundled workouts, filters them and starts the chosen one through the player', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED);
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('friendly competition');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Partner circuit');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await openFilters(page);
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await chip('Duration', 'Over 40 min').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ duration: ['long'] }));
    await expect(list).toContainText('Full body partner workout');
    await expect(list).toContainText('HYROX pace intervals');
    await chip('Duration', 'Up to 20 min').click(); // Accumulative: both buckets now match.
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ duration: ['long', 'short'] }));
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Equipment', 'Exercise mat').click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await chip('Athletes', 'Solo').click();
    await expect(page.getByText('Nothing matches yet')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Difficulty', 'Light').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ difficulty: [1] }));
    await chip('Difficulty', 'Light').click();
    await chip('Athletes', 'Solo').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledWorkouts.filter(workout => workout.participants === 1).length);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('link', { name: 'Start Full body partner workout' }).click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Full body partner workout');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(310_000));
    await expect(page.getByRole('status')).toHaveText('Next block · ready?');
    await page.getByRole('button', { name: 'Start next block' }).click();
    await expect(page.getByTestId('movement-A')).toHaveText('Air squats');
    await page.evaluate(() => window.__openwodTest!.advance(240_000));
    await expect(page.getByTestId('movement-A')).toHaveText('Dumbbell thrusters');
    await expect(page.getByTestId('movement-B')).toHaveText('Air squats');
  });

  test('imports into the editor as an unsaved draft, saves it to a device library that survives reload, then removes it', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(communityFile());
    await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Open in editor' }).click();
    await expect(page).toHaveURL(/#\/draft\/import-community-circuit$/);
    await expect(page.getByRole('main')).toContainText('Read from community.wod.yaml');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Community circuit');
    await expect(page.getByRole('status', { name: 'Movements not in your catalogue' })).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Drafts' })).toContainText('Imported from community.wod.yaml');
    await page.getByRole('link', { name: 'Continue editing' }).click();
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/community-circuit$/);
    await page.goto('/');
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED + 1);
    await expect(list).toContainText('Community circuit');
    await page.reload();
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED + 1);
    await page.getByRole('link', { name: 'Start Community circuit' }).click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community circuit');
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export WOD' }).click();
    expect((await download).suggestedFilename()).toBe('community-circuit.wod.yaml');
    await page.getByRole('link', { name: 'Back to workout overview' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community circuit');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove workout' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED);
    await page.goto('/#/wod/partner-circuit-2');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workout not found');
    await expect(page.getByRole('main')).toContainText('No workout with the ID “partner-circuit-2”');
  });

  test('an unknown address shows the not-found page with a way back', async ({ page }) => {
    await page.goto('/#/nowhere');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await page.getByRole('main').getByRole('link', { name: 'Back to the library' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick your next session');
  });

  test('rejects invalid, newer and pre-release files without touching the library', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"openwod.workout","formatVersion":99}') });
    await expect(page.getByRole('alert')).toContainText('newer than this app');
    await page.getByRole('button', { name: 'Close import preview' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(BUNDLED);
    await page.locator('input[type=file]').setInputFiles({ name: 'old.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile(partnerCircuit).replace('formatVersion: 3', 'formatVersion: 2')) });
    await expect(page.getByRole('alert')).toContainText('no longer read');
    await page.getByRole('button', { name: 'Close import preview' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(BUNDLED);
  });

  test('follows the system colour scheme and honours an explicit choice across reloads', async ({ page }) => {
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(theme).toBe('light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 245, 238)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(theme).toBe('dark');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).check();
    await expect.poll(theme).toBe('light');
    await page.goto('/');
    await page.reload();
    await expect.poll(theme).toBe('light');
    expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))).toBe('#f3f5ee');
  });
});
