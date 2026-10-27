import { expect, test } from './fixtures';
import { ready } from './helpers';

test.describe('editor', () => {
  test('builds a pair circuit with live totals, saves it to the library, and plays it to completion', async ({ page }) => {
    await page.goto('/#/new');
    const save = page.getByRole('button', { name: 'Save to library' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Give the workout a title.');
    await page.getByLabel('Title', { exact: true }).fill('Garage pair');
    await page.getByLabel('Section 1 slot 1 athlete A', { exact: true }).fill('Row');
    await page.getByLabel('Section 1 slot 1 athlete B', { exact: true }).fill('Swings');
    await page.getByRole('button', { name: 'Add slot' }).click();
    await page.getByLabel('Section 1 slot 2 athlete A', { exact: true }).fill('Burpees');
    await page.getByLabel('Section 1 slot 2 athlete B', { exact: true }).fill('Squats');
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
    await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem').first()).toContainText('Rounds 1–2 of 2');
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

  test('duplicates a bundled workout into an editable copy and explains structures it cannot edit', async ({ page }) => {
    await page.goto('/#/wod/partner-circuit');
    await page.getByRole('link', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/#\/wod\/partner-circuit\/copy$/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Copy of Partner circuit');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('19:50');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/copy-of-partner-circuit$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Copy of Partner circuit');
    await page.goto('/#/wod/hyrox-doubles-circuit/edit');
    await expect(page.getByRole('status')).toContainText('cannot change yet');
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
    await page.getByLabel('Section 1 format').selectOption('amrap');
    await page.getByLabel('Time cap').fill('12:00');
    await page.getByLabel('Section 1 movement 1', { exact: true }).fill('Kettlebell swings');
    await page.getByLabel('Section 1 movement 1 target kind').selectOption('reps');
    await page.getByLabel('Section 1 movement 1 target amount').fill('15');
    await page.getByLabel('Section 1 movement 1 load unit').selectOption('kg');
    await page.getByLabel('Section 1 movement 1', { exact: true }).locator('../..').getByRole('checkbox', { name: 'Levels' }).check();
    await page.getByLabel('Section 1 movement 1 heavy load').fill('24');
    await page.getByRole('button', { name: 'Add movement' }).click();
    await page.getByLabel('Section 1 movement 2', { exact: true }).fill('Burpees');
    await page.getByLabel('Section 1 movement 2 target kind').selectOption('reps');
    await page.getByLabel('Section 1 movement 2 target amount').fill('10');
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
