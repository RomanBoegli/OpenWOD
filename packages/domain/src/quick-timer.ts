import { builderToWorkout, emptyDraft, emptySection, type BuilderDraft, type BuilderSection } from './builder';
import { QUICK_TIMER_ID } from './library';
import type { Workout } from './schema';

/**
 * The quick timer (LIB-09): a plain clock set with a few numbers and played in the normal training view. It is an ordinary
 * solo workout under one reserved id, built here and never written to the library, with one placeholder movement that the
 * player neither shows nor speaks (UI-30).
 */
export const QUICK_TIMER_KINDS = ['tabata', 'emom', 'amrap', 'forTime'] as const;
export type QuickTimerKind = typeof QUICK_TIMER_KINDS[number];
export const QUICK_TIMER_LABELS: Record<QuickTimerKind, string> = { tabata: 'Tabata', emom: 'EMOM', amrap: 'AMRAP', forTime: 'For Time' };

/** The numbers of every kind, so each keeps its own when the kind changes. A For Time cap of 0 is no cap. */
export interface QuickTimer {
  kind: QuickTimerKind;
  prepMs: number;
  tabata: { rounds: number; workMs: number; restMs: number };
  emom: { intervalMs: number; intervals: number };
  amrap: { capMs: number };
  forTime: { capMs: number };
}
export const DEFAULT_QUICK_TIMER: QuickTimer = {
  kind: 'tabata', prepMs: 10_000,
  tabata: { rounds: 8, workMs: 20_000, restMs: 10_000 },
  emom: { intervalMs: 60_000, intervals: 10 },
  amrap: { capMs: 600_000 },
  forTime: { capMs: 0 },
};
/** The movement every quick timer carries, because a workout's slot needs one. */
export const QUICK_TIMER_MOVEMENT = 'Work';
const MAX_ROUNDS = 99, MAX_SPAN_MS = 5_999_000;
/** A workout's countdown is a minute at the most (schema.ts). */
export const QUICK_TIMER_MAX_PREP_MS = 60_000;
/** What a stored timer may add up to: under the day a workout may last (compiler.ts), with room for the countdown. */
const MAX_TOTAL_MS = 23 * 3_600_000;

export const isQuickTimer = (workout: Pick<Workout, 'id'>) => workout.id === QUICK_TIMER_ID;

const whole = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
/** A span in whole seconds, as the clock counts them. */
const span = (value: unknown, fallback: number, min: number) => Math.round(whole(value, fallback, min, MAX_SPAN_MS) / 1000) * 1000;

/** Stored settings of any age or shape, brought into range field by field. */
export function normaliseQuickTimer(stored: unknown): QuickTimer {
  const value = (stored && typeof stored === 'object' ? stored : {}) as { [key in keyof QuickTimer]?: unknown };
  const part = (key: QuickTimerKind) => (value[key] && typeof value[key] === 'object' ? value[key] : {}) as Record<string, unknown>;
  const fallback = DEFAULT_QUICK_TIMER;
  const workMs = span(part('tabata').workMs, fallback.tabata.workMs, 1000), restMs = span(part('tabata').restMs, fallback.tabata.restMs, 0);
  const intervalMs = span(part('emom').intervalMs, fallback.emom.intervalMs, 1000);
  // The longest spans still leave a few rounds inside the day, so a stored timer always plays.
  const fitting = (rounds: unknown, standard: number, roundMs: number) => Math.min(whole(rounds, standard, 1, MAX_ROUNDS), Math.floor(MAX_TOTAL_MS / roundMs));
  return {
    kind: QUICK_TIMER_KINDS.find(kind => kind === value.kind) ?? fallback.kind,
    prepMs: Math.min(QUICK_TIMER_MAX_PREP_MS, span(value.prepMs, fallback.prepMs, 0)),
    tabata: { rounds: fitting(part('tabata').rounds, fallback.tabata.rounds, workMs + restMs), workMs, restMs },
    emom: { intervalMs, intervals: fitting(part('emom').intervals, fallback.emom.intervals, intervalMs) },
    amrap: { capMs: span(part('amrap').capMs, fallback.amrap.capMs, 1000) },
    forTime: { capMs: span(part('forTime').capMs, fallback.forTime.capMs, 0) },
  };
}

/** Minutes and seconds as a title reads them: 0:20, 12:00. */
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;

/** What the session is called in the training view and the Logbook. */
export function quickTimerTitle(timer: QuickTimer): string {
  const label = QUICK_TIMER_LABELS[timer.kind];
  if (timer.kind === 'tabata') return `${label}: ${timer.tabata.rounds} × ${clock(timer.tabata.workMs)}${timer.tabata.restMs ? ` / ${clock(timer.tabata.restMs)}` : ''}`;
  if (timer.kind === 'emom') return `${label}: ${timer.emom.intervals} × ${clock(timer.emom.intervalMs)}`;
  if (timer.kind === 'amrap') return `${label}: ${clock(timer.amrap.capMs)}`;
  return timer.forTime.capMs ? `${label}: Cap ${clock(timer.forTime.capMs)}` : label;
}

/** The timer in the editor's own model, which the workout is built from: one block of the kind's format with one movement. */
export function quickTimerDraft(timer: QuickTimer): BuilderDraft {
  const slot = (durationMs: number) => ({ A: { name: QUICK_TIMER_MOVEMENT }, durationMs });
  const block = (format: BuilderSection['format'], settings: Partial<BuilderSection>): BuilderSection => ({ ...emptySection(1, format), title: QUICK_TIMER_LABELS[timer.kind], betweenSlotsRestMs: 0, slots: [slot(40_000)], ...settings });
  const section = timer.kind === 'tabata' ? block('timedCircuit', { rounds: timer.tabata.rounds, betweenRoundsRestMs: timer.tabata.restMs, slots: [slot(timer.tabata.workMs)] })
    : timer.kind === 'emom' ? block('emom', { intervalMs: timer.emom.intervalMs, intervals: timer.emom.intervals })
    : timer.kind === 'amrap' ? block('amrap', { capMs: timer.amrap.capMs, counter: 'rounds' })
    : block('forTime', { capMs: timer.forTime.capMs });
  return { ...emptyDraft(1), title: quickTimerTitle(timer), prepMs: timer.prepMs, sections: [section] };
}

export function quickTimerWorkout(timer: QuickTimer): Workout {
  return builderToWorkout(quickTimerDraft(timer), { id: QUICK_TIMER_ID, revision: 1 });
}
