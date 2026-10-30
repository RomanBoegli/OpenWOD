# Developing OpenWOD

```sh
npm ci
npm run dev:full
```

Open http://127.0.0.1:5173.
`dev:full` runs the API on port 8787 against `.data/app.sqlite` beside the Vite dev server, which proxies `/api` to it.
`npm run dev` alone serves the web app without a server, and the app then works from its device cache and says the server is unreachable.
`npm run dev:static` serves the static shape instead: no API at all, and the library lives in the browser's IndexedDB.
Dependencies, a pinned Node 24 runtime, the npm cache and the test browsers all live inside the repository (`node_modules/`, `.cache/`).
Nothing is installed globally.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | React app: library, overview, editor, player, history, settings (one file per section under `src/settings/`), the household data layer under `src/data/` (API client, IndexedDB, outbox, checkpoints, session lock), theme, audio, wake lock. |
| `apps/server/` | Fastify: the household API over SQLite (`db.ts` migrations, `store.ts`, `routes.ts`), configuration, health, and the built app. |
| `packages/domain/` | TypeBox schema (the single source for types, validators and published JSON Schemas), YAML exchange, compiler, outline, difficulty, library summaries and filters, editor builder model, load formatting, the generated workout bundle. |
| `packages/engine/` | Pure session state machine with an injected clock. |
| `packages/household/` | The household's rules as `class Household` over the synchronous `HouseholdTables` port, implemented by the server's SQLite store and the browser's `local-backend.ts`, plus the `openwod.export` document with its validation for restore. |
| `workouts/` | The workout registry: one hand-written `.wod.yaml` per workout, in a folder per bundled collection (`collection.yaml` names it). `npm run workouts:bundle` regenerates `packages/domain/src/generated/bundled.ts`, and `npm run check` fails when it is stale, a file is invalid, or a movement name is not in the catalogue. See [workouts/README.md](../workouts/README.md). |
| `schemas/` | Generated JSON Schemas. `npm run schemas:generate` after editing the schema. |
| `tests/` | Unit tests (Vitest, including the server and store against an in-memory database), browser tests (Playwright: one spec per area sharing `e2e/helpers.ts` and the scope fixture in `e2e/fixtures.ts`, plus the screenshot pass) and the production smoke test. Configs live beside them. |
| `deploy/` | The source-build Compose file. The root `compose.yaml` and `Dockerfile` are the production route. |
| `docs/` | Architecture decisions, validation records, this guide, deployment and the file format. |
| `assets/brand/` | Logo sources. |

## Checks

```sh
npm run check          # TypeScript, schema and workout-bundle consistency, unit tests
npm run build          # production bundle plus the test-hook exclusion check
npm run browsers:install
npm run test:e2e       # both shapes in Chromium, Firefox and WebKit
npm run build:static   # the static site into dist/static, with the relative-path check
npm run preview:static # serves dist/static on http://127.0.0.1:4173
npm run test:e2e:static # the static projects alone
```

Browser tests drive the player through an injected clock (`window.__openwodTest`) that exists only in test builds, so a 20-minute workout runs in seconds.
The Playwright configuration starts the API with `DATABASE_PATH=:memory:` and test scopes enabled, and every test sends its own `X-OpenWOD-Scope` header, so parallel workers never share data and a reload within a test keeps its own.
The `api` fixture talks to the same scope for seeding and assertions.
The static projects (`static-chromium`, `static-firefox`, `static-webkit`) run against a `static-test` dev server on port 5175 with no API behind it.
They rerun the player, editor, settings, screens, tabs, library and recovery specs and add `tests/e2e/static/` (library, packs, history, backup, migration, strings, settings), and `serverOnly()` from `e2e/fixtures.ts` skips a test that needs the API.
`tests/unit/local-backend.test.ts` runs the shared household suite against IndexedDB through `fake-indexeddb`.
The production smoke takes `OPENWOD_PRODUCTION_MODE=static` for the static site, for example `OPENWOD_PRODUCTION_URL=http://127.0.0.1:4173/ OPENWOD_PRODUCTION_MODE=static npm run test:production` against `preview:static`.
WebKit stands in for Safari's engine. `SCREENS=1 npx playwright test --project=webkit tests/e2e/screens.spec.ts` captures a screenshot set of every screen in both themes for visual review.

The frozen traces under `tests/unit/traces/` pin the compiled timing of the eight original timed sessions in `workouts/`.
A change there is a change in behaviour and must be deliberate.

## Recorded voices

`npm run cues:generate` renders five English voice packs with [Piper](https://github.com/OHF-Voice/piper1-gpl) into `apps/web/public/cues/<pack>/` (needs `uv` and `ffmpeg`. `CUE_PACKS=british` renders one): the fixed cues (Go, Rest, countdown, A, B, Next, Last interval, …) as `<cue>.mp3` and every bundled movement's spoken name under `names/<movement-id>.mp3`, about 200 clips and 2 MB per pack.
Names the bundled workouts write differently from their record ("Plank rows" for Renegade rows) are recorded as written under `names/text/<slug>.mp3`. `npm run workouts:bundle` lists them in `packages/domain/src/generated/cue-phrases.json`, and the app plays a record's clip only for the record's own name (AUD-10).
The list of packs and cue texts lives in `scripts/generate-cues.ts`. `scripts/render-cues.py` does the synthesis with the Piper Python API so a voice model loads once per pack.
Every clip is trimmed and brought to the same level (-18 dBFS RMS, peaks under -1 dBFS) in two ffmpeg passes, because single-pass loudness normalisation cannot measure clips this short.
Piper samples noise on every synthesis, so a clip can once in a while come out silent and is then synthesised again, up to three times, before the render fails naming that clip.
A pack rendered by an older version of the scripts is rendered again, not resumed.
The Docker build renders the same set (`CUES=1`, the default) in a stage that starts from the bare Node image with only the two cue scripts, the movement catalogue, the phrase list and a pinned `tsx`, so the layer stays cached across app edits, version bumps and dependency updates.
A cached rebuild shows `CACHED` beside the render step.
The rendered files are not committed.
Without them the app uses beeps and the device's best English voice.
For the static site CI renders the same packs with the same two scripts on the runner (`PIPER_PYTHON=python3`, Piper from pip) and caches them under a key built from the two cue scripts, `packages/domain/src/movements.ts` and the phrase list.
A cache saved by a tag is not visible to the next tag, so the **Cues** workflow (`.github/workflows/cues.yml`) renders and saves them on `main` whenever one of those four files changes, or when it is dispatched by hand.
`OPENWOD_REQUIRE_CUES=1 npm run build:static` fails unless all five packs are in the build.

## Conventions

Formats stay a bounded set of shared behaviours (timed, interval, manual, cap) rather than one implementation per workout type.
The engine never guesses: manual work has no deadline, and nothing is inferred from elapsed wall time.
In the server shape browser storage is a cache, in the static shape it is the library, and every read is validated.

## Cutting a release

The **Release image** workflow (`.github/workflows/release.yml`) publishes everything when a `v*` tag is pushed: the image, the static site on GitHub Pages and the GitHub Release.
The workflow refuses a tag whose version is not the one in `package.json`, and a tag without release notes.
It does not repeat the browser suite: the **Check** workflow that ran on the same commit when it was pushed to `main` counts, and only a commit without a green Check is tested inside the release.
The browser suite can be paused with the `BROWSER_SUITE` switch at the top of the Check workflow, which keeps lint, typecheck, unit tests and both builds running.
Tags do not trigger the Check workflow on their own.

The jobs run in this order:

| Job | What it does |
| --- | --- |
| `validate` | Checks the tag against `package.json` and the release notes, looks for a green Check of the commit, builds the static shape once. |
| `check` | The Check workflow, only when the commit has no green Check yet. |
| `image` | Builds amd64 and arm64 natively, smoke-tests each candidate container in three engines, pushes the candidates. |
| `manifest` | Publishes the multi-architecture manifest, refuses an existing tag, and hands its digest to the release job. |
| `static` | Renders the voices (or restores them from the cache), builds with `OPENWOD_REQUIRE_CUES=1`, smoke-tests `vite preview` in three engines, zips `openwod-static-<tag>.zip` and uploads the Pages artifact. |
| `release` | Tags only: creates the GitHub Release with `docs/releases/<tag>.md` as the body plus an image digest line, attaches the zip, refuses an existing release. |
| `pages` | Tags only: deploys to GitHub Pages, waits until the live site serves the new entry script, and checks that the script carries the tag's version. |

`release` and `pages` wait for both `static` and `manifest`, so nothing is published unless the image and the static site passed.
A manual run (`workflow_dispatch`) publishes the image as `sha-<commit>` and builds and smokes the static site, but never creates a release or deploys Pages.

Once per repository, before the first tag that publishes the static site:

- Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- Settings → Environments → `github-pages`: allow deployments from tags matching `v*` (by default only the default branch may deploy).
- Settings → Actions → General → Workflow permissions: allow `contents: write`, which the release job needs to create the GitHub Release.
- Optionally dispatch the **Cues** workflow once, so the first tag finds the voices in the cache instead of rendering them inside the release.

1. Pick the version, `vX.Y.Z`, and put `X.Y.Z` in `package.json`, `package-lock.json` (both `version` fields), `CITATION.cff` (with the release date), the image tag of `.env.example` and the `ARG VERSION` default of the `Dockerfile`.
2. Write `docs/releases/vX.Y.Z.md` from the previous one: what changed, where to get it, supported browsers, known limitations, the schema version, and upgrading.
   It becomes the body of the GitHub Release as it is, so leave the digest as a placeholder: the release job appends the image digest line by itself.
3. Run `npm run check`, `npm run build`, `npm run build:static`, the browser suite in Firefox and WebKit for both shapes, `scripts/rehearse-restore.sh`, and go through `docs/device-checklist.md` on a real device.
4. Commit everything as `Release vX.Y.Z`, tag it annotated, and push both:

   ```sh
   git tag -a vX.Y.Z -m "OpenWOD X.Y.Z"
   git push origin main --tags
   ```

5. Watch the workflow.
   It validates, builds the image natively for amd64 and arm64 (the voice layer comes from the build cache unless a cue script or the catalogue changed), smoke-tests each architecture against a running container, and publishes the manifest `ghcr.io/<owner>/<repository>:vX.Y.Z`.
   Beside it the static job builds and smokes the site, and once both are green the release and pages jobs publish.
   The browser suite does not gate the release, but the smoke tests do: every candidate image and the static site are tested in Chromium, Firefox and WebKit before anything is published.
   When one architecture's job fails or times out, re-run the failed jobs of that run: the other architecture's candidate is already pushed, and the manifest job runs once both image jobs have passed.
   The browser install of the image and static jobs is bounded to ten minutes because the apt mirror of a runner can stall.
   When it hits the bound, re-run all jobs and the job lands on another runner.
   When both candidates are already pushed and only the manifest is missing, it can be published from any machine logged into GHCR with a token that may write packages, with the same `docker buildx imagetools create` command the manifest job runs.
   The job summary of the manifest step prints the digest, and the pages job's summary names the live URL.
6. The first time: open the package on GitHub (Packages → the repository's image) and set its visibility, or add registry credentials to the Portainer stack.
   A fresh package is private.
7. Put the digest into the Portainer stack's `APP_IMAGE`, redeploy, and check `/api/v1/health/ready` reports the new version.
   Open `https://romanboegli.ch/OpenWOD/` and check the footer version and the five voices under Settings → Sound.
8. The GitHub Release is already there, created by the workflow, with the notes, the digest line and the zip.
   Releases up to 1.1.2 were created by hand, and a release that exists already makes the job stop rather than overwrite it.

Existing tags and releases are never overwritten.

The workflow is the only publishing route.
As an emergency exit the same multi-architecture image can be built and pushed from a machine logged into GHCR with `docker buildx build --platform linux/amd64,linux/arm64 --push`, with the `VERSION`, `REVISION` and `SOURCE_URL` build arguments the workflow passes, and the tag's later workflow run then stops at the manifest it refuses to overwrite.
A mistake after the push means a new patch version, not a moved tag.
