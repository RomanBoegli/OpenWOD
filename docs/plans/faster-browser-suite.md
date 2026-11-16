# Plan: a faster browser suite

Planned and not started.
Written on 16 November 2026, after release 1.6.0 was prepared.
Nothing here touches the shipped app: it changes tests, the Playwright configuration, two scripts and the Check workflow.

## Context

The full local browser run takes 9 to 10 minutes, and the same suite takes about 21 of the 22 minutes of the Check workflow.
The question was whether the "800+ tests" can be split by area, so that a change only runs what relates to it.

What the numbers say, from the last full run, `--list` and the last 80 commits:

- **The 870 are not 870 tests.** 336 are the screenshot pass (`screens.spec.ts`, 84 per project), which is skipped unless `SCREENS=1`. The rest is 133 distinct tests run four times: WebKit and Firefox, each in the server shape and the static shape.
- **Only 2 of 11 cores are used locally.** `workers: 2` is unchanged since the first commit, and the run is 1039 seconds of test time spread over 2 workers.
- **44 of the 67 player tests are pure geometry** (tablet sizes, the iPad turn, the clock's box). The static shape reruns them although it builds the same components and only differs in the data layer.
- **CI runs four projects one after another in one job.**
- **A split by area alone would rarely narrow anything.** The screens import each other (History uses the Player, the Editor and Overview use the Library, Settings holds the Logbook), so most source files feed three or four screens. Replayed over the last 80 commits: 24 touch nothing the browser loads, 51 reach four or five areas, and only 5 stay within one or two. Narrowing is real for leaf files, mainly `apps/web/src/settings/**`, `Editor.tsx`, `lane.ts` and `Overview.tsx`.

So the split that pays is by engine and shape first, then by area on top.

Expected sizes.
Test seconds are measured, and wall times at more workers are estimates until step 2 measures them.

| Run | Tests | Test seconds | Wall today (2 workers) | Wall expected |
| - | - | - | - | - |
| Full local today | 532 (+338 skipped) | 1039 | 8.9 min | |
| Full local after steps 1 and 2 | 444 | 919 | | about 3.5 min |
| Quick: WebKit, both shapes | 222 | 442 | | about 1.5 to 2 min |
| Quick, one area (settings 34, editor 39, library 27, household 19, player 112 tests) | | 70 to 150 | | 20 to 40 s |
| CI browser suite | 526 | | 20.6 min in one job | about 7 min in four jobs |

## 1. Trim what is not a test or is run twice for nothing

`tests/playwright.config.ts`

- The screenshot pass joins a run only with `SCREENS=1`: add `screens.spec.ts` to every project's `testIgnore` otherwise, and drop it from `STATIC_SPECS`. The `test.skip` line in `screens.spec.ts` stays as a guard.
- The static projects get `grepInvert: /@layout/`.

`tests/e2e/player.spec.ts`

- Tag three describe blocks `{ tag: '@layout' }`: "player on a tablet", "player on an iPad that is turned" and "the clock takes the room a workout leaves (UI-27)".
- They keep running in all three engines in the server shape, which has the superset of the player's interface.
- `static/session-layout.spec.ts` stays as the static shape's own layout check.

Result: 1305 listed tests become 669 (130 per server project, 93 per static project), all of them real.

## 2. Use the cores

- Measure `--project=webkit` (130 tests) with 2, 4, 5 and 6 workers, then run the full local suite three times at the best value.
- Set the local `workers` in `tests/playwright.config.ts` to the fastest value that adds no failure across those three runs. Expected: 5, which is half the cores and Playwright's own default. CI stays at 3.
- If more workers bring failures, keep 2 and say so. The one unexplained WebKit failure of the 1.6.0 run (`docs/validation.md`) is the thing to watch.

## 3. Quick runs, areas, and "what did I change"

`scripts/e2e-areas.ts` (new, pure logic)

- `AREAS` maps an area to its spec files, and a spec may sit in two areas.
  - `player`: player, recovery, tabs, handover, static/session-layout
  - `editor`: editor, static/time-fields
  - `library`: library, packs, static/library, static/cards, static/history, static/packs
  - `settings`: settings, static/settings, static/strings, static/backup
  - `household`: household, handover, migration, packs, static/migration, static/backup
- `screenReach()` says which screens each source file can reach, from the real import graph. It uses the esbuild metafile (esbuild is already a dev dependency) with the entries `Player.tsx`, `Editor.tsx`, `Settings.tsx`, and `Library.tsx` with `Overview.tsx`, `History.tsx` and `ImportPreview.tsx`. Nothing is maintained by hand, so it cannot go stale.
- `select(changedFiles)` returns areas, specs, shapes and a reason per file.
  1. `docs/**`, `assets/**`, `*.md`, `.github/**`, `tests/unit/**`, `tests/production/**`, `Dockerfile`, compose files, `CITATION.cff` and `.env.example`: no browser tests.
  2. A spec file: that spec.
  3. `apps/server/**`: the household area, server shape only.
  4. `packages/household/**`: the household area.
  5. `workouts/**`: treated as the generated bundle.
  6. A file the web app imports: the areas whose screens reach it. A file only the app shell reaches (`App.tsx`, `main.tsx`, `global.css`): every area.
  7. Anything else (`package.json`, `vite.config.ts`, `fixtures.ts`, `helpers.ts`, the configuration): every area.

`scripts/e2e.ts` (new, run with `tsx` like the other scripts)

- `npm run test:e2e:quick` runs every area in `webkit` and `static-webkit`. Area names narrow it: `npm run test:e2e:quick -- editor settings`.
- `npm run test:e2e:changed` asks git for the uncommitted and untracked files (`--changed=origin/main` for everything not pushed), applies `select`, prints what it runs and what it leaves out, and exits 0 with "nothing for the browser" when rule 1 covers everything.
- `--engines=all` widens either one to Firefox as well. Other arguments pass through to Playwright.
- `npm run test:e2e` stays the full suite, unchanged.

`tests/unit/e2e-areas.test.ts` (new)

- Every spec under `tests/e2e` except the screenshot pass belongs to an area, and every listed spec exists.
- `select`: docs only gives nothing, a spec gives itself, a server file gives household in the server shape, `settings/TrainingSettings.tsx` stays out of the editor, and `App.tsx` and an unknown path give everything.
- The test reads only `tests/e2e` and `apps/web/src`, both inside the image build context. `docs`, `assets` and `.github` are not, which once broke the image build.

## 4. CI: four jobs side by side

`.github/workflows/check.yml`

- Job `check`: `npm ci`, `npm run check` and both builds, as today, without the browsers.
- Job `browser` with `strategy.matrix` over `chromium`, `firefox`, `webkit` and `static-chromium`, `fail-fast: false`: `npm ci`, install that one engine, `npm run test:e2e -- --project=<project>`, and upload `browser-test-results-<project>` on failure.
- The `BROWSER_SUITE` switch stays, as step conditions in the browser job.
- `scripts/install-browsers.mjs`: engine names given as arguments replace the default three.
- `release.yml` needs no change: it looks for a successful run of `check.yml` on the commit and calls the workflow as a whole.

## 5. Docs

- `docs/development.md`, "Checks": the three sizes and when to use which (`test:e2e:changed` while working, `test:e2e:quick` before a commit, `test:e2e` before a push or a release), what the quick runs leave out, the static projects no longer rerunning the layout tests, and the screenshot pass.
- The header comment of `check.yml`.
- `AGENT.md`: the standing decision on local browser runs in section 15, and the pointer to this plan.

## Verification

- `npm run check` with the new unit test, and the `build` stage of the image (`docker build --target build .`), since unit tests run inside it.
- `npx playwright test --config tests/playwright.config.ts --list`: 669 tests, no `screens` entry and no `@layout` test under a static project. With `SCREENS=1` the screenshot pass is back.
- Timings recorded for 2, 4, 5 and 6 workers, and three clean full local runs at the chosen value.
- `npm run test:e2e:changed` on four staged situations: a docs edit (nothing), `settings/TrainingSettings.tsx` (settings, not the editor), `apps/server/src/store.ts` (household, no static project) and `App.module.css` (every area).
- `npm run test:e2e:quick -- editor` runs the editor spec and `static/time-fields` in WebKit only.
- Push to a branch first: the four browser jobs run in parallel, Check as a whole is green, and a deliberately failing test on the branch turns it red and uploads the trace of that project.

## Left out, with the reason

- **Skipping the browser suite in CI for docs-only pushes.** The release accepts any green Check of the tagged commit, so a docs commit on top of a red code commit would pass as tested. Closing that hole costs more than the minutes saved.
- **Serving built bundles to the tests instead of the Vite dev servers.** Every test loads about 150 modules one by one, and a bundle might cut a good part of that, mostly in CI. It changes how every test loads the app and needs its own measurement.
- **Fewer engines in CI.** CI stays the net: everything, in three engines.
