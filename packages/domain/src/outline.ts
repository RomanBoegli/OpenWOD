import type { CompiledSection, DurationKind, ExecutionPlan, Occurrence, Phase, RoundContext, Timing } from './compiler';
import type { Prescription, SectionFormat } from './schema';

/** A readable, round-by-round outline of a compiled plan for studying a workout before starting it. */
export interface RestSegment { kind: Phase; ms: number }
export interface OutlineRow {
  anchor: string;
  A?: Prescription;
  B?: Prescription;
  timing: Timing;
  /** Absent for manual work: the athletes decide when it ends. */
  workMs?: number;
  completion?: 'team' | 'both';
  restAfter: RestSegment[];
}
export interface OutlineRound {
  /** "Round 1", "Rounds 1–5", "Set 2 · Round 3", "Cycles 1–8 of 8"; empty when the section has no repeat. */
  label: string;
  first: RoundContext[];
  last: RoundContext[];
  rows: OutlineRow[];
  /** Rest after each repetition in this group, excluding the group's final one when the plan omits it. */
  roundRestMs: number;
  /** Rest that follows the whole group: an outer set rest, a block rest, or a trailing transition of an enclosing sequence. */
  restAfter: RestSegment[];
  /** How many repetitions this group stands for. */
  repetitions: number;
  /** AMRAP and you-go-I-go: the rows are one block worked through as many times as the clock allows. */
  block?: boolean;
}
export interface OutlineSection {
  id: string;
  title: string;
  format: SectionFormat;
  startMs?: number;
  durationMs: number;
  durationKind: DurationKind;
  capMs?: number;
  emom?: CompiledSection['emom'];
  youGoIGo?: CompiledSection['youGoIGo'];
  transitionAfter: 'manualReady' | 'automatic';
  /** The rest after the section (BLD-14), told once beside the transition instead of in the rounds. */
  restAfterMs?: number;
  leadingRest: RestSegment[];
  rounds: OutlineRound[];
}

const pathKey = (rounds: RoundContext[]) => rounds.map(round => `${round.nodeId}:${round.iteration}`).join('.');

/** Where a work occurrence stands in its round, for the player's round donut (UI-24). */
export interface RoundProgress {
  /** 1-based position among the work of the same round of the same block, and how much work that round holds. */
  position: number;
  size: number;
  /** The innermost repeat's iteration and count; 1 of 1 for work outside any repeat. */
  round: number;
  rounds: number;
}

/**
 * The round position of every work occurrence, by occurrence id. Work shares a round when it has the same section and
 * the same full repeat path, so loose work beside a repeat and outer sets count on their own. AMRAP and you-go-I-go
 * blocks are left out: where the athletes are inside them is theirs to say (UI-06).
 */
export function roundProgress(plan: ExecutionPlan): Map<string, RoundProgress> {
  const groups = new Map<string, Occurrence[]>();
  for (const item of plan.occurrences) {
    if (item.phase !== 'work' || item.tasks) continue;
    const key = `${item.sectionIndex}|${pathKey(item.rounds)}`;
    const members = groups.get(key);
    if (members) members.push(item); else groups.set(key, [item]);
  }
  const result = new Map<string, RoundProgress>();
  for (const members of groups.values()) members.forEach((item, index) => {
    const innermost = item.rounds.at(-1);
    result.set(item.id, { position: index + 1, size: members.length, round: innermost?.iteration ?? 1, rounds: innermost?.count ?? 1 });
  });
  return result;
}
const LEVEL_NAMES = ['Set', 'Round'];

function levelName(depth: number, levels: number, format: SectionFormat): string {
  if (format === 'emom') return 'Cycle';
  if (format === 'strength') return levels === 1 ? 'Set' : LEVEL_NAMES[depth] === 'Set' ? 'Block' : 'Set';
  return levels === 1 ? 'Round' : LEVEL_NAMES[depth] ?? `Level ${depth + 1}`;
}

function describe(first: RoundContext[], last: RoundContext[], format: SectionFormat): string {
  if (!first.length) return '';
  return first.map((round, depth) => {
    const name = levelName(depth, first.length, format);
    const end = last[depth]?.iteration ?? round.iteration;
    return end !== round.iteration ? `${name}s ${round.iteration}–${end} of ${round.count}` : `${name} ${round.iteration} of ${round.count}`;
  }).join(' · ');
}

const sameRows = (a: OutlineRow[], b: OutlineRow[]) => JSON.stringify(a) === JSON.stringify(b);
const sameOuterPath = (a: RoundContext[], b: RoundContext[]) => a.length === b.length && a.slice(0, -1).every((round, index) => round.iteration === b[index].iteration && round.nodeId === b[index].nodeId);

function row(item: Occurrence): OutlineRow {
  const result: OutlineRow = { anchor: item.anchor, A: item.assignments?.A, B: item.assignments?.B, timing: item.timing, restAfter: [] };
  if (item.timing !== 'manual') result.workMs = item.durationMs;
  if (item.completion) result.completion = item.completion;
  return result;
}

export function outlineWorkout(plan: ExecutionPlan): OutlineSection[] {
  return plan.sections.map(section => {
    const occurrences: Occurrence[] = plan.occurrences.slice(section.startIndex, (section.restAfter?.index ?? section.endIndex + 1));
    const groups: OutlineRound[] = [];
    const leadingRest: RestSegment[] = [];
    let group: OutlineRound | undefined;
    let lastRow: OutlineRow | undefined;
    for (const item of occurrences) {
      if (item.tasks) {
        group = { label: '', first: [], last: [], rows: item.tasks.map(task => ({ anchor: task.nodeId, A: task.assignments.A, B: task.assignments.B, timing: 'manual', restAfter: [] })), roundRestMs: 0, restAfter: [], repetitions: 1, block: true };
        groups.push(group);
        lastRow = undefined;
      } else if (item.phase === 'work') {
        if (!group || pathKey(group.first) !== pathKey(item.rounds)) {
          group = { label: describe(item.rounds, item.rounds, section.format), first: item.rounds, last: item.rounds, rows: [], roundRestMs: 0, restAfter: [], repetitions: 1 };
          groups.push(group);
          lastRow = undefined;
        }
        lastRow = row(item);
        group.rows.push(lastRow);
      } else if (!group) leadingRest.push({ kind: item.phase, ms: item.durationMs });
      else if (pathKey(group.first) !== pathKey(item.rounds)) group.restAfter.push({ kind: item.phase, ms: item.durationMs }); // Outer level: after the whole group.
      else if (item.phase === 'roundRest') group.roundRestMs += item.durationMs;
      else if (lastRow) lastRow.restAfter.push({ kind: item.phase, ms: item.durationMs });
    }
    // Collapse consecutive identical repetitions; the final repetition may lack the between-rounds rest.
    const rounds: OutlineRound[] = [];
    for (const candidate of groups) {
      const previous = rounds.at(-1);
      const mergeable = previous && !previous.block && !candidate.block && previous.restAfter.length === 0 && sameOuterPath(previous.last, candidate.first) && sameRows(previous.rows, candidate.rows)
        && (candidate.roundRestMs === previous.roundRestMs || (candidate.roundRestMs === 0 && candidate.last.at(-1)?.iteration === candidate.last.at(-1)?.count));
      if (mergeable) { previous.last = candidate.last; previous.repetitions += 1; previous.label = describe(previous.first, previous.last, section.format); previous.restAfter = candidate.restAfter; }
      else rounds.push(candidate);
    }
    const result: OutlineSection = { id: section.id, title: section.title, format: section.format, durationMs: section.durationMs, durationKind: section.durationKind, transitionAfter: section.transitionAfter, leadingRest, rounds };
    if (section.startMs !== undefined) result.startMs = section.startMs;
    if (section.restAfter) result.restAfterMs = section.restAfter.durationMs;
    if (section.capMs !== undefined) result.capMs = section.capMs;
    if (section.emom) result.emom = section.emom;
    if (section.youGoIGo) result.youGoIGo = section.youGoIGo;
    return result;
  });
}
