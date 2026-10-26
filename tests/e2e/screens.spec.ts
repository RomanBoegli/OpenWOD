import type { Page } from '@playwright/test';
import { test } from './fixtures';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { serialisePackFile } from '../../packages/domain/src/pack';
/** Screenshot pass for the visual review; runs only when SCREENS=1. */
const OUT = process.env.SCREENS_DIR ?? 'test-results/screens';
const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__openwodTest));
const advance = (page: Page, ms: number) => page.evaluate(ms => window.__openwodTest!.advance(ms), ms);
const shots: [string, (page: Page) => Promise<void>][] = [
  ['library', async page => { await page.goto('/'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['overview-cindy', async page => { await page.goto('/#/wod/cindy'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['overview-fran', async page => { await page.goto('/#/wod/fran'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['editor-fran', async page => { await page.goto('/#/wod/fran/edit'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['settings-movements', async page => { await page.goto('/#/settings/movements'); await page.getByRole('heading', { level: 1 }).waitFor(); await page.getByRole('searchbox', { name: 'Find movements' }).fill('clean'); }],
  ['settings-general', async page => { await page.goto('/#/settings'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['settings-player', async page => { await page.goto('/#/settings/player'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['settings-equipment', async page => { await page.goto('/#/settings/equipment'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['settings-collections', async page => { await page.goto('/#/settings/collections'); await page.getByRole('heading', { level: 1 }).waitFor(); }],
  ['settings-movement-form', async page => { await page.goto('/#/settings/movements'); await page.getByRole('heading', { level: 1 }).waitFor(); await page.getByRole('button', { name: 'New movement' }).click(); await page.getByRole('dialog', { name: 'New movement' }).waitFor(); }],
  ['editor-picker', async page => { await page.goto('/#/new'); await page.getByRole('heading', { level: 1 }).waitFor(); await page.getByRole('combobox', { name: 'Section 1 slot 1 athlete A', exact: true }).fill('clea'); await page.getByRole('combobox', { name: 'Section 1 slot 1 athlete B', exact: true }).fill('Pogo hops'); await page.getByRole('combobox', { name: 'Section 1 slot 1 athlete A', exact: true }).focus(); }],
  ['ready-fran', async page => { await page.goto('/#/wod/fran/play'); await ready(page); }],
  ['amrap', async page => { await page.goto('/#/wod/cindy/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 70_000); await page.getByRole('button', { name: 'Round', exact: true }).click(); }],
  ['emom', async page => { await page.goto('/#/wod/partner-emom-16/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 30_000); await page.getByTestId('done').click(); }],
  ['fortime', async page => { await page.goto('/#/wod/fran/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 15_000); }],
  ['ygig', async page => { await page.goto('/#/wod/you-go-i-go-sprints/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 40_000); await page.getByTestId('switch').click(); }],
  ['strength', async page => { await page.goto('/#/wod/back-squat-5x5/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 20_000); }],
  ['history', async page => { await page.goto('/#/wod/cindy/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 10_000); await page.getByRole('button', { name: 'Round', exact: true }).click(); await advance(page, 1_200_000); await page.getByRole('status').filter({ hasText: 'Workout complete' }).waitFor(); await page.goto('/#/history'); await page.getByRole('list', { name: 'Sessions' }).waitFor(); }],
  ['recovery', async page => { await page.goto('/#/wod/partner-circuit/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 75_000); await page.evaluate(() => window.__openwodTest!.flushCheckpoints()); await page.reload(); await page.getByRole('dialog', { name: 'Interrupted session' }).waitFor(); }],
  ['import-preview', async page => { await page.goto('/'); await page.getByRole('heading', { level: 1 }).waitFor(); await page.locator('input[type=file]').setInputFiles({ name: 'friends.wods.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialisePackFile({ title: 'Friends of Fran', workouts: [{ ...bundledWorkout('fran'), id: 'fran-a', title: 'Fran A', sharing: { id: 'share-a', sourceRevision: 1 } }, bundledWorkout('cindy')], collections: [{ title: 'Friends', workoutIds: ['fran-a', 'cindy'] }] })) }); await page.getByRole('dialog', { name: 'Preview your WOD' }).waitFor(); }],
  ['complete', async page => { await page.goto('/#/wod/cindy/play'); await ready(page); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await advance(page, 10_000); await page.getByRole('button', { name: 'Round', exact: true }).click(); await advance(page, 1_200_000); }],
];
test.skip(!process.env.SCREENS, 'screenshot pass only');
for (const [name, go] of shots) for (const theme of ['dark', 'light'] as const) for (const [w, h] of [[1024, 768], [390, 844]] as const) {
  test(`${name} ${theme} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: theme });
    page.on('dialog', dialog => void dialog.accept());
    await go(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-${w}.png`, fullPage: w > 400 });
  });
}
