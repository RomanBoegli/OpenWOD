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
    await second.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(second.getByRole('status')).toHaveText('Work');
    await expect(second.getByTestId('movement-A')).toHaveText('Row');
    await second.close();
  });
});
