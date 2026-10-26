import { expect, test, type Page } from '@playwright/test';
import { partnerCircuit } from '../../packages/domain/src/fixtures';

const PLAYER = '/#/wod/partner-circuit';
const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__wodvaTest));
const communityFile = (title = 'Community circuit', id = partnerCircuit.id) => ({ name: 'community.wod.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'wodva.workout', formatVersion: 1, workout: { ...partnerCircuit, id, title } })) });

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
    expect((await download).suggestedFilename()).toBe('partner-circuit.wod.json');
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

test.describe('library', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor(); });

  test('lists bundled workouts, filters them and starts the chosen one through the player', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('kettlebell');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Partner circuit');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Duration' }).selectOption('long');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Full body partner workout');
    await page.getByRole('combobox', { name: 'Duration' }).selectOption('');
    await page.getByRole('combobox', { name: 'Equipment' }).selectOption('Dumbbells');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Athletes' }).selectOption('1');
    await expect(page.getByText('Nothing matches yet')).toBeVisible();
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
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list).toContainText('Saved on this device');
    await page.reload();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('link', { name: 'Start Community circuit' }).click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community circuit');
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export WOD' }).click();
    expect((await download).suggestedFilename()).toBe('community-circuit.wod.json');
    await page.getByRole('link', { name: 'Back to library' }).click();
    await page.getByRole('button', { name: 'Remove Community circuit' }).click();
    await page.getByRole('button', { name: 'Remove workout' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await page.goto('/#/wod/partner-circuit-2');
    await expect(page.getByRole('status')).toContainText('No workout with the ID');
  });

  test('rejects invalid files without touching the library', async ({ page }) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"formatVersion":99}') });
    await expect(page.getByRole('alert')).toContainText('Unsupported workout file');
    await page.getByRole('button', { name: 'Close import preview' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(2);
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
