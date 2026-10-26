import { expect, test, type Page } from '@playwright/test';
import { bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
const BUNDLED = bundledWorkouts.length;
import { serialiseWorkoutFile } from '../../packages/domain/src';
import { matchesFilter, summariseWorkout, type LibraryFilter } from '../../packages/domain/src/library';
const partnerCircuit = bundledWorkout('partner-circuit');
const bundledCount = (filter: LibraryFilter) => bundledWorkouts.filter(workout => matchesFilter(summariseWorkout(workout), filter)).length;

const PLAYER = '/#/wod/partner-circuit/play';
const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__openwodTest));
const communityFile = (title = 'Community circuit', id = partnerCircuit.id) => ({ name: 'community.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id, title })) });

test.describe('player', () => {
  test.beforeEach(async ({ page }) => { await page.goto(PLAYER); await ready(page); });

  test('runs prep, work, transition and all five rounds without lane swaps or timer drift', async ({ page }) => {
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await page.evaluate(() => window.__openwodTest!.advance(40_000));
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByTestId('movement-A')).toHaveText('Kettlebell swings');
    await expect(page.getByTestId('movement-B')).toHaveText('Row');
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await page.evaluate(() => window.__openwodTest!.advance(1_140_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().clocks.activeMs)).toBe(1_190_000);
    await page.getByRole('button', { name: 'Train again' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
  });

  test('pause freezes the clock across a 30-second delay and resumes the same interval', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(27_100));
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    const before = await page.getByTestId('primary-timer').textContent();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Work');
  });

  test('restarts the first interval with Previous and skips with Next inside the section', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(25_000));
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
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
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
    await page.evaluate(() => window.__openwodTest!.advance(1_200_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
  });

  test('pauses on visibility loss and requires an explicit Resume after return', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => {
      window.__openwodTest!.advance(10_000);
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
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Athlete A' }).fill('Mia');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Training view' }).click();
    await page.getByRole('combobox', { name: 'Sound', exact: true }).selectOption('beeps');
    await page.goto(PLAYER); await ready(page);
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
    await page.evaluate(() => window.__openwodTest!.advance(230_000));
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
    await page.goto('/#/wod/hyrox-doubles-circuit/edit');
    await expect(page.getByRole('status')).toContainText('cannot change yet');
  });
});

test.describe('editor formats', () => {
  test('builds an AMRAP with targets and levelled loads, saves it, and plays it with the counter', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Garage AMRAP');
    await page.getByRole('radio', { name: 'Solo' }).check();
    await page.getByLabel('Section 1 format').selectOption('amrap');
    await page.getByLabel('Time cap').fill('12:00');
    await page.getByLabel('Section 1 movement 1', { exact: true }).fill('Kettlebell swings');
    await page.getByLabel('Section 1 movement 1 target kind').selectOption('reps');
    await page.getByLabel('Section 1 movement 1 target amount').fill('15');
    await page.getByLabel('Section 1 movement 1 load unit').selectOption('kg');
    await page.getByLabel('Section 1 movement 1', { exact: true }).locator('../..').getByRole('checkbox', { name: 'Levels' }).check();
    await page.getByLabel('Section 1 movement 1 heavy load').fill('24');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await page.getByLabel('Section 1 movement 2', { exact: true }).fill('Burpees');
    await page.getByLabel('Section 1 movement 2 target kind').selectOption('reps');
    await page.getByLabel('Section 1 movement 2 target amount').fill('10');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('Cap 12:00');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Garage AMRAP' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('AMRAP');
    await expect(page.getByRole('main')).toContainText('24 kg');
    await page.getByRole('link', { name: 'Start workout' }).click(); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('list', { name: 'AMRAP block' })).toContainText('24 kg');
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('1');
    await page.evaluate(() => window.__openwodTest!.advance(720_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
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
    await expect(page.getByRole('status')).toHaveText('Next section · ready?');
    await page.getByRole('button', { name: 'Start next section' }).click();
    await expect(page.getByTestId('movement-A')).toHaveText('Air squats');
    await page.evaluate(() => window.__openwodTest!.advance(240_000));
    await expect(page.getByTestId('movement-A')).toHaveText('Dumbbell thrusters');
    await expect(page.getByTestId('movement-B')).toHaveText('Air squats');
  });

  test('imports into the editor as an unsaved draft, saves it to a device library that survives reload, then removes it', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles(communityFile());
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
    await expect(page.getByRole('status')).toContainText('No workout with the ID');
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

test.describe('formats', () => {
  const advance = (page: Page, ms: number) => page.evaluate(ms => window.__openwodTest!.advance(ms), ms);

  test('AMRAP counts only what is tapped, never moves its block, and ends capped', async ({ page }) => {
    await page.goto('/#/wod/cindy/play'); await ready(page);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('AMRAP');
    await expect(page.getByTestId('primary-timer')).toHaveText('20:00');
    await expect(page.getByRole('list', { name: 'AMRAP block' }).getByRole('listitem')).toHaveCount(3);
    await advance(page, 60_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('19:00');
    await expect(page.getByRole('button', { name: 'Next interval' })).toBeDisabled();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Rep', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('2');
    await expect(page.getByTestId('reps')).toHaveText('1');
    await page.getByRole('button', { name: 'Undo last count' }).click();
    await expect(page.getByTestId('reps')).toHaveText('0');
    await expect(page.getByRole('list', { name: 'AMRAP block' }).getByRole('listitem')).toHaveCount(3);
    await advance(page, 1_140_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Section results' })).toContainText('2 rounds');
    await expect(page.getByRole('list', { name: 'Section results' })).toContainText('capped');
  });

  test('EMOM keeps its boundaries whatever is tapped and shows rest after an early Done', async ({ page }) => {
    await page.goto('/#/wod/partner-emom-16/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Interval');
    await expect(page.getByTestId('primary-timer')).toHaveText('01:00');
    await expect(page.getByText('INTERVAL 1 / 16')).toBeVisible();
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await advance(page, 20_000);
    await page.getByTestId('done').click();
    await expect(page.getByText('DONE · REST').first()).toBeVisible();
    await expect(page.getByTestId('done')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next interval' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restart interval' })).toBeDisabled();
    await advance(page, 20_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    await advance(page, 20_000);
    await expect(page.getByText('INTERVAL 2 / 16')).toBeVisible();
    await expect(page.getByTestId('movement-A')).toHaveText('Burpees');
    await expect(page.getByTestId('done')).toBeVisible();
  });

  test('For time counts up, advances on Done, shows big targets with the chosen load level, and finishes', async ({ page }) => {
    await page.goto('/#/wod/fran/play'); await ready(page);
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('20 (15)');
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('30 (20)');
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('43 (29) kg');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work · tap Done');
    await expect(page.getByTestId('movement-A')).toHaveText('Thrusters');
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('21');
    await advance(page, 5_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:05');
    await expect(page.getByText('ELAPSED · CAP BELOW')).toBeVisible();
    await expect(page.getByText('CAP09:55')).toBeVisible();
    for (let step = 0; step < 5; step++) { await page.getByTestId('done').click(); await advance(page, 1_000); }
    await expect(page.getByTestId('movement-A')).toHaveText('Pull-ups');
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('9');
    await page.getByTestId('done').click();
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Section results' })).toContainText('completed');
  });

  test('You go, I go hands over on Switch and ignores a rapid second tap', async ({ page }) => {
    await page.goto('/#/wod/you-go-i-go-sprints/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Athlete A works');
    await expect(page.getByText('TEAM ROUND 1 · TURN 1')).toBeVisible();
    await page.getByTestId('switch').click();
    await page.getByTestId('switch').click({ force: true });
    await expect(page.getByRole('status')).toHaveText('Athlete B works');
    await expect(page.getByText('TEAM ROUND 1 · TURN 2')).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId('switch').click();
    await expect(page.getByText('TEAM ROUND 2 · TURN 3')).toBeVisible();
    await advance(page, 720_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Section results' })).toContainText('1 team round');
  });

  test('the library filters by format and by the equipment you own', async ({ page }) => {
    await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await chip('Format', 'AMRAP').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Cindy');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Fran');
    await chip('Format', 'For time').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Fran');
    await chip('Collection', 'Benchmarks').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Karen');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Rack & Run');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Equipment', 'Only my equipment').click();
    await expect(page.getByText('Nothing matches yet')).toBeVisible();
    await page.goto('/#/settings/equipment');
    await page.getByRole('checkbox', { name: 'I have Pull-up bar' }).check();
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Cindy');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Fran');
    await page.reload();
    await expect(chip('Equipment', 'Only my equipment')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('settings and log', () => {
  test('logs a completed session and shows it on the card and the overview, sorted by longest ago', async ({ page }) => {
    await page.goto('/#/wod/karen/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await page.evaluate(() => window.__openwodTest!.advance(200_000));
    await page.getByTestId('done').click();
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await page.goto('/#/wod/karen');
    await expect(page.getByRole('region', { name: 'Past sessions' })).toContainText('Completed');
    await expect(page.getByRole('region', { name: 'Past sessions' })).toContainText('03:20 active');
    await expect(page.getByRole('main')).toContainText('Done once · today');
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('longestAgo');
    const titles = page.getByRole('list', { name: 'Workouts' }).getByRole('heading', { level: 2 });
    await expect(titles.last()).toHaveText('Karen');
  });

  test('merges equipment names and creates, edits and removes a collection through the settings dialogs', async ({ page }) => {
    await page.goto('/#/settings/equipment'); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor();
    await page.getByRole('checkbox', { name: 'Select Medicine ball' }).check();
    await page.getByRole('checkbox', { name: 'Select Slam ball' }).check();
    await page.getByRole('combobox', { name: 'Keep as' }).fill('Wall ball');
    await page.getByRole('button', { name: /^Merge/ }).click();
    await expect(page.getByRole('list', { name: 'Merged names' })).toContainText('Wall ball');
    await page.getByRole('button', { name: 'Rename Wall ball' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Wall ball' });
    await rename.getByRole('textbox', { name: 'Name' }).fill('Wallball');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('list', { name: 'Equipment in the library' })).toContainText('Wallball');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Collections' }).click();
    await page.getByRole('button', { name: 'New collection' }).click();
    const dialog = page.getByRole('dialog', { name: 'New collection' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Short and sharp');
    await dialog.getByRole('group', { name: 'Workouts in this collection' }).getByRole('button', { name: 'Karen', exact: true }).click();
    await dialog.getByRole('group', { name: 'Workouts in this collection' }).getByRole('button', { name: 'Fran', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create collection' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).toContainText('Short and sharp');
    await page.getByRole('button', { name: 'Edit collection Short and sharp' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Short and sharp' });
    await edit.getByRole('textbox', { name: 'Description' }).fill('Under ten minutes');
    await edit.getByRole('button', { name: 'Save collection' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).toContainText('Under ten minutes');
    await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    await page.getByRole('group', { name: 'Collection' }).getByRole('button', { name: 'Short and sharp' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Wallball');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Medicine ball');
    await page.goto('/#/wod/karen');
    await expect(page.getByRole('region', { name: 'Equipment' })).toContainText('Wallball');
    await page.goto('/#/settings/collections');
    await page.getByRole('button', { name: 'Remove collection Short and sharp' }).click();
    await page.getByRole('dialog', { name: 'Remove Short and sharp?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).not.toContainText('Short and sharp');
  });
});

test.describe('movements and search', () => {
  test('the editor picks movements from the catalogue, declares their equipment, and adds unknown movements', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Picker check');
    const lane = page.getByRole('combobox', { name: 'Section 1 slot 1 athlete A', exact: true });
    await lane.pressSequentially('thru');
    const options = page.getByRole('listbox', { name: 'Movements matching thru' });
    await expect(options.getByRole('option').first()).toContainText('Thrusters');
    await lane.press('Enter');
    await expect(lane).toHaveValue('Thrusters');
    await expect(page.getByRole('main')).toContainText('Thrusters · Barbell');
    await expect(page.getByRole('group', { name: 'Equipment' })).toContainText('Barbell');
    const partner = page.getByRole('combobox', { name: 'Section 1 slot 1 athlete B', exact: true });
    await partner.pressSequentially('Pogo hops');
    await partner.press('Escape');
    const unknown = page.getByRole('status', { name: 'Movements not in your catalogue' });
    await expect(unknown).toContainText('Pogo hops');
    await page.getByRole('button', { name: 'Add Pogo hops to the catalogue' }).click();
    await expect(unknown).toHaveCount(0);
    await page.goto('/#/settings/movements');
    const list = page.getByRole('list', { name: 'Movements' });
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Pogo hops');
  });

  test('an imported file with an unknown movement opens highlighted, and housekeeping merges it later', async ({ page }) => {
    const file = { name: 'odd.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id: 'odd-circuit', title: 'Odd circuit', sections: partnerCircuit.sections.map((section, index) => index === 0 ? JSON.parse(JSON.stringify(section).replace('"name":"Row"', '"name":"Pogo hops"')) : section) })) };
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page).toHaveURL(/#\/draft\/import-odd-circuit$/);
    const unknown = page.getByRole('status', { name: 'Movements not in your catalogue' });
    await expect(unknown).toContainText('Pogo hops');
    await unknown.getByRole('button', { name: 'Add' }).click();
    await expect(unknown).toHaveCount(0);
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/odd-circuit$/);
    await page.goto('/#/settings/movements');
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await page.getByRole('checkbox', { name: 'Select Pogo hops' }).check();
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('box jumps');
    await page.getByRole('checkbox', { name: 'Select Box jumps', exact: true }).check();
    await page.getByRole('combobox', { name: 'Keep as' }).selectOption({ label: 'Box jumps' });
    await page.getByRole('button', { name: 'Merge 2' }).click();
    await expect(page.getByRole('list', { name: 'Merged movement names' })).toContainText('Pogo hops → Box jumps');
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await expect(page.getByRole('checkbox', { name: 'Select Pogo hops' })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('hang power');
    const list = page.getByRole('list', { name: 'Movements' });
    await expect(list.getByRole('listitem').first()).toContainText('Cleans');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Hang power cleans');
    await page.getByRole('button', { name: 'Edit Hang power cleans' }).click();
    const form = page.getByRole('dialog', { name: 'Edit Hang power cleans' });
    const equipment = form.getByRole('combobox', { name: 'Equipment' });
    await equipment.pressSequentially('row');
    await expect(form.getByRole('listbox', { name: 'Equipment suggestions' }).getByRole('option').first()).toHaveText('Rowing machine');
    await equipment.press('Enter');
    await equipment.pressSequentially('Sandbox');
    await expect(form.getByRole('option', { name: 'Add “Sandbox”' })).toBeVisible();
    await equipment.press('Enter');
    await expect(form.getByRole('group', { name: 'Equipment' })).toContainText('Barbell');
    await expect(form.getByRole('group', { name: 'Equipment' })).toContainText('Rowing machine');
    await expect(form.getByRole('group', { name: 'Equipment' })).toContainText('Sandbox');
    await form.getByRole('button', { name: 'Remove Barbell' }).click();
    await form.getByRole('button', { name: 'Save movement' }).click();
    await expect(list.getByRole('listitem').nth(1)).toContainText('Sandbox');
    await expect(list.getByRole('listitem').nth(1)).not.toContainText('Barbell');
    await page.getByRole('button', { name: 'Remove Hang power cleans' }).click();
    await expect(page.getByRole('dialog', { name: 'Remove Hang power cleans?' })).toContainText('bundled record');
    await page.getByRole('dialog', { name: 'Remove Hang power cleans?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Hang power cleans' })).toHaveCount(0);
    await page.goto('/#/wod/odd-circuit');
    await expect(page.getByRole('region', { name: 'Equipment' })).toContainText('Plyo box');
  });

  test('the library search forgives typos and filters survive navigation within the session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('thrustre');
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ query: 'thrustre' }));
    await expect(list).toContainText('Fran');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('fran');
    await expect(list.getByRole('heading', { level: 2 }).first()).toHaveText('Fran');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('');
    await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'AMRAP' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(bundledCount({ format: ['amrap'] }));
    await page.goto('/#/wod/cindy');
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'AMRAP' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(BUNDLED);
  });
});

test.describe('workout view settings', () => {
  test('ring width, pulse intensity and colour marks reach the player', async ({ page }) => {
    await page.goto('/#/settings/player'); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor();
    await page.getByRole('slider', { name: /Timer ring width/ }).fill('10');
    await page.getByRole('slider', { name: /Pulse intensity/ }).fill('60');
    await page.getByRole('slider', { name: 'First milestone marker' }).fill('20');
    await page.getByLabel('First milestone colour').fill('#ff00ff');
    await page.getByRole('radio', { name: 'Pounds' }).check();
    const preview = page.locator('[data-view]');
    await expect(preview).toHaveAttribute('data-view', 'focus');
    await page.getByLabel('Default view').selectOption('context');
    await expect(preview).toHaveAttribute('data-view', 'context');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(preview).toHaveAttribute('data-warning', 'amber', { timeout: 10_000 });
    await expect(preview).toHaveAttribute('data-warning', 'red', { timeout: 10_000 });
    await expect(preview).toHaveAttribute('data-phase', 'complete', { timeout: 10_000 });
    await page.getByLabel('Default view').selectOption('focus');
    await page.goto('/#/wod/fran/play'); await ready(page);
    await expect(page.locator('svg[data-perimeter] path').first()).toHaveCSS('stroke-width', '10px');
    const player = page.locator('[data-wash]');
    expect(await player.evaluate(element => element.style.getPropertyValue('--wash-gain'))).toBe('0.6');
    expect(await player.evaluate(element => element.style.getPropertyValue('--phase-amber'))).toBe('#ff00ff');
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('95 (65) lb');
    // The pulse deepens as a timed slot drains: half-way through the first 40 s slot of the partner circuit.
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    expect(Number(await page.locator('[data-wash]').evaluate(element => element.style.getPropertyValue('--drained')))).toBeGreaterThan(0.3);
  });
});
