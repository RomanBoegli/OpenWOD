import { expect, test } from '@playwright/test';
import { partnerCircuit } from '../../packages/domain/src/fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__wodvaTest));
});

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

test('provides context, workout choice and authored manual section boundaries', async ({ page }) => {
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose workout' }).click();
  await page.getByRole('button', { name: /Full body partner workout/ }).click();
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

test('imports only after preview confirmation and exports a portable JSON file', async ({ page }) => {
  const file = { format: 'wodva.workout', formatVersion: 1, workout: { ...partnerCircuit, title: 'Community circuit' } };
  await page.locator('input[type=file]').setInputFiles({ name: 'community.wod.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByRole('dialog', { name: 'Preview your WOD' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Partner circuit');
  await page.getByRole('button', { name: 'Load workout' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community circuit');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WOD' }).click();
  expect((await download).suggestedFilename()).toBe('community-circuit.wod.json');
});

test('rejects invalid imports and confirms destructive stop', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"formatVersion":99}') });
  await expect(page.getByRole('alert')).toContainText('Unsupported workout file');
  await page.getByRole('button', { name: 'Close import preview' }).click();
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
    if (testInfo.project.name === 'chromium' && [1440, 768, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`), fullPage: true });
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
    if (testInfo.project.name === 'chromium' && [1024, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`training-${width}.png`), fullPage: true });
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
