import { normalise } from './library';

/**
 * One ranked full-text search for the library ("Pick your next session") and the exercise picker. Every query token
 * must match somewhere; a token matches a word exactly, as a prefix, inside a word, or with a small typo
 * (one edit from four letters, two from eight). Fields carry weights so a title hit outranks a description hit.
 */
export interface SearchField { text: string; weight: number }

export const searchTokens = (text: string): string[] => normalise(text).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);

/** Optimal-string-alignment distance (insert, delete, substitute, swap adjacent) with an early exit above `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, rows[i - 2][j - 2] + 1);
      row[j] = cost;
      best = Math.min(best, cost);
    }
    if (best > limit) return limit + 1;
    rows.push(row);
  }
  return rows[a.length][b.length];
}

const typoBudget = (token: string) => token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;

/** How well one query token matches one word: 0 none, 1 typo or substring, 2 prefix, 3 exact. */
function wordScore(token: string, word: string): number {
  if (word === token) return 3;
  if (word.startsWith(token)) return 2;
  if (word.includes(token)) return 1;
  const budget = typoBudget(token);
  if (!budget) return 0;
  // A typo in the typed prefix ("claen" for "cleans") or in the whole word ("thrustre" for "thrusters").
  return editDistance(token, word.slice(0, token.length), budget) <= budget || editDistance(token, word, budget) <= budget ? 1 : 0;
}

/** Words of a field, plus hyphenated words joined ("pull-ups" also matches "pullups"). */
function fieldWords(text: string): string[] {
  const words = searchTokens(text);
  for (const joined of searchTokens(text.replace(/-/g, ''))) if (!words.includes(joined)) words.push(joined);
  return words;
}

/** Score for a whole query against weighted fields; 0 when any token matches nothing. */
export function searchScore(query: string, fields: SearchField[]): number {
  const tokens = searchTokens(query);
  if (!tokens.length) return 1;
  const words = fields.map(field => ({ weight: field.weight, words: fieldWords(field.text) }));
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    // A hit on a field's first word ("Thrusters" for "thru") edges out one deeper in ("Dumbbell thrusters").
    for (const field of words) field.words.forEach((word, index) => { best = Math.max(best, wordScore(token, word) * field.weight * (index === 0 ? 1.1 : 1)); });
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Items that match the query, best first; ties keep the input order (so a pre-sorted list stays sorted). */
export function rankBySearch<T>(items: T[], query: string, fieldsOf: (item: T) => SearchField[], limit = Infinity): T[] {
  if (!searchTokens(query).length) return items.slice(0, limit);
  return items.map((item, index) => ({ item, index, score: searchScore(query, fieldsOf(item)) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(entry => entry.item);
}
