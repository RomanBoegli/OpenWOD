import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chosenColor, type ColorOptions } from '../../apps/web/src/settings/ColorField';
import { accentTokens, BUILT_IN_COLORS } from '../../apps/web/src/theme';

const OPTIONS: ColorOptions = [['', 'Green'], ['#3b82f6', 'Blue'], ['#ec4899', 'Pink']];
const BUILT_IN = BUILT_IN_COLORS.accent.dark;
const shade = (value: string) => value ? accentTokens(value, 'dark')['--accent'] : BUILT_IN;

describe('colour field', () => {
  it('keeps a ready-made choice as its own value when the picker returns the shade it was offered in', () => {
    expect(shade('#ec4899')).not.toBe('#ec4899');
    expect(chosenColor(shade('#ec4899'), OPTIONS, shade)).toBe('#ec4899');
    expect(chosenColor(shade('#3b82f6').toUpperCase(), OPTIONS, shade)).toBe('#3b82f6');
  });
  it('takes the built-in colour picked from the list as no choice at all', () => {
    expect(chosenColor(BUILT_IN, OPTIONS, shade)).toBe('');
  });
  it('keeps any other colour as picked, in lower case, with or without ready-made choices', () => {
    expect(chosenColor('#FF2299', OPTIONS, shade)).toBe('#ff2299');
    expect(chosenColor('#EC4899', OPTIONS, shade)).toBe('#ec4899');
    expect(chosenColor('#FF00FF', [], value => value || '#f4ca80')).toBe('#ff00ff');
    // Without a list nothing stands for the built-in colour: picking its hex is a choice like any other.
    expect(chosenColor('#F4CA80', [], value => value || '#f4ca80')).toBe('#f4ca80');
  });
});

describe('built-in colours', () => {
  it('mirror the stylesheet in both themes, as a well shows them for the theme that is not in effect too', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../apps/web/src/global.css'), 'utf8');
    const light = css.indexOf(':root[data-theme=light]');
    const token = (name: string, theme: 'dark' | 'light') => new RegExp(`${name}: (#[0-9a-f]{6});`).exec(theme === 'dark' ? css.slice(0, light) : css.slice(light))?.[1];
    for (const theme of ['dark', 'light'] as const) {
      expect(BUILT_IN_COLORS.accent[theme]).toBe(token('--accent', theme));
      expect(BUILT_IN_COLORS.rest[theme]).toBe(token('--phase-rest', theme));
      expect(BUILT_IN_COLORS.paused[theme]).toBe(token('--phase-paused', theme));
      expect(BUILT_IN_COLORS.amber[theme]).toBe(token('--phase-amber', theme));
      expect(BUILT_IN_COLORS.red[theme]).toBe(token('--phase-red', theme));
    }
  });
});
