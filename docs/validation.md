# Player milestone validation

Recorded 26 October 2026. This records the initial timed-player milestone, not completion of all P0 requirements.

## Environment

- Host: macOS 26.6.2, Apple silicon.
- Repository-local Node: 24.22.1. React 19.3.1, Vite 8.3.5, TypeScript 7.0.2, Fastify 5.12.7.
- Playwright: 1.64.1; Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. These are isolated test browsers, not the user's installed Safari/Firefox applications.
- Docker Desktop 4.96.0; server Engine 29.9.1; native linux/arm64 image using Node 24.22.1 on Debian Bookworm slim.

## Results

| Check | Result |
| --- | --- |
| Strict TypeScript and schema/example generation consistency | Passed on the host and inside the image build. |
| Domain/compiler, engine, audio and server unit checks | 17 passed. |
| Accelerated browser integration | 27 passed: nine scenarios in each of Chromium, Firefox and WebKit. |
| Real production-container browser smoke | Three passed: actual one-second workout in each browser engine; no clock injection available. |
| Native arm64 Docker build and startup | Passed; `wodva-preview-app-1` running healthy at `http://127.0.0.1:8080`. |
| Served frontend, JS asset and readiness endpoint | HTTP 200; hashed asset caching is immutable; readiness explicitly reports no persistence. |
| Production test-hook exclusion | Build assertion passed; fetched served JS contains no `__wodvaTest`; production browser checks confirm it is undefined. |
| Idle runtime memory | One short sample approximately 33 MiB; not a real-hour or memory-pressure test. |
| Git whitespace checks | Passed for staged and working changes. |

The accelerated cases cover exact circuit timing and stable A/B lanes, pause/resume, manual section readiness and assignment alternation, preview-before-import, export, invalid imports, confirmed stop, responsive layouts, visible training controls, continued loaded play while offline, and simulated visibility loss requiring explicit resume. Unit tests additionally exercise nested rest/repeat paths, invalid/excessive input, stale/duplicate commands, all crossed semantic boundaries after a delayed callback, audio cancellation/rebasing, and stale countdown suppression.

The canonical circuit resolves to 1,190,000 active milliseconds and 1,200,000 with prep. The supplied full-body workout resolves to 3,000,000 active milliseconds, with section durations `[300000, 600000, 600000, 600000, 600000, 300000]`. Ready waits are excluded.

## Visual checks

Automated layout checks covered 1440×1000, 768×900, 1024×768, 390×844, and 320×740 CSS pixels. Pause and both athlete assignments remain in the training viewport at the tested narrow sizes. Shared-display work uses a primary timer of at least 112px, movement names of at least 40px, and 28px athlete/up-next text at the 1024×768 baseline; phone type sizes adapt to handheld use.

Inspected generated screenshots for desktop, half-width, and phone ready states, plus 1024×768 and 390×844 active-training states. Training hides general navigation and keeps the perimeter within the usable viewport. Context mode uses a scrollable content window and provides a Follow workout control.

Screenshots and retained failure traces are ignored local test artifacts under `test-results/` and `test-results-production/`. Reproduce with `npm run test:e2e` and, while the Docker preview is running, `npm run test:production`.

## Pending acceptance

- Direct manual inspection in the installed Safari application was unavailable because computer-use permission was not granted; WebKit engine coverage passed.
- No physical iPad/iPhone testing, two-metre recognition trial, real-speaker/music audibility trial, or home-screen-mode test has been completed.
- The real 60-minute timing/offline/recovery/memory run remains pending. Short accelerated and production smoke tests do not satisfy that gate.
- amd64/native multi-architecture CI, GHCR publishing and actual Portainer deployment have not been run. Workflows and Compose definitions are provided.
- SQLite, authentication, durable local/server checkpoints, reload recovery, result synchronisation, saved-library import conflict/provenance handling, packs/programs, and the editor are not implemented in this milestone.
