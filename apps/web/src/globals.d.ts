/** Build constants from vite.config.ts `define` (tests/vitest.config.ts sets the same ones for unit tests). */
/** True in the `test` and `static-test` modes the browser suites run against. */
declare const __OPENWOD_TEST__: boolean;
/** True for the static site: no server, the library lives in this browser. */
declare const __OPENWOD_STATIC__: boolean;
declare const __OPENWOD_VERSION__: string;
declare const __OPENWOD_REPO__: string;
