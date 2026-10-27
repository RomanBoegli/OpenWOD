import type { Attribution, Prescription, SectionFormat, Workout, WorkoutNode, WorkoutSection } from './schema';

/**
 * The editor's constrained shape. Every section is: optional rounds of a slot list with explicit rests, optionally
 * followed by a block rest. The section format decides what a slot is: a timed work interval (timed circuit), a manual
 * task with targets (for time, strength), one item of a block (AMRAP, you-go-I-go) or one interval's work (EMOM).
 * Workouts with another structure are reported as not editable instead of being approximated.
 */
export interface BuilderSlot {
  A: Prescription;
  B?: Prescription;
  /** Work length for timed circuits; ignored by manual formats. */
  durationMs: number;
  /** Pair completion rule for manual tasks (for time, strength, EMOM). */
  completion?: 'team' | 'both';
}
export interface BuilderSection {
  title: string;
  format: SectionFormat;
  transitionAfter: 'manualReady' | 'automatic';
  rounds: number;
  betweenRoundsRestMs: number;
  alternate: boolean;
  betweenSlotsRestMs: number;
  trailingRestMs: number;
  /**
   * The rest after the section (BLD-14), for every format. With `transitionAfter: 'automatic'` it is the timed rest
   * before the next section starts on its own. A Ready gate after a rest is kept for timed circuits that had both.
   */
  blockRestMs: number;
  /** Each slot repeated on its own before the next (Tabata: 8 × 20 s with 10 s between). */
  slotRepeats: number;
  slotRepeatRestMs: number;
  /** AMRAP, for time, you-go-I-go. */
  capMs: number;
  /** AMRAP. */
  counter: 'roundsAndReps' | 'rounds' | 'none';
  /** EMOM. */
  intervalMs: number;
  intervals: number;
  /** You-go-I-go: team rounds to complete (0 = by cap only) and an optional fixed turn length. */
  teamRounds: number;
  turnMs: number;
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

/** Formats whose slots are manual tasks. */
export const MANUAL_FORMATS: SectionFormat[] = ['amrap', 'emom', 'forTime', 'youGoIGo', 'strength'];
/** Formats whose body is one flat list of tasks with no rounds, and no rests except the rest after the section. */
export const LIST_FORMATS: SectionFormat[] = ['amrap', 'emom', 'youGoIGo'];

export const emptySlot = (participants: 1 | 2): BuilderSlot => ({ A: { name: '' }, ...(participants === 2 ? { B: { name: '' } } : {}), durationMs: 40_000 });
export const emptySection = (participants: 1 | 2, format: SectionFormat = 'timedCircuit'): BuilderSection => ({
  title: '', format, transitionAfter: 'manualReady', rounds: 1, betweenRoundsRestMs: 60_000, alternate: false, betweenSlotsRestMs: format === 'timedCircuit' ? 10_000 : 0, trailingRestMs: 0, blockRestMs: 0,
  slotRepeats: 1, slotRepeatRestMs: 10_000, capMs: format === 'amrap' ? 600_000 : 0, counter: 'roundsAndReps', intervalMs: 60_000, intervals: 10, teamRounds: 0, turnMs: 0,
  slots: [emptySlot(participants)],
});
export const emptyDraft = (participants: 1 | 2 = 2): BuilderDraft => ({ title: '', description: '', participants, prepMs: 10_000, equipment: [], sections: [{ ...emptySection(participants), title: 'Main' }] });

const tidy = (value: Prescription): Prescription => {
  const result: Prescription = { name: value.name.trim() };
  if (value.shortName?.trim()) result.shortName = value.shortName.trim();
  if (value.spokenName?.trim()) result.spokenName = value.spokenName.trim();
  if (value.reps) result.reps = value.reps;
  if (value.calories) result.calories = value.calories;
  if (value.distance && value.distance.value > 0) result.distance = { ...value.distance };
  if (value.timeMs) result.timeMs = value.timeMs;
  if (value.load) {
    if ('value' in value.load) result.load = { ...value.load };
    else {
      const levels = Object.fromEntries(Object.entries(value.load).filter(([, load]) => load)) as Exclude<Prescription['load'], undefined | { value: number }>;
      if (Object.keys(levels).length) result.load = levels;
    }
  }
  if (value.notes?.trim()) result.notes = value.notes.trim();
  return result;
};

const isManual = (format: SectionFormat) => MANUAL_FORMATS.includes(format);
const isList = (format: SectionFormat) => LIST_FORMATS.includes(format);

function validatePrescription(value: Prescription | undefined, at: string, label: string, issues: BuilderIssue[]) {
  if (!value?.name.trim()) { issues.push({ path: at, message: `${label}: name the movement.` }); return; }
  for (const [field, amount] of [['reps', value.reps], ['calories', value.calories]] as const) if (amount !== undefined && (!Number.isInteger(amount) || amount < 1)) issues.push({ path: `${at}.${field}`, message: `${label}: ${field} must be a whole number above zero.` });
  if (value.distance && !(value.distance.value > 0)) issues.push({ path: `${at}.distance`, message: `${label}: distance must be above zero.` });
  const loads = value.load ? 'value' in value.load ? [value.load] : Object.values(value.load) : [];
  for (const load of loads) if (load && (!Number.isFinite(load.value) || load.value < 0)) issues.push({ path: `${at}.load`, message: `${label}: load cannot be negative.` });
  for (const load of loads) if (load?.women !== undefined && (!Number.isFinite(load.women) || load.women < 0)) issues.push({ path: `${at}.load`, message: `${label}: the women’s load cannot be negative.` });
  for (const load of loads) if (load?.unit === 'percent' && load.women !== undefined) issues.push({ path: `${at}.load`, message: `${label}: a percentage of 1RM takes no women’s value.` });
}

/** Field-level problems in the author's own terms, before the compiler's structural checks run. */
export function validateDraft(draft: BuilderDraft): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  if (!draft.title.trim()) issues.push({ path: 'title', message: 'Give the workout a title.' });
  if (!Number.isInteger(draft.prepMs) || draft.prepMs < 0 || draft.prepMs > 60_000) issues.push({ path: 'prepMs', message: 'Prep is 0 to 60 seconds.' });
  if (!draft.sections.length) issues.push({ path: 'sections', message: 'Add at least one section.' });
  const pair = draft.participants === 2;
  draft.sections.forEach((section, s) => {
    const at = `sections.${s}`;
    const name = `Section ${s + 1}`;
    if (!section.title.trim()) issues.push({ path: `${at}.title`, message: `${name} needs a title.` });
    if (!isList(section.format) && (!Number.isInteger(section.rounds) || section.rounds < 1 || section.rounds > 999)) issues.push({ path: `${at}.rounds`, message: `${name}: rounds must be 1 to 999.` });
    if (section.format === 'timedCircuit' && (!Number.isInteger(section.slotRepeats) || section.slotRepeats < 1 || section.slotRepeats > 999)) issues.push({ path: `${at}.slotRepeats`, message: `${name}: repeats per movement must be 1 to 999.` });
    if (!section.slots.length) issues.push({ path: `${at}.slots`, message: `${name} needs at least one movement.` });
    for (const [field, value] of [['betweenRoundsRestMs', section.betweenRoundsRestMs], ['betweenSlotsRestMs', section.betweenSlotsRestMs], ['trailingRestMs', section.trailingRestMs], ['blockRestMs', section.blockRestMs], ['slotRepeatRestMs', section.slotRepeatRestMs]] as const) {
      if (!Number.isInteger(value) || value < 0) issues.push({ path: `${at}.${field}`, message: `${name}: rests cannot be negative.` });
    }
    if ((section.format === 'amrap' || (section.format === 'youGoIGo' && !section.teamRounds)) && section.capMs < 1000) issues.push({ path: `${at}.capMs`, message: `${name}: ${section.format === 'amrap' ? 'an AMRAP needs a time cap' : 'you-go-I-go needs a cap or a number of team rounds'}.` });
    if (section.format === 'forTime' && section.capMs && section.capMs < 1000) issues.push({ path: `${at}.capMs`, message: `${name}: the cap must be at least 1 second (or empty).` });
    if (section.format === 'emom') {
      if (!Number.isInteger(section.intervalMs) || section.intervalMs < 1000) issues.push({ path: `${at}.intervalMs`, message: `${name}: the interval must be at least 1 second.` });
      if (!Number.isInteger(section.intervals) || section.intervals < 1 || section.intervals > 999) issues.push({ path: `${at}.intervals`, message: `${name}: intervals must be 1 to 999.` });
    }
    if (section.format === 'youGoIGo') {
      if (!pair) issues.push({ path: `${at}.format`, message: `${name}: you-go-I-go needs two athletes.` });
      if (section.turnMs && section.capMs && section.turnMs > section.capMs) issues.push({ path: `${at}.turnMs`, message: `${name}: a turn cannot be longer than the cap.` });
    }
    section.slots.forEach((slot, i) => {
      const slotAt = `${at}.slots.${i}`;
      const label = `${name}, movement ${i + 1}`;
      validatePrescription(slot.A, `${slotAt}.A`, pair ? `${label} (A)` : label, issues);
      if (pair && section.format !== 'youGoIGo') validatePrescription(slot.B, `${slotAt}.B`, `${label} (B)`, issues);
      if (!isManual(section.format) && (!Number.isInteger(slot.durationMs) || slot.durationMs < 1000)) issues.push({ path: `${slotAt}.durationMs`, message: `${label}: work must be at least 1 second.` });
    });
  });
  return issues;
}

/** Builds a workout with deterministic IDs derived from positions, so saving the same draft twice gives the same tree. */
export function builderToWorkout(draft: BuilderDraft, identity: { id: string; revision: number }): Workout {
  const pair = draft.participants === 2;
  const sections = draft.sections.map((section, s): WorkoutSection => {
    const key = `s${s + 1}`;
    const manual = isManual(section.format);
    const standalone = section.format === 'forTime' || section.format === 'strength' || section.format === 'emom';
    // You-go-I-go is one shared work unit: B mirrors A unless the author wrote something for B.
    const assignments = (slot: BuilderSlot) => pair ? { A: tidy(slot.A), B: tidy(section.format === 'youGoIGo' && !slot.B?.name.trim() ? slot.A : slot.B ?? { name: '' }) } : { A: tidy(slot.A) };
    const items: WorkoutNode[] = section.slots.map((slot, i) => {
      const id = `${key}-slot-${i + 1}`;
      if (manual) return { id, type: 'task', assignments: assignments(slot), ...(pair && standalone ? { completion: slot.completion ?? 'team' } : {}) };
      const timed: WorkoutNode = { id, type: 'timed', durationMs: slot.durationMs, assignments: assignments(slot) };
      return section.slotRepeats > 1 ? { id: `${id}-repeats`, type: 'repeat', count: section.slotRepeats, ...(section.slotRepeatRestMs ? { betweenIterationsRestMs: section.slotRepeatRestMs } : {}), body: timed } : timed;
    });
    const base: Omit<WorkoutSection, 'body'> = { id: key, title: section.title.trim(), format: section.format, transitionAfter: section.transitionAfter };
    if (isList(section.format)) {
      // The rest after the section ends the flat task list (BLD-14).
      const rest: WorkoutNode[] = section.blockRestMs > 0 ? [{ id: `${key}-rest`, type: 'rest', kind: 'blockRest', durationMs: section.blockRestMs }] : [];
      const body: WorkoutNode = items.length === 1 && !rest.length ? items[0] : { id: `${key}-list`, type: 'sequence', children: [...items, ...rest] };
      if (section.format === 'amrap') return { ...base, capMs: section.capMs, counter: section.counter, body };
      if (section.format === 'emom') return { ...base, intervalMs: section.intervalMs, intervals: section.intervals, body };
      return { ...base, ...(section.capMs ? { capMs: section.capMs } : {}), ...(section.teamRounds ? { rounds: section.teamRounds } : {}), ...(section.turnMs ? { turnMs: section.turnMs } : {}), body };
    }
    const stations: WorkoutNode = { id: `${key}-stations`, type: 'sequence', ...(section.betweenSlotsRestMs ? { betweenChildrenRestMs: section.betweenSlotsRestMs } : {}), ...(section.trailingRestMs ? { trailingRestMs: section.trailingRestMs } : {}), children: items };
    const rounds: WorkoutNode = section.rounds > 1
      ? { id: `${key}-rounds`, type: 'repeat', count: section.rounds, ...(section.betweenRoundsRestMs ? { betweenIterationsRestMs: section.betweenRoundsRestMs } : {}), ...(section.alternate && pair ? { assignmentPolicy: 'alternate' as const } : {}), body: stations }
      : stations;
    const body: WorkoutNode = section.blockRestMs > 0
      ? { id: `${key}-body`, type: 'sequence', children: [rounds, { id: `${key}-rest`, type: 'rest', kind: 'blockRest', durationMs: section.blockRestMs }] }
      : rounds;
    return { ...base, ...(section.format === 'forTime' && section.capMs ? { capMs: section.capMs } : {}), body };
  });
  const workout: Workout = {
    schemaVersion: 2, id: identity.id, revision: identity.revision, title: draft.title.trim(),
    equipment: draft.equipment.map(item => item.trim()).filter(Boolean), participants: draft.participants, prepMs: draft.prepMs, sections,
  };
  if (draft.description.trim()) workout.description = draft.description.trim();
  if (draft.attribution && Object.values(draft.attribution).some(value => value?.trim())) {
    workout.attribution = Object.fromEntries(Object.entries(draft.attribution).filter(([, value]) => value?.trim()).map(([k, v]) => [k, v!.trim()])) as Attribution;
  }
  return workout;
}

const slotOf = (node: Extract<WorkoutNode, { type: 'timed' | 'task' }>, durationMs: number): BuilderSlot => ({ A: structuredClone(node.assignments.A), ...(node.assignments.B ? { B: structuredClone(node.assignments.B) } : {}), durationMs, ...(node.type === 'task' && node.completion ? { completion: node.completion } : {}) });

function sectionToBuilder(section: WorkoutSection): BuilderSection | null {
  const base = { ...emptySection(2, section.format), title: section.title, transitionAfter: section.transitionAfter, capMs: section.capMs ?? 0, counter: section.counter ?? 'roundsAndReps', intervalMs: section.intervalMs ?? 60_000, intervals: section.intervals ?? 10, teamRounds: section.rounds ?? 0, turnMs: section.turnMs ?? 0 };
  if (isList(section.format)) {
    const children = section.body.type === 'task' ? [section.body] : section.body.type === 'sequence' ? section.body.children : [];
    const ending = children.at(-1);
    const blockRestMs = children.length > 1 && ending?.type === 'rest' ? ending.durationMs : 0;
    const items = blockRestMs ? children.slice(0, -1) : children;
    if (!items.length || !items.every(item => item.type === 'task') || (section.body.type === 'sequence' && (section.body.betweenChildrenRestMs || section.body.trailingRestMs))) return null;
    return { ...base, blockRestMs, slots: items.map(item => slotOf(item as Extract<WorkoutNode, { type: 'task' }>, 0)) };
  }
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
  // A single task or timed slot stands for a one-item list.
  const list = node.type === 'sequence' ? node : { type: 'sequence' as const, id: '', children: [node], betweenChildrenRestMs: undefined, trailingRestMs: undefined };
  const manual = isManual(section.format);
  let slotRepeats = 1;
  let slotRepeatRestMs = 0;
  const slots: BuilderSlot[] = [];
  for (const child of list.children) {
    if (manual) {
      if (child.type !== 'task') return null;
      slots.push(slotOf(child, 0));
    } else if (child.type === 'timed') {
      if (slots.length && slotRepeats !== 1) return null;
      slots.push(slotOf(child, child.durationMs));
    } else if (child.type === 'repeat' && child.body.type === 'timed' && !child.assignmentPolicy) {
      // Tabata-style: each slot repeated on its own; every slot must share the same repeat settings.
      const restMs = child.betweenIterationsRestMs ?? 0;
      if (slots.length && (slotRepeats !== child.count || slotRepeatRestMs !== restMs)) return null;
      slotRepeats = child.count;
      slotRepeatRestMs = restMs;
      slots.push(slotOf(child.body, child.body.durationMs));
    } else return null;
  }
  if (!slots.length) return null;
  return { ...base, rounds, betweenRoundsRestMs, alternate, betweenSlotsRestMs: list.betweenChildrenRestMs ?? 0, trailingRestMs: list.trailingRestMs ?? 0, blockRestMs, slotRepeats, slotRepeatRestMs, slots };
}

/** The inverse mapping, or null when the workout uses a structure the editor cannot represent. */
/**
 * The editor has no field for a rest after the last movement of each round. Opening a workout that has one moves it,
 * at the same length: between rounds it joins the rest between rounds, after the last round the rest between this
 * section and the next, and after the last movement of the workout it is dropped. Only the kind of pause changes.
 */
function foldTrailingRest(section: BuilderSection, last: boolean): BuilderSection {
  const trailing = section.trailingRestMs;
  if (!trailing) return section;
  return {
    ...section,
    trailingRestMs: 0,
    betweenRoundsRestMs: section.rounds > 1 ? section.betweenRoundsRestMs + trailing : section.betweenRoundsRestMs,
    blockRestMs: last ? section.blockRestMs : section.blockRestMs + trailing,
  };
}

export function workoutToBuilder(workout: Workout): BuilderDraft | null {
  const sections: BuilderSection[] = [];
  for (const [index, section] of workout.sections.entries()) {
    const built = sectionToBuilder(section);
    if (!built) return null;
    sections.push(foldTrailingRest(built, index === workout.sections.length - 1));
  }
  return { title: workout.title, description: workout.description ?? '', participants: workout.participants, prepMs: workout.prepMs, equipment: [...workout.equipment], ...(workout.attribution ? { attribution: structuredClone(workout.attribution) } : {}), sections };
}
