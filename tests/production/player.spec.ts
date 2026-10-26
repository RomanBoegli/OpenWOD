import { expect, test } from '@playwright/test';
import type { WorkoutFile } from '../../packages/domain/src';

test('the production container plays a real interval without test injection', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => typeof window.__wodvaTest)).toBe('undefined');
  await page.getByRole('button', { name: 'Player settings' }).click();
  await page.getByRole('combobox', { name: 'Sound', exact: true }).selectOption('silent');
  await page.getByRole('button', { name: 'Close settings' }).click();
  const file: WorkoutFile = { format: 'wodva.workout', formatVersion: 1, workout: {
    schemaVersion: 1, revision: 1, id: 'production-smoke', title: 'Production timing check', participants: 2, prepMs: 0, equipment: [],
    sections: [{ id: 'section', title: 'Smoke check', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: 'movement', type: 'timed', durationMs: 1000, assignments: { A: { name: 'Air squats' }, B: { name: 'March in place' } } } }],
  } };
  await page.locator('input[type=file]').setInputFiles({ name: 'production.wod.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('button', { name: 'Load workout' }).click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Workout complete', { timeout: 5000 });
  await expect(page.getByTestId('primary-timer')).toHaveText('00:01');
  expect(await page.evaluate(() => typeof window.__wodvaTest)).toBe('undefined');
});
