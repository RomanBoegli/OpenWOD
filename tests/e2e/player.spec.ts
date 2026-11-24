import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { PLAYER, ready, advance, openFilters } from './helpers';

test.describe('player', () => {
  test.beforeEach(async ({ page }) => { await page.goto(PLAYER); await ready(page); });

  test('runs prep, work, transition and all five rounds without lane swaps or timer drift', async ({ page }) => {
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await page.evaluate(() => window.__openwodTest!.advance(40_000));
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByTestId('movement-A')).toHaveText('Kettlebell Swings');
    await expect(page.getByTestId('movement-B')).toHaveText('Row');
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await expect(page.getByRole('status')).toHaveText('Work');
    await page.evaluate(() => window.__openwodTest!.advance(1_140_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().clocks.activeMs)).toBe(1_190_000);
    await page.getByRole('button', { name: 'Train again' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
  });

  test('the injected clock stays fixed while the browser waits, then advances exactly', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 30_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    await page.waitForTimeout(1_100);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().clocks.activeMs)).toBe(20_000);
    await advance(page, 20_000);
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
  });

  test('pause freezes the clock across a 30-second delay and resumes the same interval', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(27_100));
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    const before = await page.getByTestId('primary-timer').textContent();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByTestId('primary-timer')).toHaveText(before!);
    await expect(page.getByRole('status')).toHaveText('Work');
  });

  test('restarts the first interval with Previous and skips with Next inside the section', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(25_000));
    await expect(page.getByTestId('primary-timer')).toHaveText('00:25');
    await page.getByRole('button', { name: 'Restart interval' }).click();
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await expect(page.getByText('MODIFIED')).toBeVisible();
    await page.waitForTimeout(400); // Rapid repeated navigation taps are deliberately ignored.
    await page.getByRole('button', { name: 'Next interval' }).click();
    await expect(page.getByRole('status')).toHaveText('Transition');
    await expect(page.getByRole('button', { name: 'Previous interval' })).toBeEnabled();
  });

  test('skips a whole section and returns to it, and the context view carries the loads and notes of the focus view', async ({ page }) => {
    await page.goto('/#/wod/full-body-partner/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    await page.getByRole('button', { name: 'Next block' }).click();
    await expect(page.getByRole('button', { name: 'Start next block' })).toBeVisible(); // The skipped section's Ready gate.
    await expect(page.getByText('MODIFIED')).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Previous block' }).click();
    await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart block' })).toBeVisible(); // Back at the first section.
    await page.goto('/#/wod/fran/play'); await ready(page);
    await page.getByRole('button', { name: 'Context' }).click();
    const rows = page.getByRole('main').locator('[aria-current], [data-active]');
    await expect(rows.first()).toContainText('kg');
  });

  test('confirms destructive stop and exports a portable JSON file', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export WOD' }).click();
    expect((await download).suggestedFilename()).toBe('partner-circuit.wod.yaml');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'End this session?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep training' }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
  });

  test('reflows at desktop, half-window, tablet and phone widths without clipping', async ({ page }, testInfo) => {
    for (const [width, height] of [[1440, 1000], [768, 900], [1024, 768], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId('movement-A')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const A = await page.getByRole('region', { name: 'Athlete A station' }).boundingBox();
      const B = await page.getByRole('region', { name: 'Athlete B station' }).boundingBox();
      if (width <= 620) expect(B!.y).toBeGreaterThan(A!.y);
      else expect(B!.x).toBeGreaterThan(A!.x);
      if (testInfo.project.name === 'webkit' && [1440, 768, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`), fullPage: true });
    }
  });

  test('keeps Pause visible in the training viewport and offers an in-player context switch', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    for (const [width, height] of [[1024, 768], [768, 900], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      const pause = page.getByRole('button', { name: 'Pause workout', exact: true });
      await expect(pause).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('movement-A')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('movement-B')).toBeInViewport({ ratio: 1 });
      if (testInfo.project.name === 'webkit' && [1024, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`training-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Switch to context view' }).click();
    await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
  });

  test('keeps a loaded workout running with the network disabled', async ({ page, context }) => {
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(1_200_000));
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByTestId('primary-timer')).toHaveText('19:50');
  });

  test('pauses on visibility loss and requires an explicit Resume after return', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => {
      window.__openwodTest!.advance(10_000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('status')).toHaveText('Paused · app was hidden');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Work');
  });

  test('persists athlete names, sound and view preferences across a reload', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Athlete A' }).fill('Mia');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Training view' }).click();
    await page.getByRole('radiogroup', { name: 'Sound' }).getByRole('radio', { name: 'Beeps only' }).check();
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Context', exact: true }).click();
    await page.reload(); await ready(page);
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('Mia');
    await expect(page.getByRole('main').getByText('Beeps only')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
  });
});

/** Nothing scrolls, no row is shorter than its content, no row overlaps the next. */
const frame = (page: Page) => page.locator('[data-performing=true] [data-wash]').evaluate(player => {
  const rows = ([...player.children] as HTMLElement[]).filter(row => getComputedStyle(row).position !== 'absolute' && row.getClientRects().length);
  const boxes = rows.map(row => row.getBoundingClientRect());
  return { scroll: Math.max(0, player.scrollHeight - player.clientHeight - 1), squeezed: rows.filter(row => row.scrollHeight > row.clientHeight + 1).length, overlap: boxes.slice(1).filter((box, index) => box.top < boxes[index].bottom - 1).length, lanes: [...player.querySelectorAll('section[data-athlete]')].filter(lane => lane.scrollHeight > lane.clientHeight + 1).length };
});
/** The ring's path against its panel: 5 px a side at the default ring width, whatever the frame was before the turn. */
const ring = (page: Page) => page.locator('[data-perimeter]').evaluate(svg => { const box = svg.getBoundingClientRect(), path = svg.querySelector('path')!.getBBox(); return [Math.round(box.width - path.width), Math.round(box.height - path.height)]; });

test.describe('player on a tablet', () => {
  // An iPad in landscape or portrait, or a laptop: the whole session, transport controls included, fits the frame without scrolling.
  for (const id of ['back-squat-5x5', 'cindy', 'fran']) test(`${id} fits at tablet sizes in both views`, async ({ page }) => {
    await page.goto(`/#/wod/${id}/play`); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 16_000);
    const overflow = () => page.locator('[data-performing=true] [data-wash]').evaluate(player => player.scrollHeight - player.clientHeight);
    for (const [width, height] of [[1024, 680], [1180, 750], [768, 950], [820, 1110]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
      // Polled: right after a resize the frame has its new size and the stage still the room of the old one, until the ruler has measured.
      await expect.poll(overflow).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Switch to context view' }).click();
      await expect(page.getByRole('region', { name: 'Workout context' })).toBeVisible();
      await expect.poll(overflow).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Switch to focus view' }).click();
    }
  });
});

test.describe('player on an iPad that is turned', () => {
  // Portrait and landscape of each iPad, as the installed app or inside Safari. A turn mid-session moves the frame from one to the other.
  const TABLETS = [['mini in Safari', [744, 1028], [1133, 638]], ['9.7 installed', [768, 1004], [1024, 748]], ['10.2 in Safari', [810, 990], [1080, 720]], ['Air installed', [820, 1144], [1180, 784]], ['13 installed', [1024, 1330], [1366, 988]]] as const;
  for (const id of ['fran', 'full-body-partner', 'synchro-snatch-chipper', 'row-burpee-dumbbell-sprints', 'fourteens-amrap-14']) for (const [name, portrait, landscape] of TABLETS) test(`${id} holds its frame on the ${name} iPad through a turn and back`, async ({ page }) => {
    await page.setViewportSize({ width: portrait[0], height: portrait[1] });
    await page.goto(`/#/wod/${id}/play`); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 16_000);
    for (const [width, height] of [portrait, landscape, portrait]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'End session', exact: true })).toBeInViewport({ ratio: 1 });
      for (const done of await page.getByRole('button', { name: /\bdone\b/i }).or(page.getByTestId('switch')).all()) await expect(done).toBeInViewport({ ratio: 1 });
      await expect.poll(() => frame(page), `${width} by ${height}`).toEqual({ scroll: 0, squeezed: 0, overlap: 0, lanes: 0 });
      await expect.poll(() => ring(page), `${width} by ${height}`).toEqual([10, 10]);
    }
  });

  test('a station card follows its movement name when only the width changes', async ({ page }) => {
    // Kettlebell Swings takes one line in a wide lane and two in a narrow one; no size of the type changes between these two frames.
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 16_000);
    for (const width of [810, 1366, 744]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => frame(page), `${width} wide`).toEqual({ scroll: 0, squeezed: 0, overlap: 0, lanes: 0 });
    }
  });

  test('the stations a new movement replaces slide out from where they stand after a turn', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1156 });
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 11_000);
    await page.setViewportSize({ width: 1180, height: 796 });
    await expect.poll(() => ring(page)).toEqual([10, 10]);
    // The exit layer follows the ring; the parked stations carry their place as inline styles.
    await page.locator('[data-perimeter] + div').evaluate(layer => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) (window as unknown as { ghost?: number[] }).ghost = [node.style.top, node.style.left, node.style.width].map(parseFloat);
    }).observe(layer, { childList: true }));
    await advance(page, 40_000);
    await expect(page.getByRole('status')).toHaveText('Transition');
    const ghost = await (await page.waitForFunction(() => (window as unknown as { ghost?: number[] }).ghost)).jsonValue();
    const live = await page.getByRole('region', { name: 'Athlete A station' }).evaluate(lane => { const lanes = lane.parentElement!.getBoundingClientRect(), layer = document.querySelector('[data-perimeter] + div')!.getBoundingClientRect(); return [lanes.top - layer.top, lanes.left - layer.left, lanes.width]; });
    expect(ghost!.map(Math.round)).toEqual(live.map(Math.round));
  });
});

test.describe('the clock takes the room a workout leaves (UI-27)', () => {
  // A laptop, an iPad in landscape and upright, and two phones.
  const FRAMES = [[1512, 854], [1180, 796], [820, 1156], [390, 844], [430, 932]] as const;
  /** The clock's box and type, the room the stage keeps beyond the station in it (whole pixels, so at most one for the tallest), and what the frame scrolls. */
  const clock = (page: Page) => page.getByTestId('primary-timer').evaluate(timer => {
    const box = timer.getBoundingClientRect(), frame = timer.closest('[data-wash]')!;
    const body = frame.querySelector('section[data-athlete]')?.parentElement?.parentElement, stage = body?.parentElement;
    return { top: Math.round(box.top), height: Math.round(box.height), font: Math.round(parseFloat(getComputedStyle(timer).fontSize)), slack: stage && body ? Math.round(stage.getBoundingClientRect().height - body.getBoundingClientRect().height) : 0, scroll: Math.max(0, frame.scrollHeight - frame.clientHeight - 1) };
  });
  const start = async (page: Page, id: string, [width, height]: readonly [number, number]) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/#/wod/${id}/play`); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 11_000);
  };

  // Fran's first station, Thrusters with their load, is its tallest: the stage keeps exactly its room, and the clock has the rest.
  for (const [frame, floor] of [[FRAMES[0], 200], [FRAMES[1], 165], [FRAMES[2], 165], [FRAMES[3], 88], [FRAMES[4], 98]] as const) test(`Fran's clock is at least ${floor} px at ${frame[0]} by ${frame[1]}, and nothing scrolls`, async ({ page }) => {
    await start(page, 'fran', frame);
    await expect.poll(async () => { const now = await clock(page); return now.scroll + Math.max(0, now.slack - 1); }).toBe(0);
    expect((await clock(page)).font).toBeGreaterThanOrEqual(floor);
    await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('done')).toBeInViewport({ ratio: 1 });
  });

  for (const frame of FRAMES) test(`the clock keeps its box through Fran and through a block boundary at ${frame[0]} by ${frame[1]}`, async ({ page }) => {
    await start(page, 'fran', frame);
    const seen = [await clock(page)];
    for (let slot = 1; slot < 6; slot++) { await page.getByTestId('done').click(); await advance(page, 1000); await expect(page.getByText(`MOVEMENT ${slot + 1} / 6`)).toBeVisible(); seen.push(await clock(page)); }
    for (const now of seen) expect(now).toMatchObject({ top: seen[0].top, height: seen[0].height, font: seen[0].font, scroll: 0 });
    // The partner workout: five stations of the warm-up, the wait for Ready at its end, then the next block's stations and their rest.
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
    await start(page, 'full-body-partner', frame);
    const partner = [await clock(page)];
    for (let slot = 1; slot < 5; slot++) { await advance(page, 60_000); partner.push(await clock(page)); }
    await advance(page, 60_000);
    await expect(page.getByRole('button', { name: 'Start next block' })).toBeVisible();
    partner.push(await clock(page));
    await page.getByRole('button', { name: 'Start next block' }).click();
    for (let slot = 0; slot < 4; slot++) { await advance(page, 25_000); partner.push(await clock(page)); }
    for (const now of partner) expect(now).toMatchObject({ top: partner[0].top, height: partner[0].height, font: partner[0].font, scroll: 0 });
  });

  test('after a turn mid-session the clock fits the new frame and keeps that box too', async ({ page }) => {
    await start(page, 'full-body-partner', [820, 1156]);
    const room = () => page.getByTestId('primary-timer').evaluate(timer => timer.closest<HTMLElement>('[data-wash]')!.style.getPropertyValue('--stage-room'));
    const upright = await clock(page), uprightRoom = await room();
    await advance(page, 60_000);
    await page.setViewportSize({ width: 1180, height: 796 });
    // The frame has its new size at once and the stage's room once the ruler has measured it, before the next paint: the
    // clock is read only then, since a read in between finds the new frame with the room of the old one.
    await expect.poll(room).not.toBe(uprightRoom);
    const turned = [await clock(page)];
    for (let slot = 0; slot < 3; slot++) { await advance(page, 60_000); turned.push(await clock(page)); }
    for (const now of turned) expect(now).toMatchObject({ top: turned[0].top, height: turned[0].height, font: turned[0].font, scroll: 0 });
    // Back upright it is the box it had before the turn.
    await page.setViewportSize({ width: 820, height: 1156 });
    await expect.poll(() => clock(page)).toMatchObject({ top: upright.top, height: upright.height, font: upright.font, scroll: 0 });
  });

  // The four parts of the progress are switched one by one in the settings; here all of them at once, and none.
  for (const [width, height] of [[1180, 796], [390, 844]] as const) test(`the frame holds with every part of the progress on and with every part off at ${width} by ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const fonts: number[] = [];
    for (const on of [true, false]) {
      await page.goto(PLAYER); await ready(page);
      await page.evaluate(value => localStorage.setItem('openwod.preferences.v1', value), JSON.stringify({ progress: { bar: on, barPercent: on, clockPercent: on, donut: on } }));
      await page.reload(); await ready(page);
      await page.getByRole('button', { name: 'Start workout', exact: true }).click();
      await advance(page, 11_000);
      for (const part of [page.getByTestId('overall-progress'), page.getByText(/^\d+ % DONE$/), page.getByLabel('Progress beside the clock'), page.getByTestId('round-donut')]) await expect(part).toHaveCount(on ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Pause workout', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('movement-B')).toBeInViewport({ ratio: 1 });
      if (width > 620) await expect.poll(() => frame(page)).toEqual({ scroll: 0, squeezed: 0, overlap: 0, lanes: 0 });
      await expect.poll(async () => (await clock(page)).scroll).toBe(0);
      fonts.push((await clock(page)).font);
      await page.getByRole('button', { name: 'End session', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
    }
    // The donut and the percentage give their width back to the digits.
    expect(fonts[1]).toBeGreaterThan(fonts[0]);
  });

  test('the ruler that measures the stations is seen by no one', async ({ page }) => {
    await start(page, 'synchro-snatch-chipper', [1180, 796]);
    const found = await page.locator('[data-performing=true] [data-wash]').evaluate(frame => {
      const ruler = frame.querySelector(':scope > [inert][aria-hidden=true]:last-child')!;
      const ids = [...frame.querySelectorAll('[data-testid]')].map(node => node.getAttribute('data-testid'));
      return { copies: ruler.firstElementChild!.childElementCount, buttons: ruler.querySelectorAll('button').length, hidden: getComputedStyle(ruler).visibility, marked: ruler.querySelectorAll('[data-testid], [id]').length, twice: ids.filter((id, index) => ids.indexOf(id) !== index) };
    });
    // It is there, with a Done button in every copy that has one, and carries no test id and no id.
    expect(found.copies).toBeGreaterThan(1);
    expect(found.buttons).toBeGreaterThan(1);
    expect(found).toMatchObject({ hidden: 'hidden', marked: 0, twice: [] });
    await expect(page.getByTestId('movement-A')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Athlete A done' })).toHaveCount(1);
    // Tab walks the frame's own buttons and never lands in the ruler.
    for (let step = 0; step < 14; step++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[inert]')))).toBe(false); }
  });
});

test.describe('overview', () => {
  test('lays out every section and round for study, then starts the player', async ({ page }) => {
    await page.goto('/#/wod/full-body-partner');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Full Body Partner Workout');
    // Between the section cards, a tile tells what follows each section (BLD-14).
    const sections = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').filter({ hasText: /Block \d of 6/i });
    await expect(sections).toHaveCount(6);
    await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem', { name: /^Between block/ })).toHaveCount(5);
    await expect(page.getByRole('listitem', { name: 'Between block 2 and 3' })).toContainText('Rest 02:00, then continues');
    const block = sections.nth(1);
    await expect(block).toContainText('Legs & Strength');
    await expect(block).toContainText('Round 1 of 2');
    await expect(block).toContainText('Round 2 of 2');
    const firstRows = block.getByRole('table').first().getByRole('row');
    await expect(firstRows.nth(1)).toContainText('Air Squats');
    await expect(firstRows.nth(1)).toContainText('Dumbbell Thrusters');
    await expect(block.getByRole('table').nth(1).getByRole('row').nth(1)).toContainText('Dumbbell Thrusters');
    await page.goto('/#/wod/partner-circuit');
    await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').first()).toContainText('Rounds 1–5 of 5');
    await expect(page.getByText('1m rest between rounds')).toBeVisible();
    await expect(page.getByLabel('Projected difficulty: Hard')).toBeVisible();
    await page.getByRole('link', { name: 'Start workout' }).click();
    await ready(page);
    expect(page.url()).toContain('#/wod/partner-circuit/play');
    // Start on the workout's page begins the session with that tap; the ready screen is for a reload or a bookmark.
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
    await page.getByRole('link', { name: 'Back to workout overview' }).click();
    await expect(page.getByRole('list', { name: 'Blocks' })).toBeVisible();
    await page.goto(PLAYER); await ready(page);
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
  });
});

test.describe('formats', () => {

  test('AMRAP counts only what is tapped, never moves its block, and ends capped', async ({ page }) => {
    await page.goto('/#/wod/cindy/play'); await ready(page);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:10');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('AMRAP');
    await expect(page.getByTestId('primary-timer')).toHaveText('20:00');
    await expect(page.getByRole('list', { name: 'AMRAP block' }).getByRole('listitem')).toHaveCount(3);
    await advance(page, 60_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('19:00');
    await expect(page.getByRole('button', { name: 'Next interval' })).toBeDisabled();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Round', exact: true }).click();
    await page.getByRole('button', { name: 'Rep', exact: true }).click();
    await expect(page.getByTestId('rounds')).toHaveText('2');
    await expect(page.getByTestId('reps')).toHaveText('1');
    await page.getByRole('button', { name: 'Undo last count' }).click();
    await expect(page.getByTestId('reps')).toHaveText('0');
    await expect(page.getByRole('list', { name: 'AMRAP block' }).getByRole('listitem')).toHaveCount(3);
    await advance(page, 1_140_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Block results' })).toContainText('2 rounds');
    await expect(page.getByRole('list', { name: 'Block results' })).toContainText('capped');
  });

  test('EMOM keeps its boundaries whatever is tapped and shows rest after an early Done', async ({ page }) => {
    await page.goto('/#/wod/partner-emom-16/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Interval');
    await expect(page.getByTestId('primary-timer')).toHaveText('01:00');
    await expect(page.getByText('INTERVAL 1 / 16')).toBeVisible();
    await expect(page.getByTestId('movement-A')).toHaveText('Row');
    await advance(page, 20_000);
    await page.getByTestId('done').click();
    await expect(page.getByRole('region', { name: 'Athlete A station' }).getByText('DONE · REST')).toBeVisible();
    await expect(page.getByTestId('done')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next interval' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restart interval' })).toBeDisabled();
    await advance(page, 20_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:20');
    await advance(page, 20_000);
    await expect(page.getByText('INTERVAL 2 / 16')).toBeVisible();
    await expect(page.getByTestId('movement-A')).toHaveText('Burpees');
    await expect(page.getByTestId('done')).toBeVisible();
  });

  test('For time counts up, advances on Done, shows big targets with the chosen load level, and finishes', async ({ page }) => {
    await page.goto('/#/wod/fran/play'); await ready(page);
    await expect(page.getByRole('region', { name: 'Station' })).toContainText('20 (15)');
    await expect(page.getByRole('region', { name: 'Station' })).toContainText('30 (20)');
    await expect(page.getByRole('region', { name: 'Station' })).toContainText('43 (29) kg');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work · tap Done');
    await expect(page.getByTestId('movement-A')).toHaveText('Thrusters');
    await expect(page.getByRole('region', { name: 'Station' })).toContainText('21');
    await advance(page, 5_000);
    await expect(page.getByTestId('primary-timer')).toHaveText('00:05');
    await expect(page.getByText('ELAPSED · CAP BELOW')).toBeVisible();
    await expect(page.getByText('CAP09:55')).toBeVisible();
    for (let step = 0; step < 5; step++) { await page.getByTestId('done').click(); await advance(page, 1_000); }
    await expect(page.getByTestId('movement-A')).toHaveText('Pull-Ups');
    await expect(page.getByRole('region', { name: 'Station' })).toContainText('9');
    await page.getByTestId('done').click();
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Block results' })).toContainText('completed');
  });

  test('UI-29: a solo session has a station of its own, one row with no badge and no athlete name, and a game plan without a second athlete', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/#/wod/fran/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    const station = page.getByRole('region', { name: 'Station' });
    await expect(page.getByText('YOUR STATION')).toBeVisible();
    await expect(page.getByText('YOUR STATIONS')).toHaveCount(0);
    await expect(station).not.toContainText('Athlete A');
    await expect(page.getByRole('region', { name: /Athlete . station/ })).toHaveCount(0);
    // The target, the movement and the load stand beside each other, the movement in the middle of the card.
    const row = await station.evaluate(card => {
      const box = (node: Element) => { const { left, right, top, bottom } = node.getBoundingClientRect(); return { left, right, middle: (top + bottom) / 2, centre: (left + right) / 2 }; };
      const [lead, name, side] = [...card.children].map(box);
      return { lead, name, side, card: box(card) };
    });
    expect(row.lead.right).toBeLessThanOrEqual(row.name.left);
    expect(row.name.right).toBeLessThanOrEqual(row.side.left);
    expect(Math.abs(row.name.centre - row.card.centre)).toBeLessThan(2);
    // The game plan lists the movements in one column, with no dash where a second athlete would stand.
    await page.getByRole('button', { name: 'Switch to context view' }).click();
    const plan = page.getByRole('region', { name: 'Workout context' });
    await expect(plan.locator('[aria-current=step] > span')).toHaveCount(3);
    await expect(plan).not.toContainText('—');
    // On a phone the card stacks: the movement has a line of its own under the target and the load.
    await page.getByRole('button', { name: 'Switch to focus view' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const stacked = await station.evaluate(card => { const [lead, name] = [...card.children].map(node => node.getBoundingClientRect()); return name.top >= lead.bottom - 1; });
    expect(stacked).toBe(true);
  });

  test('You go, I go hands over on Switch and ignores a rapid second tap', async ({ page }) => {
    await page.goto('/#/wod/you-go-i-go-sprints/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Athlete A works');
    await expect(page.getByText('TEAM ROUND 1 · TURN 1')).toBeVisible();
    await page.getByTestId('switch').click();
    await page.getByTestId('switch').click({ force: true });
    await expect(page.getByRole('status')).toHaveText('Athlete B works');
    await expect(page.getByText('TEAM ROUND 1 · TURN 2')).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId('switch').click();
    await expect(page.getByText('TEAM ROUND 2 · TURN 3')).toBeVisible();
    await advance(page, 720_000);
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await expect(page.getByRole('list', { name: 'Block results' })).toContainText('1 team round');
  });

  test('the library filters by format and by the equipment you own', async ({ page }) => {
    await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await openFilters(page);
    await chip('Format', 'AMRAP').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Cindy');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Fran');
    await chip('Format', 'For time').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Fran');
    await chip('Collection', 'Benchmarks').click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Karen');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Rack & Run');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await chip('Equipment', 'Only my equipment').click();
    await expect(page.getByText('Nothing matches yet')).toBeVisible();
    await page.goto('/#/settings/equipment');
    await page.getByRole('checkbox', { name: 'I have Pull-Up Bar' }).check();
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Cindy');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Fran');
    await page.reload();
    await expect(chip('Equipment', 'Only my equipment')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the skip buttons move the clock either way by the chosen seconds and the J and L keys do the same', async ({ page }) => {
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await advance(page, 12_000);
    const timer = page.getByTestId('primary-timer');
    await expect(timer).toHaveText('00:38');
    await page.getByRole('button', { name: 'Back 10 seconds' }).click(); // Only 2 seconds into the slot: back to its start.
    await expect(timer).toHaveText('00:40');
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await expect(timer).toHaveText('00:20');
    // The clicked button keeps the focus on Linux, and keys from a focused button are left to the button.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('j');
    await expect(timer).toHaveText('00:30');
    await page.keyboard.press('l');
    await expect(timer).toHaveText('00:20');
    await expect(page.getByText('MODIFIED')).toBeVisible();
  });

  for (const [width, height] of [[1024, 768], [390, 844]] as const) {
    test(`UI-24: the round donut counts movements and rounds, and the context view keeps the movement under way in sight at ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(PLAYER); await ready(page);
      await page.getByRole('button', { name: 'Context', exact: true }).click();
      await page.getByRole('button', { name: 'Start workout', exact: true }).click();
      await advance(page, 165_000); // Prep, three stations with their transitions: the fourth station of round 1.
      const donut = page.getByTestId('round-donut');
      await expect(donut).toHaveAttribute('aria-label', 'Movement 4 of 4, round 1 of 5, 4 rounds left');
      const active = page.getByRole('region', { name: 'Workout context' }).locator('[aria-current=step]');
      await expect(active).toContainText('Air Squats');
      // The row sits inside the list's visible box, so it can be read without scrolling.
      await expect.poll(async () => {
        const [row, list] = await Promise.all([active.boundingBox(), active.locator('xpath=..').boundingBox()]);
        return Boolean(row && list && row.y >= list.y - 1 && row.y + row.height <= list.y + list.height + 1);
      }).toBe(true);
      await advance(page, 100_000); // The round rest, then the first station of round 2.
      await expect(donut).toHaveAttribute('aria-label', 'Movement 1 of 4, round 2 of 5, 3 rounds left');
    });
  }

  test('UI-24: a card names each block as it starts, and a finished block waits for Ready under its own card', async ({ page }) => {
    await page.goto('/#/wod/full-body-partner/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await advance(page, 10_000);
    const card = page.getByTestId('block-card');
    await expect(card).toContainText('BLOCK 1 OF 6');
    await expect(card).toContainText('Warm-Up');
    await expect(card).toBeHidden({ timeout: 5000 }); // It fades by itself.
    await advance(page, 5 * 60_000 + 1000);
    await expect(page.getByRole('button', { name: 'Start next block' })).toBeVisible();
    await expect(card).toContainText('BLOCK 1 DONE');
    await page.getByRole('button', { name: 'Start next block' }).click();
    await expect(card).toContainText('BLOCK 2 OF 6');
    await expect(card).toContainText('2 rounds');
  });

  test('the prep countdown counts down in a count-up workout and wears the rest colour', async ({ page }) => {
    await page.goto('/#/wod/fran/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await advance(page, 3000);
    const player = page.locator('[data-wash]');
    await expect(player).toHaveAttribute('data-phase', 'prep');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:07');
    await advance(page, 8000);
    await expect(player).toHaveAttribute('data-phase', 'work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:01');
  });
});

test.describe('player without a secure context', () => {
  // Plain HTTP on a LAN address (a phone opening http://YOUR_SERVER_ADDRESS:8080) has no crypto.randomUUID; starting a workout used to throw and leave a black page.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID; });
    await page.goto(PLAYER); await ready(page);
  });

  test('starts and runs a workout when crypto.randomUUID is missing', async ({ page }) => {
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Get ready');
    await expect(page.getByTestId('primary-timer')).toBeVisible();
    await advance(page, 10_000);
    await expect(page.getByRole('status')).toHaveText('Work');
    await expect(page.getByTestId('primary-timer')).toHaveText('00:40');
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    expect(await page.evaluate(() => window.__openwodTest!.snapshot().projection.sessionId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await page.locator('body').innerText()).trim()).not.toBe('');
  });
});
