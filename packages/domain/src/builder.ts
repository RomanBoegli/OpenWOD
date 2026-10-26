import type { Attribution, Prescription, Workout, WorkoutNode } from './schema';

/**
 * The editor's constrained shape for timed circuits. Every section is: optional rounds of a slot sequence with
 * explicit rests, optionally followed by a block rest. Both bundled circuits and most examples fit it; a workout
 * with another structure is reported as not editable instead of being approximated.
 */
export interface BuilderSlot { A: Prescription; B?: Prescription; durationMs: number }
export interface BuilderSection {
  title: string;
  transitionAfter: 'manualReady' | 'automatic';
  rounds: number;
  betweenRoundsRestMs: number;
  alternate: boolean;
  betweenSlotsRestMs: number;
  trailingRestMs: number;
  blockRestMs: number;
  slots: BuilderSlot[];
}
export interface BuilderDraft {
  title: string;
  description: string;
  participants: 1 | 2;
  prepMs: number;
  equipment: string[];
  attribution?: Attribution;
  sections: BuilderSection[];
}
export interface BuilderIssue { path: string; message: string }

export const emptySlot = (participants: 1 | 2): BuilderSlot => ({ A: { name: '' }, ...(participants === 2 ? { B: { name: '' } } : {}), durationMs: 40_000 });
export const emptySection = (participants: 1 | 2): BuilderSection => ({ title: '', transitionAfter: 'manualReady', rounds: 1, betweenRoundsRestMs: 60_000, alternate: false, betweenSlotsRestMs: 10_000, trailingRestMs: 0, blockRestMs: 0, slots: [emptySlot(participants)] });
export const emptyDraft = (participants: 1 | 2 = 2): BuilderDraft => ({ title: '', description: '', participants, prepMs: 10_000, equipment: [], sections: [{ ...emptySection(participants), title: 'Main' }] });

const tidy = (value: Prescription): Prescription => {
  const result: Prescription = { name: value.name.trim() };
  if (value.shortName?.trim()) result.shortName = value.shortName.trim();
  if (value.spokenName?.trim()) result.spokenName = value.spokenName.trim();
  if (value.reps) result.reps = value.reps;
  if (value.load) result.load = value.load;
  if (value.notes?.trim()) result.notes = value.notes.trim();
  return result;
};

/** Field-level problems in the author's own terms, before the compiler's structural checks run. */
export function validateDraft(draft: BuilderDraft): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  if (!draft.title.trim()) issues.push({ path: 'title', message: 'Give the workout a title.' });
  if (!Number.isInteger(draft.prepMs) || draft.prepMs < 0 || draft.prepMs > 60_000) issues.push({ path: 'prepMs', message: 'Prep is 0 to 60 seconds.' });
  if (!draft.sections.length) issues.push({ path: 'sections', message: 'Add at least one section.' });
  draft.sections.forEach((section, s) => {
    const at = `sections.${s}`;
    if (!section.title.trim()) issues.push({ path: `${at}.title`, message: `Section ${s + 1} needs a title.` });
    if (!Number.isInteger(section.rounds) || section.rounds < 1 || section.rounds > 999) issues.push({ path: `${at}.rounds`, message: `Section ${s + 1}: rounds must be 1 to 999.` });
    if (!section.slots.length) issues.push({ path: `${at}.slots`, message: `Section ${s + 1} needs at least one slot.` });
    for (const [field, value] of [['betweenRoundsRestMs', section.betweenRoundsRestMs], ['betweenSlotsRestMs', section.betweenSlotsRestMs], ['trailingRestMs', section.trailingRestMs], ['blockRestMs', section.blockRestMs]] as const) {
      if (!Number.isInteger(value) || value < 0) issues.push({ path: `${at}.${field}`, message: `Section ${s + 1}: rests cannot be negative.` });
    }
    section.slots.forEach((slot, i) => {
      const slotAt = `${at}.slots.${i}`;
      if (!slot.A.name.trim()) issues.push({ path: `${slotAt}.A`, message: `Section ${s + 1}, slot ${i + 1}: name the movement${draft.participants === 2 ? ' for A' : ''}.` });
      if (draft.participants === 2 && !slot.B?.name.trim()) issues.push({ path: `${slotAt}.B`, message: `Section ${s + 1}, slot ${i + 1}: name the movement for B.` });
      if (!Number.isInteger(slot.durationMs) || slot.durationMs < 1000) issues.push({ path: `${slotAt}.durationMs`, message: `Section ${s + 1}, slot ${i + 1}: work must be at least 1 second.` });
    });
  });
  return issues;
}

/** Builds a workout with deterministic IDs derived from positions, so saving the same draft twice gives the same tree. */
export function builderToWorkout(draft: BuilderDraft, identity: { id: string; revision: number }): Workout {
  const sections = draft.sections.map((section, s): Workout['sections'][number] => {
    const key = `s${s + 1}`;
    const slots: WorkoutNode[] = section.slots.map((slot, i) => ({
      id: `${key}-slot-${i + 1}`, type: 'timed', durationMs: slot.durationMs,
      assignments: draft.participants === 2 ? { A: tidy(slot.A), B: tidy(slot.B ?? { name: '' }) } : { A: tidy(slot.A) },
    }));
    const stations: WorkoutNode = { id: `${key}-stations`, type: 'sequence', ...(section.betweenSlotsRestMs ? { betweenChildrenRestMs: section.betweenSlotsRestMs } : {}), ...(section.trailingRestMs ? { trailingRestMs: section.trailingRestMs } : {}), children: slots };
    const rounds: WorkoutNode = section.rounds > 1
      ? { id: `${key}-rounds`, type: 'repeat', count: section.rounds, ...(section.betweenRoundsRestMs ? { betweenIterationsRestMs: section.betweenRoundsRestMs } : {}), ...(section.alternate && draft.participants === 2 ? { assignmentPolicy: 'alternate' as const } : {}), body: stations }
      : stations;
    const body: WorkoutNode = section.blockRestMs > 0
      ? { id: `${key}-body`, type: 'sequence', children: [rounds, { id: `${key}-rest`, type: 'rest', kind: 'blockRest', durationMs: section.blockRestMs }] }
      : rounds;
    return { id: key, title: section.title.trim(), format: 'timedCircuit', transitionAfter: section.transitionAfter, body };
  });
  const workout: Workout = {
    schemaVersion: 1, id: identity.id, revision: identity.revision, title: draft.title.trim(),
    equipment: draft.equipment.map(item => item.trim()).filter(Boolean), participants: draft.participants, prepMs: draft.prepMs, sections,
  };
  if (draft.description.trim()) workout.description = draft.description.trim();
  if (draft.attribution && Object.values(draft.attribution).some(value => value?.trim())) {
    workout.attribution = Object.fromEntries(Object.entries(draft.attribution).filter(([, value]) => value?.trim()).map(([k, v]) => [k, v!.trim()])) as Attribution;
  }
  return workout;
}

function sectionToBuilder(section: Workout['sections'][number]): BuilderSection | null {
  let node = section.body;
  let blockRestMs = 0;
  if (node.type === 'sequence' && node.children.length === 2 && node.children[1].type === 'rest' && !node.betweenChildrenRestMs && !node.trailingRestMs) {
    blockRestMs = node.children[1].durationMs;
    node = node.children[0];
  }
  let rounds = 1;
  let betweenRoundsRestMs = 0;
  let alternate = false;
  if (node.type === 'repeat') {
    rounds = node.count;
    betweenRoundsRestMs = node.betweenIterationsRestMs ?? 0;
    alternate = node.assignmentPolicy === 'alternate';
    node = node.body;
  }
  if (node.type !== 'sequence' || !node.children.every(child => child.type === 'timed')) return null;
  return {
    title: section.title, transitionAfter: section.transitionAfter, rounds, betweenRoundsRestMs, alternate,
    betweenSlotsRestMs: node.betweenChildrenRestMs ?? 0, trailingRestMs: node.trailingRestMs ?? 0, blockRestMs,
    slots: node.children.map(child => child.type === 'timed' ? { A: structuredClone(child.assignments.A), ...(child.assignments.B ? { B: structuredClone(child.assignments.B) } : {}), durationMs: child.durationMs } : null).filter((slot): slot is BuilderSlot => slot !== null),
  };
}

/** The inverse mapping, or null when the workout uses a structure the editor cannot represent. */
export function workoutToBuilder(workout: Workout): BuilderDraft | null {
  const sections: BuilderSection[] = [];
  for (const section of workout.sections) {
    const built = sectionToBuilder(section);
    if (!built) return null;
    sections.push(built);
  }
  return { title: workout.title, description: workout.description ?? '', participants: workout.participants, prepMs: workout.prepMs, equipment: [...workout.equipment], ...(workout.attribution ? { attribution: structuredClone(workout.attribution) } : {}), sections };
}
