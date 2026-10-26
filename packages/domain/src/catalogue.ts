import { normalise } from './library';
import type { LoadLevel } from './schema';

/**
 * Exercises as first-class records. The model is deliberately flat: every variant ("Hang power cleans",
 * "Kipping pull-ups") is its own record with its own names, equipment and loads, and an optional `family` links it
 * to one parent record ("Cleans", "Pull-ups"). There is no modifier algebra and no generated naming; families only
 * group the picker, roll up search and give housekeeping a "variants of" view. Workout files keep their free-text
 * names and may carry a `movement` id beside them (SHR-02); editing a record never rewrites a workout (LIB-02).
 */
export type MovementCategory = 'weightlifting' | 'gymnastics' | 'monostructural' | 'strength' | 'conditioning' | 'mobility';
export const MOVEMENT_CATEGORIES: MovementCategory[] = ['weightlifting', 'gymnastics', 'monostructural', 'strength', 'conditioning', 'mobility'];
export const CATEGORY_LABELS: Record<MovementCategory, string> = { weightlifting: 'Weightlifting', gymnastics: 'Gymnastics', monostructural: 'Monostructural', strength: 'Strength', conditioning: 'Conditioning', mobility: 'Mobility' };

export interface MovementLoads { unit: 'kg' | 'lb'; men: Record<LoadLevel, number>; women: Record<LoadLevel, number> }

export interface Movement {
  /** Stable slug such as `hang-power-clean`; this is what a prescription's `movement` key points at. */
  id: string;
  /** Display name as workouts write it, usually plural: "Thrusters". */
  name: string;
  /** Shorter display name for the player, when the name is long. */
  shortName?: string;
  /** What the device voice says, when the name reads badly aloud ("DB" → "dumbbell"). */
  spokenName?: string;
  /** Other spellings that resolve to this record: "Wall-ball shots", "WB". */
  aliases?: string[];
  /** Parent record id for a variant; one level only. */
  family?: string;
  /** Canonical equipment names as the library uses them ("Barbell", "Pull-up bar"). Empty means bodyweight. */
  equipment?: string[];
  category?: MovementCategory;
  /** Default light/medium/heavy loads for men and women, applied when a workout names the movement without levels. */
  loads?: MovementLoads;
  /** Standards, scaling, coaching notes. Never executed. */
  notes?: string;
}

/** Loose identity for movement names: case, accents, punctuation and a plural s per word are ignored ("Push presses" ≈ "push press", "Toes-to-bar" ≈ "toe to bar"). */
export function movementKey(name: string): string {
  return normalise(name).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(singular).join(' ');
}
function singular(word: string): string {
  if (word.length <= 3 || !word.endsWith('s') || word.endsWith('ss')) return word;
  if (/(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

export const MOVEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function movementSlug(name: string): string {
  return movementKey(name).replace(/\s+/g, '-').slice(0, 80) || 'movement';
}

/** A catalogue with its lookups built once; records are never mutated. */
export class Catalogue {
  readonly records: Movement[];
  private readonly byId = new Map<string, Movement>();
  private readonly byKey = new Map<string, Movement>();

  constructor(records: Movement[]) {
    this.records = [...records].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    for (const record of this.records) this.byId.set(record.id, record);
    // Names win over aliases so an alias never shadows another record's proper name.
    for (const record of this.records) for (const alias of record.aliases ?? []) if (!this.byKey.has(movementKey(alias))) this.byKey.set(movementKey(alias), record);
    for (const record of this.records) this.byKey.set(movementKey(record.name), record);
  }

  get(id: string): Movement | undefined { return this.byId.get(id); }
  /** The record for a prescription: its `movement` id when it resolves, otherwise an exact name or alias match. */
  resolve(prescription: { movement?: string; name: string }): Movement | undefined {
    return (prescription.movement && this.byId.get(prescription.movement)) || this.byKey.get(movementKey(prescription.name));
  }
  byName(name: string): Movement | undefined { return this.byKey.get(movementKey(name)); }
  /** The family head for a record, or the record itself when it has no parent or the parent is unknown. */
  head(record: Movement): Movement { return (record.family && this.byId.get(record.family)) || record; }
  variants(id: string): Movement[] { return this.records.filter(record => record.family === id); }
  /** Records that are family heads or stand alone, each followed by its variants, alphabetical within. */
  grouped(): { head: Movement; variants: Movement[] }[] {
    return this.records.filter(record => !record.family || !this.byId.has(record.family)).map(head => ({ head, variants: this.variants(head.id) }));
  }
  /** Equipment for a prescription from its record, or an empty list when unknown. */
  equipmentOf(prescription: { movement?: string; name: string }): string[] { return [...(this.resolve(prescription)?.equipment ?? [])]; }
}
