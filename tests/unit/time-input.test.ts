import { describe, expect, it } from 'vitest';
import { cleanTimeText, formatTimeText, parseTimeText, stepTime } from '../../apps/web/src/TimeInput';

describe('time fields', () => {
  it('keep only digits and one colon while typing', () => {
    expect(cleanTimeText('1m30s')).toBe('130');
    expect(cleanTimeText('ab01:3c0')).toBe('01:30');
    expect(cleanTimeText('1:2:3')).toBe('1:23');
  });

  it('read m:ss, mm:ss and plain seconds, and reject what is not a time yet', () => {
    expect(parseTimeText('01:30')).toBe(90_000);
    expect(parseTimeText('1:05')).toBe(65_000);
    expect(parseTimeText(':45')).toBe(45_000);
    expect(parseTimeText('90')).toBe(90_000);
    expect(parseTimeText('120:00')).toBe(7_200_000);
    for (const text of ['', '1:', '1:60', '1:5x', '1:234']) expect(parseTimeText(text)).toBeUndefined();
  });

  it('show mm:ss and step to the next multiple within the bounds', () => {
    expect(formatTimeText(90_000)).toBe('01:30');
    expect(formatTimeText(65_500)).toBe('01:05');
    expect(formatTimeText(6_000_000)).toBe('100:00');
    expect(stepTime(62_000, 1, 5000, 0, 600_000)).toBe(65_000);
    expect(stepTime(62_000, -1, 5000, 0, 600_000)).toBe(60_000);
    expect(stepTime(60_000, -1, 5000, 0, 600_000)).toBe(55_000);
    expect(stepTime(2000, -1, 5000, 0, 600_000)).toBe(0);
    expect(stepTime(598_000, 1, 60_000, 0, 600_000)).toBe(600_000);
  });
});
