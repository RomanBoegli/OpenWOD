# Developing OpenWOD

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Dependencies, a pinned Node 24 runtime, the npm cache and the test browsers all live inside the repository (`node_modules/`, `.cache/`); nothing is installed globally.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | React app: library, overview, editor, player, settings, device storage (library, drafts, master data, session log), theme, audio, wake lock. |
| `apps/server/` | Fastify asset server and health API. |
| `packages/domain/` | TypeBox schema (the single source for types, validators and published JSON Schemas), YAML exchange, compiler, outline, difficulty, library summaries and filters, editor builder model, load formatting, the generated workout bundle. |
| `packages/engine/` | Pure session state machine with an injected clock. |
| `workouts/` | The workout registry: one hand-written `.wod.yaml` per workout, in a folder per bundled collection (`collection.yaml` names it); `npm run workouts:bundle` regenerates `packages/domain/src/generated/bundled.ts`, and `npm run check` fails when it is stale, a file is invalid, or a movement name is not in the catalogue. See [workouts/README.md](../workouts/README.md). |
| `schemas/` | Generated JSON Schemas; `npm run schemas:generate` after editing the schema. |
| `tests/` | Unit tests (Vitest), browser tests (Playwright) and the production smoke test; configs live beside them. |
| `deploy/` | The source-build Compose file. The root `compose.yaml` and `Dockerfile` are the production route. |
| `docs/` | Architecture decisions, validation records, this guide, deployment and the file format. |
| `assets/brand/` | Logo sources. |

## Checks

```sh
npm run check          # TypeScript, schema and workout-bundle consistency, no legacy product name, unit tests
npm run build          # production bundle plus the test-hook exclusion check
npm run browsers:install
npm run test:e2e       # Chromium, Firefox and WebKit
```

Browser tests drive the player through an injected clock (`window.__openwodTest`) that exists only in test builds, so a 20-minute workout runs in seconds. WebKit stands in for Safari's engine. `SCREENS=1 npx playwright test --project=webkit tests/e2e/screens.spec.ts` captures a screenshot set of every screen in both themes for visual review.

The frozen traces under `tests/unit/traces/` pin the compiled timing of the eight original timed sessions in `workouts/`; a change there is a change in behaviour and must be deliberate.

## Recorded voices

`npm run cues:generate` renders five English voice packs with Piper into `apps/web/public/cues/<pack>/` (needs `uv` and `ffmpeg`; `CUE_PACKS=british` renders one): the fixed cues (Go, Rest, countdown, A, B, Next, Last interval, …) as `<cue>.mp3` and every bundled movement's spoken name under `names/<movement-id>.mp3`, about 200 clips and 2 MB per pack. The list of packs and cue texts lives in `scripts/generate-cues.ts`; `scripts/render-cues.py` does the synthesis with the Piper Python API so a voice model loads once per pack. The Docker build renders the same set (`CUES=1`, the default) from `scripts/` and `packages/` before the app is copied, so the layer is cached across app edits. The rendered files are not committed; without them the app uses beeps and the device's best English voice.

## Conventions

Formats stay a bounded set of shared behaviours (timed, interval, manual, cap) rather than one implementation per workout type. The engine never guesses: manual work has no deadline, and nothing is inferred from elapsed wall time. Browser storage is a convenience until the server milestone and every read is validated.
