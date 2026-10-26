import type { Catalogue, Movement } from '../../../../packages/domain/src/catalogue';
import { rankBySearch } from '../../../../packages/domain/src/search';
import { movementSearchFields } from '../MovementPicker';

export interface MovementRow { record: Movement; variant: boolean; /** Listed only because one of its variants matched. */ muted: boolean }

/**
 * Rows for the movements list: family heads first, each followed by its variants, in catalogue order. A search keeps
 * that order and that nesting (rather than the ranked order the picker uses) and always lists the head of a matched
 * variant so a variant never appears without its parent.
 */
export function movementRows(catalogue: Catalogue, query: string): MovementRow[] {
  const all = catalogue.grouped().flatMap(group => [{ record: group.head, variant: false, muted: false }, ...group.variants.map(record => ({ record, variant: true, muted: false }))]);
  if (!query.trim()) return all;
  const matched = new Set(rankBySearch(catalogue.records, query, movementSearchFields(catalogue)).map(record => record.id));
  const heads = new Set(all.filter(row => matched.has(row.record.id) && row.variant && row.record.family).map(row => row.record.family!));
  return all.filter(row => matched.has(row.record.id) || heads.has(row.record.id)).map(row => ({ ...row, muted: !matched.has(row.record.id) }));
}
