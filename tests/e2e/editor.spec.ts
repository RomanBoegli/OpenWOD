import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { advance, fact, ready } from './helpers';
import { serialiseWorkoutFile, type Workout, type WorkoutNode } from '../../packages/domain/src';

/** Deletes a field's text one Backspace at a time from its end, as on a phone, so every text on the way reaches the form. */
const erase = async (field: Locator) => {
  await field.focus();
  const length = await field.evaluate((node: HTMLInputElement) => { node.setSelectionRange(node.value.length, node.value.length); return node.value.length; });
  for (let i = 0; i < length; i++) await field.press('Backspace');
};
/** Names a movement and closes the suggestions, which open on every change of the text and may cover what is clicked next. */
const typeMovement = async (field: Locator, text: string) => { await field.fill(text); await field.press('Escape'); };
/** Whether a mousedown on the element is cancelled. iOS sends one with its synthetic click, and it moves the focus unless it is. */
const keepsFocus = (option: Locator) => option.evaluate(node => !node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));

test.describe('editor', () => {
  test('builds a pair circuit with live totals, saves it to the library, and plays it to completion', async ({ page }) => {
    await page.goto('/#/new');
    const save = page.getByRole('button', { name: 'Save to library' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Give the workout a title.');
    await page.getByLabel('Title', { exact: true }).fill('Garage pair');
    await page.getByLabel('Block 1 movement 1 athlete A', { exact: true }).fill('Row');
    await typeMovement(page.getByLabel('Block 1 movement 1 athlete B', { exact: true }), 'Swings');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await page.getByLabel('Block 1 movement 2 athlete A', { exact: true }).fill('Burpees');
    await typeMovement(page.getByLabel('Block 1 movement 2 athlete B', { exact: true }), 'Squats');
    await page.locator('#s0-slot1-duration').fill('0:30');
    await page.getByLabel('Rounds').fill('2');
    await page.getByLabel('Rest between rounds').fill('1:00');
    const summary = page.getByRole('complementary', { name: 'Summary' });
    // The same three times as the workout's page, without the prep countdown: total is active plus rest.
    await expect(summary.locator('dl').first().locator('dt')).toHaveText(['Total time', 'Active time', 'Rest time']);
    await expect(fact(summary, 'Total time')).toHaveText('03:40');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/#\/wod\/garage-pair$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage pair');
    await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').first()).toContainText('Rounds 1–2 of 2');
    await page.getByRole('link', { name: 'Start workout' }).click();
    await ready(page);
    await expect(page.getByRole('status')).toHaveText('Get ready');
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
    await typeMovement(page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true }), 'Air Squats');
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
    // 190 s of work and eight 10 s rests on the clock, and the open-ended rest of the For time block on top: hence the plus.
    await expect(fact(summary, 'Total time')).toHaveText('04:30+');
    await expect(fact(summary, 'Active time')).toHaveText('03:10+');
    await expect(fact(summary, 'Rest time')).toHaveText('01:20');
    await expect(page.getByLabel('Block 1 rest 2', { exact: true })).toHaveValue('00:10');
    await expect(page.getByLabel('Block 2 movement 2 work', { exact: true })).toHaveValue('timed');
    await page.getByLabel('Block 1 rest 4', { exact: true }).fill('0:15');
    await expect(summary).toContainText('04:50');
    await expect(fact(summary, 'Active time')).toHaveText('03:10+');
    await expect(fact(summary, 'Rest time')).toHaveText('01:40');
    const cardio = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').nth(1);
    await cardio.getByRole('button', { name: 'Add group', exact: true }).click();
    await typeMovement(page.getByLabel('Block 2 group 3 movement 1', { exact: true }), 'Air Squats');
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
    await typeMovement(page.getByLabel('Block 1 movement 1', { exact: true }), 'Kettlebell Swings');
    await page.getByLabel('Block 1 movement 1 target kind').selectOption('reps');
    await page.getByLabel('Block 1 movement 1 target amount').fill('15');
    await page.getByLabel('Block 1 movement 1 load unit').selectOption('kg');
    await page.getByLabel('Block 1 movement 1', { exact: true }).locator('../..').getByRole('checkbox', { name: 'Levels' }).check();
    await page.getByLabel('Block 1 movement 1 heavy load').fill('24');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await typeMovement(page.getByLabel('Block 1 movement 2', { exact: true }), 'Burpees');
    await page.getByLabel('Block 1 movement 2 target kind').selectOption('reps');
    await page.getByLabel('Block 1 movement 2 target amount').fill('10');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('Cap 12:00');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Garage AMRAP' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('AMRAP');
    await expect(page.getByRole('main')).toContainText('24 kg');
    await page.getByRole('link', { name: 'Start workout' }).click(); await ready(page);
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('list', { name: 'AMRAP block' })).toContainText('24 kg');
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('1');
    await page.evaluate(() => window.__openwodTest!.advance(720_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
  });
});

test.describe('editor fields', () => {
  test('a target keeps its kind and its field while the amount is retyped, takes decimals, and saves them', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Run and Row');
    await page.getByRole('radio', { name: 'Solo' }).check();
    await page.getByLabel('Block 1 format').selectOption('forTime');
    await typeMovement(page.getByLabel('Block 1 movement 1', { exact: true }), 'Run');
    const kind = page.getByLabel('Block 1 movement 1 target kind');
    const amount = page.getByLabel('Block 1 movement 1 target amount');
    await kind.selectOption('m');
    await expect(amount).toHaveValue('10');
    await erase(amount);
    await expect(amount).toHaveValue('');
    await expect(kind).toHaveValue('m');
    await expect(amount).toBeFocused();
    await amount.pressSequentially('25');
    await expect(kind).toHaveValue('m');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await typeMovement(page.getByLabel('Block 1 movement 2', { exact: true }), 'Row');
    await page.getByLabel('Block 1 movement 2 target kind').selectOption('km');
    const far = page.getByLabel('Block 1 movement 2 target amount');
    await erase(far);
    await far.pressSequentially('1.5');
    await expect(far).toHaveValue('1.5');
    // A comma keypad types the same number.
    await erase(far);
    await far.pressSequentially('1,5');
    await expect(far).toHaveValue('1.5');
    await expect(page.getByLabel('Block 1 movement 2 target kind')).toHaveValue('km');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/run-and-row$/);
    await expect(page.getByRole('main')).toContainText('25 m');
    await expect(page.getByRole('main')).toContainText('1.5 km');
  });

  test('clearing a load amount keeps the load, and an emptied rounds field reads empty, not 0', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByRole('radio', { name: 'Solo' }).check();
    await typeMovement(page.getByLabel('Block 1 movement 1', { exact: true }), 'Kettlebell Swings');
    const unit = page.getByLabel('Block 1 movement 1 load unit');
    const load = page.getByLabel('Block 1 movement 1 load', { exact: true });
    await unit.selectOption('kg');
    await expect(load).toHaveValue('20');
    await erase(load);
    await expect(load).toHaveValue('');
    await expect(load).toBeFocused();
    await expect(unit).toHaveValue('kg');
    await expect(page.getByRole('group', { name: 'Block 1 movement 1 loads' })).toBeVisible();
    await load.pressSequentially('22.5');
    await page.getByLabel('Block 1 movement 1 women’s load', { exact: true }).fill('15');
    await load.fill('24');
    await expect(page.getByLabel('Block 1 movement 1 women’s load', { exact: true })).toHaveValue('15');
    const rounds = page.getByLabel('Block 1 rounds', { exact: true });
    await erase(rounds);
    await expect(rounds).toHaveValue('');
    await expect(rounds).toBeFocused();
    await rounds.pressSequentially('3');
    await expect(page.getByLabel('Rest between rounds')).toBeVisible();
    // Left empty, the field shows the rounds the workout still has.
    await erase(rounds);
    await rounds.blur();
    await expect(rounds).toHaveValue('3');
  });

  test('the women’s loads of a bundled workout survive an edit of the men’s, a change of unit and the Levels switch', async ({ page }) => {
    await page.goto('/#/wod/pull-carry-burpee-ladder');
    await page.getByRole('link', { name: 'Duplicate' }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Copy of Pull, Carry, Burpee Ladder');
    const men = page.getByLabel('Block 1 movement 2 medium load', { exact: true });
    const women = page.getByLabel('Block 1 movement 2 medium women’s load', { exact: true });
    await expect(men).toHaveValue('17.5');
    await expect(women).toHaveValue('12.5');
    await men.fill('20');
    await expect(women).toHaveValue('12.5');
    // On a phone the number is deleted first: the emptied level takes its women's amount back with the new number.
    await erase(men);
    await expect(men).toHaveValue('');
    await expect(women).toBeDisabled();
    await men.pressSequentially('22.5');
    await expect(women).toHaveValue('12.5');
    await page.getByLabel('Block 1 movement 2 load unit').selectOption('lb');
    await expect(women).toHaveValue('12.5');
    await expect(page.getByLabel('Block 1 movement 2 heavy women’s load', { exact: true })).toHaveValue('15');
    await page.getByLabel('Block 1 movement 2', { exact: true }).locator('../..').getByRole('checkbox', { name: 'Levels' }).uncheck();
    await expect(page.getByLabel('Block 1 movement 2 load', { exact: true })).toHaveValue('22.5');
    await expect(page.getByLabel('Block 1 movement 2 women’s load', { exact: true })).toHaveValue('12.5');
    await page.getByLabel('Block 1 movement 2 load unit').selectOption('percent');
    await expect(page.getByLabel('Block 1 movement 2 women’s load', { exact: true })).toHaveCount(0);
  });

  test('Solo hides athlete B without deleting the lane, and Pair brings it back', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Block 1 movement 1 athlete A', { exact: true }).fill('Row');
    const partner = page.getByLabel('Block 1 movement 1 athlete B', { exact: true });
    await partner.fill('thru');
    await page.getByRole('listbox', { name: 'Movements matching thru' }).getByRole('option').first().click();
    await expect(partner).toHaveValue('Thrusters');
    await page.getByLabel('Block 1 movement 1 athlete B target kind').selectOption('reps');
    await page.getByLabel('Block 1 movement 1 athlete B target amount').fill('15');
    const needs = page.getByRole('group', { name: 'Equipment needed' });
    await expect(needs).toContainText('Barbell');
    await page.getByRole('radio', { name: 'Solo' }).check();
    await expect(partner).toHaveCount(0);
    await expect(page.getByLabel('Block 1 movement 1', { exact: true })).toHaveValue('Row');
    await expect(needs).not.toContainText('Barbell');
    await page.getByRole('radio', { name: 'Pair' }).check();
    await expect(partner).toHaveValue('Thrusters');
    await expect(page.getByLabel('Block 1 movement 1 athlete B target amount')).toHaveValue('15');
    await expect(needs).toContainText('Barbell');
  });

  test('the rest at the end of the workout stays while it is retyped or left empty', async ({ page }) => {
    const workout: Workout = { schemaVersion: 2, id: 'plank-and-rest', revision: 1, title: 'Plank and Rest', equipment: [], participants: 1, prepMs: 10_000, sections: [
      { id: 'main', title: 'Main', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: 'body', type: 'sequence', children: [{ id: 'plank', type: 'timed', durationMs: 60_000, assignments: { A: { name: 'Plank' } } }, { id: 'rest', type: 'rest', durationMs: 90_000, kind: 'blockRest' }] } },
    ] };
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'plank-and-rest.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile(workout)) });
    await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Save and edit' }).click();
    await expect(page).toHaveURL(/#\/wod\/plank-and-rest\/edit$/);
    const rest = page.getByLabel('Rest at the end of the workout');
    const summary = page.getByRole('complementary', { name: 'Summary' });
    await expect(rest).toHaveValue('01:30');
    await expect(summary).toContainText('02:30');
    await erase(rest);
    await expect(rest).toHaveValue('');
    await expect(rest).toBeFocused();
    await expect(summary).toContainText('01:00');
    await rest.pressSequentially('45');
    await expect(summary).toContainText('01:45');
    await erase(rest);
    await rest.blur();
    await expect(rest).toHaveValue('');
    await expect(rest).toBeVisible();
  });

  test('an edit made just before leaving the editor is kept in the draft, and a saved draft does not come back', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Quick Exit');
    // Well inside the half second the autosave waits.
    await page.getByRole('link', { name: 'YOUR LIBRARY', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Drafts' })).toContainText('Quick Exit');
    await page.goto('/#/new');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Quick Exit');
    await page.getByLabel('Block 1 movement 1 athlete A', { exact: true }).fill('Burpees');
    await typeMovement(page.getByLabel('Block 1 movement 1 athlete B', { exact: true }), 'Air Squats');
    await page.getByLabel('Title', { exact: true }).fill('Quick Save');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/quick-save$/);
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Quick Save');
    await expect(page.getByRole('region', { name: 'Drafts' })).toHaveCount(0);
  });

  test('a save the server refuses says so in the summary and keeps the edits', async ({ page, staticProject }) => {
    test.skip(staticProject, 'Needs the household server.');
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Refused Once');
    await page.getByLabel('Block 1 movement 1 athlete A', { exact: true }).fill('Burpees');
    await typeMovement(page.getByLabel('Block 1 movement 1 athlete B', { exact: true }), 'Air Squats');
    await page.route('**/api/v1/workouts/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_WORKOUT', message: 'Refused for the test.' } }) }) : route.fallback());
    const save = page.getByRole('button', { name: 'Save to library' });
    await save.click();
    const summary = page.getByRole('complementary', { name: 'Summary' });
    await expect(summary.getByRole('alert')).toContainText('The workout was not saved.');
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Refused Once');
    await page.unroute('**/api/v1/workouts/*');
    await save.click();
    await expect(page).toHaveURL(/#\/wod\/refused-once$/);
  });

  test('on a phone every form control is 16 px, so iOS does not zoom the page on focus, and the editor fits the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/#/wod/fran/edit', '/#/wod/full-body-partner/edit', '/', '/#/settings', '/#/settings/player', '/#/settings/movements']) {
      // A fresh document each time: between two routes of the app the old page would still answer.
      await page.goto('about:blank'); await page.goto(path); await page.getByRole('heading', { level: 1 }).waitFor();
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input, select, textarea')]
        .filter(node => !['checkbox', 'radio', 'range', 'color', 'file'].includes(node.getAttribute('type') ?? '') && node.getClientRects().length > 0 && parseFloat(getComputedStyle(node).fontSize) < 16)
        .map(node => node.getAttribute('aria-label') ?? node.outerHTML.slice(0, 80)));
      expect(small, path).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
    }
  });
});

test.describe('pickers', () => {
  test('movement suggestions open without key events, keep the focus when pressed, and a click picks one', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    const author = page.getByRole('combobox', { name: 'Author', exact: true });
    await author.fill('cros');
    const known = page.getByRole('listbox', { name: 'Author suggestions' }).getByRole('option', { name: 'CrossFit' });
    expect(await keepsFocus(known)).toBe(true);
    await known.click();
    await expect(author).toHaveValue('CrossFit');
    await expect(author).toBeFocused();
    const lane = page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true });
    // No key events, as from an Android keyboard, dictation or a paste.
    await lane.fill('thru');
    const options = page.getByRole('listbox', { name: 'Movements matching thru' });
    const option = options.getByRole('option').first();
    await expect(option).toContainText('Thrusters');
    expect(await keepsFocus(option)).toBe(true);
    await option.click();
    await expect(lane).toHaveValue('Thrusters');
    await expect(lane).toBeFocused();
    await expect(options).toHaveCount(0);
  });

  test('a retyped movement drops the short name of the one picked before, in the player too', async ({ page }) => {
    await page.goto('/#/new'); await page.getByRole('heading', { level: 1, name: 'Build a workout' }).waitFor();
    await page.getByLabel('Title', { exact: true }).fill('Retyped Name');
    await page.getByRole('radio', { name: 'Solo' }).check();
    const lane = page.getByRole('combobox', { name: 'Block 1 movement 1', exact: true });
    await lane.fill('dumbbell romanian');
    await page.getByRole('listbox', { name: 'Movements matching dumbbell romanian' }).getByRole('option', { name: /^Dumbbell Romanian Deadlifts/ }).click();
    await expect(lane).toHaveValue('Dumbbell Romanian Deadlifts');
    await typeMovement(lane, 'Burpees');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/retyped-name$/);
    await page.goto('/#/wod/retyped-name/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByTestId('movement-A')).toHaveText('Burpees');
  });

  test('an equipment list takes a clicked suggestion and a comma typed as text, closes after each, and drops a chip on a click only', async ({ page }) => {
    await page.goto('/#/settings/movements'); await page.getByRole('heading', { level: 1 }).waitFor();
    await page.getByRole('button', { name: 'New movement' }).click();
    const form = page.getByRole('dialog', { name: 'New movement' });
    const equipment = form.getByRole('combobox', { name: 'Equipment' });
    const chips = form.getByRole('group', { name: 'Equipment', exact: true }).getByRole('button', { name: /^Remove / });
    await equipment.fill('row');
    const option = form.getByRole('listbox', { name: 'Equipment suggestions' }).getByRole('option').first();
    await expect(option).toHaveText('Rowing machine');
    expect(await keepsFocus(option)).toBe(true);
    await option.click();
    await expect(chips).toHaveCount(1);
    await expect(equipment).toBeFocused();
    // The list is closed, so another Enter adds nothing.
    await expect(form.getByRole('listbox')).toHaveCount(0);
    await equipment.press('Enter');
    await expect(chips).toHaveCount(1);
    // A comma that arrives as text, as from an Android keyboard, takes the best match like the comma key.
    await equipment.fill('barb,');
    await expect(form.getByRole('button', { name: 'Remove Barbell' })).toBeVisible();
    await expect(equipment).toHaveValue('');
    // A press that turns into a scroll is no click, and the chip stays.
    await form.getByRole('button', { name: 'Remove Barbell' }).dispatchEvent('pointerdown');
    await expect(chips).toHaveCount(2);
    await form.getByRole('button', { name: 'Remove Barbell' }).click();
    await expect(chips).toHaveCount(1);
    await expect(form.getByRole('button', { name: 'Remove Rowing machine' })).toBeVisible();
  });
});
