import { apiFor, expect, isStaticProject, test } from './fixtures';
import { advance, PLAYER, ready } from './helpers';

const YGIG = '/#/wod/you-go-i-go-sprints/play';
const flush = (page: Parameters<typeof advance>[0]) => page.evaluate(() => window.__openwodTest!.flushCheckpoints());
const snapshot = (page: Parameters<typeof advance>[0]) => page.evaluate(() => window.__openwodTest!.snapshot());
/** The recorded sessions: from the test server, or in the static projects from History, the only view of the browser's log. */
const expectOneSession = async (page: Parameters<typeof advance>[0], outcome: string, label: string) => {
  if (!isStaticProject()) {
    const api = apiFor();
    await expect.poll(async () => (await api.get<{ sessions: { outcome: string; interrupted: boolean }[] }>('/api/v1/sessions')).sessions).toEqual([expect.objectContaining({ outcome, interrupted: true })]);
    return;
  }
  await page.goto('/#/history');
  const rows = page.getByRole('list', { name: 'Sessions' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(label);
  await expect(rows.first()).toContainText('Interrupted');
};

test.describe('checkpoints and recovery', () => {
  test('AT-12: a reload in round 3 during B’s turn recovers paused with lane, round, clock and acks, then finishes Interrupted', async ({ page }) => {
    await page.goto(YGIG); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    for (let i = 0; i < 5; i++) { await advance(page, 20_000); await page.evaluate(() => window.__openwodTest!.command('switch')); }
    await advance(page, 7_000.125);
    const before = await snapshot(page);
    expect(before.projection.turn).toMatchObject({ athlete: 'B', teamRound: 2 });
    const timerBefore = await page.getByTestId('primary-timer').textContent();
    await flush(page);
    await page.reload(); await ready(page);
    const prompt = page.getByRole('dialog', { name: 'Interrupted session' });
    await expect(prompt).toContainText('saved just now');
    await expect(prompt).toContainText('Athlete B’s turn · team round 3');
    await expect(page.getByRole('status')).toHaveText('Recovered · paused');
    const restored = await snapshot(page);
    expect(restored.projection.turn).toEqual(before.projection.turn);
    expect(restored.projection.acks).toEqual(before.projection.acks);
    expect(Math.abs(restored.clocks.sectionMs - before.clocks.sectionMs)).toBeLessThan(1500);
    await prompt.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('status')).toHaveText('Athlete B works');
    expect(await page.getByTestId('primary-timer').textContent()).toBe(timerBefore);
    await advance(page, 12 * 60_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expectOneSession(page, 'capped', 'Capped');
    await page.goto('/#/history');
    await expect(page.getByRole('list', { name: 'Sessions' }).getByRole('listitem').first()).toContainText('Interrupted');
  });

  test('ending from the recovery prompt records Aborted and Interrupted, and the library banner offers the session until then', async ({ page }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000 + 65_000.125);
    await flush(page);
    await page.goto('/');
    const banner = page.getByRole('status', { name: 'Interrupted session' });
    await expect(banner).toContainText('Partner circuit');
    await banner.getByRole('link', { name: 'Resume' }).click();
    await ready(page);
    const prompt = page.getByRole('dialog', { name: 'Interrupted session' });
    await expect(prompt).toContainText('Round 1 · 00:25 left');
    await prompt.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('status')).toHaveText('Workout ended');
    await expectOneSession(page, 'aborted', 'Ended early');
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);
  });

  test('AT-16: without browser storage the player says so and never claims a recovery', async ({ page, context }) => {
    await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 12_000);
    await expect(page.getByText('Not saving progress on this device', { exact: false })).toBeVisible();
    page.on('dialog', dialog => void dialog.accept());
    await page.reload(); await ready(page);
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
    await expect(page.getByRole('dialog', { name: 'Interrupted session' })).toHaveCount(0);
  });
});
