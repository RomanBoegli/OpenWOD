# Initial architecture decisions

## Runtime and dependencies

Use a pinned Node 24 runtime, React/TypeScript/Vite, CSS Modules, Fastify, TypeBox/Ajv, Vitest, and Playwright. npm dependencies and the development Node runtime are repository-local; package-lock.json pins resolution. npm and test-browser caches are also local. Production uses the same Node line in a multi-stage image, serves compiled assets and the same-origin API in one process, and runs as the existing Node image's non-root user. Preserve the repository's GPLv3 licence.

## Schema and compilation

TypeBox is the source for inferred TypeScript types, runtime schema validation, and generated JSON Schemas. Semantic validation additionally enforces global node IDs, athlete counts, two nested repeat levels, occurrence expansion and duration limits. Bound object depth/count before recursive validation. Compiling clones authoring input to isolate the session.

The Phase 0 compiler handles timed work/rest, sequences, repeats, explicit trailing transitions, and an authored alternate-assignment policy. It emits cumulative offsets, stable content anchors, repeat paths, and distinct generated-rest identities. A/B names are presentation settings; swaps change assignments, not athlete identity. Preview and engine use the same compiler. Known unsupported capabilities are rejected rather than approximated.

The 20-minute circuit is the first exact trace. The supplied full-body workout is the second: two four-minute rounds plus two minutes of rest in each block; warm-up/cooldown make 50 active minutes. Manual section readiness waits are excluded from active time. Every trailing rest is authored explicitly.

## Clock and events

WorkoutEngine accepts a monotonic clock function. Each running segment stores an anchor and accumulated offsets; callback counts never determine elapsed time. The host uses animation frames for display and one next-deadline timeout for progression. Pausing freezes offsets. Late observations cross every due semantic boundary once at its scheduled timestamp, suppressing obsolete audio through the separate audio adapter. No late observation crosses a manual readiness gate.

The projection changes at commands/transitions. Clock labels and the SVG perimeter read a separate clock projection without rerendering the full component tree per frame; the DOM is written only when a displayed value changes. One engine exists per session; Train again creates a new session rather than cloning the workout. Previous at a section's first occurrence restarts it. Previous/Next reset the selected slot while retaining section/active elapsed time and mark the session modified. Commands carry IDs and target the current occurrence; navigation creates a new visit identity. The UI additionally suppresses rapid repeated navigation taps.

## Audio and platform behaviour

Locally generated beeps use the AudioContext clock. Only future countdown/deadline cues are scheduled; pause/navigation cancels pending sources and speech. Each resumed segment obtains a fresh clock mapping. Fixed cues (countdown numbers, Go/Rest at a boundary, Get ready, Paused, Resume, Complete) prefer pre-rendered MP3 clips under `apps/web/public/cues/`, decoded once before Play and scheduled at the same instants as the beeps; a boundary before a manual Ready gate or at the very end plays no Go/Rest. Dynamic text (athlete assignments) stays on device speech, with the best installed voice chosen by `pickDefaultVoice`. Missing clips fall back to beeps plus device speech without any error. Speech is optional, device-provided, best-effort, and never controls progression. Semantic and audio identities include the session and occurrence. Browser visibility loss auto-pauses without automatic resume. Wake lock is acquired while running/preparing where supported; failures are visible.

## Sharing and persistence boundary

The first player can preview/import and export a complete timed `.wod.yaml` file (file version 2: human-readable durations under `duration`/`prep`/`*Rest` keys, parsed by one YAML 1.2 parser that also reads the version 1 JSON form with `*Ms` keys). The version 2 JSON Schema is derived from the model schema by renaming duration properties, so TypeBox stays the single source. Anchors, aliases and duplicate keys are rejected; the model is always integer milliseconds. Imports go into a device library held in browser storage, validated and compiled again on every load so an older or corrupt entry is dropped rather than approximated; ID collisions produce a copy with a free ID, or an explicit replacement of a saved entry. Preferences (names, sound, theme, view) are also device-local and validated on read. Both are conveniences until SQLite and IndexedDB arrive and are never treated as the household's authoritative data. Files exclude household names, audio settings, and all session data. Versioned schemas/examples describe the supported subset. Full attribution/provenance, remapped saved-library identities, packs, and supported-version migrations belong to the sharing/editor milestone.

Phase 0 does not write browser or server checkpoints and does not claim recovery. The next vertical slice adds authenticated SQLite content/results, IndexedDB checkpoint/event/outbox transactions, bounded-age progress records naming their checkpoint, Web Locks ownership, and consistent backups. Snapshot deduplication remains optional until measured need.

## Screens, routes and theme

The app has two screens behind hash routes: the library at `#/` and the player at `#/wod/<id>`. Hash routes need no server rewrites and keep reloads and the back button working. The library filters pure summaries from `packages/domain/src/library.ts`, computed once per entry. Colours are CSS custom properties on `:root`; `data-theme` on the root element selects the dark or light set. Auto follows `prefers-color-scheme` and reacts to live changes; an inline script in `index.html` applies the stored or system theme before first paint. The player keeps its dark-first contrast targets in both sets.

## Editor

The editor works on a constrained builder model (`packages/domain/src/builder.ts`): sections of timed slots with explicit between-slot, trailing, between-round and after-section rests, optional rounds with the alternate assignment policy, and a ready gate or automatic continuation. `builderToWorkout` emits deterministic position-based IDs so the same draft always yields the same tree; `workoutToBuilder` is the inverse and returns null for shapes outside the model, which the UI reports rather than approximating. The live summary compiles the draft with the same compiler as the player; `validateDraft` adds author-level messages before structural checks. Drafts autosave to browser storage (`wodva.drafts.v1`, debounced), one draft per workout plus one for a new workout, and are removed when saved or discarded. Saving replaces a saved workout at the next revision or creates a new saved workout with a free slugged ID; bundled workouts are only ever duplicated.

## Deployment and tests

The production root Compose uses an image reference and named `/data` volume. Source-build Compose is a separate local route. Phase 0 health explicitly reports no persistence. Images run the unit/schema checks during their build. Release CI runs browser tests, then tests amd64/arm64 images on native runners before publishing the combined release manifest.

Browser clock/audio injection exists only in test builds. Unit and browser tests share the canonical fixture definitions. Accelerated tests establish semantics; a real-hour reliability/accuracy run and physical mobile/audio/readability checks remain separate release work.
