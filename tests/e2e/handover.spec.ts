import type { Browser, Page } from '@playwright/test';
import { expect, serverOnly, test, type Api } from './fixtures';
import { advance, PLAYER, ready } from './helpers';

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
interface LiveRow { id: string; status: string; deviceId: string; deviceLabel: string; generation: number; title: string }
const liveRows = async (api: Api) => (await api.get<{ sessions: LiveRow[] }>('/api/v1/live-sessions')).sessions;
const flush = (page: Page) => page.evaluate(() => window.__openwodTest!.flushCheckpoints());
const engineStatus = (page: Page) => page.evaluate(() => window.__openwodTest!.snapshot().projection.status);
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const deviceIdOf = (page: Page) => page.evaluate(() => localStorage.getItem('openwod.device.v1'));
const offer = (page: Page) => page.getByRole('status', { name: 'Session on another device' });
const steppedAside = (page: Page) => page.getByRole('region', { name: 'Continued on another device' });
const arrival = (page: Page) => page.getByRole('dialog', { name: 'Continued session' });
/** How many session checkpoints this device's IndexedDB holds. */
const checkpoints = (page: Page) => page.evaluate(() => new Promise<number>((resolve, reject) => {
  const open = indexedDB.open('openwod');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const request = open.result.transaction('checkpoints').objectStore('checkpoints').count();
    request.onsuccess = () => { open.result.close(); resolve(request.result); };
    request.onerror = () => { open.result.close(); reject(request.error); };
  };
}));

/** A second device of the same household: its own browser context (so its own storage and device id), the test's scope, a Mac's user agent. */
async function secondDevice(browser: Browser, page: Page, api: Api) {
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, userAgent: MAC });
  await context.addInitScript(value => { window.__openwodScope = value; }, api.scope);
  return { context, mac: await context.newPage() };
}

/** Starts the partner circuit on the first device and plays it into round 1, 25 seconds before the end of a slot. */
async function startOnFirst(page: Page) {
  await page.goto(PLAYER); await ready(page);
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await advance(page, 10_000);
  await advance(page, 65_000);
  await flush(page);
}

// The first device is an iPad in Safari, the second a Mac in Chrome: the labels the screens name each other by.
test.use({ userAgent: IPAD });

test.describe('hand-over between devices (ENG-15)', () => {
  serverOnly();

  test('AT-34: a session started on one device continues on another, the first steps aside, and one result is kept', async ({ page, browser, api }) => {
    await page.goto('/');
    const { context, mac } = await secondDevice(browser, page, api);
    try {
      // The second device sits on its library before anything runs.
      await mac.goto('/');
      await expect(mac.getByRole('heading', { level: 1, name: 'Pick your next session' })).toBeVisible();
      await expect(offer(mac)).toHaveCount(0);

      await startOnFirst(page);
      const [ipadId, macId] = [await deviceIdOf(page), await deviceIdOf(mac)];
      expect(ipadId).toMatch(/^[a-z0-9-]{8,80}$/);
      expect(macId).toMatch(/^[a-z0-9-]{8,80}$/);
      expect(macId).not.toBe(ipadId);
      expect(await liveRows(api)).toEqual([expect.objectContaining({ status: 'running', deviceId: ipadId, deviceLabel: 'iPad · Safari', generation: 1, title: 'Partner Circuit' })]);
      // The device that runs it is not offered its own session.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(offer(page)).toHaveCount(0);

      // Coming back to the second device shows the session without a reload.
      await mac.evaluate(() => { (window as unknown as { __stayed?: boolean }).__stayed = true; });
      await focus(mac);
      await expect(offer(mac)).toContainText('Session running on iPad · Safari');
      await expect(offer(mac)).toContainText('“Partner Circuit” · updated just now');
      expect(await mac.evaluate(() => (window as unknown as { __stayed?: boolean }).__stayed)).toBe(true);

      await offer(mac).getByRole('button', { name: 'Continue here' }).click();
      await expect(mac).toHaveURL(/#\/wod\/partner-circuit\/play$/);
      await ready(mac);
      // It arrives paused and asks first, naming the device it comes from and where it stands.
      await expect(arrival(mac)).toContainText('Continued from iPad · Safari · saved just now');
      await expect(arrival(mac)).toContainText('Block 1 of');
      await expect(arrival(mac)).toContainText('Round 1 · 00:25 left');
      expect(await engineStatus(mac)).toBe('paused');
      expect(await liveRows(api)).toEqual([expect.objectContaining({ deviceId: macId, deviceLabel: 'Mac · Chrome', generation: 2 })]);
      await arrival(mac).getByRole('button', { name: 'Resume' }).click();
      await expect(mac.getByRole('status')).toHaveText('Work');
      await expect(mac.getByTestId('primary-timer')).toHaveText('00:25');
      await expect(arrival(mac)).toHaveCount(0);

      // The first device learns it from its next save: it steps aside, and no key moves its clock any more.
      await advance(page, 4000);
      await expect(steppedAside(page)).toContainText('Continued on Mac · Chrome.');
      await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toHaveCount(0);
      expect(await engineStatus(page)).toBe('paused');
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      expect(await engineStatus(page)).toBe('paused');
      await flush(mac);
      expect(await liveRows(api)).toEqual([expect.objectContaining({ status: 'running', deviceId: macId, generation: 2 })]);
      // Its own copy is gone: after a reload the library offers the session as the other device's, not as interrupted.
      await expect.poll(() => checkpoints(page)).toBe(0);
      await page.goto('/');
      await expect(offer(page)).toContainText('Session running on Mac · Chrome');
      await expect(page.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);

      // Finished on the second device: one logbook entry, no live row, nothing left to offer.
      await advance(mac, 20 * 60_000);
      await expect(mac.getByRole('status')).toHaveText('Workout complete');
      await expect.poll(async () => (await api.get<{ sessions: { deviceId: string; outcome: string; interrupted: boolean }[] }>('/api/v1/sessions')).sessions).toEqual([expect.objectContaining({ deviceId: macId, outcome: 'completed', interrupted: true })]);
      await expect.poll(() => liveRows(api)).toEqual([]);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Pick your next session' })).toBeVisible();
      await expect(offer(page)).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);
      await page.goto('/#/history');
      await expect(page.getByRole('list', { name: 'Sessions' }).getByRole('listitem')).toHaveCount(1);
    } finally { await context.close(); }
  });

  test('a session whose app was hidden reads paused for the other devices', async ({ page, api }) => {
    await startOnFirst(page);
    expect(await liveRows(api)).toEqual([expect.objectContaining({ status: 'running' })]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('status')).toHaveText('Paused · app was hidden');
    await expect.poll(() => liveRows(api)).toEqual([expect.objectContaining({ status: 'paused', deviceLabel: 'iPad · Safari', generation: 1 })]);
    // Discarded on its own device, the session is over for the others too.
    await page.goto('/');
    await page.getByRole('status', { name: 'Interrupted session' }).getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);
    await expect.poll(() => liveRows(api)).toEqual([]);
  });

  test('a session too short to count leaves no live row behind when it ends', async ({ page, api }) => {
    await startOnFirst(page);
    expect(await liveRows(api)).toHaveLength(1);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('dialog', { name: 'End this session?' }).getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('status')).toHaveText('Workout ended');
    await expect.poll(() => liveRows(api)).toEqual([]);
    expect((await api.get<{ sessions: unknown[] }>('/api/v1/sessions')).sessions).toEqual([]);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Interrupted session' })).toHaveCount(0);
  });

  test('the offer shows on the workout page and before Start, a session can be taken back, and the library discards one', async ({ page, browser, api }) => {
    await startOnFirst(page);
    const { context, mac } = await secondDevice(browser, page, api);
    try {
      // On the workout's own page the title is not repeated.
      await mac.goto('/#/wod/partner-circuit');
      await expect(offer(mac)).toHaveText(/^Session running on iPad · Safari · updated just now\s*Continue here$/);
      // The ready player offers it too, and Start stays for a session of this device's own.
      await mac.goto(PLAYER); await ready(mac);
      await expect(mac.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
      const before = mac.getByRole('region', { name: 'Session on another device' });
      await expect(before).toContainText('Session running on iPad · Safari · updated just now');
      await before.getByRole('button', { name: 'Continue here' }).click();
      await expect(arrival(mac)).toContainText('Continued from iPad · Safari');
      await expect(mac.getByRole('button', { name: 'Start workout', exact: true })).toHaveCount(0);

      // The first device, idle, learns it from the household's list when it is looked at again.
      await focus(page);
      await expect(steppedAside(page)).toContainText('Continued on Mac · Chrome.');
      await expect.poll(async () => (await liveRows(api))[0]?.status).toBe('paused');
      // Taking it back asks first as well, although the session was paused over there.
      await steppedAside(page).getByRole('button', { name: 'Take it back here' }).click();
      await expect(arrival(page)).toContainText('Continued from Mac · Chrome · saved just now');
      await expect(arrival(page)).toContainText('Round 1 · 00:25 left');
      await expect(steppedAside(page)).toHaveCount(0);
      expect(await liveRows(api)).toEqual([expect.objectContaining({ deviceLabel: 'iPad · Safari', generation: 3 })]);
      await focus(mac);
      await expect(steppedAside(mac)).toContainText('Continued on iPad · Safari.');

      // From the library a session can be discarded for every device, here one whose device is not coming back.
      await mac.goto('/');
      await expect(offer(mac)).toContainText('Session paused on iPad · Safari');
      await offer(mac).getByRole('button', { name: 'Discard' }).click();
      await expect(offer(mac)).toHaveCount(0);
      await expect.poll(() => liveRows(api)).toEqual([]);
    } finally { await context.close(); }
  });
});
