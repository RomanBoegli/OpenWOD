import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { BUNDLED, partnerCircuit, bundledCount, PLAYER, ready, openFilters } from './helpers';
import { serialiseWorkoutFile } from '../../packages/domain/src';

test.describe('settings and log', () => {
  test('logs a completed session and shows it on the card and the overview, sorted by longest ago', async ({ page }) => {
    await page.goto('/#/wod/karen/play'); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(10_000));
    await page.evaluate(() => window.__openwodTest!.advance(200_000));
    await page.getByTestId('done').click();
    await expect(page.getByRole('status')).toHaveText('Workout complete');
    await page.goto('/#/wod/karen');
    // A completed session needs no outcome chip; only Capped, Ended early and the like are shown.
    await expect(page.getByRole('region', { name: 'Past sessions' })).not.toContainText('Completed');
    await expect(page.getByRole('region', { name: 'Past sessions' })).toContainText('03:20 active');
    await expect(page.getByRole('main')).toContainText('Done once · today');
    await page.goto('/');
    await openFilters(page);
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('longestAgo');
    const titles = page.getByRole('list', { name: 'Workouts' }).getByRole('heading', { level: 2 });
    await expect(titles.last()).toHaveText('Karen');
  });

  test('LIB-06: authors are master data: rename, merge, undo, delete and restore change what the library shows', async ({ page }) => {
    await page.goto('/#/settings/authors'); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor();
    const list = page.getByRole('list', { name: 'Authors in the library' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button', { name: 'Rename CrossFit' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename CrossFit' });
    await rename.getByRole('textbox', { name: 'Name' }).fill('CrossFit HQ');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('list', { name: 'Merged author names' })).toContainText('crossfit → CrossFit HQ');
    await page.getByRole('checkbox', { name: 'Select Coach programming' }).check();
    await page.getByRole('checkbox', { name: 'Select OpenWOD' }).check();
    await page.getByRole('combobox', { name: 'Keep as' }).fill('Coaches');
    await page.getByRole('button', { name: 'Merge 2' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').filter({ hasText: 'Coaches' })).toContainText(String(bundledCount({ authors: ['Coach programming', 'OpenWOD'] })));
    await page.getByRole('list', { name: 'Merged author names' }).getByRole('listitem').filter({ hasText: 'openwod →' }).getByRole('button', { name: 'Undo' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.goto('/#/wod/fran');
    await expect(page.getByRole('main')).toContainText('By CrossFit HQ');
    await page.goto('/#/settings/authors');
    await page.getByRole('button', { name: 'Delete CrossFit HQ' }).click();
    await page.getByRole('dialog', { name: 'Delete CrossFit HQ?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('list', { name: 'Deleted authors' })).toContainText(`CrossFit HQ · ${bundledCount({ authors: ['CrossFit'] })} workouts without an author`);
    await page.goto('/#/wod/fran');
    await expect(page.getByRole('main')).not.toContainText('By CrossFit');
    await page.goto('/#/settings/authors');
    await page.getByRole('button', { name: 'Restore CrossFit HQ' }).click();
    await expect(list).toContainText('CrossFit HQ');
  });

  test('merges equipment names and creates, edits and removes a collection through the settings dialogs', async ({ page }) => {
    await page.goto('/#/settings/equipment'); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor();
    await page.getByRole('checkbox', { name: 'Select Medicine ball' }).check();
    await page.getByRole('checkbox', { name: 'Select Slam ball' }).check();
    await page.getByRole('combobox', { name: 'Keep as' }).fill('Wall ball');
    await page.getByRole('button', { name: /^Merge/ }).click();
    await expect(page.getByRole('list', { name: 'Merged names' })).toContainText('Wall ball');
    await page.getByRole('button', { name: 'Rename Wall ball' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Wall ball' });
    await rename.getByRole('textbox', { name: 'Name' }).fill('Wallball');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('list', { name: 'Equipment in the library' })).toContainText('Wallball');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Collections' }).click();
    await page.getByRole('button', { name: 'New collection' }).click();
    const dialog = page.getByRole('dialog', { name: 'New collection' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Short and sharp');
    await dialog.getByRole('group', { name: 'Workouts in this collection' }).getByRole('button', { name: 'Karen', exact: true }).click();
    await dialog.getByRole('group', { name: 'Workouts in this collection' }).getByRole('button', { name: 'Fran', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create collection' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).toContainText('Short and sharp');
    await page.getByRole('button', { name: 'Edit collection Short and sharp' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Short and sharp' });
    await edit.getByRole('textbox', { name: 'Description' }).fill('Under ten minutes');
    await edit.getByRole('button', { name: 'Save collection' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).toContainText('Under ten minutes');
    await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Pick your next session' }).waitFor();
    await openFilters(page);
    await page.getByRole('group', { name: 'Collection' }).getByRole('button', { name: 'Short and sharp' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('list', { name: 'Workouts' })).toContainText('Wallball');
    await expect(page.getByRole('list', { name: 'Workouts' })).not.toContainText('Medicine ball');
    await page.goto('/#/wod/karen');
    await expect(page.getByRole('region', { name: 'Equipment' })).toContainText('Wallball');
    await page.goto('/#/settings/collections');
    await page.getByRole('button', { name: 'Remove collection Short and sharp' }).click();
    await page.getByRole('dialog', { name: 'Remove Short and sharp?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('list', { name: 'Collections' })).not.toContainText('Short and sharp');
  });
});

test.describe('movements and search', () => {
  test('the editor picks movements from the catalogue, derives their equipment, and adds unknown movements', async ({ page }) => {
    await page.goto('/#/new');
    await page.getByLabel('Title', { exact: true }).fill('Picker check');
    const lane = page.getByRole('combobox', { name: 'Block 1 movement 1 athlete A', exact: true });
    await lane.pressSequentially('thru');
    const options = page.getByRole('listbox', { name: 'Movements matching thru' });
    await expect(options.getByRole('option').first()).toContainText('Thrusters');
    await lane.press('Enter');
    await expect(lane).toHaveValue('Thrusters');
    await expect(page.getByRole('main')).toContainText('Thrusters · Barbell');
    await expect(page.getByRole('group', { name: 'Equipment needed' })).toContainText('Barbell');
    const partner = page.getByRole('combobox', { name: 'Block 1 movement 1 athlete B', exact: true });
    await partner.pressSequentially('Pogo hops');
    await partner.press('Escape');
    const unknown = page.getByRole('status', { name: 'Movements not in your catalogue' });
    await expect(unknown).toContainText('Pogo hops');
    await page.getByRole('button', { name: 'Add Pogo hops to the catalogue' }).click();
    await expect(unknown).toHaveCount(0);
    await page.goto('/#/settings/movements');
    const list = page.getByRole('list', { name: 'Movements' });
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Pogo hops');
  });

  test('an imported file with an unknown movement opens highlighted, and housekeeping merges it later', async ({ page }) => {
    const file = { name: 'odd.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id: 'odd-circuit', title: 'Odd circuit', sections: partnerCircuit.sections.map((section, index) => index === 0 ? JSON.parse(JSON.stringify(section).replace('"name":"Row"', '"name":"Pogo hops"')) : section) })) };
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByRole('dialog', { name: 'Preview your WOD' }).getByRole('button', { name: 'Edit before saving' }).click();
    await expect(page).toHaveURL(/#\/draft\/import-odd-circuit$/);
    const unknown = page.getByRole('status', { name: 'Movements not in your catalogue' });
    await expect(unknown).toContainText('Pogo hops');
    await unknown.getByRole('button', { name: 'Add' }).click();
    await expect(unknown).toHaveCount(0);
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page).toHaveURL(/#\/wod\/odd-circuit$/);
    await page.goto('/#/settings/movements');
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await page.getByRole('checkbox', { name: 'Select Pogo hops' }).check();
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('box jumps');
    await page.getByRole('checkbox', { name: 'Select Box Jumps', exact: true }).check();
    await page.getByRole('combobox', { name: 'Keep as' }).selectOption({ label: 'Box Jumps' });
    await page.getByRole('button', { name: 'Merge 2' }).click();
    await expect(page.getByRole('list', { name: 'Merged movement names' })).toContainText('Pogo hops → Box Jumps');
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('pogo');
    await expect(page.getByRole('checkbox', { name: 'Select Pogo hops' })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Find movements' }).fill('hang power');
    const list = page.getByRole('list', { name: 'Movements' });
    await expect(list.getByRole('listitem').first()).toContainText('Cleans');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Hang Power Cleans');
    await page.getByRole('button', { name: 'Edit Hang Power Cleans' }).click();
    const form = page.getByRole('dialog', { name: 'Edit Hang Power Cleans' });
    const equipment = form.getByRole('combobox', { name: 'Equipment' });
    await equipment.pressSequentially('row');
    await expect(form.getByRole('listbox', { name: 'Equipment suggestions' }).getByRole('option').first()).toHaveText('Rowing machine');
    await equipment.press('Enter');
    await equipment.pressSequentially('Sandbox');
    await expect(form.getByRole('option', { name: 'Add “Sandbox”' })).toBeVisible();
    await equipment.press('Enter');
    await expect(form.getByRole('group', { name: 'Equipment', exact: true })).toContainText('Barbell');
    await expect(form.getByRole('group', { name: 'Equipment', exact: true })).toContainText('Rowing machine');
    await expect(form.getByRole('group', { name: 'Equipment', exact: true })).toContainText('Sandbox');
    await form.getByRole('button', { name: 'Remove Barbell' }).click();
    await form.getByRole('button', { name: 'Save movement' }).click();
    await expect(list.getByRole('listitem').nth(1)).toContainText('Sandbox');
    await expect(list.getByRole('listitem').nth(1)).not.toContainText('Barbell');
    await page.getByRole('button', { name: 'Remove Hang Power Cleans' }).click();
    await expect(page.getByRole('dialog', { name: 'Remove Hang Power Cleans?' })).toContainText('bundled record');
    await page.getByRole('dialog', { name: 'Remove Hang Power Cleans?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Hang Power Cleans' })).toHaveCount(0);
    await page.goto('/#/wod/odd-circuit');
    await expect(page.getByRole('region', { name: 'Equipment' })).toContainText('Plyo box');
  });

  test('the library search forgives typos and filters survive navigation within the session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('thrustre');
    const list = page.getByRole('list', { name: 'Workouts' });
    await expect(list.getByRole('listitem')).toHaveCount(bundledCount({ query: 'thrustre' }));
    await expect(list).toContainText('Fran');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('fran');
    await expect(list.getByRole('heading', { level: 2 }).first()).toHaveText('Fran');
    await page.getByRole('searchbox', { name: 'Search workouts' }).fill('');
    await openFilters(page);
    await page.getByRole('group', { name: 'Block format' }).getByRole('button', { name: 'AMRAP' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(bundledCount({ format: ['amrap'] }));
    await page.goto('/#/wod/cindy');
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('group', { name: 'Block format' }).getByRole('button', { name: 'AMRAP' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem')).toHaveCount(BUNDLED);
  });
});

/** What the platform's picker returns for a ready-made choice: the value of its entry in the list the picker offers. */
const offered = (well: Locator, name: string) => well.evaluate((input, label) => [...document.getElementById(input.getAttribute('list')!)!.querySelectorAll('option')].find(option => option.label === label)!.value, name);
/** The well a colour picker lies over: the part that shows the colour. */
const shown = (well: Locator) => well.locator('xpath=..');
const back = (page: Page, name: string) => page.getByRole('button', { name: `${name} back to the built-in colour` });
const rootToken = (page: Page, name: string) => page.evaluate(token => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const settingsAt = async (page: Page, path: string) => { await page.goto(path); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor(); };

test.describe('workout view settings', () => {
  test('the difficulty calibration re-rates the reference workouts, the library and the editor', async ({ page }) => {
    await page.goto('/#/settings');
    const fran = page.getByRole('list', { name: 'Reference workouts' }).getByRole('listitem').filter({ hasText: 'Fran' });
    await expect(fran).toContainText('Hard');
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
    await page.getByRole('slider', { name: 'Brutal from' }).fill('40');
    await expect(fran).toContainText('Brutal');
    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Workouts' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Fran', exact: true }) })).toContainText('Brutal');
    await page.goto('/#/wod/fran/edit');
    await expect(page.getByLabel('Projected difficulty: Brutal')).toBeVisible();
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(fran).toContainText('Hard');
  });

  test('ring width, pulse intensity and colour marks reach the player', async ({ page }) => {
    await settingsAt(page, '/#/settings/player');
    await page.getByRole('slider', { name: /Timer ring width/ }).fill('10');
    await page.getByRole('slider', { name: /Skip buttons/ }).fill('15');
    await page.getByRole('checkbox', { name: 'Percentage beside the clock' }).check();
    await page.getByRole('slider', { name: /Pulse intensity/ }).fill('60');
    await page.getByRole('slider', { name: 'First milestone marker' }).fill('20');
    // Every phase colour is chosen per theme: the theme this browser is in gets the colours looked for below, the other theme others.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme!), other = theme === 'dark' ? 'light' : 'dark';
    for (const [name, mine, theirs] of [['First milestone', '#ff00ff', '#00aa00'], ['Second milestone', '#00c2ff', '#aa5500'], ['Paused', '#8844ff', '#445566']]) {
      await page.getByLabel(`${name} colour in the ${theme} theme`, { exact: true }).fill(mine);
      await page.getByLabel(`${name} colour in the ${other} theme`, { exact: true }).fill(theirs);
    }
    // A ready-made choice comes back from the picker as the shade it is offered in: Pink for the dark theme, any colour for the light.
    const restDark = page.getByLabel('Rest colour in the dark theme', { exact: true });
    await restDark.fill(await offered(restDark, 'Pink'));
    await page.getByLabel('Rest colour in the light theme', { exact: true }).fill('#ff2299');
    await page.getByRole('radio', { name: 'Pounds' }).check();
    const preview = page.locator('[data-view]');
    await expect(preview).toHaveAttribute('data-view', 'focus');
    const view = page.getByRole('radiogroup', { name: 'Default view' });
    await expect(view.getByRole('radio', { name: 'Focus' })).toBeChecked();
    await view.getByRole('radio', { name: 'Context' }).check();
    await expect(preview).toHaveAttribute('data-view', 'context');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(preview).toHaveAttribute('data-warning', 'amber', { timeout: 10_000 });
    await expect(preview).toHaveAttribute('data-warning', 'red', { timeout: 10_000 });
    await expect(preview).toHaveAttribute('data-phase', 'complete', { timeout: 10_000 });
    await view.getByRole('radio', { name: 'Focus' }).check();
    await page.goto('/#/wod/fran/play'); await ready(page);
    await expect(page.locator('svg[data-perimeter] path').first()).toHaveCSS('stroke-width', '10px');
    await expect(page.locator('[data-wash]').locator('.overallTrack, [class*=overallTrack]').first()).toHaveCSS('height', '10px'); // As thick as the ring.
    await expect(page.getByRole('button', { name: 'Back 15 seconds' })).toBeVisible();
    await expect(page.getByLabel('Progress beside the clock')).toHaveText(/^\d+ %$/);
    const player = page.locator('[data-wash]');
    expect(await player.evaluate(element => element.style.getPropertyValue('--wash-gain'))).toBe('0.6');
    // The milestone and paused colours of this theme are on the player alone: elsewhere those tokens colour warnings.
    for (const [token, mine] of [['--phase-amber', '#ff00ff'], ['--phase-red', '#00c2ff'], ['--phase-paused', '#8844ff']]) {
      expect(await player.evaluate((element, name) => element.style.getPropertyValue(name), token)).toBe(mine);
      expect(await page.evaluate(name => document.documentElement.style.getPropertyValue(name), token)).toBe('');
    }
    // The rest colour is a root token tinted per theme: whichever theme the browser picked, its pink choice reads as pink.
    const rest = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--phase-rest').trim());
    expect(rest).toMatch(/^#[0-9a-f]{6}$/);
    expect(['#a3cbf0', '#1d5fa8']).not.toContain(rest);
    expect(parseInt(rest.slice(1, 3), 16)).toBeGreaterThan(parseInt(rest.slice(3, 5), 16));
    await expect(page.getByRole('region', { name: 'Athlete A station' })).toContainText('95 (65) lb');
    // The pulse deepens as a timed slot drains: half-way through the first 40 s slot of the partner circuit.
    await page.goto(PLAYER); await ready(page);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await page.evaluate(() => window.__openwodTest!.advance(30_000));
    await expect.poll(async () => Number(await page.locator('[data-wash]').evaluate(element => element.style.getPropertyValue('--drained')))).toBeGreaterThan(0.3);
    const overall = page.getByTestId('overall-progress');
    await expect(overall.locator('[data-segment]')).toHaveCount(1); // The bar has one segment per block.
    await expect(overall.locator('[data-segment] span')).toHaveAttribute('style', /width/);
    // A paused session takes the paused colour chosen for this theme.
    await page.getByRole('button', { name: 'Pause workout', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Workout paused');
    expect(await page.locator('[data-wash]').evaluate(element => element.style.getPropertyValue('--phase-paused'))).toBe('#8844ff');
  });

  test('the overall progress is put together from four parts, each on its own in the player', async ({ page }) => {
    const names = { bar: 'Overall bar', barPercent: 'Percentage under the bar', clockPercent: 'Percentage beside the clock', donut: 'Round donut' } as const;
    const parts = Object.keys(names) as (keyof typeof names)[];
    const boxes = page.getByRole('group', { name: 'Overall progress' });
    /** Ticks exactly these boxes in the settings, then looks at the player: each part is there when its box is ticked and gone when it is not. */
    const expectParts = async (on: Record<keyof typeof names, boolean>) => {
      await settingsAt(page, '/#/settings/player');
      for (const part of parts) await boxes.getByRole('checkbox', { name: names[part] }).setChecked(on[part]);
      await page.goto(PLAYER); await ready(page);
      const found = { bar: page.getByTestId('overall-progress'), barPercent: page.getByText(/^\d+ % DONE$/), clockPercent: page.getByLabel('Progress beside the clock'), donut: page.getByTestId('round-donut') };
      for (const part of parts) { if (on[part]) await expect(found[part], names[part]).toBeVisible(); else await expect(found[part], names[part]).toHaveCount(0); }
    };
    await settingsAt(page, '/#/settings/player');
    await expect(boxes.getByRole('checkbox')).toHaveCount(4);
    // The look of a fresh install: the bar with its percentage, and the donut.
    for (const part of parts) await expect(boxes.getByRole('checkbox', { name: names[part] })).toBeChecked({ checked: part !== 'clockPercent' });
    const none = { bar: false, barPercent: false, clockPercent: false, donut: false };
    await expectParts({ bar: true, barPercent: true, clockPercent: true, donut: true });
    // Every part alone, the percentage under the bar without its bar included: no part needs another.
    for (const part of parts) await expectParts({ ...none, [part]: true });
    await expectParts(none);
  });

  test('sound and voice are toggles: three sound modes and one cell per voice, all the same size', async ({ page }) => {
    // The recorded voices are rendered into the image, so a checkout may have none: the list is given here.
    const packs = ['British male (Alan)', 'American female (Amy)', 'Scottish female (Alba)', 'Northern English male', 'American male (Ryan)'].map((label, index) => ({ id: `voice-${index + 1}`, label }));
    await page.route('**/cues/packs.json', route => route.fulfill({ json: packs }));
    const stored = () => page.evaluate(() => { const { soundMode, cueSource, cuePack } = JSON.parse(localStorage.getItem('openwod.preferences.v1') ?? '{}') as Record<string, unknown>; return { soundMode, cueSource, cuePack }; });
    await settingsAt(page, '/#/settings/player');
    const sound = page.getByRole('radiogroup', { name: 'Sound', exact: true }), voice = page.getByRole('radiogroup', { name: 'Voice', exact: true });
    // Three tests: the voice, the beeps, and both as a session plays them. Each follows the Sound choice.
    const [testVoice, testBeeps, testBoth] = ['Test voice', 'Test beeps', 'Test both'].map(name => page.getByRole('region', { name: 'Sound and voice' }).getByRole('button', { name, exact: true }));
    await expect(sound.getByRole('radio')).toHaveCount(3);
    await expect(sound.getByRole('radio', { name: 'Voice + beeps' })).toBeChecked();
    for (const button of [testVoice, testBeeps, testBoth]) await expect(button).toBeEnabled();
    await sound.getByRole('radio', { name: 'Beeps only' }).check();
    await expect.poll(stored).toMatchObject({ soundMode: 'beeps' });
    await expect(testBeeps).toBeEnabled();
    for (const button of [testVoice, testBoth]) await expect(button).toBeDisabled();
    await sound.getByRole('radio', { name: 'Silent' }).check();
    await expect.poll(stored).toMatchObject({ soundMode: 'silent' });
    for (const button of [testVoice, testBeeps, testBoth]) await expect(button).toBeDisabled();
    // Every installed voice and the device's own; the first pack speaks until one is chosen.
    await expect(voice.getByRole('radio')).toHaveCount(packs.length + 1);
    await expect(voice.getByRole('radio', { name: packs[0].label })).toBeChecked();
    await voice.getByRole('radio', { name: 'Device voice only' }).check();
    await expect.poll(stored).toMatchObject({ cueSource: 'device' });
    await voice.getByRole('radio', { name: packs[3].label }).check();
    await expect.poll(stored).toMatchObject({ cueSource: 'clips', cuePack: packs[3].id });
    await expect(voice.getByRole('radio', { name: 'Device voice only' })).not.toBeChecked();
    // Three cells to a row, two on a phone, and every cell as large as the others whatever its name needs.
    for (const [width, columns] of [[1280, 3], [390, 2]]) {
      await page.setViewportSize({ width, height: 844 });
      const cells = await voice.locator('label').evaluateAll(labels => labels.map(label => { const box = label.getBoundingClientRect(); return { x: Math.round(box.x), size: `${Math.round(box.width)} x ${Math.round(box.height)}` }; }));
      expect(new Set(cells.map(cell => cell.size)).size).toBe(1);
      expect(new Set(cells.map(cell => cell.x)).size).toBe(columns);
    }
  });

  test('a few voices fill their row: one recorded voice and the device voice share it in halves', async ({ page }) => {
    await page.route('**/cues/packs.json', route => route.fulfill({ json: [{ id: 'british', label: 'British male (Alan)' }] }));
    await settingsAt(page, '/#/settings/player');
    const voice = page.getByRole('radiogroup', { name: 'Voice', exact: true });
    await expect(voice.getByRole('radio')).toHaveCount(2);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      // No empty slot: the last cell ends where the control's inner edge is.
      const { inner, last, sizes } = await voice.evaluate(group => { const labels = [...group.querySelectorAll('label')].map(label => label.getBoundingClientRect()); const box = group.getBoundingClientRect(), style = getComputedStyle(group); return { inner: Math.round(box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)), last: Math.round(labels[labels.length - 1].right), sizes: labels.map(label => Math.round(label.width)) }; });
      expect(Math.abs(inner - last)).toBeLessThanOrEqual(1);
      expect(Math.abs(sizes[0] - sizes[1])).toBeLessThanOrEqual(1);
    }
  });

  test('without recorded voices the Voice toggle says so in a cell that cannot be chosen', async ({ page }) => {
    await page.route('**/cues/packs.json', route => route.fulfill({ json: [] }));
    await settingsAt(page, '/#/settings/player');
    const voice = page.getByRole('radiogroup', { name: 'Voice', exact: true });
    await expect(voice.getByRole('radio')).toHaveCount(2);
    const missing = voice.getByRole('radio', { name: 'Recorded voices (not installed in this build)' });
    await expect(missing).toBeDisabled();
    await expect(missing).toBeChecked();
    await voice.getByRole('radio', { name: 'Device voice only' }).check();
    await expect(missing).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('openwod.preferences.v1') ?? '{}') as { cueSource?: string }).cueSource)).toBe('device');
  });

  test('each theme keeps its own colour across a reload, and its well shows the shade that theme uses', async ({ page }) => {
    const stored = () => page.evaluate(() => (JSON.parse(localStorage.getItem('openwod.preferences.v1') ?? '{}') as { accent?: unknown }).accent);
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const dark = page.getByLabel('Accent in the dark theme', { exact: true }), light = page.getByLabel('Accent in the light theme', { exact: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await settingsAt(page, '/#/settings');
    // Each theme has one row with its accent well and its background; the ready-made colours are inside the picker, not on the page.
    for (const name of ['dark', 'light']) {
      const row = page.getByRole('group', { name: `${name} theme` });
      await expect(row.locator('input[type=color]')).toHaveCount(1);
      await expect(row.getByRole('radiogroup', { name: `Background in the ${name} theme` }).getByRole('radio')).toHaveCount(3);
    }
    await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveCount(0);
    // A ready-made choice comes back from the picker as the shade it is offered in, and is kept as its own value.
    const blue = await offered(dark, 'Blue');
    await dark.fill(blue);
    await light.fill('#ff6600');
    await expect.poll(stored).toEqual({ dark: '#3b82f6', light: '#ff6600' });
    await page.reload(); await page.getByRole('heading', { level: 1, name: 'Make it yours' }).waitFor();
    await expect.poll(stored).toEqual({ dark: '#3b82f6', light: '#ff6600' });
    // The dark theme shows its blue, in the very shade the picker offered and the well shows.
    await expect.poll(() => rootToken(page, '--accent')).toBe(blue);
    await expect(shown(dark)).toHaveCSS('background-color', rgb(blue));
    // The light theme shows its orange, deepened for the light page: the well has that shade, not the colour as picked.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(theme).toBe('light');
    const fill = await rootToken(page, '--accent-fill');
    const [red, green, blueChannel] = [1, 3, 5].map(at => parseInt(fill.slice(at, at + 2), 16));
    expect(red).toBeGreaterThan(green); expect(green).toBeGreaterThan(blueChannel);
    expect(fill).not.toBe('#ff6600');
    await expect(shown(light)).toHaveCSS('background-color', rgb(fill));
    await expect(shown(dark)).toHaveCSS('background-color', rgb(blue));
  });

  test('a chosen colour goes back to the built-in one with its reset button, which then leaves', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await settingsAt(page, '/#/settings');
    const builtIn = await rootToken(page, '--accent');
    const accent = page.getByLabel('Accent in the dark theme', { exact: true });
    await expect(shown(accent)).toHaveCSS('background-color', rgb(builtIn));
    await expect(back(page, 'Accent in the dark theme')).toHaveCount(0);
    await accent.fill('#ff2299');
    await expect.poll(() => rootToken(page, '--accent')).not.toBe(builtIn);
    await expect(back(page, 'Accent in the light theme')).toHaveCount(0); // Only the theme that has a choice.
    await back(page, 'Accent in the dark theme').click();
    await expect(back(page, 'Accent in the dark theme')).toHaveCount(0);
    await expect.poll(() => rootToken(page, '--accent')).toBe(builtIn);
    await expect(shown(accent)).toHaveCSS('background-color', rgb(builtIn));
    await expect(accent).toBeFocused(); // The button left, the focus stays on the control.
    // The built-in colour picked from the picker's own list is no choice either.
    await accent.fill('#ff2299');
    await expect(back(page, 'Accent in the dark theme')).toBeVisible();
    await accent.fill(await offered(accent, 'Green'));
    await expect(back(page, 'Accent in the dark theme')).toHaveCount(0);
    await expect.poll(() => rootToken(page, '--accent')).toBe(builtIn);
    // The same control for every phase colour of either theme: a well shows that theme's own colour until one is chosen, and again after the reset.
    await settingsAt(page, '/#/settings/player');
    const phases = [['Rest colour', '--phase-rest'], ['Paused colour', '--phase-paused'], ['First milestone colour', '--phase-amber'], ['Second milestone colour', '--phase-red']] as const;
    await expect(page.getByRole('group', { name: 'Phase colours' }).locator('input[type=color]')).toHaveCount(8);
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      for (const [phase, token] of phases) {
        const name = `${phase} in the ${theme} theme`, well = page.getByLabel(name, { exact: true }), own = await rootToken(page, token);
        await expect(shown(well)).toHaveCSS('background-color', rgb(own));
        await expect(back(page, name)).toHaveCount(0);
        await well.fill('#ff00ff');
        await expect(shown(well)).not.toHaveCSS('background-color', rgb(own));
        await back(page, name).click();
        await expect(back(page, name)).toHaveCount(0);
        await expect(shown(well)).toHaveCSS('background-color', rgb(own));
      }
    }
    const none = { dark: '', light: '' };
    await expect.poll(() => page.evaluate(() => { const { restColor, markColors, pauseColor } = JSON.parse(localStorage.getItem('openwod.preferences.v1') ?? '{}') as Record<string, unknown>; return { restColor, markColors, pauseColor }; })).toEqual({ restColor: none, markColors: { first: none, second: none }, pauseColor: none });
  });
});
