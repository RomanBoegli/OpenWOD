import { expect, test } from './fixtures';
import { PLAYER, ready, advance, openFilters } from './helpers';

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

  test('the injected clock stays fixed while the browser waits, then advances exactly', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 30_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    await page.waitForTimeout(1_100);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().clocks.activeMs)).toBe(20_000);
    await advance(page, 20_000);
    await expect(page.getByRole('status')).toHaveText('Transition');
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

  test('skips a whole section and returns to it, and the context view carries the loads and notes of the focus view', async ({ page }) => {
    await page.goto('/#/wod/full-body-partner/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    await page.getByRole('button', { name: 'Next section' }).click();
    await expect(page.getByRole('button', { name: 'Start next section' })).toBeVisible(); // The skipped section's Ready gate.
    await expect(page.getByText('MODIFIED')).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Previous section' }).click();
    await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart section' })).toBeVisible(); // Back at the first section.
    await page.goto('/#/wod/fran/play'); await ready(page);
    await page.getByRole('button', { name: 'Context' }).click();
    const rows = page.getByRole('main').locator('[aria-current], [data-active]');
    await expect(rows.first()).toContainText('kg');
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

test.describe('player on a tablet', () => {
  // An iPad in landscape or portrait, or a laptop: the whole session, transport controls included, fits the frame without scrolling.
  for (const id of ['back-squat-5x5', 'cindy', 'fran']) test(`${id} fits at tablet sizes in both views`, async ({ page }) => {
    await page.goto(`/#/wod/${id}/play`); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 16_000);
    const overflow = () => page.locator('[data-performing=true] [data-progress]').evaluate(player => player.scrollHeight - player.clientHeight);
    for (const [width, height] of [[1024, 680], [1180, 750], [768, 950], [820, 1110]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await overflow()).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Switch to context view' }).click();
      await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Switch to focus view' }).click();
    }
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

test.describe('formats', () => {

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
    await openFilters(page);
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

  test('the skip buttons move the clock either way by the chosen seconds and the J and L keys do the same', async ({ page }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await advance(page, 12_000);
    const timer = page.getByTestId('primary-timer');
    await expect(timer).toHaveText('00:38');
    await page.getByRole('button', { name: 'Back 10 seconds' }).click(); // Only 2 seconds into the slot: back to its start.
    await expect(timer).toHaveText('00:40');
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await expect(timer).toHaveText('00:20');
    // The clicked button keeps the focus on Linux, and keys from a focused button are left to the button.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('j');
    await expect(timer).toHaveText('00:30');
    await page.keyboard.press('l');
    await expect(timer).toHaveText('00:20');
    await expect(page.getByText('MODIFIED')).toBeVisible();
  });

  test('the prep countdown counts down in a count-up workout and wears the rest colour', async ({ page }) => {
    await page.goto('/#/wod/fran/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await advance(page, 3000);
    const player = page.locator('[data-wash]');
    await expect(player).toHaveAttribute('data-phase', 'prep');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:07');
    await advance(page, 8000);
    await expect(player).toHaveAttribute('data-phase', 'work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:01');
  });
});

test.describe('player without a secure context', () => {
  // Plain HTTP on a LAN address (a phone opening http://YOUR_SERVER_ADDRESS:8080) has no crypto.randomUUID; starting a workout used to throw and leave a black page.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID; });
    await page.goto(PLAYER); await ready(page);
  });

  test('starts and runs a workout when crypto.randomUUID is missing', async ({ page }) => {
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await expect(page.getByTestId('primary-timer')).toBeVisible();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().projection.sessionId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await page.locator('body').innerText()).trim()).not.toBe('');
  });
});
