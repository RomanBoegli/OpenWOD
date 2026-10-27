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

## Sharing and persistence

The app imports and exports complete `.wod.yaml` files (file version 3: human-readable durations under `duration`/`prep`/`*Rest`/`cap`/`interval`/`turn`/`time` keys, parsed by one YAML 1.2 parser that also reads JSON) and `.wods.yaml` packs (`openwod.workoutPack` version 1) that carry several workouts and the collections grouping them.
The file JSON Schemas are derived from the model schema by renaming duration properties, so TypeBox stays the single source.
Only the current versions are read.
Anchors, aliases and duplicate keys are rejected.
The model is always integer milliseconds.
A workout may carry a sharing identity (`sharing`: a stable id, the author's revision at export, and for a derivative the identity it came from).
The identity is assigned the first time a saved workout is exported, bundled workouts carry a deterministic one, and the local id and revision stay separate from it (SHR-05).
An import previews every workout with its attribution and a state read from the provenance: known, newer than the known copy, or new.
Known copies are skipped by default, a newer revision may replace the local workout at its expected revision, and ids that are taken are remapped on the server in one transaction.
Files exclude household names, audio settings and all session data.
An edit of an imported workout gives it a new sharing identity that records its source.

The household server (`apps/server`) is the authoritative store (DAT-01): SQLite through `node:sqlite` at `DATABASE_PATH`, with revisioned JSON documents for workouts and one master-data document, immutable session records with the workout as played and the engine's event log, and a correction table for scores.
Migrations are versioned and run in transactions, a newer schema refuses to start, and an existing file is backed up with the SQLite backup API before any migration.
Writes require the expected revision (`If-Match`) and answer a conflict with the current document.
Session uploads are idempotent by id.
Validation reuses the domain parser and compiler, so invalid content never reaches the database.
The rules themselves (revisions, archive, idempotent sessions, corrections, device and pack imports, export and restore) live once in `packages/household` as `class Household` over a small synchronous port, `HouseholdTables`.
The server implements the port with prepared SQLite statements inside one transaction per call, and a shared conformance suite (`tests/unit/helpers/household-suite.ts`) runs against both implementations.
The JSON export (`openwod.export`, format version 1) restores through `POST /api/v1/import/restore`: the document is validated whole, the server writes `pre-restore-<timestamp>.sqlite` under `/data/backups/`, and then everything is replaced in one transaction.
In test builds a header selects a per-test in-memory database, which lets the browser suite run in parallel against one server process.

On the device (`apps/web/src/data/`), IndexedDB holds five stores in the server shape: checkpoints and progress records of running sessions, the outbox of writes that have not reached the server, a cache of the household data for an instant and offline start, and metadata.
`useLibraryData` owns the household state for the app: cache first, then the server, with writes going to the server directly and into the outbox on a network failure.
The outbox flushes single-flight with backoff on reconnect, when the tab becomes visible and on a timer, and a master-data conflict is resolved by merging ours over the server's.
Everything not yet uploaded is labelled in the header, on the card, in history and in settings (DAT-09).
A pre-1.0 device library is offered for a one-time move to the server, in one transaction that renames colliding ids and remaps sessions and collections.

Recovery (ENG-11/12) writes a full checkpoint (`engine.toJSON()` plus the workout as played) after every accepted command and transition, and a small progress record about once a second that names the checkpoint revision it extends.
Both are written through a queue that keeps only the latest value, off the timing path.
On the play route the app reads the device's checkpoints before mounting the player, restores the engine paused with reason `recovered`, pulls offsets that overran a boundary back to that boundary, and asks for Resume or End.
A session ended from that prompt is recorded as aborted and interrupted.
When checkpoint writes fail, the player says so and never claims a recovery (AT-16).
One tab controls a session (ENG-14): a Web Lock named by the session id, a BroadcastChannel for the takeover, and a ping that distinguishes a live holder from a document on its way out.

## Two deployment shapes

The same sources build two shapes, chosen by the Vite mode at build time.
The server shape (`vite build`, base `/`, `dist/web`) talks to the household API over HTTP.
The static shape (`vite build --mode static`, base `./`, `dist/static`, `__OPENWOD_STATIC__` set) has no server and keeps the library in the browser.
`apps/web/src/data/backend.ts` declares one `Backend` interface and picks its implementation once at module load: `remote.ts` for the server, `local-backend.ts` for the browser.
The local backend runs the same `Household` core over IndexedDB version 2, which adds the stores `workouts`, `master` and `sessions` (indexed by finish time and by workout) beside the five above.
Each call is one IndexedDB transaction that loads what the core needs, runs the core synchronously and writes the result, so an import or a restore is all-or-nothing.
It throws the client's own `ApiError`, never a network error, so the outbox and `useLibraryData` work unchanged: a conflict is a conflict, a rejected write is rejected, everything else succeeds at once.
The static shape keeps the newest 2000 sessions and prunes older ones on every write and on restore.
A pre-1.0 device library migrates into the browser's library on the first start with one notice, where the server shape offers it for upload.
The interface says "this browser" where the server shape says "the server", has no connection pill, and labels the library under Settings → General → This browser with the storage used, whether the browser keeps it, the counts, the JSON backup and its restore.
Relative URLs and hash routes let one build run at `https://romanboegli.github.io/OpenWOD/`, from a zip in any web root and under `vite preview`: cue clips and the LICENSE link go through `import.meta.env.BASE_URL`, the manifest and icons are relative.

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
The bundled catalogue (`movements.ts`, 193 records) seeds the device.
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

The production root Compose names the stack `openwod`, uses an image reference and a named `/data` volume, and passes `DATABASE_PATH`, `LOG_LEVEL` and `TRUST_PROXY`.
Source-build Compose is a separate local route named `openwod-preview`.
Health reports persistence and the schema version once the database is open.
Images run the unit and schema checks during their build.
Release CI runs browser tests, then tests amd64 and arm64 images on native runners before publishing the combined release manifest.
The same run builds the static site with the voices rendered on the runner, tests it against `vite preview` in three engines, and on a tag publishes it to GitHub Pages and attaches the zip to the GitHub Release.
The static build must stay relative: `scripts/check-production.mjs dist/static` fails on any `href="/` or `src="/` in `index.html`, and the production smoke uses relative URLs alone, so the same spec checks the container, the preview and the live Pages URL (`OPENWOD_PRODUCTION_MODE` selects the shape).
`scripts/rehearse-restore.sh` rehearses backup, volume loss and restore against a throwaway stack.

Browser clock and audio injection exist only in test builds.
The Playwright configuration starts the API with an in-memory database and Vite with a proxy, and a fixture gives every test its own scope.
A third web server runs the `static-test` build on port 5175 for the `static-chromium`, `static-firefox` and `static-webkit` projects, which rerun the player, editor, settings, screens, tabs, library and recovery specs without an API and add the static specs under `tests/e2e/static/`.
Accelerated tests establish semantics, including reload recovery, takeover between tabs, offline finish and upload, and the device migration.
A real-hour reliability and accuracy run and the physical device checks (`docs/device-checklist.md`) remain release work done by hand.
