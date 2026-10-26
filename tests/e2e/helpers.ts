import type { Page } from '@playwright/test';
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
export const advance = (page: Page, ms: number) => page.evaluate(ms => window.__openwodTest!.advance(ms), ms);
