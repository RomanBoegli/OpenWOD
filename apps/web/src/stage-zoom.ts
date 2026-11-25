/**
 * The stations' zoom in the training view (UI-33): how large the movement, its target and its load are drawn, with the
 * clock taking the room that leaves. It is kept in this browser alone and never with the household's settings, since a
 * phone on the floor and a tablet on the wall want different sizes.
 */
export const STAGE_ZOOMS = [.75, .85, 1, 1.15, 1.3, 1.5] as const;
const STAGE_ZOOM_KEY = 'openwod.stage-zoom.v1';

const indexOf = (zoom: number) => Math.max(0, (STAGE_ZOOMS as readonly number[]).indexOf(zoom));

export function loadStageZoom(): number {
  try { const stored = Number(localStorage.getItem(STAGE_ZOOM_KEY)); return (STAGE_ZOOMS as readonly number[]).includes(stored) ? stored : 1; } catch { return 1; }
}

export function saveStageZoom(zoom: number): void {
  try { localStorage.setItem(STAGE_ZOOM_KEY, String(zoom)); } catch { /* no storage: the zoom lasts for this visit */ }
}

/** The step above or below, or the same one at either end. An unknown value counts as the smallest. */
export const stepStageZoom = (zoom: number, by: 1 | -1): number => STAGE_ZOOMS[Math.min(STAGE_ZOOMS.length - 1, Math.max(0, indexOf(zoom) + by))];
