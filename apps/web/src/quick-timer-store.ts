import { normaliseQuickTimer, type QuickTimer } from '../../../packages/domain/src/quick-timer';

/** The quick timer's numbers as last set (LIB-09): kept in this browser, so the timer page opens where it was left. */
const QUICK_TIMER_KEY = 'openwod.quick-timer.v1';

export function loadQuickTimer(): QuickTimer {
  try { return normaliseQuickTimer(JSON.parse(localStorage.getItem(QUICK_TIMER_KEY) ?? 'null')); } catch { return normaliseQuickTimer(undefined); }
}

export function saveQuickTimer(timer: QuickTimer): void {
  try { localStorage.setItem(QUICK_TIMER_KEY, JSON.stringify(timer)); } catch { /* no storage: the timer still plays, and opens with its defaults next time */ }
}
