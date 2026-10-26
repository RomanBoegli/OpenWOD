import type { Catalogue } from '../../../packages/domain/src/catalogue';
import { equipmentKey, equipmentOptions, type WorkoutSummary } from '../../../packages/domain/src/library';

/** Every equipment name the app knows: the catalogue's canonical names, what library workouts declare, and your own list. Deduplicated loosely, sorted. */
export function equipmentRepertoire(catalogue: Catalogue, summaries: WorkoutSummary[] = [], extra: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const name of [...catalogue.records.flatMap(record => record.equipment ?? []), ...equipmentOptions(summaries), ...extra]) if (name.trim() && !seen.has(equipmentKey(name))) seen.set(equipmentKey(name), name.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
