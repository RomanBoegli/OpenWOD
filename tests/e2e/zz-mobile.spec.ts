import { test } from './fixtures';
const OUT = '/private/tmp/claude-501/-Users-rbo-Documents-GitHub-OpenWOD/f00e5ce1-6bab-4149-a04f-c599e9a9a000/scratchpad/shots';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });
test('phone screens', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('openwod.preferences.v1', JSON.stringify({ progress: 'percent', theme: 'light' })); } });
  await page.goto('/');
  await page.getByRole('list', { name: 'Workouts' }).waitFor();
  await page.screenshot({ path: `${OUT}/library.png` });
  await page.screenshot({ path: `${OUT}/library-full.png`, fullPage: true });
  await page.goto('/#/wod/angie/play');
  await page.getByRole('button', { name: 'Start workout', exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/play.png`, fullPage: true });
  await page.goto('/#/wod/full-body-partner/play');
  await page.getByRole('button', { name: 'Start workout', exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/play-pair.png`, fullPage: true });
});
