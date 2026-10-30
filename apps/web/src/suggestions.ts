import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { normalise } from '../../../packages/domain/src/library';
import { editDistance, rankBySearch } from '../../../packages/domain/src/search';

/**
 * Suggestions from a repertoire of names, shared by the pickers (TagPicker for lists of names, NamePicker for one):
 * ranked typo-tolerant matches, and a nudge when a new name is a typo away from a known one.
 */

/** Loose identity for names: case, accents, punctuation and spacing are ignored. */
export const nameKey = (text: string) => normalise(text).replace(/[^a-z0-9]+/g, ' ').trim();

/** The best matches for what is typed, or the first names when nothing is typed. */
export const suggest = (options: string[], query: string, limit = 7): string[] =>
  query.trim() ? rankBySearch(options, query, option => [{ text: option, weight: 1 }], limit) : options.slice(0, limit);

/** A known name within a typo of a new one, so the repertoire does not fill with near-duplicate spellings. */
export const nearName = (options: string[], query: string): string | undefined =>
  query.trim().length >= 4 ? options.find(option => nameKey(option) !== nameKey(query) && editDistance(nameKey(option), nameKey(query), 2) <= 2) : undefined;

/**
 * Places a suggestion list just below its field, fixed to the viewport rather than absolute inside a dialog, so an
 * open list never adds scroll height to its container. `layout` re-places it when the field changes size.
 */
export function useListBelow(field: RefObject<HTMLElement | null>, showing: boolean, layout?: unknown): CSSProperties | undefined {
  const [anchor, setAnchor] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!showing || !field.current) { setAnchor(undefined); return; }
    const place = () => { const box = field.current!.getBoundingClientRect(); setAnchor({ position: 'fixed', top: box.bottom + 4, left: box.left, minWidth: Math.min(box.width, 360) }); };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [field, showing, layout]);
  return anchor;
}
