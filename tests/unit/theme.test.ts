import { describe, expect, it } from 'vitest';
import { accentTokens, DARK_BACKGROUNDS, LIGHT_BACKGROUNDS, neutralTokens, restTokens } from '../../apps/web/src/theme';

const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const lightness = (color: string) => [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)).reduce((sum, part) => sum + part, 0) / 3;

describe('accent colour', () => {
  it('derives every token as a colour, light in the dark theme and deep in the light theme, from the chosen hue', () => {
    const dark = accentTokens('#ec4899', 'dark');
    const light = accentTokens('#ec4899', 'light');
    for (const tokens of [dark, light]) for (const value of Object.values(tokens)) expect(value).toMatch(hex);
    expect(lightness(dark['--accent'])).toBeGreaterThan(170);
    expect(lightness(light['--accent-fill'])).toBeLessThan(110);
    expect(dark['--accent-ink']).not.toBe('#ffffff');
    expect(light['--accent-ink']).toBe('#ffffff');
    expect(dark['--phase-work']).toBe(dark['--accent']);
  });
  it('keeps a grey or washed-out choice saturated enough to read as an accent', () => {
    expect(accentTokens('#808080', 'dark')['--accent']).not.toMatch(/^#(..)\1\1$/);
  });
  it('tints the rest colour like the accent: light in the dark theme, deep in the light theme', () => {
    const dark = restTokens('#ec4899', 'dark')['--phase-rest'], light = restTokens('#ec4899', 'light')['--phase-rest'];
    expect(dark).toMatch(hex); expect(light).toMatch(hex);
    expect(lightness(dark)).toBeGreaterThan(170);
    expect(lightness(light)).toBeLessThan(120);
    // The built-in blue is already at the target lightness, so choosing it changes nothing visible.
    expect(restTokens('#a3cbf0', 'dark')['--phase-rest']).toBe('#a3cbf0');
  });
});

const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (color: string) => { const [r, g, b] = [1, 3, 5].map(at => channel(parseInt(color.slice(at, at + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hueOf = (color: string) => { const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)); return r > g && r > b ? 'red' : g > r && g > b ? 'green' : 'blue'; };

describe('background depth and tinted neutrals', () => {
  it('orders the depths: black is darker than deep, deep than grey, white is brighter than paper, paper than grey', () => {
    const bg = (depth: Parameters<typeof neutralTokens>[1], theme: 'dark' | 'light') => lightness(neutralTokens('', depth, theme)['--bg']);
    expect(bg('black', 'dark')).toBeLessThan(bg('deep', 'dark'));
    expect(bg('deep', 'dark')).toBeLessThan(bg('grey', 'dark'));
    expect(bg('white', 'light')).toBeGreaterThan(bg('paper', 'light'));
    expect(bg('paper', 'light')).toBeGreaterThan(bg('grey', 'light'));
  });
  it('takes the hue of the chosen accent, so an orange accent no longer leaves a green background', () => {
    expect(hueOf(neutralTokens('', 'deep', 'dark')['--bg'])).toBe('green');
    expect(hueOf(neutralTokens('#f97316', 'deep', 'dark')['--bg'])).toBe('red');
    expect(hueOf(neutralTokens('#3b82f6', 'paper', 'light')['--bg-glow'].slice(0, 7))).toBe('blue');
    for (const value of Object.values(neutralTokens('#8b5cf6', 'grey', 'dark'))) expect(value).toMatch(hex);
  });
  it('reproduces the built-in deep and paper backgrounds closely when no accent is chosen', () => {
    expect(Math.abs(lightness(neutralTokens('', 'deep', 'dark')['--bg']) - lightness('#101613'))).toBeLessThan(2);
    expect(Math.abs(lightness(neutralTokens('', 'paper', 'light')['--bg']) - lightness('#f3f5ee'))).toBeLessThan(2);
  });
  it('keeps the text readable on the page and the cards at every depth and accent', () => {
    for (const accent of ['', '#f97316', '#3b82f6', '#ec4899']) {
      for (const [theme, depths] of [['dark', DARK_BACKGROUNDS], ['light', LIGHT_BACKGROUNDS]] as const) {
        for (const depth of depths) {
          const tokens = neutralTokens(accent, depth, theme);
          for (const ground of [tokens['--bg'], tokens['--surface-1'], tokens['--surface-2']]) {
            expect(contrast(tokens['--ink'], ground), `${theme} ${depth} ink`).toBeGreaterThan(9);
            expect(contrast(tokens['--ink-2'], ground), `${theme} ${depth} ink-2`).toBeGreaterThan(7);
            expect(contrast(tokens['--ink-3'], ground), `${theme} ${depth} ink-3`).toBeGreaterThan(4.5);
            expect(contrast(tokens['--ink-4'], ground), `${theme} ${depth} ink-4`).toBeGreaterThan(3);
          }
        }
      }
    }
  });
});
