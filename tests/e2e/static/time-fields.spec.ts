import { expect, test } from '../fixtures';

test('a time field takes digits and one colon, tidies to mm:ss, and steps with the arrow keys', async ({ page }) => {
  await page.goto('./#/wod/partner-circuit/edit'); await page.getByRole('heading', { level: 1 }).waitFor();
  const field = page.getByLabel('Rest between rounds');
  await field.fill('');
  await field.pressSequentially('1m3x0s');
  await expect(field).toHaveValue('130');
  await field.blur();
  await expect(field).toHaveValue('02:10');
  await field.focus(); await field.press('ArrowUp');
  await expect(field).toHaveValue('02:15');
  await field.press('Shift+ArrowDown');
  await expect(field).toHaveValue('02:00');
});
