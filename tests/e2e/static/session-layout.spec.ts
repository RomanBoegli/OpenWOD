import { expect, test } from '../fixtures';

// The big clock stays in place from slot to slot: a station card of one line or three only moves the gap above Up next.
for (const [width, height] of [[1440, 900], [1180, 820], [820, 1180], [390, 844]] as const) test(`the clock holds its place across slots at ${width} by ${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto('./#/wod/full-body-partner/play');
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  const tops = new Set<number>();
  for (let step = 0; step < 12; step++) {
    await page.evaluate(ms => window.__openwodTest!.advance(ms), step ? 20_000 : 11_000);
    tops.add(await page.getByTestId('primary-timer').evaluate(timer => Math.round(timer.getBoundingClientRect().top)));
  }
  expect([...tops]).toHaveLength(1);
});
