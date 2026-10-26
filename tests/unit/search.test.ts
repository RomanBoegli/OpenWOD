import { describe, expect, it } from 'vitest';
import { editDistance, rankBySearch, searchScore, searchTokens } from '../../packages/domain/src/search';
import { matchesFilter, searchFields, summariseWorkout } from '../../packages/domain/src/library';
import { fixtureWorkouts } from '../../packages/domain/src/fixtures';

describe('ranked search', () => {
  it('tokenises loosely and measures edit distance with an early exit', () => {
    expect(searchTokens('Toes-to-bar, 21–15–9!')).toEqual(['toes', 'to', 'bar', '21', '15', '9']);
    expect(editDistance('thruster', 'thrustre', 2)).toBe(1); // a swapped pair is one typo
    expect(editDistance('row', 'run', 1)).toBe(2);
    expect(editDistance('clean', 'cleans', 1)).toBe(1);
  });

  it('matches exact words, prefixes, substrings and small typos, and refuses when any token misses', () => {
    const fields = [{ text: 'Hang power cleans', weight: 3 }, { text: 'Barbell', weight: 1 }];
    expect(searchScore('clean', fields)).toBeGreaterThan(0);
    expect(searchScore('cle', fields)).toBeGreaterThan(0);
    expect(searchScore('ower', fields)).toBeGreaterThan(0);
    expect(searchScore('claen', fields)).toBeGreaterThan(0); // one typo at five letters
    expect(searchScore('clean rowing', fields)).toBe(0);
    expect(searchScore('clean rower', fields)).toBeGreaterThan(0); // "rower" is one letter from "power": a forgiven typo
    expect(searchScore('', fields)).toBe(1);
    expect(searchScore('cl', fields)).toBeGreaterThan(0); // two letters: prefix only, no typo budget
    expect(searchScore('xq', fields)).toBe(0);
  });

  it('ranks exact title hits above movement hits and keeps ties in input order', () => {
    const items = [{ title: 'Grace', movements: 'Clean and jerks' }, { title: 'Clean ladder', movements: 'Power cleans' }, { title: 'Cindy', movements: 'Pull-ups Push-ups Air squats' }];
    const ranked = rankBySearch(items, 'clean', item => [{ text: item.title, weight: 3 }, { text: item.movements, weight: 2 }]);
    expect(ranked.map(item => item.title)).toEqual(['Clean ladder', 'Grace']);
    expect(rankBySearch(items, '', item => [{ text: item.title, weight: 1 }])).toEqual(items);
  });

  it('LIB-04: the library search forgives a typo and still requires every token', () => {
    const summaries = fixtureWorkouts.map(workout => summariseWorkout(workout));
    const fran = summaries.find(summary => summary.id === 'fran')!;
    expect(matchesFilter(fran, { query: 'thrustre' })).toBe(true);
    expect(matchesFilter(fran, { query: 'fran pullups' })).toBe(true);
    expect(matchesFilter(fran, { query: 'fran rower' })).toBe(false);
    const ranked = rankBySearch(summaries, 'fran', searchFields);
    expect(ranked[0].id).toBe('fran');
  });
});
