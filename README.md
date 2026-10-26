# Wodva

A responsive workout player for training together at home. React + TypeScript, Vite, and a small Fastify server, packaged in one Docker container.

## Try the player

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** in Safari or Firefox. The library lists every workout on this device; filter by text, athletes, equipment or duration, then press Start. Try a full window, a half-width window, and a narrow phone viewport. Start workout enters a dedicated training layout with the countdown, athlete assignments, perimeter timer, and Pause control in view.

Dependencies are local to `node_modules/`. A pinned Node 24 runtime is installed there too; npm scripts use it automatically. npm's cache and downloaded test browsers live under the ignored `.cache/` directory. No global Node upgrade, Python environment, or global package installation is required. Vite serves and builds the frontend; npm provides dependency isolation.

## What works now

- The canonical **Partner circuit**: five rounds, 40-second work, 10-second station transitions, and 60-second round breaks. Exactly **19:50 active / 20:00 with prep**.
- **Full body partner workout**, based on [example-wod.md](example-wod.md): warm-up, four blocks with alternating assignments, explicit trailing rests, and cooldown. **50:00 active**, excluding prep and Ready waits between sections.
- **Six workout formats**: timed circuits, AMRAP (whole block on screen, round and rep counter with Undo, cap), EMOM (work starts on every boundary, Done shows rest until the next one, no skipping), For time (ordered movements ended by Done, count-up clock, optional cap, chippers and 21-15-9 ladders), You go, I go (one athlete works, Switch hands over, team rounds), and Strength (sets at your own pace with timed rest). Movements carry targets (reps, calories, metres, time) shown big in the player, and loads can be levelled: blue L, red M, black H chips like ski slopes; each athlete picks their level before Play or in settings. Pair tasks choose one Done or both athletes tapping Done.
- **Benchmarks and coach programming**: Cindy and Fran follow the published CrossFit benchmarks; a partner EMOM, you-go-I-go sprints, a run/sled/run piece, a 5 × 5 back squat and a mixed session show the formats; and **22 standalone workouts** curated from a coach's class programs (AMRAPs, EMOMs, chippers, intervals, strength blocks, three for pairs) are bundled with attribution and levelled loads.
- Six more bundled sessions, all playable as timed circuits and each carrying its source: **Tabata This** (23:10) and **Fight Gone Bad** (17:00) follow the published [CrossFit](https://www.crossfit.com/benchmark/tabata-this) [benchmarks](https://www.crossfit.com/workout/2013/09/22); **Row & burpee EMOM 20** is an original EMOM; **HYROX pace intervals** (47:30, solo), **HYROX doubles circuit** (14:00, pair) and **HYROX engine EMOM 24** (24:00, solo) are training variations of the published [HYROX race structure](https://hyrox.com/the-fitness-race/) with timed intervals in place of race distances and loads, labelled as unofficial in the app. Each workout shows a projected difficulty (Light to Brutal) derived from work density, movement intensity, duration and load.
- A **library view** at `#/` with search over titles, descriptions, movements and equipment, plus athlete, format, equipment, duration and difficulty filters and sorting. Each card lists the distinct equipment a workout needs (declared plus inferred from movement names); tick your own gear in settings and “Only my equipment” hides everything that needs more. Each card starts, reads through, edits, exports or removes a workout. The **overview** at `#/wod/<id>` lays the whole session out section by section and round by round for studying before anyone presses Start; the player lives at `#/wod/<id>/play`, so reloads and the back button keep their place.
- A **workout editor** at `#/new` and `#/wod/<id>/edit` for all six formats: sections with a format, rounds, between-round, between-slot, trailing and after-section rests, Tabata-style per-slot repeats, caps, EMOM intervals, team rounds, a ready gate or automatic continuation, and A/B movements with targets, levelled loads, notes and a pair completion rule. The live summary shows active time, time with prep, per-section durations, projected difficulty and every validation message; Save stays disabled until the workout compiles. Drafts autosave on this device and appear in the library until saved or discarded. Bundled workouts can be duplicated into an editable copy; the one bundled shape outside the editor (a timed run before an alternating repeat) says so instead of being approximated.
- Responsive paired Focus/Context views; stable A/B lanes; per-round assignment swaps; upcoming-work preview; accurate countdown/perimeter; pause/resume, previous/next interval (Previous restarts the first interval of a section), and confirmed stop. Leaving the page mid-session asks first, since checkpoints are a later milestone.
- **Light and dark themes** that follow the operating system by default, with an explicit Auto/Light/Dark choice in settings. The theme is applied before first paint to avoid a flash. Athlete names, sound, voice, speed, volume, view and theme are remembered on this device.
- Voice plus local beeps, beeps only, or silent; voice/rate/volume settings and sound test. Audio is unlocked by a user gesture. The device voice is chosen automatically (enhanced/neural voices in English first, novelty voices never) and movement names are phrased with pauses. The fixed cues (Get ready, Go, Rest, 3-2-1, Paused, Resume, Complete) can play as recorded clips scheduled on the audio clock at the exact boundary; generate them once with `npm run cues:generate` (needs `uv` and `ffmpeg`, renders an open-licensed Piper voice) and commit `apps/web/public/cues/`. Without clips the app falls back to beeps and the device voice and says so in settings.
- Screen wake lock where available. Hiding the tab pauses automatically; returning requires Resume. Network loss alone does not pause the timer.
- Export one self-contained `.wod.yaml` file (file version 3, model version 2) and preview/import a compatible workout into the device library, where it survives reloads (browser storage, up to 100 imports). Files are YAML with human durations (`duration: 40s`, `cap: 20m`, `interval: 1m`, `prep: 10s`; `1:30` and bare seconds also work). Earlier version 1 `.wod.json` and version 2 `.wod.yaml` files still import and migrate. An ID that collides with a saved workout offers Import as copy or Replace; a collision with a bundled workout is always saved as a copy. Names and sound preferences are not exported. Schemas and examples are under [schemas/](schemas/) and [examples/workouts/](examples/workouts/).

This is the **first player milestone**, not the full application. Reload starts a fresh session. The device library is browser storage, not the shared household library: SQLite persistence, checkpoint recovery, household login, the editor, program packs, and result history are subsequent milestones. There is no cloud account or runtime analytics requirement. Browser speech may use device-provided online voices; local beeps work without an external service.

## Run the container

Docker builds and tests the application from source:

```sh
docker compose -p wodva-preview -f compose.dev.yaml up --build -d
```

Open **http://127.0.0.1:8080**. This local preview binds only to loopback. Inspect or stop it with:

```sh
docker compose -p wodva-preview -f compose.dev.yaml ps
docker compose -p wodva-preview -f compose.dev.yaml logs app
docker compose -p wodva-preview -f compose.dev.yaml down
```

The runtime runs as UID/GID 1000, serves the frontend and API on container port 8080, and shuts down gracefully. The named volume `wodva-preview_wodva-data` mounts at `/data` and is reserved for the upcoming SQLite milestone; this player currently writes no server data. Stopping/recreating a stack retains its named volume. Changing a stack name changes the default volume identity.

Health endpoints:

- `/api/v1/health/live`: process is responsive.
- `/api/v1/health/ready`: fixture-player service is ready; explicitly reports `persistence: false`.

## Checks

```sh
npm run check
npm run build
npm run browsers:install
npm run test:e2e
```

With the Docker preview running, `npm run test:production` checks a real one-second workout against the production image in all three browser engines, including confirmation that clock-injection hooks are absent.

`check` runs TypeScript, generated-schema/example consistency, and domain/engine/server tests. Playwright covers Chromium, Firefox, and WebKit at desktop/tablet/phone sizes. WebKit tests provide Safari-engine coverage; they do not automate the installed Safari browser. Engine and integration timing tests use an injected monotonic clock and do not wait through full workouts. Test clock/audio injection is compiled out of production builds.

The real 60-minute reliability/accuracy run and physical iPad/iPhone sound, touch, safe-area, wake-lock, and distance-readability checks remain pending. Automated tests cannot establish physical readability or speaker audibility.

After editing the schema source or canonical fixtures:

```sh
npm run schemas:generate
```

The model supports timed work/rest, manual tasks with targets and levelled loads, sequences, up to two repeat levels, explicit trailing rests, round alternation, and six section formats. Malformed files, duplicate node IDs, invalid assignments, format rules (an AMRAP without a cap, a pair task without a completion rule) and excessive expansion are rejected before play. Importing never starts a session automatically. Preview imports are temporary and do not yet implement the saved-library conflict/provenance workflow.

## Portainer and image publishing

The root [compose.yaml](compose.yaml) uses a **prebuilt image**, with no source builds on the server. The [release workflow](.github/workflows/release.yml) validates the project and browser tests, then builds and smoke-tests native amd64/arm64 images before publishing a combined manifest to GHCR. A `v*` tag publishes that release tag; a manual workflow run publishes `sha-COMMIT`. Existing release tags are not overwritten.

To prepare the first deployment, push the code and run the release workflow in your own GitHub repository. Ensure Actions may write packages, choose package visibility, and note the successfully published image tag/digest. This checkout does not publish automatically. Code remains GPLv3; shared workout content does not inherit a licence automatically.

In Portainer Community Edition on Docker Standalone:

1. Create a stack using **Repository**, choose the Git repository/reference, and set the Compose path to `compose.yaml`.
2. Set `APP_IMAGE` to the published full reference, preferably a digest, and optionally `HTTP_PORT` (default `8080`). Placeholder values in `.env.example` must be replaced in the stack variables; the server does not need a local `.env` file.
3. For private repositories, supply Git credentials. For private GHCR packages, configure registry credentials separately.
4. Deploy, check health, and open the app through your existing trusted HTTPS reverse proxy. The app listens on port 8080 inside the container. A typical proxy route is `https://wodva.example.org` → `http://docker-host:8080`.

Current settings:

| Setting | Meaning |
| --- | --- |
| `APP_IMAGE` | Required prebuilt image reference for production Compose. |
| `HTTP_PORT` | Host port, default `8080`. |
| `PORT` | Server port inside the container, fixed to `8080` by Compose. |
| `HOST` | Server bind address; defaults to `0.0.0.0`. |
| `WEB_ROOT` | Optional absolute path to built frontend assets; default `dist/web`. |

This milestone serves public fixtures and has no household API or authentication yet. Authentication secrets, SQLite backups, migration/rollback operations, and trusted-proxy handling will arrive with persistence and are not represented as working features here. Until then, upgrading means selecting a new tested image and re-pulling/redeploying the same stack; image rollback selects the previous image. The existing `/data` volume remains attached.

If startup is unhealthy, inspect container logs and verify the image architecture, port configuration, and available host port. If sound is silent, use Test sound and check browser/device volume and available voices. Wake lock needs a supported browser and secure context (trusted HTTPS or localhost); no background/lock-screen execution is promised.

## Project map

| Path | Purpose |
| --- | --- |
| `apps/web/` | Library, overview, editor and player screens, hash routes, device preferences/library/draft storage, theme sync, browser clock host, audio, wake lock. |
| `apps/server/` | Fastify asset server and health API. |
| `packages/domain/` | TypeBox schema source, validators, YAML exchange format, compiler, outline, difficulty, library summaries/filters, editor builder model, bundled workouts. |
| `packages/engine/` | Pure session state machine with an injected clock. |
| `schemas/`, `examples/workouts/` | Generated portable schemas and workout examples. |
| `tests/` | Unit and browser acceptance checks. |
| `docs/` | Architecture decisions and milestone validation. |

The requirements and full implementation sequence are in [AGENT.md](AGENT.md). Existing project licence: [GNU GPL version 3](LICENSE).
