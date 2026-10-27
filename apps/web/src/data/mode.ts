/**
 * Which shape this build is (vite.config.ts): `server` talks to the household API, `static` keeps the household in
 * this browser's IndexedDB and needs no server at all.
 */
export type DataMode = 'server' | 'static';
export const DATA_MODE: DataMode = __OPENWOD_STATIC__ ? 'static' : 'server';
