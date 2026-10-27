import { expect, test } from '../fixtures';

// The static site has no server and uploads nothing; its pages must not talk as if it did.
const SERVER_WORDING = /household server|\bservers?\b|upload/i;

test.describe('static wording', () => {
  for (const [name, path, heading] of [['library', '/', /./], ['Settings → General', '/#/settings/general', /./], ['History', '/#/history', 'What you have done']] as const) {
    test(`${name} never mentions a server or an upload`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      if (path === '/#/settings/general') await expect(page.getByRole('region', { name: 'This browser' })).toBeVisible();
      if (path === '/') await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').first()).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(SERVER_WORDING);
    });
  }
});
