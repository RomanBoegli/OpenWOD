import { expect, test } from './fixtures';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { parsePackFile, serialisePackFile, type WorkoutPack } from '../../packages/domain/src/pack';
import type { Workout } from '../../packages/domain/src/schema';

const shared = (id: string, title: string, sharingId: string, sourceRevision: number): Workout => ({ ...bundledWorkout('fran'), id, revision: 1, title, sharing: { id: sharingId, sourceRevision } });
const packFile = (pack: WorkoutPack, name = 'friends.wods.yaml') => ({ name, mimeType: 'application/yaml', buffer: Buffer.from(serialisePackFile(pack)) });

test.describe('workout packs and provenance', () => {
  test('imports a pack with its collection, recognises it on reimport, and offers a replace for a newer revision', async ({ page, api }) => {
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
    const stored = await api.get<{ workouts: { id: string; origin: string; document: Workout }[] }>('/api/v1/workouts');
    expect(stored.workouts.map(item => [item.id, item.origin, item.document.sharing?.id]).sort()).toEqual([['fran-a', 'imported', 'share-a'], ['fran-b', 'imported', 'share-b']]);
    await expect(page.getByRole('group', { name: 'Collection' })).toContainText('Friends');

    // The same pack again: both are known by provenance and skipped unless asked for another copy.
    await page.locator('input[type=file]').setInputFiles(packFile(pack));
    await expect(rows.first()).toContainText('Already in your library');
    await expect(dialog.getByRole('button', { name: /Import/ })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Action for Fran A' }).selectOption('copy');
    await dialog.getByRole('button', { name: 'Import 1 workout' }).click();
    await expect(page.getByText('Import done: 1 imported, 1 skipped.')).toBeVisible();
    expect((await api.get<{ workouts: { id: string }[] }>('/api/v1/workouts')).workouts.map(item => item.id).sort()).toEqual(['fran-a', 'fran-a-2', 'fran-b']);

    // A newer revision of Fran B from its author: replace the local one, keeping its id.
    const newer: WorkoutPack = { workouts: [{ ...shared('whatever', 'Fran B, revised', 'share-b', 2), description: 'Revised by the author.' }], collections: [] };
    await page.locator('input[type=file]').setInputFiles(packFile(newer, 'fran-b-v2.wods.yaml'));
    await expect(rows.first()).toContainText('Newer version of one you imported');
    await expect(dialog.getByRole('combobox', { name: 'Action for Fran B, revised' })).toHaveValue('replace');
    await dialog.getByRole('button', { name: 'Import 1 workout' }).click();
    await expect(page).toHaveURL(/#\/wod\/fran-b$/);
    const replaced = await api.get<{ revision: number; document: Workout }>('/api/v1/workouts/fran-b');
    expect(replaced.revision).toBe(2);
    expect(replaced.document.title).toBe('Fran B, revised');
    expect(replaced.document.sharing).toEqual({ id: 'share-b', sourceRevision: 2 });
  });

  test('exporting assigns a sharing identity once, and a collection exports as a pack after a preview', async ({ page, api }) => {
    expect((await api.put('/api/v1/workouts/mine', { document: { ...bundledWorkout('cindy'), id: 'mine', revision: 1, title: 'Mine', sharing: undefined } })).status).toBe(201);
    await page.goto('/#/wod/mine');
    const single = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    expect((await single).suggestedFilename()).toBe('mine.wod.yaml');
    const after = await api.get<{ revision: number; document: Workout }>('/api/v1/workouts/mine');
    expect(after.revision).toBe(2);
    expect(after.document.sharing?.sourceRevision).toBe(2);
    const sharingId = after.document.sharing!.id;
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => (await api.get<{ revision: number }>('/api/v1/workouts/mine')).revision).toBe(2);

    await page.goto('/#/settings/collections');
    await page.getByRole('button', { name: 'Export collection Benchmarks' }).click();
    const preview = page.getByRole('dialog', { name: /Export “Benchmarks” as a pack/ });
    await expect(preview).toContainText('Fran');
    await expect(preview).toContainText('by CrossFit');
    const download = page.waitForEvent('download');
    await preview.getByRole('button', { name: /Export \d+ workouts/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('benchmarks.wods.yaml');
    const pack = parsePackFile(await (await import('node:fs/promises')).readFile(await file.path() as string, 'utf8'));
    expect(pack.title).toBe('Benchmarks');
    expect(pack.collections).toEqual([{ title: 'Benchmarks', workoutIds: pack.workouts.map(workout => workout.id) }]);
    expect(pack.workouts.find(workout => workout.id === 'fran')?.sharing).toEqual({ id: 'openwod.bundled:fran', sourceRevision: 1 });
    expect(sharingId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
