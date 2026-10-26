# Initial architecture decisions

## Runtime and dependencies

Use a pinned Node 24 runtime, React/TypeScript/Vite, CSS Modules, Fastify, TypeBox/Ajv, Vitest, and Playwright. npm dependencies and the development Node runtime are repository-local; package-lock.json pins resolution. npm and test-browser caches are also local. Production uses the same Node line in a multi-stage image, serves compiled assets and the same-origin API in one process, and runs as the existing Node image's non-root user. Preserve the repository's GPLv3 licence.

## Schema and compilation

TypeBox is the source for inferred TypeScript types, runtime schema validation, and generated JSON Schemas. Semantic validation additionally enforces global node IDs, athlete counts, two nested repeat levels, occurrence expansion and duration limits. Bound object depth/count before recursive validation. Compiling clones authoring input to isolate the session.

The Phase 0 compiler handles timed work/rest, sequences, repeats, explicit trailing transitions, and an authored alternate-assignment policy. It emits cumulative offsets, stable content anchors, repeat paths, and distinct generated-rest identities. A/B names are presentation settings; swaps change assignments, not athlete identity. Preview and engine use the same compiler. Known unsupported capabilities are rejected rather than approximated.

The 20-minute circuit is the first exact trace. The supplied full-body workout is the second: two four-minute rounds plus two minutes of rest in each block; warm-up/cooldown make 50 active minutes. Manual section readiness waits are excluded from active time. Every trailing rest is authored explicitly.

## Clock and events

WorkoutEngine accepts a monotonic clock function. Each running segment stores an anchor and accumulated offsets; callback counts never determine elapsed time. The host uses animation frames for display and one next-deadline timeout for progression. Pausing freezes offsets. Late observations cross every due semantic boundary once at its scheduled timestamp, suppressing obsolete audio through the separate audio adapter. No late observation crosses a manual readiness gate.

The projection changes at commands/transitions. Clock labels and the SVG perimeter read a separate clock projection without rerendering the full component tree per frame. Previous/Next reset the selected slot while retaining section/active elapsed time and mark the session modified. Commands carry IDs and target the current occurrence; navigation creates a new visit identity. The UI additionally suppresses rapid repeated navigation taps.

## Audio and platform behaviour

Locally generated beeps use the AudioContext clock. Only future countdown/deadline cues are scheduled; pause/navigation cancels pending sources and speech. Each resumed segment obtains a fresh clock mapping. Speech is optional, device-provided, best-effort, and never controls progression. Semantic and audio identities include the session and occurrence. Browser visibility loss auto-pauses without automatic resume. Wake lock is acquired while running/preparing where supported; failures are visible.

## Sharing and persistence boundary

The first player can preview/load and export a complete timed `.wod.json` file. This deliberately has no saved-library import semantics yet. It excludes household names, audio settings, and all session data. Versioned schemas/examples describe the supported subset. Full attribution/provenance, remapped saved-library identities, packs, and supported-version migrations belong to the sharing/editor milestone.

Phase 0 does not write browser or server checkpoints and does not claim recovery. The next vertical slice adds authenticated SQLite content/results, IndexedDB checkpoint/event/outbox transactions, bounded-age progress records naming their checkpoint, Web Locks ownership, and consistent backups. Snapshot deduplication remains optional until measured need.

## Deployment and tests

The production root Compose uses an image reference and named `/data` volume. Source-build Compose is a separate local route. Phase 0 health explicitly reports no persistence. Images run the unit/schema checks during their build. Release CI runs browser tests, then tests amd64/arm64 images on native runners before publishing the combined release manifest.

Browser clock/audio injection exists only in test builds. Unit and browser tests share the canonical fixture definitions. Accelerated tests establish semantics; a real-hour reliability/accuracy run and physical mobile/audio/readability checks remain separate release work.
