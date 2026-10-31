import { mapSlots, slotsOf, type BuilderDraft } from '../../../packages/domain/src/builder';
import type { Catalogue, Movement } from '../../../packages/domain/src/catalogue';
import { inferEquipment } from '../../../packages/domain/src/library';
import type { Prescription, Workout, WorkoutNode } from '../../../packages/domain/src/schema';
import { freeMovementId } from './master-data';
import { movementSlug } from '../../../packages/domain/src/catalogue';

/**
 * Linking prescriptions to movement records. A prescription whose name resolves gets the record's id; names stay as
 * written, so a workout file never depends on the catalogue (SHR-02). Unmatched names are what the editor highlights.
 */
export function linkPrescription(prescription: Prescription, catalogue: Catalogue): Prescription {
  if (prescription.movement && catalogue.get(prescription.movement)) return prescription;
  const record = catalogue.byName(prescription.name);
  if (!record) { if (!prescription.movement) return prescription; const { movement: _stale, ...rest } = prescription; return rest; }
  return { ...prescription, movement: record.id };
}

export function linkDraft(draft: BuilderDraft, catalogue: Catalogue): BuilderDraft {
  return { ...draft, sections: draft.sections.map(section => ({ ...section, slots: mapSlots(section.slots, slot => ({ ...slot, A: linkPrescription(slot.A, catalogue), ...(slot.B ? { B: linkPrescription(slot.B, catalogue) } : {}) })) })) };
}

export function linkWorkout(workout: Workout, catalogue: Catalogue): Workout {
  const walk = (node: WorkoutNode): WorkoutNode => {
    if (node.type === 'timed' || node.type === 'task') return { ...node, assignments: { A: linkPrescription(node.assignments.A, catalogue), ...(node.assignments.B ? { B: linkPrescription(node.assignments.B, catalogue) } : {}) } };
    if (node.type === 'sequence') return { ...node, children: node.children.map(walk) };
    if (node.type === 'repeat') return { ...node, body: walk(node.body) };
    return node;
  };
  return { ...workout, sections: workout.sections.map(section => ({ ...section, body: walk(section.body) })) };
}

/** Movement names in a draft that no record knows, each once, in authored order. */
export function unmatchedMovements(draft: BuilderDraft, catalogue: Catalogue): string[] {
  const names: string[] = [];
  for (const section of draft.sections) for (const slot of slotsOf(section.slots)) for (const prescription of [slot.A, slot.B]) {
    if (!prescription || !prescription.name.trim() || catalogue.resolve(prescription)) continue;
    if (!names.some(name => name.toLowerCase() === prescription.name.trim().toLowerCase())) names.push(prescription.name.trim());
  }
  return names;
}

/** A new record for a name the catalogue does not know, with equipment guessed from the name as a starting point. */
export function recordForName(name: string, catalogue: Catalogue, declaredEquipment: string[] = []): Movement {
  const clean = name.trim();
  const equipment = inferEquipment([clean], declaredEquipment);
  return { id: freeMovementId(movementSlug(clean), catalogue), name: clean, ...(equipment.length ? { equipment } : {}) };
}
