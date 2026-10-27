import { expect, test } from '../fixtures';
import { bundledWorkout } from '../../../packages/domain/src/bundled';
import { browserRows } from '../helpers';

const legacyWorkout = { ...bundledWorkout('fran'), id: 'my-fran', title: 'My Fran', sharing: undefined };
const collidingWorkout = { ...bundledWorkout('cindy'), id: 'cindy', title: 'My Cindy', sharing: undefined };
const legacySession = { id: 'old-session', workoutId: 'my-fran', title: 'My Fran', startedAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T10:08:00.000Z', outcome: 'completed', completion: 1, activeMs: 480_000, results: [] };
const legacyMaster = { equipmentAliases: { 'kettle bell': 'Kettlebell' }, collections: [{ id: 'mine', title: 'Mine', workoutIds: ['my-fran', 'cindy'] }], collectionEdits: {}, movements: [], hiddenMovements: [], movementAliases: {}, committed: [] };

test.describe('static: pre-1.0 data moves into this browser', () => {
  test('the first load moves the localStorage library without asking, says so once, and clears the old keys', async ({ page, context }) => {
    await context.addInitScript(([workouts, sessions, master]) => {
      if (!localStorage.getItem('openwod.migrated.marker')) {
        localStorage.setItem('openwod.library.v1', workouts);
        localStorage.setItem('openwod.sessions.v1', sessions);
        localStorage.setItem('openwod.master.v1', master);
        localStorage.setItem('openwod.migrated.marker', '1');
      }
    }, [JSON.stringify([legacyWorkout, collidingWorkout]), JSON.stringify([legacySession]), JSON.stringify(legacyMaster)]);
    await page.goto('/');
    await expect(page.getByText("Moved 2 workouts and 1 session into this browser's library.")).toBeVisible();
    await expect(page.getByRole('status', { name: 'Move device data' })).toHaveCount(0);
    expect(await page.evaluate(() => [localStorage.getItem('openwod.library.v1'), localStorage.getItem('openwod.sessions.v1'), localStorage.getItem('openwod.master.v1')])).toEqual([null, null, null]);
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem').filter({ hasText: 'My Fran' })).toBeVisible();
    await expect(list.getByRole('listitem').filter({ hasText: 'My Cindy' })).toBeVisible();
    expect((await browserRows<{ id: string }>(page, 'workouts')).map(row => row.id).sort()).toEqual(['cindy-2', 'my-fran']);
    expect((await browserRows<{ id: string }>(page, 'sessions')).map(row => row.id)).toEqual(['old-session']);
    await page.reload();
    await expect(list.getByRole('listitem').filter({ hasText: 'My Cindy' })).toBeVisible();
    await expect(page.getByText(/Moved \d+ workouts?/)).toHaveCount(0);
  });
});
