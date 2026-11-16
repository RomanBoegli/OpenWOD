import { describe, expect, it } from 'vitest';
import { cleanNumberText, parseNumberText, stepNumber } from '../../apps/web/src/NumberInput';

describe('number fields', () => {
  it('keep digits and one point for decimals, and take a comma as the point', () => {
    expect(cleanNumberText('1,5', true)).toBe('1.5');
    expect(cleanNumberText('1.', true)).toBe('1.');
    expect(cleanNumberText('1.2.3', true)).toBe('1.23');
    expect(cleanNumberText('1,2,3', true)).toBe('1.23');
    expect(cleanNumberText('12 kg', true)).toBe('12');
    expect(cleanNumberText('-4e2', true)).toBe('42');
    expect(cleanNumberText('', true)).toBe('');
    expect(cleanNumberText('.', true)).toBe('.');
    expect(cleanNumberText('007', true)).toBe('007');
  });

  it('keep digits only for whole numbers', () => {
    expect(cleanNumberText('1,5', false)).toBe('15');
    expect(cleanNumberText('1.', false)).toBe('1');
    expect(cleanNumberText('x21', false)).toBe('21');
    expect(cleanNumberText('007', false)).toBe('007');
    expect(cleanNumberText('.', false)).toBe('');
  });

  it('read what the text means, and nothing while it is empty or only a point', () => {
    expect(parseNumberText('1.5')).toBe(1.5);
    expect(parseNumberText('1.')).toBe(1);
    expect(parseNumberText('.5')).toBe(0.5);
    expect(parseNumberText('007')).toBe(7);
    expect(parseNumberText('0')).toBe(0);
    for (const text of ['', '.', '1.2.3', '1,5', 'x']) expect(parseNumberText(text)).toBeUndefined();
    // What is typed for one and a half on a comma keypad, as the field reads it.
    expect(parseNumberText(cleanNumberText('1,5', true))).toBe(1.5);
  });

  it('step to the next multiple without rounding dust, and stay put at the bounds', () => {
    expect(stepNumber(10, 1, 1, 1, 999)).toBe(11);
    expect(stepNumber(17.5, 1, 1, .001, 10_000)).toBe(18);
    expect(stepNumber(17.5, -1, 1, .001, 10_000)).toBe(17);
    expect(stepNumber(.2, 1, .1, .001, 1000)).toBe(.3);
    expect(stepNumber(.3, 1, .1, .001, 1000)).toBe(.4);
    expect(stepNumber(1.5, -1, .1, .001, 1000)).toBe(1.4);
    expect(stepNumber(1, -1, 1, 1, 999)).toBe(1);
    expect(stepNumber(999, 1, 1, 1, 999)).toBe(999);
    // A decimal that must stay above zero does not step down onto it.
    expect(stepNumber(1, -1, 1, .001, 1000)).toBe(1);
  });
});
