import { expect, test } from './fixtures';
import { advance, PLAYER, ready } from './helpers';

test.describe('one tab per session (ENG-14)', () => {
  test('AT-21: a second tab is read-only until it takes over, and the first tab then stops controlling', async ({ page, context }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 25_000);
    await page.evaluate(() => window.__openwodTest!.flushCheckpoints());
    const second = await context.newPage();
    await second.goto(PLAYER);
    const busy = second.getByRole('region', { name: 'Session in another tab' });
    await expect(busy).toContainText('running in another tab');
    await expect(second.getByRole('button', { name: 'Start workout', exact: true })).toHaveCount(0);
    await busy.getByRole('button', { name: 'Take over here' }).click();
    await ready(second);
    await expect(second.getByRole('status')).toHaveText('Workout paused');
    await expect(page.getByRole('region', { name: 'Taken over' })).toContainText('took over this session');
    await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toHaveCount(0);
    // The first tab is inert: no key resumes its engine, which holds no lock and would overwrite the second tab's checkpoint.
    const status = (tab: typeof page) => tab.evaluate(() => window.__openwodTest!.snapshot().projection.status);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    expect(await status(page)).toBe('paused');
    await second.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(second.getByRole('status')).toHaveText('Work');
    await expect(second.getByTestId('movement-A')).toHaveText('Row');
    await page.keyboard.press('Space');
    expect(await status(page)).toBe('paused');
    expect(await status(second)).toBe('running');
    await second.close();
  });

  test('the library of a second tab calls a session that is live in the first running, and offers no Discard for it', async ({ page, context }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 25_000);
    await page.evaluate(() => window.__openwodTest!.flushCheckpoints());
    const second = await context.newPage();
    await second.goto('/');
    const running = second.getByRole('status', { name: 'Session in another tab' });
    await expect(running).toContainText('Running in another tab');
    await expect(running).toContainText('Partner Circuit');
    await expect(second.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);
    await expect(second.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
    // Opening it there asks before taking over, as the play route always does.
    await running.getByRole('link', { name: 'Open here' }).click();
    await expect(second.getByRole('region', { name: 'Session in another tab' })).toContainText('running in another tab');
    // Once the first tab is gone the session is an interrupted one, and may be discarded.
    await page.close();
    await second.goto('/');
    const interrupted = second.getByRole('status', { name: 'Interrupted session' });
    await expect(interrupted).toContainText('Partner Circuit');
    await interrupted.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(interrupted).toHaveCount(0);
  });
});
