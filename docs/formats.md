# Workout files

OpenWOD shares workouts as single YAML files with the suffix `.wod.yaml`. A file is complete in itself: prescriptions, targets, loads, repeats, rests and section rules all travel with it, never a reference into somebody else's library. Athlete names, sound settings and session results are never written to a file.

```yaml
format: openwod.workout
formatVersion: 3
workout:
  schemaVersion: 2
  id: cindy
  revision: 1
  title: Cindy
  description: As many rounds as possible in twenty minutes.
  attribution:
    author: CrossFit
    sourceUrl: https://www.crossfit.com/benchmark/cindy
  equipment:
    - Pull-up bar
  participants: 1
  prep: 10s
  sections:
    - id: cindy-amrap
      title: AMRAP 20
      format: amrap
      transitionAfter: manualReady
      cap: 20m
      counter: roundsAndReps
      body:
        id: cindy-round
        type: sequence
        children:
          - { id: pull-ups, type: task, assignments: { A: { name: Pull-ups, reps: 5 } } }
          - { id: push-ups, type: task, assignments: { A: { name: Push-ups, reps: 10 } } }
          - { id: squats, type: task, assignments: { A: { name: Air squats, reps: 15 } } }
```

## Envelope

| Key | Meaning |
| --- | --- |
| `format` | `openwod.workout`. Files written as `wodva.workout` (the earlier name) are still read. |
| `formatVersion` | `3`. Version 2 (timed circuits with human durations) and version 1 (JSON with `*Ms` keys) still import and migrate. Newer versions are refused with a clear message. |
| `workout` | The workout model, version 2 (`schemaVersion: 2`). |

Durations are human readable: `40s`, `2m`, `1m30s`, `1:30`, `1:02:03`, or a bare number of seconds. Duration keys are `prep`, `duration`, `betweenChildrenRest`, `trailingRest`, `betweenIterationsRest`, `cap`, `interval`, `turn` and `time`. The app stores integer milliseconds internally and writes the shortest readable form.

Import rejects YAML anchors, aliases and duplicate keys, files over 1 MB, duplicate node ids, athlete mismatches, unsupported capabilities, and anything that would expand beyond 10,000 occurrences or 24 hours.

## Workout

| Key | Meaning |
| --- | --- |
| `id`, `revision`, `title`, `description` | Identity and text. Imports that collide with an existing id become a copy with a free id, or replace a saved workout on explicit confirmation. |
| `attribution` | Optional `author`, `sourceUrl` (metadata, never fetched), `licence`, `notes`. |
| `equipment` | Declared equipment. The app also infers equipment from movement names and lets you merge spellings in settings. |
| `participants` | `1` or `2`. A and B are lanes, not people; names are a device setting. |
| `prep` | The countdown before the first section, 0 to 60 seconds. |
| `sections` | One or more sections, each with a `format`, a `transitionAfter` rule (`manualReady` waits for a tap, `automatic` continues) and a `body`. |

## Section formats

| Format | Settings | Body | Clock and controls |
| --- | --- | --- | --- |
| `timedCircuit` | none | `timed`, `rest`, `sequence`, `repeat` | Every slot has a duration; the clock drives everything. Previous and Next move inside the section. |
| `amrap` | `cap`, optional `counter` (`roundsAndReps`, `rounds`, `none`) | one `task` or a flat `sequence` of `task` | The whole block stays on screen; athletes count rounds and reps, Undo is available; Finish ends early; the cap ends the section. |
| `emom` | `interval`, `intervals` | one `task` or a flat `sequence` of `task` | Work starts on every boundary; the slot list cycles over the intervals; Done shows rest until the next boundary and never moves it; no Previous or Next. |
| `forTime` | optional `cap` | anything, with `task` for manual work | Ordered movements ended by Done; the clock counts up; a cap ends the section as Capped. Chippers and ladders (21-15-9) are sequences of tasks with explicit `reps`. |
| `youGoIGo` | `cap` and/or `rounds`, optional `turn` | one `task` or a flat `sequence` of `task` | One athlete works through the unit while the other rests; Switch hands over; an A turn plus a B turn is one team round; needs two athletes. |
| `strength` | none | like `forTime` | Sets at your own pace ended by Done, with timed rest between them; loads are usually percentages or levels. |

## Nodes

| Type | Keys |
| --- | --- |
| `timed` | `duration`, `assignments` (`A`, optional `B`) |
| `task` | `assignments`, optional `completion` for pairs: `team` (one Done) or `both` (each athlete taps Done) |
| `rest` | `duration`, optional `kind` (`transition`, `roundRest`, `blockRest`) |
| `sequence` | `children`, optional `betweenChildrenRest` and `trailingRest` |
| `repeat` | `count`, `body`, optional `betweenIterationsRest`, optional `assignmentPolicy: alternate` to swap the A and B columns after every complete round |

At most two repeat levels nest. Rests are only ever added where they are written: between children, between iterations, or as a trailing rest.

## Prescriptions

| Key | Meaning |
| --- | --- |
| `movement` | Optional id of the exercise record the movement was picked from (`hang-power-clean`). The names below stay authoritative, so a file is complete without any catalogue; a reader that knows the id can attach its own equipment and default loads. |
| `name`, `shortName`, `spokenName` | What is shown and spoken. Short names keep the player readable from across the room. |
| `reps`, `calories`, `distance` (`{ value, unit: m or km }`), `time` | Targets, shown big in the player. |
| `load` | Either a single `{ value, unit }` or levels: `light`, `medium`, `heavy`, each `{ value, unit }` with `kg`, `lb` or `percent` (of a one-rep max). All levels are shown inline in the player and the overview. |
| `notes` | Free text such as tempo, scaling or coaching cues; never executed. |

## Examples and schemas

`examples/workouts/` holds every bundled workout as a file; `schemas/workout.v2.schema.json` and `schemas/workout-file.v3.schema.json` validate the model and the parsed file. Earlier schema versions stay in the folder for reference.
