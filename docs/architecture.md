# Initial architecture decisions

## Runtime and dependencies

Use a pinned Node 24 runtime, React/TypeScript/Vite, CSS Modules, Fastify, TypeBox/Ajv, Vitest, and Playwright. npm dependencies and the development Node runtime are repository-local.
Package-lock.json pins resolution. npm and test-browser caches are also local.
Production uses the same Node line in a multi-stage image, serves compiled assets and the same-origin API in one process, and runs as the existing Node image's non-root user.
Preserve the repository's GPLv3 licence.

## Schema and compilation

TypeBox is the source for inferred TypeScript types, runtime schema validation, and generated JSON Schemas.
Semantic validation additionally enforces global node IDs, athlete counts, two nested repeat levels, occurrence expansion and duration limits.
Bound object depth/count before recursive validation.
Compiling clones authoring input to isolate the session.

The Phase 0 compiler handles timed work/rest, sequences, repeats, explicit trailing transitions, and an authored alternate-assignment policy.
It emits cumulative offsets, stable content anchors, repeat paths, and distinct generated-rest identities.
A/B names are presentation settings.
Swaps change assignments, not athlete identity.
Preview and engine use the same compiler.
Known unsupported capabilities are rejected rather than approximated.

The 20-minute circuit is the first exact trace.
The supplied full-body workout is the second: two four-minute rounds plus two minutes of rest in each block.
Warm-up/cooldown make 50 active minutes.
Manual section readiness waits are excluded from active time.
Every trailing rest is authored explicitly.

## Formats and manual work

Model version 2 adds a manual `task` node (a prescription with targets but no execution duration, plus a pair completion rule) and a section `format`: timed circuit, AMRAP, EMOM, for time, you-go-I-go and strength.
The schema keeps the format settings optional on one flat section object because Ajv cannot hold the recursive node schema inside several union members.
The compiler enforces what each format needs (a cap for AMRAP, interval length and count for EMOM, a cap or team rounds for you-go-I-go) and which bodies they accept (flat task lists for AMRAP, EMOM and you-go-I-go, anything for the rest).
Version 1 documents migrate by changing the version literal only.

The compiler marks every occurrence with `timing`: `timed` (fixed duration), `interval` (an EMOM window: fixed duration, Done only reports) or `manual` (zero duration, ended by Done, Finish, Switch or the section cap).
AMRAP and you-go-I-go compile to one block occurrence carrying the whole task list.
The engine never advances it.
Offsets (`startMs`) exist only until the first manual occurrence, so nothing is ever guessed.
A section's `durationMs` is known timed content plus its cap, and `durationKind` says whether that is exact, an upper bound or open.
Difficulty uses nominal times for manual work (the cap, or 60 s per task and 30 s per set) and says so in its header.
Those numbers never reach the player.

The engine gained no statuses: waiting for Done, waiting for a partner and acknowledged rest are projections of `running`.
Its next deadline is the earliest of cap, slot and turn, processed in that precedence so a Finish timestamped at the cap is stale and the result is Capped.
Acknowledgements are scoped to athlete and occurrence.
A you-go-I-go handoff is part of the occurrence identity, so a rapid second Switch carries the previous turn's id and is rejected by the ordinary stale-command check.
The projection lists the controls the engine would accept right now, and the player renders only those. `toJSON`/`fromSnapshot` serialise the whole state without the clock anchor.
A moving snapshot restores as paused with reason `recovered`, which the checkpoint milestone builds on.

Loads are workout data: a single value or light, medium and heavy levels, in kg, lb or percent of 1RM, each with an optional women's amount (`packages/domain/src/prescription.ts` formats them).
Every level is shown as written.
Solo workouts show the women's amount in brackets and a pair lane shows its athlete's amount according to a device preference, and kg/lb display conversion is a device preference too.
Movement records carry no loads, so there is never a second number competing with the workout's.

## Clock and events

WorkoutEngine accepts a monotonic clock function.
Each running segment stores an anchor and accumulated offsets.
Callback counts never determine elapsed time.
The host uses animation frames for display and one next-deadline timeout for progression.
Pausing freezes offsets.
Late observations cross every due semantic boundary once at its scheduled timestamp, suppressing obsolete audio through the separate audio adapter.
No late observation crosses a manual readiness gate.

The projection changes at commands/transitions.
Clock labels and the SVG perimeter read a separate clock projection without rerendering the full component tree per frame.
The DOM is written only when a displayed value changes.
One engine exists per session.
Train again creates a new session rather than cloning the workout.
Previous at a section's first occurrence restarts it.
Previous/Next reset the selected slot while retaining section/active elapsed time and mark the session modified.
Commands carry IDs and target the current occurrence.
Navigation creates a new visit identity.
The UI additionally suppresses rapid repeated navigation taps.

## Audio and platform behaviour

Speech is self-contained: five English [Piper](https://github.com/OHF-Voice/piper1-gpl) voices are rendered at image build time (`scripts/generate-cues.ts`, `scripts/render-cues.py`) as fixed cues plus one clip per bundled movement, and the player decodes the clips a workout needs before Play.
An announcement ("A, kettlebell swings. B, row.") is a sequence of clips when the pack has every name, otherwise the device's best English voice reads the names after the recorded lead cue.
The device voice is never offered as a choice beyond that fallback.
Locally generated beeps use the AudioContext clock.
Only future countdown/deadline cues are scheduled.
Pause/navigation cancels pending sources and speech.
Each resumed segment obtains a fresh clock mapping.
Fixed cues (countdown numbers, Go/Rest at a boundary, Get ready, Paused, Resume, Complete) prefer pre-rendered MP3 clips under `apps/web/public/cues/`, decoded once before Play and scheduled at the same instants as the beeps.
A boundary before a manual Ready gate or at the very end plays no Go/Rest.
Dynamic text (athlete assignments) stays on device speech, with the best installed voice chosen by `pickDefaultVoice`.
Missing clips fall back to beeps plus device speech without any error.
Speech is optional, device-provided, best-effort, and never controls progression.
Semantic and audio identities include the session and occurrence.
Browser visibility loss auto-pauses without automatic resume.
Wake lock is acquired while running/preparing where supported.
Failures are visible.

## Sharing and persistence boundary

The app imports and exports complete `.wod.yaml` files (file version 3: human-readable durations under `duration`/`prep`/`*Rest`/`cap`/`interval`/`turn`/`time` keys, parsed by one YAML 1.2 parser that also reads JSON).
The file JSON Schema is derived from the model schema by renaming duration properties, so TypeBox stays the single source.
Only version 3 is read.
The two pre-release versions are refused with a message.
Anchors, aliases and duplicate keys are rejected.
The model is always integer milliseconds.
Imports go into a device library held in browser storage, validated and compiled again on every load so an older or corrupt entry is dropped rather than approximated.
ID collisions produce a copy with a free ID, or an explicit replacement of a saved entry.
Preferences (names, sound, theme, view) are also device-local and validated on read.
Both are conveniences until SQLite and IndexedDB arrive and are never treated as the household's authoritative data.
Files exclude household names, audio settings, and all session data.
Versioned schemas/examples describe the supported subset.
Full attribution/provenance, remapped saved-library identities, packs, and supported-version migrations belong to the sharing/editor milestone.

Phase 0 does not write browser or server checkpoints and does not claim recovery.
The next vertical slice adds authenticated SQLite content/results, IndexedDB checkpoint/event/outbox transactions, bounded-age progress records naming their checkpoint, Web Locks ownership, and consistent backups.
Snapshot deduplication remains optional until measured need.

## Screens, routes and theme

The app has two screens behind hash routes: the library at `#/` and the player at `#/wod/<id>`.
Hash routes need no server rewrites and keep reloads and the back button working.
The library filters pure summaries from `packages/domain/src/library.ts`, computed once per entry.
Colours are CSS custom properties on `:root`. `data-theme` on the root element selects the dark or light set.
Auto follows `prefers-color-scheme` and reacts to live changes.
An inline script in `index.html` applies the stored or system theme before first paint.
The player keeps its dark-first contrast targets in both sets.

## Workout registry

The bundled workouts are hand-written YAML files under `workouts/<collection>/`, one per workout.
A folder with a `collection.yaml` is a bundled collection, so every bundled workout sits in at most one collection.
A workout belongs to one collection at a time, and the card shows it as a thin corner label.
The user's edits to a bundled collection are stored as a delta (title, description, added and removed ids) so a workout added to that folder in a later release still appears.
A full copy saved by an earlier build is converted on load. `scripts/bundle-workouts.ts` parses every file with the same importer the app uses, checks that ids match file names and are unique and that every movement name resolves in the catalogue, and writes `packages/domain/src/generated/bundled.ts`, which the app, the tests and the server import. `npm run check` fails when the bundle is stale.
The files are the source of truth, so a workout is changed by editing its file, never a TypeScript fixture, and the frozen timing traces under `tests/unit/traces/` keep the eight original timed sessions honest.

## Movements, search and master data

Movements are first-class records (`packages/domain/src/catalogue.ts`): id, display, short and spoken names, aliases, equipment, category, notes, and one optional `family` link to a parent record.
Every variant is its own record (Hang power cleans, Kipping pull-ups).
There is no modifier algebra and no generated naming, because coaches already think in named variants and a flat record can be named, spoken, loaded and merged without rules.
The bundled catalogue (`movements.ts`, 190 records) seeds the device.
The user's own records, overrides of bundled ones, removals and merge aliases live in master data on the device (`apps/web/src/master-data.ts`) and compose into one `Catalogue` per render.
Names resolve loosely (`movementKey`: case, accents, punctuation and a plural s per word are ignored) and a prescription may carry a `movement` id.
The id wins when it resolves, the name otherwise, so files stay portable (SHR-02) and editing a record never rewrites a workout (LIB-02).
Summaries take equipment from the records of recognised movements and fall back to keyword inference for the rest.

One ranked search (`packages/domain/src/search.ts`) serves the library and the movement picker: every query token must match some weighted field exactly, as a prefix, inside a word or with a small typo (optimal-string-alignment distance, one edit from four letters, two from eight, and hyphenated words are also indexed joined).
The library ranks by relevance when a query is present and lets the chosen sort break ties.
The editor's picker fills the names and links the record, and highlights names no record knows with an inline Add.
The editor has no equipment field: a workout's equipment is derived from the records of its movements (keyword inference for names no record knows) and shown on the live summary, and whatever an opened workout declared beyond that (a wall, a running route, a squat rack) is carried unchanged.
An imported file that the editor can express opens as an unsaved draft (`#/draft/<id>`) with its movements linked where names match, so unknown ones are fixed before anything is saved.
Files the editor cannot express keep the preview dialog.
Housekeeping (merge, rename, remove, restore the bundled set) is on the settings page, which is split into sections behind `#/settings/<section>`: General, Training view, Equipment, Movements and Collections.
General holds appearance, athletes, and the difficulty calibration: the full-effort and long marks, the three weights and the three thresholds of `rateDifficulty`, with reference workouts re-rated live, stored as a device preference that is passed into every summary.
Training view holds the load unit, sound and voices, and a Look & feel tile with the default view, timer ring width, pulse intensity and two milestone markers, each a time before the end and a colour, around a live miniature of the player that can run a preview.
The miniature is painted by the player's own wash overlay (the shared `.wash` rules in `App.module.css`, fed the same custom properties), so the pulse looks the same in both, and the marker colours override the player's amber and red tokens as inline custom properties.
The three master-data pages share one flow (`apps/web/src/settings/`): a searchable dense list with a New button, Create and Edit in the same modal form, Remove behind a confirmation that names the consequence, and multi-select with a merge bar.
A merge stays listed with Undo until it is committed.
Fields that draw on a repertoire (equipment, today) use `TagPicker`: ranked suggestions while typing, Enter or a comma takes one, and an unknown name is offered as "Add …" so new entries are created in place, with a nudge when the new name is within a typo of a known one.
The suggestion list is fixed to the viewport so it never scrolls the dialog it sits in.

Press feedback is delegated from the document (`apps/web/src/feel.ts`): a ripple of the element's own colour from the pointer position on buttons, links and cards, and a light tilt on library cards for fine pointers.
Both stop under reduced motion.
Cards and buttons use a drop shadow on hover rather than a lift.

## Editor

The editor works on a constrained builder model (`packages/domain/src/builder.ts`): sections with a format, whose slots are timed intervals (timed circuit), manual movements with targets and levelled loads (for time, strength), items of a block (AMRAP, you-go-I-go) or an interval's work (EMOM).
Explicit between-slot, trailing, between-round and after-section rests.
Optional rounds with the alternate assignment policy.
Tabata-style per-slot repeats.
And a ready gate or automatic continuation.
A timed run before an alternating repeat (the HYROX doubles circuit) is the one bundled shape it still reports as not editable. `builderToWorkout` emits deterministic position-based IDs so the same draft always yields the same tree. `workoutToBuilder` is the inverse and returns null for shapes outside the model, which the UI reports rather than approximating.
The live summary compiles the draft with the same compiler as the player. `validateDraft` adds author-level messages before structural checks.
Drafts autosave to browser storage (`openwod.drafts.v1`, debounced), one draft per workout plus one for a new workout, and are removed when saved or discarded.
Saving replaces a saved workout at the next revision or creates a new saved workout with a free slugged ID.
Bundled workouts are only ever duplicated.

## Deployment and tests

The production root Compose uses an image reference and named `/data` volume.
Source-build Compose is a separate local route.
Phase 0 health explicitly reports no persistence.
Images run the unit/schema checks during their build.
Release CI runs browser tests, then tests amd64/arm64 images on native runners before publishing the combined release manifest.

Browser clock/audio injection exists only in test builds.
Unit and browser tests share the canonical fixture definitions.
Accelerated tests establish semantics.
A real-hour reliability/accuracy run and physical mobile/audio/readability checks remain separate release work.
