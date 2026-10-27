import type { Locator, Page } from '@playwright/test';
import { bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
import { serialiseWorkoutFile } from '../../packages/domain/src';
import { matchesFilter, summariseWorkout, type LibraryFilter } from '../../packages/domain/src/library';

export const BUNDLED = bundledWorkouts.length;
export const partnerCircuit = bundledWorkout('partner-circuit');
export const bundledCount = (filter: LibraryFilter) => bundledWorkouts.filter(workout => matchesFilter(summariseWorkout(workout), filter)).length;
export const PLAYER = '/#/wod/partner-circuit/play';
/** The test build exposes an injected clock; wait for it before driving the player. */
export const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__openwodTest));
export const communityFile = (title = 'Community circuit', id = partnerCircuit.id) => ({ name: 'community.wod.yaml', mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id, title })) });
/** A workout file of one's own: no sharing identity, so the import never takes it for a copy of a bundled workout. */
export const ownFile = (title: string, id: string) => ({ name: `${id}.wod.yaml`, mimeType: 'application/yaml', buffer: Buffer.from(serialiseWorkoutFile({ ...partnerCircuit, id, title, sharing: undefined })) });
export const advance = (page: Page, ms: number) => page.evaluate(ms => window.__openwodTest!.advance(ms), ms);
/** Static shape: every row of one of the browser library's IndexedDB stores. Call it after the app has opened the database. */
export const browserRows = <T = Record<string, unknown>>(page: Page, store: 'workouts' | 'master' | 'sessions') => page.evaluate(name => new Promise<T[]>((resolve, reject) => {
  const open = indexedDB.open('openwod');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const request = open.result.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => { open.result.close(); resolve(request.result as T[]); };
    request.onerror = () => { open.result.close(); reject(request.error); };
  };
}), store);
/** The value beside one term of a Settings card's facts (a dt/dd list). */
export const fact = (card: Locator, term: string) => card.locator('dt').getByText(term, { exact: true }).locator('xpath=following-sibling::dd[1]');
