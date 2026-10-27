import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { serialiseWorkoutFile } from '../../packages/domain/src';

/**
 * Every URL is relative to the base URL (which the config ends with a slash), so the same specs check the server
 * container at / and the static site under any prefix. OPENWOD_PRODUCTION_MODE says which shape is under test.
 */
const MODE = process.env.OPENWOD_PRODUCTION_MODE === 'static' ? 'static' : 'server';
const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const expectFooterVersion = (page: Page) => expect(page.locator('footer').getByRole('link', { name: `v${VERSION}`, exact: true })).toBeVisible();

test('the production container plays a real interval without test injection', async ({ page, browserName }) => {
  // Three engines share one real server, so each imports its own workout.
  const id = `production-smoke-${browserName}`;
  const title = `Production timing check ${browserName}`;
  await page.goto('./');
  expect(await page.evaluate(() => typeof window.__openwodTest)).toBe('undefined');
  await page.goto('./#/settings/sound');
  await page.getByRole('combobox', { name: 'Sound', exact: true }).selectOption('silent');
  await page.goto('./');
  const file = serialiseWorkoutFile({
    schemaVersion: 2, revision: 1, id, title, participants: 2, prepMs: 0, equipment: [],
    sections: [{ id: 'section', title: 'Smoke check', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: 'movement', type: 'timed', durationMs: 1000, assignments: { A: { name: 'Air squats' }, B: { name: 'March in place' } } } }],
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'production.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(file) });
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page).toHaveURL(new RegExp(`#/wod/${id}(-\\d+)?$`));
  await page.goto('./');
  await page.getByRole('link', { name: `Start ${title}` }).first().click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Workout complete', { timeout: 5000 });
  await expect(page.getByTestId('primary-timer')).toHaveText('00:01');
  expect(await page.evaluate(() => typeof window.__openwodTest)).toBe('undefined');
});

test('the production container ships the recorded cue packs', async ({ page, request }) => {
  const packs = await request.get('./cues/packs.json');
  expect(packs.ok()).toBe(true);
  const list = (await packs.json()) as { id: string; label: string }[];
  expect(list.map(pack => pack.id)).toEqual(['british', 'american', 'scottish', 'northern', 'american-male']);
  for (const pack of list) expect((pack as { names?: number }).names, `${pack.id} names`).toBeGreaterThan(150);
  const name = await request.get('./cues/british/names/row.mp3');
  expect(name.ok()).toBe(true);
  for (const pack of list) {
    const clip = await request.get(`./cues/${pack.id}/go.mp3`);
    expect(clip.ok(), `${pack.id}/go.mp3`).toBe(true);
    expect(clip.headers()['content-type']).toContain('audio/mpeg');
  }
  // One clip must decode in the real browser: this is what the player plays at Go.
  await page.goto('./');
  const durationSeconds = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const audio = new Audio('cues/scottish/complete.mp3');
    audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
    audio.addEventListener('error', () => reject(new Error('clip failed to decode')));
    audio.load();
  }));
  expect(durationSeconds).toBeGreaterThan(0.5);
  await page.goto('./#/settings/sound');
  const options = await page.getByRole('combobox', { name: 'Voice', exact: true }).locator('option').allTextContents();
  expect(options).toEqual(['British male (Alan)', 'American female (Amy)', 'Scottish female (Alba)', 'Northern English male', 'American male (Ryan)', 'Device voice only']);
});

test('the production container is installable from a phone\'s home screen', async ({ page, request }) => {
  const manifest = await request.get('./manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  const body = (await manifest.json()) as { display: string; start_url: string; icons: { src: string }[] };
  expect(body.display).toBe('standalone');
  expect(body.start_url).toBe('./');
  for (const icon of [...body.icons.map(icon => icon.src), 'icons/apple-touch-icon.png']) expect((await request.get(`./${icon}`)).ok(), icon).toBe(true);
  await page.goto('./');
  // The server shape links from the root, the static one relatively; both must land beside the page.
  const linked = (rel: string) => page.locator(`link[rel=${rel}]`).evaluate(link => (link as HTMLLinkElement).href);
  expect(await linked('manifest')).toBe(new URL('manifest.webmanifest', page.url()).href);
  expect(await linked('apple-touch-icon')).toBe(new URL('icons/apple-touch-icon.png', page.url()).href);
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
});

test('health answers with the shipped version', async ({ page, request }) => {
  test.skip(MODE !== 'server', 'The static site has no server.');
  const health = await request.get('./api/v1/health/live');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok', version: VERSION });
  await page.goto('./');
  await expectFooterVersion(page);
});

test('no server, Settings shows This browser', async ({ page, request }) => {
  test.skip(MODE !== 'static', 'The server container has a server.');
  // A static host answers 404 or its index page, never the API's JSON.
  const health = await request.get('./api/v1/health/live');
  expect(health.ok() && (health.headers()['content-type'] ?? '').includes('application/json')).toBe(false);
  const calls: string[] = [];
  page.on('request', call => { if (new URL(call.url()).pathname.includes('/api/')) calls.push(call.url()); });
  await page.goto('./#/settings');
  const card = page.getByRole('region', { name: 'This browser' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('IndexedDB');
  await expect(page.getByRole('region', { name: 'Household server' })).toHaveCount(0);
  await expectFooterVersion(page);
  expect(calls).toEqual([]);
});
