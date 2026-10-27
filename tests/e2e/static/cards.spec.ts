import { expect, test } from '../fixtures';

// Chips on a card state what holds for the whole workout; formats belong to blocks and show on the workout page.
test('a card shows athletes, collection, difficulty and when it was last done, and formats sit on the blocks', async ({ page }) => {
  await page.goto('./#/');
  const card = page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Karen', exact: true }) });
  await expect(card).toContainText('Solo');
  await expect(card).toContainText('Benchmarks');
  await expect(card.getByLabel(/^Projected difficulty/)).toBeVisible();
  await expect(card).not.toContainText('Wall-ball shots for time');
  await expect(card).not.toContainText(/\bFor time\b/);
  await expect(card).not.toContainText('Not done yet');
  await expect(card).toContainText('Duration');

  await page.goto('./#/wod/karen/play');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await page.evaluate(() => window.__openwodTest!.advance(1_000_000));
  await page.goto('./#/');
  await expect(card).toContainText('today');

  await page.goto('./#/wod/karen');
  await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').first()).toContainText('For time');

  await page.goto('./#/');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('group', { name: 'Block format' }).getByRole('button', { name: 'EMOM' }).click();
  await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('heading', { name: 'Karen', exact: true })).toHaveCount(0);
});
