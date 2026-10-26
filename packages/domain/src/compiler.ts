import { parseWorkout, WorkoutValidationError, type Prescription, type Workout, type WorkoutNode } from './index';

export interface RoundContext { nodeId: string; iteration: number; count: number }
export type Phase = 'work' | 'transition' | 'roundRest' | 'blockRest';
export interface Occurrence {
  id: string;
  anchor: string;
  sectionIndex: number;
  sectionId: string;
  phase: Phase;
  startMs: number;
  durationMs: number;
  assignments?: { A: Prescription; B?: Prescription };
  rounds: RoundContext[];
}
export interface CompiledSection { id: string; title: string; startIndex: number; endIndex: number; startMs: number; durationMs: number; transitionAfter: 'manualReady' | 'automatic' }
export interface ExecutionPlan { workout: Workout; occurrences: Occurrence[]; sections: CompiledSection[]; durationMs: number }

export function compileWorkout(input: unknown): ExecutionPlan {
  const workout = parseWorkout(input);
  const ids = new Set<string>([workout.id]);
  const fail = (path: string, message: string): never => { throw new WorkoutValidationError([{ path, message }]); };
  const claim = (id: string) => {
    if (ids.has(id)) fail(id, 'IDs must be unique throughout the workout.');
    ids.add(id);
  };
  function inspect(node: WorkoutNode, depth: number) {
    claim(node.id);
    if (node.type === 'repeat') {
      if (depth >= 2) fail(node.id, 'Use at most two nested repeat levels.');
      if (node.assignmentPolicy === 'alternate' && workout.participants !== 2) fail(node.id, 'Alternating assignments requires two athletes.');
      inspect(node.body, depth + 1);
    } else if (node.type === 'sequence') node.children.forEach(child => inspect(child, depth));
    else if (node.type === 'timed' && Boolean(node.assignments.B) !== (workout.participants === 2)) fail(node.id, 'Every work slot must match the workout’s athlete count.');
  }
  for (const section of workout.sections) { claim(section.id); inspect(section.body, 0); }

  const occurrences: Occurrence[] = [];
  const sections: CompiledSection[] = [];
  let elapsed = 0;
  workout.sections.forEach((section, sectionIndex) => {
    const startIndex = occurrences.length;
    const startMs = elapsed;
    function append(anchor: string, phase: Phase, durationMs: number, rounds: RoundContext[], assignments?: Occurrence['assignments'], generated = false) {
      if (!durationMs) return;
      if (occurrences.length >= 10_000) fail(anchor, 'Workout expands beyond 10,000 occurrences.');
      if (elapsed + durationMs > 86_400_000) fail(anchor, 'Workout duration exceeds 24 hours.');
      occurrences.push({ id: `${section.id}/${generated ? 'generated' : 'node'}/${anchor}@${rounds.map(round => `${round.nodeId}:${round.iteration}`).join('.') || '1'}`, anchor, phase, durationMs, startMs: elapsed, rounds: structuredClone(rounds), sectionId: section.id, sectionIndex, assignments });
      elapsed += durationMs;
    }
    function expand(node: WorkoutNode, rounds: RoundContext[], swapped: boolean) {
      if (node.type === 'timed') {
        const assignments = swapped ? { A: node.assignments.B!, B: node.assignments.A } : node.assignments;
        append(node.id, 'work', node.durationMs, rounds, assignments);
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
    expand(section.body, [], false);
    if (!occurrences.slice(startIndex).some(item => item.phase === 'work')) fail(section.id, 'Each section needs at least one work slot.');
    sections.push({ id: section.id, title: section.title, startIndex, endIndex: occurrences.length - 1, startMs, durationMs: elapsed - startMs, transitionAfter: section.transitionAfter });
  });
  return { workout, occurrences, sections, durationMs: elapsed };
}
