import { parseWorkout, WorkoutValidationError, type Prescription, type SectionFormat, type Workout, type WorkoutNode, type WorkoutSection } from './index';

export interface RoundContext { nodeId: string; iteration: number; count: number }
export type Phase = 'work' | 'transition' | 'roundRest' | 'blockRest';
/** timed: fixed duration. interval: fixed scheduled window (EMOM). manual: ends on Done/Finish/Switch or the section cap. */
export type Timing = 'timed' | 'interval' | 'manual';
export type Completion = 'team' | 'both';
export type DurationKind = 'exact' | 'capped' | 'open';
export type Assignments = { A: Prescription; B?: Prescription };
export interface TaskItem { nodeId: string; assignments: Assignments; rounds: RoundContext[] }
export interface Occurrence {
  id: string;
  anchor: string;
  sectionIndex: number;
  sectionId: string;
  phase: Phase;
  timing: Timing;
  /** Active-time offset from the start of the workout; absent once an earlier occurrence has no known duration. */
  startMs?: number;
  /** Offset from the start of its section; absent once an earlier occurrence in the section has no known duration. */
  sectionStartMs?: number;
  /** 0 for manual occurrences. */
  durationMs: number;
  assignments?: Assignments;
  rounds: RoundContext[];
  /** Pair completion rule for manual and interval work. */
  completion?: Completion;
  /** EMOM position. */
  interval?: { index: number; count: number };
  /** Block occurrences (AMRAP, you-go-I-go): the whole list the athletes work through; the engine never advances it. */
  tasks?: TaskItem[];
}
export interface CompiledSection {
  id: string;
  title: string;
  format: SectionFormat;
  startIndex: number;
  endIndex: number;
  startMs?: number;
  /** Known timed content plus the cap of a capped manual section: an upper bound of scored time. */
  durationMs: number;
  durationKind: DurationKind;
  capMs?: number;
  transitionAfter: 'manualReady' | 'automatic';
  emom?: { intervalMs: number; intervals: number };
  amrap?: { counter: 'roundsAndReps' | 'rounds' | 'none' };
  youGoIGo?: { rounds?: number; turnMs?: number };
}
export interface ExecutionPlan { workout: Workout; occurrences: Occurrence[]; sections: CompiledSection[]; durationMs: number; durationKind: DurationKind }

const MAX_OCCURRENCES = 10_000;
const MAX_MS = 86_400_000;
const MAX_BLOCK_TASKS = 50;

export function compileWorkout(input: unknown): ExecutionPlan {
  const workout = parseWorkout(input);
  const pair = workout.participants === 2;
  const ids = new Set<string>([workout.id]);
  const fail = (path: string, message: string): never => { throw new WorkoutValidationError([{ path, message }]); };
  const claim = (id: string) => {
    if (ids.has(id)) fail(id, 'IDs must be unique throughout the workout.');
    ids.add(id);
  };
  function inspect(node: WorkoutNode, depth: number, section: WorkoutSection) {
    claim(node.id);
    const listOnly = section.format === 'amrap' || section.format === 'emom' || section.format === 'youGoIGo';
    if (node.type === 'repeat') {
      if (listOnly) fail(node.id, `${label(section.format)} sections list manual tasks; repeats are not supported inside them.`);
      if (depth >= 2) fail(node.id, 'Use at most two nested repeat levels.');
      if (node.assignmentPolicy === 'alternate' && !pair) fail(node.id, 'Alternating assignments requires two athletes.');
      inspect(node.body, depth + 1, section);
    } else if (node.type === 'sequence') {
      if (listOnly && depth > 0) fail(node.id, `${label(section.format)} sections take one flat list of tasks.`);
      node.children.forEach(child => inspect(child, listOnly ? depth + 1 : depth, section));
    } else if (node.type === 'timed' || node.type === 'task') {
      if (Boolean(node.assignments.B) !== pair) fail(node.id, 'Every work slot must match the workout’s athlete count.');
      if (node.type === 'task') {
        if (section.format === 'timedCircuit') fail(node.id, 'Timed circuits need durations. Use a For time, strength, AMRAP, EMOM or you-go-I-go section for manual tasks.');
        const standalone = section.format === 'forTime' || section.format === 'strength' || section.format === 'emom';
        if (standalone && pair && !node.completion) fail(node.id, 'Choose a completion rule for pairs: team (one Done) or both (each athlete taps Done).');
        if (node.completion === 'both' && !pair) fail(node.id, 'Both-done completion needs two athletes.');
        if (!standalone && node.completion) fail(node.id, 'AMRAP and you-go-I-go blocks finish by cap, Finish or Switch; remove the task completion rule.');
      } else if (listOnly) fail(node.id, `${label(section.format)} sections list manual tasks; timed slots belong in a timed circuit or For time section.`);
    } else if (listOnly) fail(node.id, `${label(section.format)} sections list manual tasks without rests.`);
  }
  for (const section of workout.sections) {
    claim(section.id);
    if ((section.format === 'amrap' || section.format === 'emom' || section.format === 'youGoIGo') && section.body.type !== 'task' && section.body.type !== 'sequence') fail(section.id, `${label(section.format)} sections take one task or a list of tasks.`);
    const allowed: Record<SectionFormat, (keyof WorkoutSection)[]> = { timedCircuit: [], amrap: ['capMs', 'counter'], emom: ['intervalMs', 'intervals'], forTime: ['capMs'], youGoIGo: ['capMs', 'rounds', 'turnMs'], strength: [] };
    for (const key of ['capMs', 'intervalMs', 'intervals', 'counter', 'rounds', 'turnMs'] as const) if (section[key] !== undefined && !allowed[section.format].includes(key)) fail(section.id, `${label(section.format)} sections do not use ${key.replace(/Ms$/, '')}.`);
    if (section.format === 'amrap' && !section.capMs) fail(section.id, 'AMRAP sections need a cap.');
    if (section.format === 'emom' && (!section.intervalMs || !section.intervals)) fail(section.id, 'EMOM sections need an interval length and a number of intervals.');
    if (section.format === 'youGoIGo') {
      if (!pair) fail(section.id, 'You go, I go needs two athletes.');
      if (!section.capMs && !section.rounds) fail(section.id, 'Give you-go-I-go a cap or a number of team rounds so it can finish.');
      if (section.turnMs && section.capMs && section.turnMs > section.capMs) fail(section.id, 'A turn cannot be longer than the cap.');
    }
    inspect(section.body, 0, section);
  }

  const occurrences: Occurrence[] = [];
  const sections: CompiledSection[] = [];
  let elapsed = 0;
  let known = true;
  let durationKind: DurationKind = 'exact';
  workout.sections.forEach((section, sectionIndex) => {
    const startIndex = occurrences.length;
    const startMs = known ? elapsed : undefined;
    let sectionElapsed = 0;
    let sectionKnown = true;
    const capMs = section.capMs;
    type Extra = { timing?: Timing; completion?: Completion; interval?: Occurrence['interval']; tasks?: TaskItem[] };
    function append(anchor: string, phase: Phase, durationMs: number, rounds: RoundContext[], assignments?: Assignments, generated = false, extra: Extra = {}) {
      const timing = extra.timing ?? 'timed';
      if (!durationMs && timing !== 'manual') return;
      if (occurrences.length >= MAX_OCCURRENCES) fail(anchor, 'Workout expands beyond 10,000 occurrences.');
      if (elapsed + durationMs > MAX_MS) fail(anchor, 'Workout duration exceeds 24 hours.');
      const occurrence: Occurrence = {
        id: `${section.id}/${generated ? 'generated' : 'node'}/${anchor}@${rounds.map(round => `${round.nodeId}:${round.iteration}`).join('.') || '1'}`,
        anchor, sectionIndex, sectionId: section.id, phase, timing, durationMs, rounds: structuredClone(rounds), assignments,
      };
      if (known) occurrence.startMs = elapsed;
      if (sectionKnown) occurrence.sectionStartMs = sectionElapsed;
      if (extra.completion) occurrence.completion = extra.completion;
      if (extra.interval) occurrence.interval = extra.interval;
      if (extra.tasks) occurrence.tasks = extra.tasks;
      occurrences.push(occurrence);
      elapsed += durationMs;
      sectionElapsed += durationMs;
      if (timing === 'manual') { known = false; sectionKnown = false; }
    }
    const completionOf = (node: Extract<WorkoutNode, { type: 'task' }>): Completion => node.completion ?? 'team';
    function expand(node: WorkoutNode, rounds: RoundContext[], swapped: boolean) {
      if (node.type === 'timed' || node.type === 'task') {
        const assignments = swapped ? { A: node.assignments.B!, B: node.assignments.A } : node.assignments;
        if (node.type === 'timed') append(node.id, 'work', node.durationMs, rounds, assignments);
        else append(node.id, 'work', 0, rounds, assignments, false, { timing: 'manual', completion: completionOf(node) });
      } else if (node.type === 'rest') append(node.id, node.kind ?? 'blockRest', node.durationMs, rounds);
      else if (node.type === 'sequence') {
        node.children.forEach((child, index) => {
          expand(child, rounds, swapped);
          if (index < node.children.length - 1) append(`${node.id}:between:${index + 1}`, 'transition', node.betweenChildrenRestMs ?? 0, rounds, undefined, true);
        });
        append(`${node.id}:trailing`, 'transition', node.trailingRestMs ?? 0, rounds, undefined, true);
      } else {
        for (let iteration = 1; iteration <= node.count; iteration++) {
          const path = [...rounds, { nodeId: node.id, iteration, count: node.count }];
          expand(node.body, path, swapped !== (node.assignmentPolicy === 'alternate' && iteration % 2 === 0));
          if (iteration < node.count) append(`${node.id}:rest`, 'roundRest', node.betweenIterationsRestMs ?? 0, path, undefined, true);
        }
      }
    }
    /** Flattens a task list body (one task or a sequence of tasks) into block items. */
    function tasksOf(body: WorkoutNode): TaskItem[] {
      const items: TaskItem[] = [];
      const walk = (node: WorkoutNode, rounds: RoundContext[]) => {
        if (node.type === 'task') items.push({ nodeId: node.id, assignments: node.assignments, rounds });
        else if (node.type === 'sequence') node.children.forEach(child => walk(child, rounds));
        else if (node.type === 'repeat') for (let iteration = 1; iteration <= node.count; iteration++) walk(node.body, [...rounds, { nodeId: node.id, iteration, count: node.count }]);
      };
      walk(body, []);
      if (items.length > MAX_BLOCK_TASKS) fail(body.id, `A block lists at most ${MAX_BLOCK_TASKS} tasks.`);
      return items;
    }

    let kind: DurationKind = 'exact';
    if (section.format === 'timedCircuit' || section.format === 'forTime' || section.format === 'strength') {
      expand(section.body, [], false);
      if (section.format !== 'timedCircuit' && !sectionKnown) kind = capMs ? 'capped' : 'open';
    } else if (section.format === 'emom') {
      type Task = Extract<WorkoutNode, { type: 'task' }>;
      const slots: Task[] = section.body.type === 'task' ? [section.body] : section.body.type === 'sequence' ? section.body.children.filter((child): child is Task => child.type === 'task') : [];
      const intervals = section.intervals!;
      const cycles = Math.ceil(intervals / slots.length);
      for (let index = 1; index <= intervals; index++) {
        const slot = slots[(index - 1) % slots.length];
        const cycle = Math.ceil(index / slots.length);
        append(slot.id, 'work', section.intervalMs!, [{ nodeId: section.body.id, iteration: cycle, count: cycles }], slot.assignments, false, { timing: 'interval', completion: completionOf(slot), interval: { index, count: intervals } });
      }
    } else {
      const tasks = tasksOf(section.body);
      append(section.body.id, 'work', 0, [], undefined, false, { timing: 'manual', tasks });
      kind = capMs ? 'capped' : 'open';
    }
    if (!occurrences.slice(startIndex).some(item => item.phase === 'work')) fail(section.id, 'Each section needs at least one work slot.');
    if (kind === 'capped' && capMs) {
      if (elapsed + capMs > MAX_MS) fail(section.id, 'Workout duration exceeds 24 hours.');
      elapsed += capMs;
      sectionElapsed += capMs;
    }
    if (kind === 'open') durationKind = 'open';
    else if (kind === 'capped' && durationKind === 'exact') durationKind = 'capped';
    const compiled: CompiledSection = { id: section.id, title: section.title, format: section.format, startIndex, endIndex: occurrences.length - 1, durationMs: sectionElapsed, durationKind: kind, transitionAfter: section.transitionAfter };
    if (startMs !== undefined) compiled.startMs = startMs;
    if (capMs) compiled.capMs = capMs;
    if (section.format === 'emom') compiled.emom = { intervalMs: section.intervalMs!, intervals: section.intervals! };
    if (section.format === 'amrap') compiled.amrap = { counter: section.counter ?? 'roundsAndReps' };
    if (section.format === 'youGoIGo') compiled.youGoIGo = { ...(section.rounds ? { rounds: section.rounds } : {}), ...(section.turnMs ? { turnMs: section.turnMs } : {}) };
    sections.push(compiled);
  });
  return { workout, occurrences, sections, durationMs: elapsed, durationKind };
}

const label = (format: SectionFormat) => ({ timedCircuit: 'Timed circuit', amrap: 'AMRAP', emom: 'EMOM', forTime: 'For time', youGoIGo: 'You go, I go', strength: 'Strength' })[format];
