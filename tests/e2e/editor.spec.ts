import { expect, test } from './fixtures';
import { ready } from './helpers';
import { serialiseWorkoutFile, type Workout, type WorkoutNode } from '../../packages/domain/src';

test.describe('editor', () => {
  test('builds a pair circuit with live totals, saves it to the library, and plays it to completion', async ({ page }) => {
    await page.goto('/#/new');
    const save = page.getByRole('button', { name: 'Save to library' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Give the workout a title.');
    await page.getByLabel('Title', { exact: true }).fill('Garage pair');
    await page.getByLabel('Block 1 movement 1 athlete A', { exact: true }).fill('Row');
    await page.getByLabel('Block 1 movement 1 athlete B', { exact: true }).fill('Swings');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await page.getByLabel('Block 1 movement 2 athlete A', { exact: true }).fill('Burpees');
    await page.getByLabel('Block 1 movement 2 athlete B', { exact: true }).fill('Squats');
    await page.locator('#s0-slot1-duration').fill('0:30');
    await page.getByLabel('Rounds').fill('2');
    await page.getByLabel('Rest between rounds').fill('1:00');
    const summary = page.getByRole('complementary', { name: 'Summary' });
    await expect(summary).toContainText('03:40');
    await expect(summary).toContainText('03:50');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/#\/wod\/garage-pair$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage pair');
    await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').first()).toContainText('Rounds 1–2 of 2');
    await page.getByRole('link', { name: 'Start workout' }).click();
    await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(230_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('03:40');
    await page.goto('/#/wod/garage-pair/edit');
    await page.locator('#s0-slot0-duration').fill('1:00');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage pair');
    await expect(page.getByRole('definition').filter({ hasText: '04:20' })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Garage pair');
  });

  test('LIB-06: the author field suggests the library’s authors as you type, and nudges a near-duplicate spelling', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Author check');
    const author = page.getByRole('combobox', { name: 'Author', exact: true });
    const suggestions = page.getByRole('listbox', { name: 'Author suggestions' });
    await author.fill('cros');
    await suggestions.getByRole('option', { name: 'CrossFit' }).click();
    await expect(author).toHaveValue('CrossFit');
    await author.fill('Crosfit');
    await expect(suggestions.getByRole('option', { name: /New: “Crosfit”/ })).toContainText('not “CrossFit”?');
    await author.press('Enter'); // The best match is highlighted first.
    await expect(author).toHaveValue('CrossFit');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true }).fill('Burpees');
    await page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true }).fill('Air Squats');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/author-check$/);
    await expect(page.getByRole('main')).toContainText('By CrossFit');
  });

  test('autosaves a draft across reload, lists it in the library, and discards it on request', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Half done');
    await expect(page.getByText(/Draft saved on this device/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half done');
    await page.goto('/');
    const drafts = page.getByRole('region', { name: 'Drafts' });
    await expect(drafts).toContainText('Half done');
    await page.getByRole('button', { name: 'Discard draft Half done' }).click();
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(drafts).toHaveCount(0);
  });

  test('duplicates a bundled workout into an editable copy, and opens one with rests of their own', async ({ page }) => {
    await page.goto('/#/wod/partner-circuit');
    await page.getByRole('link', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/#\/wod\/partner-circuit\/copy$/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Copy of Partner Circuit');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('19:50');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/copy-of-partner-circuit$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Copy of Partner Circuit');
    // BLD-15: the ladder's 1:00 rests between its rungs are rows of their own.
    await page.goto('/#/wod/pull-and-press-ladder');
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Block 1 rest 4', { exact: true })).toHaveValue('01:00');
    await expect(page.getByLabel('Block 1 rest 8', { exact: true })).toHaveValue('01:00');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  test('BLD-15: edits an imported workout with rests of its own, a timed movement and a group, and saves them', async ({ page }) => {
    const timed = (id: string, name: string, durationMs: number): WorkoutNode => ({ id, type: 'timed', durationMs, assignments: { A: { name } } });
    const rest = (id: string): WorkoutNode => ({ id, type: 'rest', durationMs: 10_000, kind: 'transition' });
    const workout: Workout = { schemaVersion: 2, id: 'fatburn', revision: 1, title: 'Fatburn', equipment: [], participants: 1, prepMs: 10_000, sections: [
      { id: 'tabata', title: 'Tabata', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: 'rounds', type: 'repeat', count: 4, body: { id: 'list', type: 'sequence', children: [timed('burpees', 'Burpees', 20_000), rest('rest-1'), timed('knees', 'High Knees', 20_000), rest('rest-2')] } } },
      { id: 'cardio', title: 'Cardio', format: 'forTime', transitionAfter: 'manualReady', body: { id: 'cardio-list', type: 'sequence', children: [{ id: 'push-ups', type: 'task', assignments: { A: { name: 'Push-Ups', reps: 10 } } }, timed('stretch', 'Stretch of Choice', 30_000)] } },
    ] };
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'fatburn.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile(workout)) });
    await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Save and edit' }).click();
    await expect(page).toHaveURL(/#\/wod\/fatburn\/edit$/);
    const summary = page.getByRole('complementary', { name: 'Summary' });
    // Four rounds of 20 s, 10 s, 20 s and 10 s, and the 30 s stretch on the clock.
    await expect(summary).toContainText('04:30');
    await expect(page.getByLabel('Block 1 rest 2', { exact: true })).toHaveValue('00:10');
    await expect(page.getByLabel('Block 2 movement 2 work', { exact: true })).toHaveValue('timed');
    await page.getByLabel('Block 1 rest 4', { exact: true }).fill('0:15');
    await expect(summary).toContainText('04:50');
    const cardio = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').nth(1);
    await cardio.getByRole('button', { name: 'Add group', exact: true }).click();
    await page.getByLabel('Block 2 group 3 movement 1', { exact: true }).fill('Air Squats');
    await page.getByLabel('Block 2 group 3 movement 1 work', { exact: true }).selectOption('timed');
    await page.locator('#s1-2-slot0-duration').fill('0:20');
    // Two rounds of a 20 s movement put 40 s more on the clock.
    await expect(summary).toContainText('05:30');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/#\/wod\/fatburn$/);
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Duplicate' })).toBeVisible();
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Block 2 group 3 rounds', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('Block 1 rest 4', { exact: true })).toHaveValue('00:15');
  });

  test('edits a bundled workout in place, removes it, and restores it with the edits from settings', async ({ page }) => {
    await page.goto('/#/wod/cindy');
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(/#\/wod\/cindy\/edit$/);
    await page.getByLabel('Title', { exact: true }).fill('Cindy at home');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/#\/wod\/cindy$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cindy at home');
    await page.goto('/');
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('heading', { name: 'Cindy at home', exact: true })).toHaveCount(1);
    await expect(list.getByRole('heading', { name: 'Cindy', exact: true })).toHaveCount(0);
    await page.goto('/#/wod/cindy');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove “Cindy at home”?' });
    await expect(confirm).toContainText('Settings → Collections');
    await confirm.getByRole('button', { name: 'Remove workout' }).click();
    await expect(list.getByRole('heading', { name: 'Cindy at home', exact: true })).toHaveCount(0);
    await page.goto('/#/settings/collections');
    await page.getByRole('button', { name: 'Restore Cindy' }).click();
    await expect(page.getByRole('region', { name: 'Removed workouts' })).toHaveCount(0);
    await page.goto('/');
    await expect(list.getByRole('heading', { name: 'Cindy at home', exact: true })).toHaveCount(1);
  });
});

test.describe('editor formats', () => {
  test('builds an AMRAP with targets and levelled loads, saves it, and plays it with the counter', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Garage AMRAP');
    await page.getByRole('radio', { name: 'Solo' }).check();
    await page.getByLabel('Block 1 format').selectOption('amrap');
    await page.getByLabel('Time cap').fill('12:00');
    await page.getByLabel('Block 1 movement 1', { exact: true }).fill('Kettlebell Swings');
    await page.getByLabel('Block 1 movement 1 target kind').selectOption('reps');
    await page.getByLabel('Block 1 movement 1 target amount').fill('15');
    await page.getByLabel('Block 1 movement 1 load unit').selectOption('kg');
    await page.getByLabel('Block 1 movement 1', { exact: true }).locator('../..').getByRole('checkbox', { name: 'Levels' }).check();
    await page.getByLabel('Block 1 movement 1 heavy load').fill('24');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await page.getByLabel('Block 1 movement 2', { exact: true }).fill('Burpees');
    await page.getByLabel('Block 1 movement 2 target kind').selectOption('reps');
    await page.getByLabel('Block 1 movement 2 target amount').fill('10');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('Cap 12:00');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Garage AMRAP' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('AMRAP');
    await expect(page.getByRole('main')).toContainText('24 kg');
    await page.getByRole('link', { name: 'Start workout' }).click(); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('list', { name: 'AMRAP block' })).toContainText('24 kg');
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('1');
    await page.evaluate(() => window.__openwodTest!.advance(720_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
  });
});
