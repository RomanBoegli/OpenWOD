import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { advance, BUNDLED, ready } from './helpers';

/** Start on the timer's page is the session's own start: the player opens counting down. */
const startTimer = async (page: Page) => { await page.getByRole('link', { name: 'Start timer' }).click(); await ready(page); await expect(page.getByRole('status')).toHaveText('Get ready'); };
/** The top line of the frame names the timer; the page's own heading is hidden during a session. */
const frame = (page: Page) => page.locator('[data-wash]');
const sessions = (page: Page) => page.getByRole('list', { name: 'Sessions' }).getByRole('listitem');

test.describe('quick timer (LIB-09, UI-30)', () => {
  test('AT-37: a Tabata of three numbers plays as the clock alone, is logged under its title and repeats, and the library keeps its count', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main')).toContainText(`${BUNDLED} WORKOUTS`);
    await page.getByRole('link', { name: 'Quick timer' }).click();
    await expect(page.getByRole('heading', { name: 'Quick timer' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Rounds' }).fill('2');
    await page.getByRole('textbox', { name: 'Work' }).fill('0:05');
    await page.getByRole('textbox', { name: 'Rest' }).fill('0:05');
    await expect(page.getByRole('status')).toContainText('Tabata: 2 × 0:05 / 0:05');
    await expect(page.getByRole('status')).toContainText('00:15 after a 10-second countdown');
    await startTimer(page);
    await expect(frame(page)).toContainText('Tabata: 2 × 0:05 / 0:05');
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:05');
    // Only the clock: no station, no movement, no Up next and no second view.
    await expect(page.locator('section[data-athlete]')).toHaveCount(0);
    await expect(page.getByTestId('movement-A')).toHaveCount(0);
    await expect(page.getByText('UP NEXT')).toHaveCount(0);
    await expect(page.getByText('YOUR STATION')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Switch to (context|focus) view/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Zoom (in|out)$/ })).toHaveCount(0);
    await expect(page.getByTestId('done')).toHaveCount(0);
    // The ring counts the rounds, there being one movement.
    await expect(page.getByTestId('round-donut')).toHaveAccessibleName(/^Round 1 of 2/);
    await advance(page, 5_000);
    await expect(page.getByRole('status')).toHaveText('Rest');
    await advance(page, 5_000);
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('round-donut')).toHaveAccessibleName(/^Round 2 of 2/);
    await advance(page, 5_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await page.goto('/#/settings/logbook');
    await expect(sessions(page)).toHaveCount(1);
    await expect(sessions(page).first()).toContainText('Tabata: 2 × 0:05 / 0:05');
    await expect(sessions(page).first()).toContainText('00:15');
    await sessions(page).first().getByRole('link', { name: 'Repeat' }).click();
    await ready(page);
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await expect(frame(page)).toContainText('Tabata: 2 × 0:05 / 0:05');
    await advance(page, 10_000);
    await expect(page.locator('section[data-athlete]')).toHaveCount(0);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
    await page.goto('/');
    await expect(page.getByRole('main')).toContainText(`${BUNDLED} WORKOUTS`);
  });

  test('an AMRAP timer counts its rounds and lists their times, a For Time timer stops on Done, an EMOM has no Done, and the scores reach the Logbook', async ({ page }) => {
    await page.goto('/#/timer');
    await page.getByRole('radio', { name: 'AMRAP' }).check();
    await page.getByRole('textbox', { name: 'Time', exact: true }).fill('1:00');
    await expect(page.getByRole('status')).toContainText('AMRAP: 1:00');
    await startTimer(page);
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('AMRAP');
    await expect(page.getByRole('list', { name: 'AMRAP block' })).toHaveCount(0);
    // Each counted round joins the list on top, with the time it took and the time it ended at, like a stopwatch's laps.
    const laps = page.getByRole('list', { name: 'Rounds' }).getByRole('listitem');
    await expect(laps).toHaveCount(0);
    await advance(page, 12_000);
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('1');
    await advance(page, 15_000);
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(laps).toHaveText(['Round 200:1500:27', 'Round 100:1200:12']);
    await advance(page, 5_000);
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(laps).toHaveCount(3);
    await page.getByRole('button', { name: 'Undo last count' }).click();
    await expect(laps).toHaveText(['Round 200:1500:27', 'Round 100:1200:12']);
    await advance(page, 28_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');

    await page.goto('/#/timer');
    await expect(page.getByRole('radio', { name: 'AMRAP' })).toBeChecked(); // The page opens where it was left.
    await page.getByRole('radio', { name: 'For Time' }).check();
    await expect(page.getByRole('status')).toContainText('Open-ended');
    await startTimer(page);
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work · tap Done');
    await advance(page, 42_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:42');
    await page.getByTestId('done').click();
    await expect(page.getByRole('status')).toHaveText('Workout complete');

    await page.goto('/#/timer');
    await page.getByRole('radio', { name: 'EMOM' }).check();
    await page.getByRole('textbox', { name: 'Every' }).fill('0:30');
    await page.getByRole('textbox', { name: 'Rounds' }).fill('2');
    await expect(page.getByRole('status')).toContainText('EMOM: 2 × 0:30');
    await startTimer(page);
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Interval');
    await expect(page.getByText('INTERVAL 1 / 2')).toBeVisible();
    await expect(page.getByTestId('done')).toHaveCount(0);
    await advance(page, 30_000);
    await expect(page.getByText('INTERVAL 2 / 2')).toBeVisible();
    await advance(page, 30_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');

    await page.goto('/#/settings/logbook');
    await expect(sessions(page)).toHaveCount(3);
    await expect(sessions(page).nth(0)).toContainText('EMOM: 2 × 0:30');
    await expect(sessions(page).nth(1)).toContainText('For Time');
    await expect(sessions(page).nth(1)).toContainText('00:42');
    await expect(sessions(page).nth(2)).toContainText('AMRAP: 1:00');
    await expect(sessions(page).nth(2)).toContainText('2 rounds');
  });

  test('a reload brings an interrupted timer back, and Start with new numbers plays those instead', async ({ page }) => {
    await page.goto('/#/timer');
    await startTimer(page);
    await advance(page, 13_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:17');
    await page.evaluate(() => window.__openwodTest!.flushCheckpoints());
    await page.reload(); await ready(page);
    await expect(page.getByRole('dialog', { name: 'Interrupted session' })).toBeVisible();
    await expect(frame(page)).toContainText('Tabata: 8 × 0:20 / 0:10');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:17');
    // The library offers the interrupted timer, and its link leads to the timer's own player.
    await page.goto('/');
    await expect(page.getByRole('main')).toContainText('Tabata: 8 × 0:20 / 0:10');
    await page.goto('/#/timer');
    await page.getByRole('textbox', { name: 'Rounds' }).fill('3');
    await startTimer(page);
    await expect(page.getByRole('dialog', { name: 'Interrupted session' })).toHaveCount(0);
    await expect(frame(page)).toContainText('Tabata: 3 × 0:20 / 0:10');
    await page.goto('/');
    await page.goto('/#/timer/play'); await ready(page);
    await expect(frame(page)).toContainText('Tabata: 3 × 0:20 / 0:10');
  });
});
