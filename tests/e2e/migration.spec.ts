import { expect, test } from './fixtures';
import { bundledWorkout } from '../../packages/domain/src/bundled';

const legacyWorkout = { ...bundledWorkout('fran'), id: 'my-fran', title: 'My Fran', sharing: undefined };
const collidingWorkout = { ...bundledWorkout('cindy'), id: 'cindy', title: 'My Cindy', sharing: undefined };
const legacySession = { id: 'old-session', workoutId: 'my-fran', title: 'My Fran', startedAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T10:08:00.000Z', outcome: 'completed', completion: 1, activeMs: 480_000, results: [] };
const legacyMaster = { equipmentAliases: { 'kettle bell': 'Kettlebell' }, collections: [{ id: 'mine', title: 'Mine', workoutIds: ['my-fran', 'cindy'] }], collectionEdits: {}, movements: [], hiddenMovements: [], movementAliases: {}, committed: [] };

test.describe('moving a device library to the server', () => {
  test('offers the pre-1.0 data once, moves it with collisions renamed, and clears the browser copies', async ({ page, context, api }) => {
    await context.addInitScript(([workouts, sessions, master]) => {
      if (!localStorage.getItem('openwod.migrated.marker')) {
        localStorage.setItem('openwod.library.v1', workouts);
        localStorage.setItem('openwod.sessions.v1', sessions);
        localStorage.setItem('openwod.master.v1', master);
        localStorage.setItem('openwod.migrated.marker', '1');
      }
    }, [JSON.stringify([legacyWorkout, collidingWorkout]), JSON.stringify([legacySession]), JSON.stringify(legacyMaster)]);
    await page.goto('/');
    const banner = page.getByRole('status', { name: 'Move device data' });
    await expect(banner).toContainText('2 saved workouts, 1 logged session, your settings');
    await banner.getByRole('button', { name: 'Move to the server' }).click();
    await expect(page.getByText(/Moved 2 workouts and 1 sessions to the server/)).toBeVisible();
    await expect(page.getByText(/cindy became cindy-2/)).toBeVisible();
    const workouts = await api.get<{ workouts: { id: string; document: { title: string } }[] }>('/api/v1/workouts');
    expect(workouts.workouts.map(item => item.id).sort()).toEqual(['cindy-2', 'my-fran']);
    const sessions = await api.get<{ sessions: { id: string; workoutId: string; deviceId: string }[] }>('/api/v1/sessions');
    expect(sessions.sessions).toEqual([expect.objectContaining({ id: 'old-session', workoutId: 'my-fran' })]);
    const master = await api.get<{ document: { collections: { workoutIds: string[] }[]; equipmentAliases: Record<string, string> } }>('/api/v1/master-data');
    expect(master.document.collections[0].workoutIds).toEqual(['my-fran', 'cindy-2']);
    expect(master.document.equipmentAliases).toEqual({ 'kettle bell': 'Kettlebell' });
    expect(await page.evaluate(() => [localStorage.getItem('openwod.library.v1'), localStorage.getItem('openwod.sessions.v1'), localStorage.getItem('openwod.master.v1')])).toEqual([null, null, null]);
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').filter({ hasText: 'My Cindy' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Move device data' })).toHaveCount(0);
  });
});
