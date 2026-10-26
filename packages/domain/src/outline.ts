import type { ExecutionPlan, Occurrence, Phase, RoundContext } from './compiler';
import type { Prescription } from './schema';

/** A readable, round-by-round outline of a compiled plan for studying a workout before starting it. */
export interface RestSegment { kind: Phase; ms: number }
export interface OutlineRow { anchor: string; A?: Prescription; B?: Prescription; workMs: number; restAfter: RestSegment[] }
export interface OutlineRound {
  /** "Round 1", "Rounds 1–5", "Set 2 · Round 3"; empty when the section has no repeat. */
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
}
export interface OutlineSection { id: string; title: string; startMs: number; durationMs: number; transitionAfter: 'manualReady' | 'automatic'; leadingRest: RestSegment[]; rounds: OutlineRound[] }

const pathKey = (rounds: RoundContext[]) => rounds.map(round => `${round.nodeId}:${round.iteration}`).join('.');
const LEVEL_NAMES = ['Set', 'Round'];

function levelName(depth: number, levels: number): string {
  return levels === 1 ? 'Round' : LEVEL_NAMES[depth] ?? `Level ${depth + 1}`;
}

function describe(first: RoundContext[], last: RoundContext[]): string {
  if (!first.length) return '';
  return first.map((round, depth) => {
    const name = levelName(depth, first.length);
    const end = last[depth]?.iteration ?? round.iteration;
    return end !== round.iteration ? `${name}s ${round.iteration}–${end} of ${round.count}` : `${name} ${round.iteration} of ${round.count}`;
  }).join(' · ');
}

const sameRows = (a: OutlineRow[], b: OutlineRow[]) => JSON.stringify(a) === JSON.stringify(b);
const sameOuterPath = (a: RoundContext[], b: RoundContext[]) => a.length === b.length && a.slice(0, -1).every((round, index) => round.iteration === b[index].iteration && round.nodeId === b[index].nodeId);

export function outlineWorkout(plan: ExecutionPlan): OutlineSection[] {
  return plan.sections.map(section => {
    const occurrences: Occurrence[] = plan.occurrences.slice(section.startIndex, section.endIndex + 1);
    const groups: OutlineRound[] = [];
    const leadingRest: RestSegment[] = [];
    let group: OutlineRound | undefined;
    let lastRow: OutlineRow | undefined;
    for (const item of occurrences) {
      if (item.phase === 'work') {
        if (!group || pathKey(group.first) !== pathKey(item.rounds)) {
          group = { label: describe(item.rounds, item.rounds), first: item.rounds, last: item.rounds, rows: [], roundRestMs: 0, restAfter: [], repetitions: 1 };
          groups.push(group);
          lastRow = undefined;
        }
        lastRow = { anchor: item.anchor, A: item.assignments?.A, B: item.assignments?.B, workMs: item.durationMs, restAfter: [] };
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
      const mergeable = previous && previous.restAfter.length === 0 && sameOuterPath(previous.last, candidate.first) && sameRows(previous.rows, candidate.rows)
        && (candidate.roundRestMs === previous.roundRestMs || (candidate.roundRestMs === 0 && candidate.last.at(-1)?.iteration === candidate.last.at(-1)?.count));
      if (mergeable) { previous.last = candidate.last; previous.repetitions += 1; previous.label = describe(previous.first, previous.last); previous.restAfter = candidate.restAfter; }
      else rounds.push(candidate);
    }
    return { id: section.id, title: section.title, startMs: section.startMs, durationMs: section.durationMs, transitionAfter: section.transitionAfter, leadingRest, rounds };
  });
}
