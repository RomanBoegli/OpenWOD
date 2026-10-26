# Wodva

A responsive workout player for training together at home. React + TypeScript, Vite, and a small Fastify server, packaged in one Docker container.

## Try the player

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** in Safari or Firefox. Try a full window, a half-width window, and a narrow phone viewport. Start workout enters a dedicated training layout with the countdown, athlete assignments, perimeter timer, and Pause control in view.

Dependencies are local to `node_modules/`. A pinned Node 24 runtime is installed there too; npm scripts use it automatically. npm's cache and downloaded test browsers live under the ignored `.cache/` directory. No global Node upgrade, Python environment, or global package installation is required. Vite serves and builds the frontend; npm provides dependency isolation.

## What works now

- The canonical **Partner circuit**: five rounds, 40-second work, 10-second station transitions, and 60-second round breaks. Exactly **19:50 active / 20:00 with prep**.
- **Full body partner workout**, based on [example-wod.md](example-wod.md): warm-up, four blocks with alternating assignments, explicit trailing rests, and cooldown. **50:00 active**, excluding prep and Ready waits between sections.
- Responsive paired Focus/Context views; stable A/B lanes; per-round assignment swaps; upcoming-work preview; accurate countdown/perimeter; pause/resume, previous/next interval, and confirmed stop.
- Voice plus local beeps, beeps only, or silent; voice/rate/volume settings and sound test. Audio is unlocked by a user gesture; voice availability depends on the browser/OS.
- Screen wake lock where available. Hiding the tab pauses automatically; returning requires Resume. Network loss alone does not pause the timer.
- Export one self-contained `.wod.json` file and preview/import a compatible timed workout for the current visit. Names and sound preferences are not exported. Schemas and examples are under [schemas/](schemas/) and [examples/workouts/](examples/workouts/).

This is the **first player milestone**, not the full application. Reload starts a fresh session. Saved workouts, SQLite persistence, checkpoint recovery, household login, the editor, program packs, and result history are subsequent milestones. There is no cloud account or runtime analytics requirement. Browser speech may use device-provided online voices; local beeps work without an external service.

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

The first version supports timed work/rest, sequences, up to two repeat levels, explicit trailing rests, and round alternation. Unsupported formats, malformed files, duplicate node IDs, invalid assignments, and excessive expansion are rejected before play. Importing never starts a session automatically. Preview imports are temporary and do not yet implement the saved-library conflict/provenance workflow.

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
| `apps/web/` | Responsive player, browser clock host, audio, wake lock. |
| `apps/server/` | Fastify asset server and health API. |
| `packages/domain/` | TypeBox schema source, validators, compiler, canonical fixtures. |
| `packages/engine/` | Pure session state machine with an injected clock. |
| `schemas/`, `examples/workouts/` | Generated portable schemas and workout examples. |
| `tests/` | Unit and browser acceptance checks. |
| `docs/` | Architecture decisions and milestone validation. |

The requirements and full implementation sequence are in [AGENT.md](AGENT.md). Existing project licence: [GNU GPL version 3](LICENSE).
