import { expect, test } from '../fixtures';
import { bundledWorkout } from '../../../packages/domain/src/bundled';
import { serialisePackFile, type WorkoutPack } from '../../../packages/domain/src/pack';
import type { Workout } from '../../../packages/domain/src/schema';
import { browserRows, openFilters } from '../helpers';

const shared = (id: string, title: string, sharingId: string, sourceRevision: number): Workout => ({ ...bundledWorkout('fran'), id, revision: 1, title, sharing: { id: sharingId, sourceRevision } });
const packFile = (pack: WorkoutPack, name = 'friends.wods.yaml') => ({ name, mimeType: 'application/yaml', buffer: Buffer.from(serialisePackFile(pack)) });
type Row = { id: string; revision: number; origin: string; document: Workout };
const stored = async (page: Parameters<typeof browserRows>[0]) => (await browserRows<Row>(page, 'workouts')).filter(row => !(row as { archivedAt?: string }).archivedAt);

test.describe('static workout packs', () => {
  test('imports a pack into this browser, recognises it on reimport, and replaces with a newer revision', async ({ page }) => {
    const pack: WorkoutPack = { title: 'Friends of Fran', workouts: [shared('fran-a', 'Fran A', 'share-a', 1), shared('fran-b', 'Fran B', 'share-b', 1)], collections: [{ title: 'Friends', workoutIds: ['fran-a', 'fran-b'] }] };
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(packFile(pack));
    const dialog = page.getByRole('dialog', { name: 'Preview your WOD' });
    await expect(dialog).toContainText('Pack “Friends of Fran” with 2 workouts and 1 collection');
    const rows = dialog.getByRole('list', { name: 'Workouts in the file' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('New');
    await dialog.getByRole('button', { name: 'Import 2 workouts' }).click();
    await expect(page.getByText('Import done: 2 imported, 1 collection created.')).toBeVisible();
    expect((await stored(page)).map(item => [item.id, item.origin, item.document.sharing?.id]).sort()).toEqual([['fran-a', 'imported', 'share-a'], ['fran-b', 'imported', 'share-b']]);
    await openFilters(page);
    await expect(page.getByRole('group', { name: 'Collection' })).toContainText('Friends');

    // After a reload the pack is still known by provenance: skipped unless asked for another copy.
    await page.reload();
    await page.locator('input[type=file]').setInputFiles(packFile(pack));
    await expect(rows.first()).toContainText('Already in your library');
    await expect(dialog.getByRole('button', { name: /Import/ })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Action for Fran A' }).selectOption('copy');
    await dialog.getByRole('button', { name: 'Import 1 workout' }).click();
    await expect(page.getByText('Import done: 1 imported, 1 skipped.')).toBeVisible();
    expect((await stored(page)).map(item => item.id).sort()).toEqual(['fran-a', 'fran-a-2', 'fran-b']);

    // A newer revision of Fran B from its author replaces the local one, keeping its id.
    const newer: WorkoutPack = { workouts: [{ ...shared('whatever', 'Fran B, revised', 'share-b', 2), description: 'Revised by the author.' }], collections: [] };
    await page.locator('input[type=file]').setInputFiles(packFile(newer, 'fran-b-v2.wods.yaml'));
    await expect(rows.first()).toContainText('Newer version of one you imported');
    await expect(dialog.getByRole('combobox', { name: 'Action for Fran B, revised' })).toHaveValue('replace');
    await dialog.getByRole('button', { name: 'Import 1 workout' }).click();
    await expect(page).toHaveURL(/#\/wod\/fran-b$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fran B, revised');
    const replaced = (await stored(page)).find(item => item.id === 'fran-b')!;
    expect(replaced.revision).toBe(2);
    expect(replaced.document.sharing).toEqual({ id: 'share-b', sourceRevision: 2 });
  });
});
