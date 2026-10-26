# Player milestone validation

Recorded 26 October 2026.
This records the initial timed-player milestone, not completion of all P0 requirements.

## Environment

- Host: macOS 26.6.2, Apple silicon.
- Repository-local Node: 24.22.1.
  React 19.3.1, Vite 8.3.5, TypeScript 7.0.2, Fastify 5.12.7.
- Playwright: 1.64.1.
  Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2.
  These are isolated test browsers, not the user's installed Safari/Firefox applications.
- Docker Desktop 4.96.0.
  Server Engine 29.9.1.
  Native linux/arm64 image using Node 24.22.1 on Debian Bookworm slim.

## Results

| Check | Result |
| --- | --- |
| Strict TypeScript and schema/example generation consistency | Passed on the host and inside the image build. |
| Domain/compiler, engine, audio and server unit checks | 17 passed. |
| Accelerated browser integration | 27 passed: nine scenarios in each of Chromium, Firefox and WebKit. |
| Real production-container browser smoke | Three passed: actual one-second workout in each browser engine. No clock injection available. |
| Native arm64 Docker build and startup | Passed. `openwod-preview-app-1` running healthy at `http://127.0.0.1:8080`. |
| Served frontend, JS asset and readiness endpoint | HTTP 200. Hashed asset caching is immutable. Readiness explicitly reports no persistence. |
| Production test-hook exclusion | Build assertion passed. Fetched served JS contains no `__openwodTest`. Production browser checks confirm it is undefined. |
| Idle runtime memory | One short sample approximately 33 MiB. Not a real-hour or memory-pressure test. |
| Git whitespace checks | Passed for staged and working changes. |

The accelerated cases cover exact circuit timing and stable A/B lanes, pause/resume, manual section readiness and assignment alternation, preview-before-import, export, invalid imports, confirmed stop, responsive layouts, visible training controls, continued loaded play while offline, and simulated visibility loss requiring explicit resume.
Unit tests additionally exercise nested rest/repeat paths, invalid/excessive input, stale/duplicate commands, all crossed semantic boundaries after a delayed callback, audio cancellation/rebasing, and stale countdown suppression.

The canonical circuit resolves to 1,190,000 active milliseconds and 1,200,000 with prep.
The supplied full-body workout resolves to 3,000,000 active milliseconds, with section durations `[300000, 600000, 600000, 600000, 600000, 300000]`.
Ready waits are excluded.

## Visual checks

Automated layout checks covered 1440×1000, 768×900, 1024×768, 390×844, and 320×740 CSS pixels.
Pause and both athlete assignments remain in the training viewport at the tested narrow sizes.
Shared-display work uses a primary timer of at least 112px, movement names of at least 40px, and 28px athlete/up-next text at the 1024×768 baseline.
Phone type sizes adapt to handheld use.

Inspected generated screenshots for desktop, half-width, and phone ready states, plus 1024×768 and 390×844 active-training states.
Training hides general navigation and keeps the perimeter within the usable viewport.
Context mode uses a scrollable content window and provides a Follow workout control.

Screenshots and retained failure traces are ignored local test artifacts under `test-results/` and `test-results-production/`.
Reproduce with `npm run test:e2e` and, while the Docker preview is running, `npm run test:production`.

## Pending acceptance

- Direct manual inspection in the installed Safari application was unavailable because computer-use permission was not granted.
  WebKit engine coverage passed.
- No physical iPad/iPhone testing, two-metre recognition trial, real-speaker/music audibility trial, or home-screen-mode test has been completed.
- The real 60-minute timing/offline/recovery/memory run remains pending.
  Short accelerated and production smoke tests do not satisfy that gate.
- amd64/native multi-architecture CI, GHCR publishing and actual Portainer deployment have not been run.
  Workflows and Compose definitions are provided.
- SQLite, authentication, durable local/server checkpoints, reload recovery, result synchronisation, saved-library import conflict/provenance handling, packs/programs, and the editor are not implemented in this milestone.

## Feature round, 26 October 2026

Added after the player milestone: YAML exchange format (version 2, human durations, legacy JSON still read), projected difficulty, the overview page, six sourced example workouts, device-voice selection with optional recorded cue clips, and the timed-circuit editor with autosaved drafts.

| Check | Result |
| --- | --- |
| Strict TypeScript, generated schema/example consistency, unit tests | 40 unit tests passed (compiler, engine, audio, server, library, difficulty, outline, examples, builder). |
| Accelerated browser integration | 17 scenarios in each of Firefox and WebKit passed (34). Chromium runs in CI. |
| Production build and test-hook exclusion | Passed. Bundle grew by the YAML parser (about 33 kB gzipped). |
| Visual pass | WebKit screenshots of library, overview, editor and player in light and dark at 1440 and 390 px inspected. |

Not run in this round: the recorded cue clips (`npm run cues:generate` needs a one-off Piper download, which this environment could not perform, so the app falls back to device voice and says so), the Docker production smoke test, and the real-hour and physical-device checks listed above.

## Formats wave, 26 October 2026

Added: workout model version 2 and file version 3 (manual tasks, six section formats, targets, levelled loads), engine commands Done/Finish/Switch/Count with cap precedence and a snapshot/restore pair, per-format player layouts with big targets and level chips, a per-athlete load level, format and “only my equipment” filters, seven format fixtures (Cindy, Fran, a partner EMOM, you-go-I-go sprints, run/sled/run, 5 × 5 back squat, a mixed session) and 22 workouts curated from coach programming, and editor support for every format.

| Check | Result |
| --- | --- |
| Frozen traces of the eight timed fixtures | Byte-identical before and after the model change (`tests/unit/traces`). |
| Unit tests | 76 passed, including AT-04, 05, 06, 07, 08, 20 and 22 against the fake clock, and a snapshot round trip. |
| Accelerated browser integration | Firefox and WebKit: the previous 17 scenarios plus AMRAP, EMOM, For time, you-go-I-go, library filters and an editor-built AMRAP. Chromium runs in CI. |
| Production build and test-hook exclusion | Passed. |
| Visual pass | WebKit screenshots of library, overview, editor, the ready screen and the AMRAP, EMOM, For time, you-go-I-go, strength and finish screens in light and dark at 1024 × 768 and 390 × 844 inspected. |

Not run in this round: the Docker production smoke test, the recorded cue clips, and the real-hour and physical-device checks listed above.

## Library and identity wave, 26 October 2026

Added: OpenWOD branding, inline load levels, 16 bundled benchmarks, collections, the Settings page with equipment and movement master data, the local session log, accumulative chip filters, equipment on the overview, one chip style, the timer wash and motion pass, three recorded cue packs rendered in the Docker build, and the repository cleanup with the README rewrite.

| Check | Result |
| --- | --- |
| Unit tests | 95 passed (including coach and benchmark fixtures, library filters, audio packs). |
| Accelerated browser integration | Firefox and WebKit: 25 scenarios each (50), including the settings page, master-data merge, collections, the session log and accumulative filters. Chromium runs in CI. |
| Production build and test-hook exclusion | Passed. |
| Visual pass | WebKit screenshots of the library (desktop and phone), the settings page and the player wash at work, warning and rest inspected. |
| Native arm64 Docker build with cue packs | Passed with `CUES=1` after two fixes: piper-tts 1.8 needs an explicit `piper.download_voices` step (pinned, script updated), and the Vitest root is now resolved from the config file so `npm run check` works inside the image. The image rendered 3 packs × 10 cues. `/cues/packs.json` and every `go.mp3` are served as `audio/mpeg`. |
| Production smoke test | Firefox and WebKit against the running image: the real one-second interval and a new scenario that lists the three packs, decodes a clip in the browser and sees the packs in the settings select. Found and fixed: the settings page listed no packs until a sound had been unlocked (packs.json is now read on start). |

Not run in this round: the amd64 build (CI), and the real-hour and physical-device checks listed above.

## Exercises and search wave, 26 October 2026

Added: the exercise catalogue (190 bundled records in families, device-local records, overrides, merges and removals), the `movement` id on prescriptions, one ranked typo-tolerant search for the library and the editor's exercise picker, imports opening in the editor with unmatched movements highlighted, exercise housekeeping and the settings page split into sections with labelled switches and segmented controls, library filters kept for the session, press ripple and card tilt, chip contrast, the brand mark rendering in theme colours (it had been black in both themes because the component used a plain class name instead of the CSS-module one), and self-contained speech: five English Piper voices (three men and two women with British, Scottish, Northern English and American accents) rendered at image build time as fixed cues plus one clip per bundled exercise, so announcements like "A, kettlebell swings.
B, row." are recorded clips and the device-voice picker is gone (the device's best English voice only reads exercises the pack does not know).

| Check | Result |
| --- | --- |
| Unit tests | 110 passed, including the catalogue (every bundled movement name resolves except two composite names), search ranking and typos, linking, merges, renames and default loads, and announcements from recorded name clips with the device-voice fallback. |
| Accelerated browser integration | Firefox and WebKit: 28 scenarios each (56): the exercise picker filling names and equipment, unknown movements added from the editor, an import with an unknown movement opened as a draft, merged on the exercises page and reflected on the overview, typo search, filters surviving navigation, and the settings sections. Chromium runs in CI. |
| Production build and test-hook exclusion | Passed. |
| Visual pass | WebKit screenshots of the general, sound and exercises settings pages, the library chips and the brand mark in both themes inspected. |

| Native arm64 Docker build with five voices | Passed with `CUES=1`: 5 packs × 207 clips (17 cues and 190 movement names each) rendered in about 5.5 minutes with the Piper Python API, about 2 MB per pack, image 286 MB. The voice layer is built from `scripts/` and `packages/` before the app is copied, so it is cached across app edits. |
| Production smoke test | Firefox and WebKit against the running image: the real one-second interval through the new import-to-editor flow, the five packs listed with 190 names each, a name clip served and a cue clip decoded in the browser, and the five voices in the Voice select. |

Not run in this round: the real-hour and physical-device checks listed above.

## Registry, polish and master-data wave (2c), 26 October 2026

Added: the workout registry (`workouts/<collection>/<id>.wod.yaml`, bundled at build time with a drift check that also refuses unknown movement names), a CrossFit/HYROX-aware content pass over 28 files (women's loads, HYROX open-division station standards, ball and box standards, equipment, recorded in `workouts/README.md`), the `women` amount on load values with the bracket display for solo workouts and sex-aware lanes for pairs, kg/lb display conversion snapped to plate sizes, loads removed from movement records, the "movement" wording, the complete removal of the working title (storage fallbacks, test hook, the old file discriminator and pre-release file versions, attribution strings) with a guard in `npm run check`, one CRUD flow for the three master-data pages with family heads kept above variants under a search, the Training view settings section (unit, default view, ring width, pulse intensity, amber/red marks), bordered secondary and danger buttons, a thicker configurable timer ring, a softer ripple, no source label on cards, and a structured editor row with a men/women load table.

| Check | Result |
| --- | --- |
| Unit tests | 126 passed, including the registry (every file bundled once under its own id, every movement name resolves), load formatting and conversion, the compiler's rejection of a women's amount on a percentage, parent-first movement rows, and the configurable colour marks. |
| Generated-file and legacy checks | Schema and workout bundle up to date. No occurrence of the working title outside AGENT.md's history. |
| Accelerated browser integration | Firefox and WebKit: 29 scenarios each (58): the import flow, pre-release files refused, Fran showing `20 (15) · 30 (20) · 43 (29) kg`, equipment rename and merge through the list, a collection created, edited and removed through the dialogs, a bundled movement removed behind its confirmation, the training view settings reaching the ring width, the wash and the pound display (`95 (65) lb`). Chromium runs in CI. |
| Production build and test-hook exclusion | Passed. |
| Visual pass | WebKit screenshots of the Training view, Movements, Equipment and Collections pages, the editor, the library, the overview and the for-time and you-go-I-go players in both themes at 1024 and 390 px inspected. The editor's target select was truncated in the lane cell and now stacks under the load group below 1400 px, and narrow list rows caption their cells. |

Follow-ups the same day, all verified with the full suites (127 unit, 58 browser scenarios in Firefox and WebKit): the Training view section with its Look & feel tile (live miniature, Preview run, milestone markers with colours, the per-segment pulse curve shared with the player through `washDrain`), Sound under Training view, cards reduced to Start and Details with the collection as a corner label, exclusive collections with a Default collection and editable bundled ones, the repertoire picker for equipment (a Firefox-only failure traced to the suggestion list scrolling the dialog, fixed by fixing the list to the viewport), committed merges, and aligned list captions.
Then, before Wave 3: bundled-collection edits became deltas (a full copy from an earlier build converts on load), the partner session's dumbbell stations were renamed to the dumbbell records (two records added, and the frozen trace was regenerated and differs only in ten names, not in timing), women's sandbag lunges got a 7.5 kg medium step, the picker nudges on near-duplicate names, and the settings page and the browser spec were split into one file per section.

Native arm64 Docker build with the registry and five voices: passed (the image's check step runs the registry bundle and the legacy-name guard, and the cue layer rendered 5 × 213 clips including the new dumbbell records).
The production smoke test passed in Firefox and WebKit against the running image (6 scenarios).

Later the same day: the editor's manual equipment field removed in favour of derivation from the movements (a bundled workout's declared gear that no record covers is carried unchanged).
The projected difficulty discounts short pieces and takes a device calibration (marks, weights, thresholds) from a new tile under General with reference workouts that re-rate live.
The font stack names the families directly, because the local() alias bound Firefox to the regular face and every bold weight fell back to regular there.
Verified: 129 unit tests, 60 browser scenarios in Firefox and WebKit (new: the calibration re-rates the reference list, a library card and the editor's live summary), production build, and WebKit screenshots of the General page in both themes at 1024 and 390 px, the editor at 1024 px, and a Firefox-against-WebKit comparison of the editor heading.
The settings miniature then switched from its own flat tint to the player's wash overlay (one shared class, the same custom properties), re-verified with the player and settings specs in both engines and a WebKit capture of the Training view.

Not run in this round: the real-hour and physical-device checks listed above.
