import { describe, expect, it } from 'vitest';
import { accentTokens } from '../../apps/web/src/theme';

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
});
