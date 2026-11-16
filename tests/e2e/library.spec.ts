import { expect, test } from './fixtures';
import { BUNDLED, partnerCircuit, bundledCount, ready, communityFile, openFilters, ownFile, fact } from './helpers';
import { serialiseWorkoutFile } from '../../packages/domain/src';
import { bundledWorkouts } from '../../packages/domain/src/bundled';

test.describe('library', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor(); });

  test('lists bundled workouts, filters them and starts the chosen one through the player', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED);
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('friendly competition');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Partner Circuit');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await openFilters(page);
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await chip('Duration', 'Over 40 min').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ duration: ['long'] }));
    await expect(list).toContainText('Full Body Partner Workout');
    await expect(list).toContainText('HYROX Pace Intervals');
    await chip('Duration', 'Up to 20 min').click(); // Accumulative: both buckets now match.
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ duration: ['long', 'short'] }));
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Equipment', 'Exercise mat').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ equipment: ['Exercise mat'] }));
    await chip('Athletes', 'Solo').click(); // Groups narrow each other: the partner workout drops out.
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ equipment: ['Exercise mat'], participants: 1 }));
    await expect(list).toContainText('Dumbbell Full Body Crunch');
    await expect(list).not.toContainText('Full Body Partner Workout');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Difficulty', 'Light').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ difficulty: [1] }));
    await chip('Difficulty', 'Light').click();
    await chip('Athletes', 'Solo').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledWorkouts.filter(workout => workout.participants === 1).length);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('link', { name: 'Start Full Body Partner Workout' }).click();
    await ready(page);
    // Start on the card begins the session at once: no second Start on the player.
    await expect(page).toHaveURL(/#\/wod\/full-body-partner\/play$/);
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.evaluate(() => window.__openwodTest!.advance(310_000));
    await expect(page.getByRole('status')).toHaveText('Next block · ready?');
    await page.getByRole('button', { name: 'Start next block' }).click();
    await expect(page.getByTestId('movement-A')).toHaveText('Air Squats');
    await page.evaluate(() => window.__openwodTest!.advance(240_000));
    await expect(page.getByTestId('movement-A')).toHaveText('Dumbbell Thrusters');
    await expect(page.getByTestId('movement-B')).toHaveText('Air Squats');
  });

  test('imports into the editor as an unsaved draft, saves it to a device library that survives reload, then removes it', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(communityFile());
    await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Edit before saving' }).click();
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
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community circuit');
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

  test('LIB-06: finds workouts by author, typos included, and filters them with the Author chips', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Workouts' });
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('crosfit');
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ query: 'crosfit' }));
    await expect(list).toContainText('Fran');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await openFilters(page);
    await chip('Author', 'Coach programming').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ authors: ['Coach programming'] }));
    await chip('Athletes', 'Pair').click();
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ authors: ['Coach programming'], participants: 2 }));
    await chip('Author', 'OpenWOD').click(); // Any of the chosen authors.
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ authors: ['Coach programming', 'OpenWOD'], participants: 2 }));
  });

  test('sorts by date added: the workout that joined last comes first, bundled ones follow by title', async ({ page }) => {
    for (const [title, id] of [['Aaa First', 'aaa-first'], ['Zzz Second', 'zzz-second']] as const) {
      await page.locator('input[type=file]').setInputFiles(ownFile(title, id));
      await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Save and edit' }).click();
      await expect(page).toHaveURL(/#\/wod\/[^/]+\/edit$/);
      await page.goto('/');
      await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    }
    await openFilters(page);
    await page.getByLabel('Sort').selectOption('newest');
    const titles = page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').getByRole('heading', { level: 2 });
    await expect(titles).toHaveCount(BUNDLED + 2);
    await expect(titles.nth(0)).toHaveText('Zzz Second');
    await expect(titles.nth(1)).toHaveText('Aaa First');
    await expect(titles.nth(2)).toHaveText(bundledWorkouts.map(workout => workout.title).sort((a, b) => a.localeCompare(b, 'en'))[0]);
    await page.reload(); // The sort survives within the browser session.
    await expect(titles.nth(0)).toHaveText('Zzz Second');
  });

  test('a workout’s page splits its time into active and rest, and counts blocks, movements and equipment', async ({ page }) => {
    await page.goto('/#/wod/partner-circuit');
    const facts = page.getByLabel('At a glance');
    await expect(facts.locator('dt')).toHaveText(['Total time', 'Active time', 'Rest time', 'Blocks', 'Movements', 'Equipment']);
    await expect(fact(facts, 'Total time')).toHaveText('19:50');
    await expect(fact(facts, 'Active time')).toHaveText('13:20');
    await expect(fact(facts, 'Rest time')).toHaveText('06:30'); // 2:30 of transitions and 4:00 between rounds.
    await expect(fact(facts, 'Blocks')).toHaveText('1');
    await expect(fact(facts, 'Equipment')).toHaveText(/^\d+$/);
    // A capped workout states its cap as the time, plainly, as its library card does.
    await page.goto('/#/wod/fran');
    await expect(fact(facts, 'Total time')).toHaveText('10:00');
    await expect(fact(facts, 'Active time')).toHaveText('10:00');
    await expect(fact(facts, 'Rest time')).toHaveText('00:00');
  });

  test('an unknown address shows the not-found page with a way back', async ({ page }) => {
    await page.goto('/#/nowhere');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await page.getByRole('main').getByRole('link', { name: 'Back to the library' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick your next session');
  });

  test('writes a workout with an AI assistant: the guide to copy, a pasted answer to preview and save (SHR-07)', async ({ page }) => {
    await page.getByRole('button', { name: 'Create with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a WOD with AI' });
    await dialog.getByText('Show the guide').click();
    await expect(dialog.getByLabel('Authoring guide')).toContainText('format: openwod.workout');
    await expect(dialog.getByLabel('Authoring guide')).toContainText('Dumbbell Sumo Squats');
    await dialog.getByRole('button', { name: 'Copy guide' }).click();
    await expect(dialog.getByRole('status')).toHaveText(/Copied|blocked copying/);
    await dialog.getByLabel('Assistant’s answer').fill('```yaml\nformat: openwod.workout\nformatVersion: 3\nworkout: {}\n```');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview your WOD' });
    await expect(preview.getByRole('alert')).toContainText('/workout: must have required property');
    await preview.getByRole('button', { name: 'Back to the answer' }).click();
    const file = serialiseWorkoutFile({ ...partnerCircuit, id: 'assistant-circuit', title: 'Assistant circuit', sharing: undefined });
    await dialog.getByLabel('Assistant’s answer').fill(`Assumed twenty seconds of rest between stations.\n\n\`\`\`yaml\n${file}\`\`\``);
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(preview).toContainText('Assistant circuit');
    await preview.getByRole('button', { name: 'Save and edit' }).click();
    await expect(page).toHaveURL(/#\/wod\/assistant-circuit\/edit$/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Assistant circuit');
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
