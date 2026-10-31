import { MAX_REPEAT_DEPTH } from './compiler';
import { FORMAT_LABELS, type Attribution, type Prescription, type SectionFormat, type Workout, type WorkoutNode, type WorkoutSection } from './schema';

/**
 * The editor's shape. Every section is: optional rounds of a list with explicit rests, optionally followed by a block
 * rest. The section format decides what a movement is: a timed work interval (timed circuit), a manual task with
 * targets (for time, strength), one item of a block (AMRAP, you-go-I-go) or one interval's work (EMOM). Timed circuit,
 * for time and strength lists also hold rests of their own length and groups with their own rounds, so every workout
 * the compiler accepts opens here (BLD-15).
 */
export interface BuilderSlot {
  /** Movements carry no kind, so drafts stored before rests and groups existed stay valid. */
  kind?: undefined;
  A: Prescription;
  B?: Prescription;
  /** Work length for timed circuits and timed movements; ignored by manual work. */
  durationMs: number;
  /** Pair completion rule for manual tasks (for time, strength, EMOM). */
  completion?: 'team' | 'both';
  /** A movement on the clock inside a for time or strength block; a timed circuit times every movement. */
  timed?: boolean;
}
export type RestKind = NonNullable<Extract<WorkoutNode, { type: 'rest' }>['kind']>;
/** A rest at its own place in a list, with its own length. */
export interface BuilderRest { kind: 'rest'; durationMs: number; restKind?: RestKind }
/** Movements with their own rounds inside a block, such as each set of a circuit or a superset (BLD-03). */
export interface BuilderGroup { kind: 'group'; rounds: number; betweenRoundsRestMs: number; alternate: boolean; betweenSlotsRestMs: number; slots: BuilderItem[] }
export type BuilderItem = BuilderSlot | BuilderRest | BuilderGroup;
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
  slots: BuilderItem[];
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
export const emptyRest = (): BuilderRest => ({ kind: 'rest', durationMs: 30_000 });
export const emptyGroup = (participants: 1 | 2, format: SectionFormat): BuilderGroup => ({ kind: 'group', rounds: 2, betweenRoundsRestMs: 0, alternate: false, betweenSlotsRestMs: format === 'timedCircuit' ? 10_000 : 0, slots: [emptySlot(participants)] });

export const isSlot = (item: BuilderItem): item is BuilderSlot => item.kind === undefined;
/** Every movement of a list, inside groups too, in order. */
export const slotsOf = (items: BuilderItem[]): BuilderSlot[] => items.flatMap(item => item.kind === 'group' ? slotsOf(item.slots) : isSlot(item) ? [item] : []);
/** The list with `change` applied to every movement, inside groups too. */
export const mapSlots = (items: BuilderItem[], change: (slot: BuilderSlot) => BuilderSlot): BuilderItem[] => items.map(item => item.kind === 'group' ? { ...item, slots: mapSlots(item.slots, change) } : isSlot(item) ? change(item) : item);
/** Nested repeat levels the section compiles to: block rounds, per-movement repeats and groups of more than one round. */
function repeatLevels(section: BuilderSection): number {
  const inner = (items: BuilderItem[]): number => Math.max(0, ...items.map(item => item.kind === 'group' ? (item.rounds > 1 ? 1 : 0) + inner(item.slots) : 0));
  const own = section.format === 'timedCircuit' && section.slotRepeats > 1 && section.slots.some(isSlot) ? 1 : 0;
  return (section.rounds > 1 ? 1 : 0) + Math.max(own, inner(section.slots));
}

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
/** Manual formats whose movements may also run on the clock. */
export const TIMED_MOVEMENT_FORMATS: SectionFormat[] = ['forTime', 'strength'];
/** Whether a movement runs on the clock: every one in a timed circuit, the marked ones in for time and strength. */
export const isTimed = (format: SectionFormat, slot: BuilderSlot) => format === 'timedCircuit' || (TIMED_MOVEMENT_FORMATS.includes(format) && slot.timed === true);

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
  if (!draft.sections.length) issues.push({ path: 'sections', message: 'Add at least one block.' });
  const pair = draft.participants === 2;
  draft.sections.forEach((section, s) => {
    const at = `sections.${s}`;
    const name = `Block ${s + 1}`;
    if (!section.title.trim()) issues.push({ path: `${at}.title`, message: `${name} needs a title.` });
    if (!isList(section.format) && (!Number.isInteger(section.rounds) || section.rounds < 1 || section.rounds > 999)) issues.push({ path: `${at}.rounds`, message: `${name}: rounds must be 1 to 999.` });
    if (section.format === 'timedCircuit' && (!Number.isInteger(section.slotRepeats) || section.slotRepeats < 1 || section.slotRepeats > 999)) issues.push({ path: `${at}.slotRepeats`, message: `${name}: repeats per movement must be 1 to 999.` });
    if (!slotsOf(section.slots).length) issues.push({ path: `${at}.slots`, message: `${name} needs at least one movement.` });
    if (isList(section.format) && !section.slots.every(isSlot)) issues.push({ path: `${at}.slots`, message: `${name}: ${FORMAT_LABELS[section.format]} blocks list movements only; remove the rests and groups.` });
    else if (!isList(section.format) && repeatLevels(section) > MAX_REPEAT_DEPTH) issues.push({ path: `${at}.slots`, message: `${name}: use at most two levels of rounds, such as rounds of the block and rounds of a group.` });
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
    const items = (list: BuilderItem[], listAt: string, where: string) => list.forEach((item, i) => {
      const itemAt = `${listAt}.${i}`;
      if (item.kind === 'rest') {
        if (!Number.isInteger(item.durationMs) || item.durationMs < 1000) issues.push({ path: `${itemAt}.durationMs`, message: `${where}, rest ${i + 1}: a rest is at least 1 second.` });
        return;
      }
      if (item.kind === 'group') {
        const label = `${where}, group ${i + 1}`;
        if (!slotsOf(item.slots).length) issues.push({ path: `${itemAt}.slots`, message: `${label} needs at least one movement.` });
        if (!Number.isInteger(item.rounds) || item.rounds < 1 || item.rounds > 999) issues.push({ path: `${itemAt}.rounds`, message: `${label}: rounds must be 1 to 999.` });
        if (![item.betweenRoundsRestMs, item.betweenSlotsRestMs].every(value => Number.isInteger(value) && value >= 0)) issues.push({ path: `${itemAt}.rest`, message: `${label}: rests cannot be negative.` });
        items(item.slots, `${itemAt}.slots`, label);
        return;
      }
      const label = `${where}, movement ${i + 1}`;
      validatePrescription(item.A, `${itemAt}.A`, pair ? `${label} (A)` : label, issues);
      if (pair && section.format !== 'youGoIGo') validatePrescription(item.B, `${itemAt}.B`, `${label} (B)`, issues);
      if (isTimed(section.format, item) && (!Number.isInteger(item.durationMs) || item.durationMs < 1000)) issues.push({ path: `${itemAt}.durationMs`, message: `${label}: work must be at least 1 second.` });
    });
    items(section.slots, `${at}.slots`, name);
  });
  return issues;
}

/** Builds a workout with deterministic IDs derived from positions, so saving the same draft twice gives the same tree. */
export function builderToWorkout(draft: BuilderDraft, identity: { id: string; revision: number }): Workout {
  const pair = draft.participants === 2;
  const sections = draft.sections.map((section, s): WorkoutSection => {
    const key = `s${s + 1}`;
    const standalone = section.format === 'forTime' || section.format === 'strength' || section.format === 'emom';
    // You-go-I-go is one shared work unit: B mirrors A unless the author wrote something for B.
    const assignments = (slot: BuilderSlot) => pair ? { A: tidy(slot.A), B: tidy(section.format === 'youGoIGo' && !slot.B?.name.trim() ? slot.A : slot.B ?? { name: '' }) } : { A: tidy(slot.A) };
    // A group's children take its position as their prefix: s2-slot-3 is the group, s2-slot-3-1 its first movement.
    const nodes = (list: BuilderItem[], prefix: string, top: boolean): WorkoutNode[] => list.map((item, i): WorkoutNode => {
      const id = `${prefix}-${i + 1}`;
      if (item.kind === 'rest') return { id, type: 'rest', kind: item.restKind ?? 'transition', durationMs: item.durationMs };
      if (item.kind === 'group') {
        const body: WorkoutNode = { id: `${id}-list`, type: 'sequence', ...(item.betweenSlotsRestMs ? { betweenChildrenRestMs: item.betweenSlotsRestMs } : {}), children: nodes(item.slots, id, false) };
        return item.rounds > 1
          ? { id, type: 'repeat', count: item.rounds, ...(item.betweenRoundsRestMs ? { betweenIterationsRestMs: item.betweenRoundsRestMs } : {}), ...(item.alternate && pair ? { assignmentPolicy: 'alternate' as const } : {}), body }
          : { ...body, id };
      }
      if (!isTimed(section.format, item)) return { id, type: 'task', assignments: assignments(item), ...(pair && standalone ? { completion: item.completion ?? 'team' } : {}) };
      const timed: WorkoutNode = { id, type: 'timed', durationMs: item.durationMs, assignments: assignments(item) };
      return top && section.format === 'timedCircuit' && section.slotRepeats > 1 ? { id: `${id}-repeats`, type: 'repeat', count: section.slotRepeats, ...(section.slotRepeatRestMs ? { betweenIterationsRestMs: section.slotRepeatRestMs } : {}), body: timed } : timed;
    });
    const items = nodes(section.slots, `${key}-slot`, true);
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
    // Rests between or after the tasks of a list have no effect on these formats, so they are not carried.
    if (!items.length || !items.every(item => item.type === 'task')) return null;
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
  // Tabata-style: each movement repeated on its own, all with the same repeat settings.
  const repeated = list.children.filter((child): child is Extract<WorkoutNode, { type: 'repeat' }> => child.type === 'repeat' && child.body.type === 'timed' && !child.assignmentPolicy);
  const [first] = repeated;
  const perSlot = section.format === 'timedCircuit' && first && repeated.length === list.children.length && repeated.every(child => child.count === first.count && (child.betweenIterationsRestMs ?? 0) === (first.betweenIterationsRestMs ?? 0)) ? first : undefined;
  const slots = (perSlot ? repeated.map(child => child.body) : list.children).map(child => itemOf(child, section.format));
  if (!slots.length || slots.some(item => item === null)) return null;
  const repeats = perSlot ? { slotRepeats: perSlot.count, slotRepeatRestMs: perSlot.betweenIterationsRestMs ?? 0 } : { slotRepeats: 1, slotRepeatRestMs: 0 };
  return { ...base, rounds, betweenRoundsRestMs, alternate, betweenSlotsRestMs: list.betweenChildrenRestMs ?? 0, trailingRestMs: list.trailingRestMs ?? 0, blockRestMs, ...repeats, slots: slots as BuilderItem[] };
}

/**
 * One node of a list as an editor item: a movement, a rest at its place, or a group for a repeat or a nested list.
 * Null only for a node the compiler rejects in this format, such as a manual task in a timed circuit.
 */
function itemOf(node: WorkoutNode, format: SectionFormat): BuilderItem | null {
  if (node.type === 'timed') return { ...slotOf(node, node.durationMs), ...(TIMED_MOVEMENT_FORMATS.includes(format) ? { timed: true } : {}) };
  if (node.type === 'task') return isManual(format) ? slotOf(node, 0) : null;
  if (node.type === 'rest') return { kind: 'rest', durationMs: node.durationMs, ...(node.kind ? { restKind: node.kind } : {}) };
  const repeat = node.type === 'repeat' ? node : undefined;
  const body = repeat ? repeat.body : node;
  const inner = body.type === 'sequence' ? body : undefined;
  let betweenSlotsRestMs = inner?.betweenChildrenRestMs ?? 0;
  const children: WorkoutNode[] = inner ? inner.children : [body];
  let slots = children.map(child => itemOf(child, format));
  if (slots.some(item => item === null)) return null;
  // A group has no field for a rest after its last movement: it becomes a rest of its own at the end. The rests
  // between the movements then become rests of their own too, so none is added before it.
  if (inner?.trailingRestMs) {
    if (betweenSlotsRestMs) slots = slots.flatMap((item, i) => i ? [{ kind: 'rest', durationMs: betweenSlotsRestMs, restKind: 'transition' } as BuilderRest, item] : [item]);
    betweenSlotsRestMs = 0;
    slots.push({ kind: 'rest', durationMs: inner.trailingRestMs, restKind: 'transition' });
  }
  return { kind: 'group', rounds: repeat?.count ?? 1, betweenRoundsRestMs: repeat?.betweenIterationsRestMs ?? 0, alternate: repeat?.assignmentPolicy === 'alternate', betweenSlotsRestMs, slots: slots as BuilderItem[] };
}

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

/** The inverse mapping. Every workout the compiler accepts opens (BLD-15); null only for one it would reject. */
export function workoutToBuilder(workout: Workout): BuilderDraft | null {
  const sections: BuilderSection[] = [];
  for (const [index, section] of workout.sections.entries()) {
    const built = sectionToBuilder(section);
    if (!built) return null;
    sections.push(foldTrailingRest(built, index === workout.sections.length - 1));
  }
  return { title: workout.title, description: workout.description ?? '', participants: workout.participants, prepMs: workout.prepMs, equipment: [...workout.equipment], ...(workout.attribution ? { attribution: structuredClone(workout.attribution) } : {}), sections };
}
