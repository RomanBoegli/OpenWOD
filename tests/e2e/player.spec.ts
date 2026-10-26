import { expect, test, type Page } from '@playwright/test';
import { fixtureWorkouts, partnerCircuit } from '../../packages/domain/src/fixtures';
const BUNDLED = fixtureWorkouts.length;
import { serialiseWorkoutFile } from '../../packages/domain/src';

const PLAYER = '/#/wod/partner-circuit/play';
const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__wodvaTest));
const communityFile = (title = 'Community circuit', id = partnerCircuit.id) => ({ name: 'community.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id, title })) });
const legacyJsonFile = { name: 'legacy.wod.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'wodva.workout', formatVersion: 1, workout: { ...partnerCircuit, id: 'legacy-circuit', title: 'Legacy circuit' } })) };

test.describe('player', () => {
  test.beforeEach(async ({ page }) => { await page.goto(PLAYER); await ready(page); });

  test('runs prep, work, transition and all five rounds without lane swaps or timer drift', async ({ page }) => {
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.evaluate(() => window.__wodvaTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await page.evaluate(() => window.__wodvaTest!.advance(40_000));
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByTestId('movement-A')).toHaveText('Kettlebell swings');
    await expect(page.getByTestId('movement-B')).toHaveText('Row');
    await page.evaluate(() => window.__wodvaTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await page.evaluate(() => window.__wodvaTest!.advance(1_140_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
    expect(await page.evaluate(() => window.__wodvaTest!.snapshot().clocks.activeMs)).toBe(1_190_000);
    await page.getByRole('button', { name: 'Train again' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
  });

  test('pause freezes the clock across a 30-second delay and resumes the same interval', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(27_100));
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    const before = await page.getByTestId('primary-timer').textContent();
    await page.evaluate(() => window.__wodvaTest!.advance(30_000));
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Work');
  });

  test('restarts the first interval with Previous and skips with Next inside the section', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(25_000));
    await expect(page.getByTestId('primary-timer')).toHaveText('00:25');
    await page.getByRole('button', { name: 'Restart interval' }).click();
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await expect(page.getByText('MODIFIED')).toBeVisible();
    await page.waitForTimeout(400); // Rapid repeated navigation taps are deliberately ignored.
    await page.getByRole('button', { name: 'Next interval' }).click();
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByRole('button', { name: 'Previous interval' })).toBeEnabled();
  });

  test('confirms destructive stop and exports a portable JSON file', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export WOD' }).click();
    expect((await download).suggestedFilename()).toBe('partner-circuit.wod.yaml');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'End this session?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep training' }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
  });

  test('reflows at desktop, half-window, tablet and phone widths without clipping', async ({ page }, testInfo) => {
    for (const [width, height] of [[1440, 1000], [768, 900], [1024, 768], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId('movement-A')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const A = await page.getByRole('region', { name: 'Athlete A station' }).boundingBox();
      const B = await page.getByRole('region', { name: 'Athlete B station' }).boundingBox();
      if (width <= 620) expect(B!.y).toBeGreaterThan(A!.y);
      else expect(B!.x).toBeGreaterThan(A!.x);
      if (testInfo.project.name === 'webkit' && [1440, 768, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`), fullPage: true });
    }
  });

  test('keeps Pause visible in the training viewport and offers an in-player context switch', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(10_000));
    for (const [width, height] of [[1024, 768], [768, 900], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      const pause = page.getByRole('button', { name: 'Pause workout', exact: true });
      await expect(pause).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('movement-A')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('movement-B')).toBeInViewport({ ratio: 1 });
      if (testInfo.project.name === 'webkit' && [1024, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`training-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Switch to context view' }).click();
    await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
  });

  test('keeps a loaded workout running with the network disabled', async ({ page, context }) => {
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(1_200_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
  });

  test('pauses on visibility loss and requires an explicit Resume after return', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => {
      window.__wodvaTest!.advance(10_000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('status')).toHaveText('Paused · app was hidden');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Work');
  });

  test('persists athlete names, sound and view preferences across a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Player settings' }).click();
    await page.getByRole('textbox', { name: 'Athlete A' }).fill('Mia');
    await page.getByRole('combobox', { name: 'Sound', exact: true }).selectOption('beeps');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Context', exact: true }).click();
    await page.reload(); await ready(page);
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('Mia');
    await expect(page.getByRole('main').getByText('Beeps only')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
  });
});

test.describe('overview', () => {
  test('lays out every section and round for study, then starts the player', async ({ page }) => {
    await page.goto('/#/wod/full-body-partner');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Full body partner workout');
    const sections = page.getByRole('list', { name: 'Sections' }).getByRole('listitem');
    await expect(sections).toHaveCount(6);
    const block = sections.nth(1);
    await expect(block).toContainText('Legs & strength');
    await expect(block).toContainText('Round 1 of 2');
    await expect(block).toContainText('Round 2 of 2');
    await expect(block).toContainText('2m block rest');
    const firstRows = block.getByRole('table').first().getByRole('row');
    await expect(firstRows.nth(1)).toContainText('Air squats');
    await expect(firstRows.nth(1)).toContainText('Dumbbell thrusters');
    await expect(block.getByRole('table').nth(1).getByRole('row').nth(1)).toContainText('Dumbbell thrusters');
    await page.goto('/#/wod/partner-circuit');
    await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem').first()).toContainText('Rounds 1–5 of 5');
    await expect(page.getByText('1m rest between rounds')).toBeVisible();
    await expect(page.getByLabel('Projected difficulty: Hard')).toBeVisible();
    await page.getByRole('link', { name: 'Start workout' }).click();
    await ready(page);
    expect(page.url()).toContain('#/wod/partner-circuit/play');
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
    await page.getByRole('link', { name: 'Back to workout overview' }).click();
    await expect(page.getByRole('list', { name: 'Sections' })).toBeVisible();
  });
});

test.describe('editor', () => {
  test('builds a pair circuit with live totals, saves it to the library, and plays it to completion', async ({ page }) => {
    await page.goto('/#/new');
    const save = page.getByRole('button', { name: 'Save to library' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Give the workout a title.');
    await page.getByLabel('Title', { exact: true }).fill('Garage pair');
    await page.getByLabel('Section 1 slot 1 athlete A', { exact: true }).fill('Row');
    await page.getByLabel('Section 1 slot 1 athlete B', { exact: true }).fill('Swings');
    await page.getByRole('button', { name: 'Add slot' }).click();
    await page.getByLabel('Section 1 slot 2 athlete A', { exact: true }).fill('Burpees');
    await page.getByLabel('Section 1 slot 2 athlete B', { exact: true }).fill('Squats');
    await page.locator('#s0-slot1-duration').fill('0:30');
    await page.getByLabel('Rounds').fill('2');
    await page.getByLabel('Rest between rounds').fill('1:00');
    const summary = page.getByRole('complementary', { name: 'Summary' });
    await expect(summary).toContainText('03:40');
    await expect(summary).toContainText('03:50');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/#\/wod\/garage-pair$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage pair');
    await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem').first()).toContainText('Rounds 1–2 of 2');
    await page.getByRole('link', { name: 'Start workout' }).click();
    await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(230_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('03:40');
    await page.goto('/#/wod/garage-pair/edit');
    await page.locator('#s0-slot0-duration').fill('1:00');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage pair');
    await expect(page.getByRole('definition').filter({ hasText: '04:20' })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Garage pair');
  });

  test('autosaves a draft across reload, lists it in the library, and discards it on request', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Half done');
    await expect(page.getByText(/Draft saved on this device/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half done');
    await page.goto('/');
    const drafts = page.getByRole('region', { name: 'Drafts' });
    await expect(drafts).toContainText('Half done');
    await page.getByRole('button', { name: 'Discard draft Half done' }).click();
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(drafts).toHaveCount(0);
  });

  test('duplicates a bundled workout into an editable copy and explains structures it cannot edit', async ({ page }) => {
    await page.goto('/#/wod/partner-circuit/edit');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Copy of Partner circuit');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('19:50');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/copy-of-partner-circuit$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Copy of Partner circuit');
    await page.goto('/#/wod/tabata-this/edit');
    await expect(page.getByRole('status')).toContainText('cannot change yet');
  });
});

test.describe('library', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor(); });

  test('lists bundled workouts, filters them and starts the chosen one through the player', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED);
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('friendly competition');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Partner circuit');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Duration' }).selectOption('long');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Full body partner workout');
    await expect(list).toContainText('HYROX pace intervals');
    await page.getByRole('combobox', { name: 'Duration' }).selectOption('');
    await page.getByRole('combobox', { name: 'Equipment' }).selectOption('Dumbbells');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Athletes' }).selectOption('1');
    await expect(page.getByText('Nothing matches yet')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Difficulty' }).selectOption('1');
    await expect(list.getByRole('listitem')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Athletes' }).selectOption('1');
    await page.getByRole('combobox', { name: 'Difficulty' }).selectOption('');
    await expect(list.getByRole('listitem')).toHaveCount(fixtureWorkouts.filter(workout => workout.participants === 1).length);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('link', { name: 'Start Full body partner workout' }).click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Full body partner workout');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__wodvaTest!.advance(310_000));
    await expect(page.getByRole('status')).toHaveText('Next section · ready?');
    await page.getByRole('button', { name: 'Start next section' }).click();
    await expect(page.getByTestId('movement-A')).toHaveText('Air squats');
    await page.evaluate(() => window.__wodvaTest!.advance(240_000));
    await expect(page.getByTestId('movement-A')).toHaveText('Dumbbell thrusters');
    await expect(page.getByTestId('movement-B')).toHaveText('Air squats');
  });

  test('imports after preview into a device library that survives reload, then removes it', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(communityFile());
    const dialog = page.getByRole('dialog', { name: 'Preview your WOD' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('bundled workout with the same ID');
    await page.getByRole('button', { name: 'Import as copy' }).click();
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED + 1);
    await expect(list).toContainText('Saved on this device');
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
    await page.getByRole('link', { name: 'Back to library' }).click();
    await page.getByRole('button', { name: 'Remove Community circuit' }).click();
    await page.getByRole('button', { name: 'Remove workout' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(BUNDLED);
    await page.goto('/#/wod/partner-circuit-2');
    await expect(page.getByRole('status')).toContainText('No workout with the ID');
  });

  test('rejects invalid files without touching the library and still reads legacy JSON', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wodva.workout","formatVersion":99}') });
    await expect(page.getByRole('alert')).toContainText('newer than this app');
    await page.getByRole('button', { name: 'Close import preview' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(BUNDLED);
    await page.locator('input[type=file]').setInputFiles(legacyJsonFile);
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Legacy circuit');
  });

  test('follows the system colour scheme and honours an explicit choice across reloads', async ({ page }) => {
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(theme).toBe('light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 245, 238)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(theme).toBe('dark');
    await page.getByRole('button', { name: 'Player settings' }).click();
    await page.getByRole('radio', { name: 'Light' }).check();
    await expect.poll(theme).toBe('light');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.reload();
    await expect.poll(theme).toBe('light');
    expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))).toBe('#f3f5ee');
  });
});
