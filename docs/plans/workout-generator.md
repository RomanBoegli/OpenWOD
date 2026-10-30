# Plan: the workout generator (version 1.7.0)

The design of the planned workout generator (BLD-13), moved verbatim from AGENT.md, whose section 15 now points here in place of the §15.6 named below.

## Context

The user wants a "magic button" in the create-workout view that generates a workout, inspired by dgurkaynak/wod-generator.
That project is a char-RNN trained on 5,000 scraped WODs, run from Python, and it invents movements ("brusseane push-up").
It does not fit OpenWOD: AGENT.md §2.2 defers "workout generation by AI" to P2, NFR-11 forbids cloud AI, and the app must stay offline and deterministic.
What fits is a **rules-based generator** in `packages/domain`: it draws from the household's own movement catalogue, builds a `BuilderDraft` through the existing builder model, verifies it with the same compiler and difficulty rating the editor already uses, and fills the editor with an editable draft.

Decisions made by the user (27 October 2026):

- A **Generate** button on the New workout page opens a dialog with knobs: duration, format or Surprise me, difficulty, gear source and focus. Athletes come from the editor's Solo/Pair choice. The result fills the editor. **Shuffle again** rerolls with the same knobs.
- Generated loaded movements carry **levelled loads** (light/medium/heavy, men and women, kg) from a reference table inside the generator, shifted a notch by difficulty. Catalogue records stay load-free (AGENT.md decision).
- Ships as **1.4.0** (first planned as 1.3.0), after the static shape (wave 5, 1.2.0). This session records the plan in AGENT.md as §15.6 (as §15.5 did for the static shape). Code follows once 1.2.0 is out.

Standing constraints: no runtime cloud service, deterministic and seedable, requirement IDs appended (next builder ID **BLD-13**), the user commits, Markdown one sentence per line and no semicolons, local browser tests with `--project=firefox --project=webkit`.

---

## Facts verified against the code (they shape the templates)

Measured through `builderToWorkout` → `compileWorkout` → `rateDifficulty` with the default calibration:

- The movement intensity tier (`movementIntensity` in `packages/domain/src/difficulty.ts`: 0.4 core, 0.6 mid, 0.9 high) is the biggest lever, then duration, then rests.
- AMRAP and you-go-I-go are one occurrence: one loaded lane marks the whole block loaded, one lane with reps ≥ 15 boosts the whole block. EMOM and for time count per task.
- Brutal (≥ 62) needs 15 minutes or more. Strength alone caps near 42 (Moderate), so Hard/Brutal strength needs a conditioning finisher section. Light is unreachable at 45 minutes (the duration factor alone adds 10 points) and for the manual formats at 30 minutes. Tabata tops out near 60.
- `blockRestMs`, `betweenSlotsRestMs` and `rounds` are ignored for list formats (`builder.ts` L152–156): no rest between two AMRAP/EMOM/you-go-I-go sections except the Ready gate.
- EMOM slots cycle across intervals (`compiler.ts` L175–177): a 20-minute EMOM of 2 movements is 2 slots with `intervals: 20`.
- For time without a cap and you-go-I-go by team rounds only are rated as open (nominal 60 s per task): the generator always sets a cap.
- `completion` must be absent on AMRAP and you-go-I-go tasks and present on pair for-time, strength and EMOM tasks (`compiler.ts` L80–83).
- Shared object references fail `assertBounded` and `tidy()` keeps load objects by reference (`builder.ts` L77): every load and prescription is built fresh.
- `alternate` reaches the workout only for a pair with rounds > 1. Percent loads cannot carry `women`.
- `handstand-walk` rates 0.15 (the `walk\b` rule) and `muscle-up` 0.9: skill gating uses the generator's own list, not the intensity.

---

## Design

### Modules (all pure, in `packages/domain/src/`)

- `random.ts`: `mulberry32(seed)` and a `Random` helper (`next`, `int`, `pick`, `weighted`, `shuffle`, `chance`). The Library's private LCG (`apps/web/src/Library.tsx` L67–77) stays.
- `generator-pool.ts`: focus groups, exclusions, tiering, equipment filter, widening. `buildPool(catalogue, request)`.
- `generator-loads.ts`: the load table, `loadFor(record, difficulty)` (fresh `LoadLevels` every call), `snapLoad(kg, kind)`.
- `generator-targets.ts`: reps, calories, distance and hold targets by movement kind and tier, `targetFor(candidate, format, difficulty, random)`.
- `generator-templates.ts`: one builder per format returning `BuilderSection[]` plus an estimated duration, and `chooseFormat(request, random)`.
- `generator-text.ts`: titles and descriptions.
- `generator.ts`: types, `generateWorkout`, the rate-and-nudge loop, notes.

```ts
export type GeneratorMinutes = 10 | 15 | 20 | 30 | 45;
export type GeneratorGear = 'mine' | 'bodyweight' | 'all';
export type GeneratorFocus = 'full' | 'upper' | 'lower' | 'core' | 'engine';
export interface GeneratorRequest { minutes: GeneratorMinutes; format: SectionFormat | 'any'; difficulty: DifficultyLevel; gear: GeneratorGear; myEquipment: string[]; focus: GeneratorFocus; participants: 1 | 2 }
export interface GeneratorContext { catalogue: Catalogue; calibration: DifficultyCalibration; seed: number; dayName?: string }
export interface GeneratorResult { draft: BuilderDraft; seed: number; target: DifficultyLevel; difficulty: Difficulty; hit: boolean; estimatedMs: number; format: SectionFormat; attempts: number; notes: string[] }
export function generateWorkout(request: GeneratorRequest, context: GeneratorContext): GeneratorResult;
```

The result's draft always passes `validateDraft` and compiles. It throws `No movements match these choices.` only when the pool is empty after every widening step.

### Movement selection (`generator-pool.ts`)

- Each record becomes a candidate: `head` (`catalogue.head`), `groups` (upper, lower, core, engine, full), `tier` from `movementIntensity` (< 0.5 low, 0.5–0.79 mid, ≥ 0.8 high), `kind` (reps, calories, distance, hold), `skill`, `loaded` (has a load table entry).
- Focus groups: a table keyed by family head id with a keyword fallback on the normalised name for household records. upper: press, bench-press, pull-up, muscle-up, handstand-push-up, handstand-walk, wall-walk, push-up, dip, rope-climb, bent-over-row, biceps-curl, overhead-triceps-extension. lower: squat, deadlift, lunge, box-jump, broad-jump, good-morning, kettlebell-swing, sled-push/pull/drag. core: sit-up, plank, toes-to-bar, l-sit, turkish-get-up, dumbbell-woodchopper, farmers-carry, plate-pinch-hold. engine: every monostructural record plus burpee, jumping-jack, high-knee, mountain-climber, skater-jump. full: clean, snatch, thruster, wall-ball, slam-ball, devil-press, man-maker, ground-to-overhead, sandbag-over-shoulder, kettlebell-swing, burpee. Unknown records go to full.
- Focus rules per section of n picks: full needs two different groups and at most one engine record. upper/lower/core need ⌈2n/3⌉ from the group, never the opposite group. engine needs at least half monostructural (up to three).
- Exclusions: mobility records, `rest`, `active-recovery`, the umbrella heads `squat`, `press`, `dip`, and `ghd-sit-up` outside gear `all`. Skill list only at Hard and Brutal: muscle-up family, handstand-walk, rope climbs, strict and deficit HSPU, pistol, butterfly-pull-up, crossover. Same head never twice in a section (ladder rungs are one pick). At most one monostructural per section unless engine focus.
- Equipment: `mine` → `equipmentKey` set of `myEquipment`, `bodyweight` → empty set, `all` → no filter. "Wall" is always available. A record is allowed when every item of its `equipment` is in the set. `mine` with an empty list equals bodyweight, with a note.
- Widening in order, each noted: focus falls back to full, the monostructural limit lifts, heads may repeat across sections, the skill gate lifts at Moderate. Equipment is never widened.
- Tier profile by level: Light at least half low tier and no loads outside strength. Moderate mid tier, at most one high, at most one loaded, reps below 15. Hard at least two high of three or four, 15+ reps allowed. Brutal all high where possible, at least one task at 15+, at least two loaded.

### Templates (`generator-templates.ts`)

Every section: `transitionAfter: 'manualReady'`, `prepMs: 10_000`, `equipment: []`, no attribution. Every prescription carries `movement`, `name`, and `shortName`/`spokenName` from the record. Pair slots get `B` as a fresh copy of `A` unless stated.

- **AMRAP**: cap = bucket, `counter: 'roundsAndReps'`, 3–5 tasks, no `completion`. 10: one AMRAP 10 of 3. 15: one of 3–4. 20: one of 4 or two AMRAP 10. 30: two AMRAP 14 or one AMRAP 30 of 5 at Hard/Brutal. 45: two AMRAP 20 or three AMRAP 14. Reps ≥ 15 only at Hard/Brutal.
- **For time**: cap = bucket, `betweenSlotsRestMs: 0`, `completion: 'team'` for pairs. Shapes: rounds for time (10: 3×3, 15: 4–5×3, 20: 5×3–4, 30: 5×4 with 60 s round rest, 45: two sections), ladders laid flat with `rounds: 1` (21-15-9 of two movements, 15-12-9 at Light/Moderate, 10 down to 1 at 20 minutes or more), chipper at 20 minutes or more (6–10 tasks, target factor 2.5).
- **EMOM**: slot count divides `intervals` (prefer 3, 4, 2, 5). 10: 60 s × 10. 15: 60 s × 15. 20: 60 s × 20. 30: 90 s × 20 or 120 s × 15. 45: 120 s × 22 or EMOM 20 + EMOM 24. Target factor 0.8 (1.2 for 120 s windows). Pairs mirrored with `completion: 'team'`, with the crossed "swap" shape of `partner-emom-16` 30 % of the time at 2 slots.
- **Timed circuit**: work/rest by level (Light 20/40 or 30/30, Moderate 40/20 or 30/15, Hard 40/20 or 45/15, Brutal 45/15 or 50/10 with 45 s round rest), 4–6 slots, round rest 60 s, `rounds = clamp(round((S + 60) / (n·work + (n−1)·rest + 60)), 2, 10)`. Tabata variant 35 % of the time at 10–30 minutes (20/10 × 8, 60 s between slots, movements 2/3/5/7/10 by bucket), never at Brutal. Pairs mirrored, or at full focus 50 % the stations shape of `full-body-partner` with `alternate: true` and even rounds.
- **Strength**: one section per lift, `rounds` = sets, `completion: 'both'` for pairs. Lifts from the strength subset (back/front squat, deadlift, RDL, bench, shoulder press, push press, weighted pull-ups, goblet squat, DB bench, DB RDL, DB shoulder press, DB rows), picked by focus. 10: 4×5 at 90 s. 15: 5×5 at 2 min. 20: 5×5 + 3×8. 30: 5×5 at 2:30 + 4×8, or 6×3 at 3 min + accessory 3×10. 45: two lifts plus a finisher AMRAP 8–10. Hard/Brutal always add a finisher. Barbell lifts carry percent levels (65/75/85 for 5s, 60/70/80 for 8s, 75/82/90 for 3s, no `women`). Dumbbell and kettlebell lifts carry kg levels.
- **You-go-I-go** (pairs only): cap = bucket, 1–3 movements with sprint targets (factor 0.6), `B` left empty so `builderToWorkout` mirrors A, optional `turnMs` 60–90 s and `teamRounds` at 20 minutes or more with the cap kept. Solo requests fall back to AMRAP with a note, and the dialog disables the option for solo.
- **Surprise me**: weighted by minutes (10: amrap 30, forTime 25, emom 20, circuit 25. 15: 30/20/25/15/strength 10. 20: 25/20/25/15/15. 30: 15/20/20/25/20. 45: 10/10/10/20/15/combo 35), then adjusted: pairs move 15 points to youGoIGo, strength is zero for core and engine, engine doubles emom and circuit, Light doubles circuit and strength and zeroes amrap and youGoIGo at 30 and 45, Brutal zeroes strength-only and Tabata and doubles amrap and forTime. "Combo" is strength + conditioning, circuit + AMRAP, or EMOM + for time, each half the bucket.
- Estimated duration = compiled active time for circuits and EMOMs, the cap for AMRAP, for time and you-go-I-go, sets × (rest + 40 s) for strength. Must land within ±20 % of the bucket.

### Targets and loads

- Base targets at Moderate by kind and tier, × level factor (0.75 / 1 / 1.25 / 1.5) × format factor (AMRAP and rounds 1, EMOM 0.8, you-go-I-go 0.6, chipper 2.5), rounded to whole numbers, to 5s above 20, to 50 m for distances. High-tier reps 8–12, mid 12–15 (pull-ups and dips 6–10, HSPU 5–8, muscle-ups 3–5, rope climbs 2–3), low 15–20, wall balls 15–20 (25 at Brutal), swings 15–20, double-unders 30–50, calories 12–15 (bikes 10–12), run 200 m (400 m at 20 minutes or more, 800 m only in a 30+ chipper), carries 50 m, sled 20–25 m, holds `timeMs` 20–45 s in manual formats.
- Load table: `Record<string, { kind: 'barbell' | 'dumbbell' | 'kettlebell' | 'ball' | 'slamBall' | 'sandbag' | 'sled' | 'plate'; men: [light, medium, heavy]; women: [light, medium, heavy]; perHand?: boolean }>` keyed by family head or record id (record wins), about 25 entries following `workouts/README.md` (heavy = Rx, medium ≈ 70 %, light ≈ 45–50 %, women ≈ 0.65–0.75 × men): thruster 20/30/43 · 15/20/29, clean 30/42.5/60 · 20/30/42.5, snatch 20/30/43 · 15/20/29, press family 30/42.5/60 · 20/30/42.5, deadlift 40/60/85 · 30/42.5/60, front squat 30/42.5/60, overhead squat 20/30/43, SDHP 20/30/43, bench 40/60/80 · 25/35/50, bent-over row 30/40/50, barbell lunges 20/30/40, dumbbell pairs per hand 7.5/10/15 · 5/7.5/10, light dumbbell 5/7.5/10, single dumbbell 10/15/22.5 · 7.5/10/15, kettlebell 12/16/24 · 8/12/16, carries 16/24/32 · 12/16/24, wall and med balls 4/6/9 · 3/4/6, slam balls 10/15/20, sandbag 10/15/20, sled push 70/105/152 · 50/70/102, sled pull 50/75/103, sled drag 40/60/80, plate pinch 5/10/15.
- Snapping ladders: barbell and dumbbell 2.5 kg, kettlebell 8/12/16/20/24/28/32, ball 2/3/4/6/9, slam ball 10/15/20/30, sandbag 5/10/15/20, sled 5 kg, plate 2.5 kg.
- Difficulty shift: Light −1 (`snap(light × 0.7), light, medium`), Moderate and Hard 0, Brutal +1 (`medium, heavy, snap(heavy × 1.2)`).

### Difficulty loop (`generator.ts`)

Band from `calibration.thresholds`, centre = midpoint (Brutal: brutal + 10). Attempt 0 builds from the profile. Up to 6 reversible nudges: rate, keep the best by distance to the centre, stop on a hit, revert a nudge that fails validation or compile. Return the best with `hit` and notes.

Nudge order by format: AMRAP/you-go-I-go: movement tier, the 15-rep line, cap ±2 minutes within ±20 %, drop the single load at Light/Moderate. EMOM/for time: tier, reps, intervals or rounds ±1, interval 60↔90 s. Circuit: work/rest step along 20/40 → 30/30 → 40/20 → 45/15 → 50/10, round rest 60 → 45 → 30 s, tier, rounds ±1. Strength: rest ±30 s, sets ±1, add or remove the finisher, finisher tier.

Known-unreachable cells get a note at attempt 0 instead of nudges: Light at 45 minutes, Light for the manual formats at 30 minutes, Brutal at 10 minutes for EMOM, circuit and strength, Brutal Tabata, strength-only above Moderate.

### Text (`generator-text.ts`)

Titles from patterns that apply: `${gear} ${formatWord} ${n}` ("Barbell AMRAP 15", "Kettlebell and bar 21-15-9", "Mixed gear circuit 20"), `${focus} ${formatWord} ${n}` ("Engine EMOM 20"), `${dayName} …` when given, or record names joined for two- or three-movement pieces ("Thrusters and pull-ups for time"). Descriptions of two to four sentences built from the draft: structure, pair rule, loads sentence when loaded, and provenance ("Generated on this device: Hard, 15 minutes, full body, my equipment."). No attribution.

### UI (`apps/web/src/`)

- `GenerateDialog.tsx` on `FormDialog` (`settings/FormDialog.tsx`), `submitLabel="Generate"`, radio groups or selects with `aria-label`s "Duration", "Format", "Difficulty", "Gear", "Focus". You-go-I-go disabled for solo. Under Gear = My equipment with an empty list: "No equipment ticked yet, so this makes a bodyweight workout. Tick your gear in settings." linking `settingsHref('equipment')`. Athletes shown read-only from the draft.
- Knob persistence: `generator: { minutes, format, difficulty, gear, focus }` in `Preferences` (`preferences.ts`), defaults `{ 15, 'any', 2, 'mine', 'full' }`, validated in `loadPreferences` like the other fields. Editor gains `preferences` and `onPreferencesChange` props, passed from `App.tsx` L210.
- Placement: a right-hand actions block in the editor's `shared.workoutHeading` (as `Overview.tsx` L53–58), only when `mode === 'create'` and not `importedFrom`: **Generate** (`Icon name="dice"`). After a generation: **Shuffle again** beside it and a `role="status"` line "Generated a Hard AMRAP 15 (score 55), three movements." plus notes, with Dismiss.
- Applying: `setDraft(result.draft)` inside the Editor. A `ConfirmDialog` "Replace the current draft?" guards a non-empty draft that is not the last generated one. Shuffle again uses a fresh `Math.random()` seed and skips the confirm when the draft still equals the last generated. `dayName` from `toLocaleDateString('en', { weekday: 'long' })` in the dialog. Participants from `draft.participants`.

---

## Phases

| Phase | Work | Gate |
| - | - | - |
| 0 Record (this session) | AGENT.md §15.6 "Planned wave 6: the workout generator (version 1.4.0)" with the decisions and phase table, BLD-13 appended after BLD-12, §2.2 keeps "workout generation by AI" deferred with "(a local rule-based generator ships under BLD-13)", a revision-log bullet under the current version header. | Markdown rules, IDs appended. |
| A Random and tables | `random.ts`, `generator-loads.ts`, `generator-targets.ts` with unit tests. | Table ordered and snapped, fresh objects, fixed-seed values. |
| B Pool | `generator-pool.ts` with tests on the seed catalogue. | Exclusions, equipment, focus rules, widening notes. |
| C Templates | `generator-templates.ts` per format and `chooseFormat`. | Grid validity and duration ±20 %. |
| D Loop and text | `generator.ts`, `generator-text.ts`, hit-rate tuning. | ±1 level everywhere, ≥ 80 % exact hits, unreachable cells noted. |
| E UI | Preferences block, `GenerateDialog.tsx`, Editor actions and status, App props. | Playwright scenario, visual pass in both themes at 1024 and 390 px. |
| F Docs and version | README feature line, `docs/architecture.md` Editor paragraph, `docs/validation.md` wave entry, `docs/development.md` package line, AGENT.md wave row and log, version 1.4.0 in `package.json`, `package-lock.json`, `CITATION.cff`, `.env.example`, `Dockerfile`, `docs/releases/v1.4.0.md`. | `npm run check`, browser suites. |

Phases A–F run after the static shape (1.2.0) has shipped.

---

## Tests

- `tests/unit/generator.test.ts`: determinism per seed (equal drafts, 10 seeds give ≥ 8 distinct results). Grid formats (6 + any) × minutes (5) × difficulty (4) × gear (3, `myEquipment: ['Kettlebell', 'Pull-up bar', 'Dumbbells']`) × focus (5) × participants (2): `validateDraft` empty, compiles, `estimatedMs` within ±25 % of the bucket, every lane resolves with a `movement` id, equipment within the allowed set, no mobility or rest records, no skill records at Light/Moderate, distinct heads per section, at most one monostructural outside engine, loads only table values for the level, percent loads without `women`, pair `B` and `completion` rules per format. Difficulty `|achieved − target| ≤ 1` everywhere and exact hits ≥ 80 % with an allowlist of noted unreachable cells. Drop focus to three values if the grid runs over 20 s.
- `tests/unit/random.test.ts`, load table tests, `preferences.test.ts` (junk `generator` block falls back), text tests (titles only from record names and gear words, ≤ 160 chars).
- `tests/e2e/editor.spec.ts`: open `/#/new`, Generate, Duration 15, Format AMRAP, Difficulty Hard, Gear Everything, Focus Full body, submit, expect a non-empty Title, Summary "Cap 15:00", status "Generated", Shuffle again changes the title or the first movement within three tries, Save to library lands on `#/wod/<slug>` with the h1 equal to the title.

## Verification

1. `npm run check` (lint, typecheck, unit tests, build) and `npx playwright test --config tests/playwright.config.ts --project=firefox --project=webkit`.
2. WebKit screenshots of the dialog and the editor after a generation in both themes at 1024 and 390 px.
3. A by-hand pass: generate for each of the six formats, solo and pair, with "My equipment" against the user's ticked gear, start one generated workout in the player.
4. Markdown rules in every touched file, `grep -n 1.4.0 CITATION.cff .env.example Dockerfile package.json`.
