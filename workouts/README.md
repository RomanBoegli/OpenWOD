# Workout registry

This folder is the source of every workout that ships with OpenWOD.
Each workout is one hand-written `<id>.wod.yaml` file in the file format described in `docs/formats.md`.
The file name must equal the workout `id` inside it.
A folder that contains a `collection.yaml` (`title`, `description`) is a bundled collection that the app lists as a group.
Every folder has one.

| Folder | Collection | Contents |
| --- | --- | --- |
| `benchmarks/` | Benchmarks | The CrossFit girls and hero workouts, as published on CrossFit.com. |
| `advanced/` | Advanced | Standalone pieces curated from class programming. |
| `hyrox/` | HYROX | Training variations of the race structure. |
| `default/` | Default | Timed circuits, intervals and mixed sessions that show every format and both participant counts. |

## Licence and attribution

The files in this folder are data, not code, so the repository's GPL does not apply to them.
The text written for OpenWOD (descriptions, notes, the levelled loads that are training suggestions) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribute it to the OpenWOD project.
The workouts themselves (a sequence of movements, reps and times) and the published standards (Rx loads, target heights, HYROX station weights) are facts, cited in each file's `attribution` block with its `author` and `sourceUrl`.
CrossFit® is a registered trademark of CrossFit, LLC, and HYROX® of Upsolut Sports AG.
The names identify the sources and imply no affiliation or endorsement.

`npm run workouts:bundle` (`scripts/bundle-workouts.ts`) parses every file, checks ids, and refuses any movement `name` the catalogue in `packages/domain/src/movements.ts` does not know (by name or alias), then writes `packages/domain/src/generated/bundled.ts`, which the app, the server and the tests import. `npm run workouts:check` fails when that module is out of date.
It is part of `npm run check`.

## Adding a workout

1. Copy a similar file into the right folder and rename it to `<id>.wod.yaml`.
   Set `workout.id` to the same id (lower-case, hyphens) and `revision: 1`.
2. Give every node a unique `id`, end each section with `transitionAfter: manualReady` (Wait for Ready) unless the workout prescribes a timed rest before the next section (a `blockRest` node at the end of the body with `transitionAfter: automatic`) or a straight continuation (`automatic` without a rest), set `attribution.author`, and list the `equipment` the movements need using the catalogue's names (Barbell, Rowing machine, Bike, SkiErg, Plyo box, Medicine ball, Slam ball, Jump rope, Pull-up bar, Rings, Kettlebell, Dumbbells, Bench, Sled, Sandbag, Climbing rope, Wall, AbMat, Weight plate, Parallettes) plus `Running route`, `Treadmill or running route`, `Exercise mat` or `Squat rack` where that is what the session needs.
3. Use movement names or aliases from `movements.ts`.
   Add a record there first if the movement is new (the voice packs render one clip per record).
4. Put standards (ball target, box height, race distances) in the description or the movement `notes`, coaching cues in `notes`, and loads as levels (below).
5. Run `npm run workouts:bundle`, then `npm test`.
   Re-serialising with `parseWorkoutFile` and `serialiseWorkoutFile` from `packages/domain/src/index.ts` gives the canonical key order and quoting.

## Load convention

Every loaded movement (barbell, dumbbell, kettlebell, wall or slam ball, sled, sandbag, carry, plate) carries `load` levels `light`, `medium` and `heavy`, each `{ value, women, unit }` where `value` is the men's amount and `women` the women's amount in the same unit.
Percent loads (`unit: percent`, of a one-rep max) carry no `women` value.

- **heavy** is the published Rx for men with the women's Rx as `women`: CrossFit.com for the benchmarks, the HYROX rulebook open-division station standards for HYROX-style sessions.
  Where no standard exists, heavy is the coach's or OpenWOD's training suggestion.
- **medium** is about 70 % and **light** about 45–50 % of heavy, for men and women alike, rounded to real equipment: 2.5 kg steps on a bar, kettlebells 8/12/16/20/24/28/32 kg, medicine balls 2/3/4/6/9 kg, slam balls 10/15/20/30 kg, dumbbells 2.5 kg steps, sandbags 5/10/15/20 kg, sled totals in 5 kg steps including the sled.
- Where a program stated women's loads they are used.
  Otherwise women ≈ 0.65–0.75 × men, rounded the same way.
- Dumbbell and kettlebell loads are per hand unless the notes say one implement.
  Sled loads are totals including the sled.

HYROX station standards (Season 26/27 rulebook, open division, where doubles men and mixed teams use the men's loads): sled push 152 kg men / 102 kg women (incl. sled), sled pull 103 / 78 kg, farmers carry 2 × 24 / 2 × 16 kg, sandbag lunges 20 / 10 kg, wall balls 6 / 4 kg to a 3.00 / 2.70 m target.
Race distances: 1 km runs, 1000 m SkiErg and row, 50 m (4 × 12.5 m) sled push and pull, 80 m burpee broad jumps, 200 m farmers carry, 100 m lunges, 100 wall balls.

CrossFit standards used in notes: wall balls 20 lb / 14 lb (9 / 6 kg) to a 10 ft / 9 ft target, boxes 24 in / 20 in (Fight Gone Bad: 20 in for everyone), rope climbs 15 ft.

## Changes in this pass

Loads marked **standard** are published prescriptions (source given).
Loads marked **suggestion** were set by the editor following the convention above.
Men's amounts that already existed were kept and only the women's amounts added unless stated.

| id | What changed | Loads |
| --- | --- | --- |
| `fight-gone-bad` | Box note now "20 in box (step-ups to scale)". Description states ball, target, bar and box standards. `Wall` added to equipment. | Unchanged. Heavy is the CrossFit.com Rx (standard), lighter levels suggestion. |
| `angie`, `annie`, `jerry`, `murph` | Attribution notes corrected: these are bodyweight benchmarks and carried a boilerplate note about loads. | No loads (Murph's optional 20 lb / 14 lb vest stays in the notes). |
| `bar-lunge-wall-ball-emom-20` | Women's loads on the single-dumbbell overhead lunges (10/15/20 kg) and wall balls (3/4/6 kg). Wall-ball target in the description and notes. `Wall` added. | Wall balls heavy 9 (6) kg: CrossFit standard. Lunges: suggestion. |
| `curls-push-ups-sit-ups-emom-12` | Biceps curls get levels 7.5/10/15 kg (5/7.5/10 kg) per dumbbell as a starting weight. | Suggestion. |
| `double-amrap-10` | Women's front squats 20/30/42.5 kg. | Suggestion (≈ 0.7 × men). |
| `fourteens-amrap-14` | Women's thrusters 15/20/29 kg. | Heavy 43 (29) kg = Fran Rx (CrossFit.com standard). Lighter levels suggestion. |
| `grip-and-core-intervals` | Plate pinch hold 5/10/15 kg (2.5/5/10 kg) per hand. Suitcase carry 16/24/32 kg (12/16/24 kg). `Plates` renamed `Weight plate`. | Suggestion. |
| `mixed-rounds-under-19` | `Plates` renamed `Weight plate`. | None. |
| `overhead-endurance-emom-20` | Dumbbell overhead lunges 7.5/10/15 kg (5/7.5/10 kg) per dumbbell. Wall balls 4/6/9 kg (3/4/6 kg) with target. Description states the target. | Wall balls heavy: CrossFit standard. Lunges: suggestion. |
| `partner-mirror-chipper` | Women's wall balls 4/6/9 kg (men's 6/9/12 kg kept, the program's heavy-ball choice) and slam balls 10/15/20 kg. Target in notes. | Suggestion. |
| `pull-and-press-ladder` | Women's loads per rung: 20/30/42.5, 25/35/47.5, 30/42.5/60 kg. | Suggestion (≈ 0.7 × men). |
| `pull-carry-burpee-ladder` | Women's farmers carry 7.5/12.5/15 kg per hand. Note says per hand. | Suggestion. |
| `rack-and-run-amrap-25` | Women's bar 20/30/40 kg for deadlifts, cleans and shoulder-to-overhead. | Heavy follows the program's stated 35–42.5 kg for women (standard, program). Lighter levels suggestion. |
| `row-burpee-dumbbell-sprints` | Women's single-dumbbell clean and jerks 10/17.5/22.5 kg. Box height in notes. | Suggestion. |
| `synchro-snatch-chipper` | Dumbbell overhead lunges and single-dumbbell thrusters get 10/15/22.5 kg (7.5/10/15 kg). Women's squat snatches 20/30/43 kg. Box height in notes. | Snatch heavy 61 (43) kg = Isabel Rx (CrossFit.com standard). The rest suggestion. |
| `three-minute-windows` | Women's deadlifts 30/42.5/60 kg. Women's power cleans and shoulder-to-overhead 20/30/45 kg. Box height in notes. | Suggestion. |
| `triple-amrap-4` | Women's dumbbell clean and jerks and carry shuttles 7.5/12.5/15 kg per hand. Shuttle note says the same dumbbells. | Suggestion. |
| `wall-ball-row-burpee-emom-20` | Wall balls 4/6/9 kg (3/4/6 kg) with target. Box height in notes. Description states the target. `Wall` added. | Wall balls heavy: CrossFit standard. Lighter levels suggestion. |
| `hyrox-doubles-circuit` | Loads on sled push, sled pull, farmers carry, sandbag lunges and wall balls. Standards in the description. `sourceUrl` set to the Doubles rulebook. Attribution notes updated. `Kettlebells` → `Kettlebell`, `Treadmill or running route` and `Wall` added. | Heavy = HYROX Doubles open standard, Season 26/27 rulebook (standard). Medium and light suggestion. |
| `hyrox-engine-emom-24` | Same loads and notes on every station and wall-ball minute. Standards in the description. Equipment as above. | Heavy = HYROX open standard (standard). Medium and light suggestion. |
| `hyrox-pace-intervals` | Same loads and notes. Standards in the description. Equipment as above. | Heavy = HYROX open standard (standard). Medium and light suggestion. |
| `run-sled-run` | Sled push levels changed from 50/75/100 kg to 70/105/152 kg (50/70/102 kg) total incl. sled. Description states race distance and load. `sourceUrl` set to the rulebook. | Heavy = HYROX open standard (standard). Medium and light suggestion. |
| `full-body-partner` | Every B-column dumbbell station gets levels: 7.5/10/15 kg (5/7.5/10 kg) for thrusters, goblet squats, Romanian deadlifts, bent-over rows, dumbbell deadlifts, hang cleans and farmer march. 5/7.5/10 kg (2.5/5/7.5 kg) for shoulder press, curls, triceps extensions and woodchoppers. Notes say how the dumbbells are held. Description explains the two pairs. Timing untouched. | Suggestion. |
| `mixed-session` | Box step-ups note "24 in (20 in) box". | Kettlebell swings already carried Helen's levels (standard). |
| `partner-circuit` | Kettlebell swings get 12/16/24 kg (8/12/16 kg). Timing untouched. | Heavy 24 (16) kg = Helen Rx (CrossFit.com standard). Lighter levels suggestion. |

Untouched (already complete): `cindy`, `diane`, `dt`, `elizabeth`, `fran`, `grace`, `helen`, `isabel`, `jackie`, `karen`, `nancy`, `nate`, `randy`, `tommy-v`, `pause-front-squat-6x3`, `row-burpee-clean-jerk-e2mom-40`, `row-intervals-8x90`, `ski-skip-muscle-up-rounds`, `skip-and-toes-40-40`, `squat-power-e2-30`, `back-squat-5x5`, `partner-emom-16`, `row-burpee-emom-20`, `tabata-this`, `you-go-i-go-sprints`.
