import { apiFor, expect, isStaticProject, test } from './fixtures';
import { advance, PLAYER, ready } from './helpers';

const YGIG = '/#/wod/you-go-i-go-sprints/play';
const flush = (page: Parameters<typeof advance>[0]) => page.evaluate(() => window.__openwodTest!.flushCheckpoints());
const snapshot = (page: Parameters<typeof advance>[0]) => page.evaluate(() => window.__openwodTest!.snapshot());
/** The save times this device's IndexedDB holds: of its checkpoints, and of everything (checkpoints and progress records), latest last. */
const savedTimes = (page: Parameters<typeof advance>[0]) => page.evaluate(() => new Promise<{ checkpoints: string[]; all: string[] }>((resolve, reject) => {
  const open = indexedDB.open('openwod');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction(['checkpoints', 'progress']);
    const checkpoints = tx.objectStore('checkpoints').getAll();
    const progress = tx.objectStore('progress').getAll();
    const times = (rows: { savedAt: string }[]) => rows.map(row => row.savedAt).sort();
    tx.oncomplete = () => { open.result.close(); resolve({ checkpoints: times(checkpoints.result), all: times([...checkpoints.result, ...progress.result]) }); };
    tx.onerror = () => { open.result.close(); reject(tx.error); };
  };
}));
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
    const lastSave = (await savedTimes(page)).all.at(-1);
    await page.reload(); await ready(page);
    const prompt = page.getByRole('dialog', { name: 'Interrupted session' });
    await expect(prompt).toContainText('saved just now');
    // Opening the recovery is not a new save: the checkpoint written on arrival keeps the time of the last one, so a second reload tells the same age.
    await flush(page);
    expect((await savedTimes(page)).checkpoints).toEqual([lastSave]);
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
    await expect(banner).toContainText('Partner Circuit');
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

  test('leaving a running session for the library pauses it, and the banner offers it there without a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    await page.evaluate(() => { (window as unknown as { __stayed?: boolean }).__stayed = true; window.location.hash = '#/wod/partner-circuit/play'; });
    await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000 + 65_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:25');
    // Back: the same page, no reload.
    await page.goBack();
    const banner = page.getByRole('status', { name: 'Interrupted session' });
    await expect(banner).toContainText('Partner Circuit');
    await expect(banner).toContainText('Saved just now on this device');
    expect(await page.evaluate(() => (window as unknown as { __stayed?: boolean }).__stayed)).toBe(true);
    // It was paused where it stood, so it comes back as a paused session: nothing was lost, nothing to recover.
    await banner.getByRole('link', { name: 'Resume' }).click();
    await ready(page);
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:25');
    await expect(page.getByRole('dialog', { name: 'Interrupted session' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Work');
    // A session that ended leaves nothing to offer.
    await advance(page, 20 * 60_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Pick your next session' })).toBeVisible();
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
