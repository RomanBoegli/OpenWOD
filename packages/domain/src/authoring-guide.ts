import { bundledWorkout } from './bundled';
import { CATEGORY_LABELS, MOVEMENT_CATEGORIES, type Movement } from './catalogue';
import { FORMAT_SETTINGS, MAX_BLOCK_TASKS, MAX_MS, MAX_OCCURRENCES, MAX_REPEAT_DEPTH } from './compiler';
import { DURATION_KEYS, FILE_EXTENSION, FILE_FORMAT, FILE_VERSION, MAX_FILE_BYTES, serialiseWorkoutFile } from './exchange';
import { FORMAT_HELP, FORMAT_LABELS, LOAD_LEVELS, SCHEMA_VERSION, SECTION_FORMATS, type SectionFormat, type WorkoutSection } from './schema';

/**
 * The authoring guide (SHR-07): Markdown that a person pastes into an AI assistant of their choice so it writes an
 * importable workout file. The app never contacts the assistant (NFR-11). Format names, settings, limits and the
 * examples come from the code, and the movement and equipment lists from the caller, so the guide matches the
 * importing app; only the explanations are prose.
 */
export interface AuthoringGuideOptions {
  /** The movement records to list, normally the effective catalogue. */
  movements: Movement[];
  /** Canonical equipment names to list. */
  equipment: string[];
}

type SettingKey = 'capMs' | 'intervalMs' | 'intervals' | 'counter' | 'rounds' | 'turnMs';
const SETTING_NOTES: Record<SettingKey, string> = {
  capMs: 'duration',
  intervalMs: 'duration of one interval',
  intervals: 'number of intervals, 1 to 999',
  counter: '`roundsAndReps` (default), `rounds` or `none`',
  rounds: 'team rounds, 1 to 999',
  turnMs: 'duration of one turn, no longer than the cap',
};
const fileKey = (key: keyof WorkoutSection) => DURATION_KEYS[key] ?? key;

/** What each format needs beyond its optional settings, and what its body may hold; mirrors the compiler's checks. */
const FORMAT_RULES: Record<SectionFormat, { needs?: string; body: string }> = {
  timedCircuit: { body: '`timed`, `rest`, `sequence` and `repeat` nodes, no `task`' },
  amrap: { needs: '`cap`', body: 'one `task`, or one `sequence` of `task` nodes without nesting' },
  emom: { needs: '`interval` and `intervals`', body: 'one `task`, or one `sequence` of `task` nodes. The list cycles over the intervals, so two tasks with `intervals: 20` alternate minute by minute' },
  forTime: { body: 'any nodes: `task` for work ended by Done, `repeat` for rounds' },
  youGoIGo: { needs: '`cap` or `rounds` (or both), and `participants: 2`', body: 'one `task`, or one `sequence` of `task` nodes: the work of one turn' },
  strength: { body: 'like For time. Sets are usually a `repeat` of one `task` with `betweenIterationsRest`' },
};

const EXAMPLES: [title: string, id: string][] = [
  ['Solo example: a timed warm-up, strength sets with levelled loads, then an AMRAP', 'mixed-session'],
  ['Pair example: an EMOM where A and B swap tasks every minute', 'partner-emom-16'],
];

const yaml = (text: string) => '```yaml\n' + text.trimEnd() + '\n```';
const list = (items: string[]) => items.map(item => `\`${item}\``).join(', ');

function movementNames(movements: Movement[]): string {
  const groups = [...MOVEMENT_CATEGORIES.map(category => [CATEGORY_LABELS[category], movements.filter(record => record.category === category)] as const), ['Other', movements.filter(record => !record.category)] as const];
  return groups.filter(([, records]) => records.length)
    .map(([label, records]) => `**${label}:** ${[...new Set(records.map(record => record.name))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join(', ')}`)
    .join('\n\n');
}

export function buildAuthoringGuide({ movements, equipment }: AuthoringGuideOptions): string {
  const formats = SECTION_FORMATS.map(format => {
    const settings = FORMAT_SETTINGS[format].map(key => `\`${fileKey(key)}\` (${SETTING_NOTES[key as SettingKey]})`).join(', ') || 'None';
    const needs = FORMAT_RULES[format].needs;
    return `| \`${format}\` | ${FORMAT_LABELS[format]} | ${FORMAT_HELP[format]} | ${settings}.${needs ? ` Needs ${needs}.` : ''} | ${FORMAT_RULES[format].body} |`;
  });
  return `# OpenWOD workout file guide

You are helping someone write a workout for OpenWOD, an app that plays solo and partner workouts (CrossFit-style, HYROX-style, circuits, strength) with a timer, spoken cues and a screen readable from across the room.
Turn their request into one OpenWOD workout file that the app imports without changes.

## How to answer

1. Reply with exactly one YAML document in one \`\`\`yaml code block. The person pastes it into OpenWOD or saves it as \`<id>${FILE_EXTENSION}\`.
2. Before the block, list the assumptions you made in at most two short lines. Write nothing after the block.
3. Where the request leaves something open (rests, loads, rounds, caps), choose sensible values and mention them in those lines.
4. Write \`title\`, \`description\` and \`notes\` in the language of the request. Take movement \`name\`s from the list at the end, in English, exactly as written there.
5. If the app reports an error and the person pastes it back to you, fix what it names and send the whole file again. Error lines read \`/path/in/the/file: message\` or \`node-id: message\`.

## File shape

${yaml(`format: ${FILE_FORMAT}\nformatVersion: ${FILE_VERSION}\nworkout:\n  schemaVersion: ${SCHEMA_VERSION}\n  id: …`)}

| Key under \`workout\` | Required | Meaning |
| --- | --- | --- |
| \`schemaVersion\` | yes | Always \`${SCHEMA_VERSION}\`. |
| \`id\` | yes | Lower-case words joined by hyphens, such as \`upper-body-emom-20\`. Letters, digits and \`_ . : -\`, at most 120 characters. |
| \`revision\` | yes | \`1\`. |
| \`title\` | yes | Short, it is shown big, in Title Case when it is in English. At most 160 characters. |
| \`description\` | no | What the session is, standards and scaling. At most 2000 characters. |
| \`attribution\` | no | \`author\`, \`sourceUrl\` (starting with https://), \`licence\`, \`notes\`. Set \`author\` and \`sourceUrl\` when the workout comes from a known source. |
| \`equipment\` | yes | What the workout needs, from the equipment names below, or \`[]\` for bodyweight only. At most 30. |
| \`participants\` | yes | \`1\` for solo, \`2\` for a pair. A pair has the lanes \`A\` and \`B\`, which are positions, not names. |
| \`prep\` | yes | The countdown before the first section, \`0s\` to \`60s\`. Use \`10s\`. |
| \`sections\` | yes | One to 100 sections, in order. |

Leave out the \`sharing\` and \`movement\` keys. The app adds them.

## Durations

The duration keys are ${list(Object.values(DURATION_KEYS))}.
Write a duration as \`40s\`, \`2m\`, \`1m30s\`, \`1h\`, \`1:30\`, \`1:02:03\` or a bare number of seconds.

## Sections

Every section has \`id\`, \`title\`, \`format\`, \`transitionAfter\` and \`body\` (exactly one node), plus the settings its format allows and no others.
A section \`title\` is short, in Title Case when it is in English, such as "Warm-Up" or "Metcon: 3 Rounds".
\`transitionAfter: manualReady\` waits for the athletes to tap Ready before the next section, and \`automatic\` continues straight on.
Use \`manualReady\` unless the request asks for a straight run into the next section, or the section ends with a rest before the next one.

| \`format\` | Name | What it is | Settings | Body |
| --- | --- | --- | --- | --- |
${formats.join('\n')}

## Nodes

| \`type\` | Keys | Use |
| --- | --- | --- |
| \`timed\` | \`id\`, \`duration\`, \`assignments\` | Work for a fixed time. Timed circuit, For time and strength sections. |
| \`task\` | \`id\`, \`assignments\`, \`completion\` (pairs, see below) | Work ended by Done: reps, calories, distance. Not in timed circuits. |
| \`rest\` | \`id\`, \`duration\`, \`kind\` (\`transition\`, \`roundRest\` or \`blockRest\`) | A rest at one place in the order. |
| \`sequence\` | \`id\`, \`children\` (1 to 1000 nodes), \`betweenChildrenRest\`, \`trailingRest\` | Nodes in order. |
| \`repeat\` | \`id\`, \`count\` (1 to 999), \`body\` (one node), \`betweenIterationsRest\`, \`assignmentPolicy: alternate\` (pairs) | Rounds. At most ${MAX_REPEAT_DEPTH} repeat levels nested. |

Every \`id\` is unique in the whole file: the workout, its sections and all nodes. Make them readable, such as \`legs-goblet-squats\`.

Rests happen only where they are written: \`betweenChildrenRest\` between the children of a sequence (not after the last), \`trailingRest\` after its last child, \`betweenIterationsRest\` between rounds (not after the last), or a \`rest\` node.
To rest before the next section, end the section's top-level sequence with a \`rest\` node of kind \`blockRest\` and set \`transitionAfter: automatic\`. Never combine that rest with \`manualReady\`.
In AMRAP, EMOM and you-go-I-go sections that closing rest is the only rest allowed.

## Prescriptions

\`assignments\` holds \`A\`, and also \`B\` in a pair workout. Each is a prescription:

| Key | Meaning |
| --- | --- |
| \`name\` | Required. The movement, from the list below where one fits. |
| \`shortName\` | A shorter display name when \`name\` is long. |
| \`reps\` | Whole number, 1 to 100000. |
| \`calories\` | Machine calories, whole number. |
| \`distance\` | \`{ value: 400, unit: m }\`, or \`unit: km\`. |
| \`time\` | A target time or hold as a duration. It is shown, it never runs a clock. |
| \`load\` | See loads. |
| \`notes\` | Free text up to 500 characters: tempo, scaling, how to hold the weight, standards such as box height. |

The targets are shown big, so give one main target per prescription. "10 per side" is \`reps: 10\` with \`notes: Per side\`.

## Loads

A load is \`{ value, women, unit }\`: \`value\` is the men's (or only) amount, \`women\` the optional women's amount in the same unit, and \`unit\` is \`kg\`, \`lb\` or \`percent\` (of a one-rep max). A percentage takes no \`women\` value.
Prefer levels, so each athlete picks one: \`load\` with the keys ${list([...LOAD_LEVELS])}, each a load as above.
Heavy is the prescribed (Rx) load, medium about 70 % and light about half of it, rounded to real equipment (dumbbells in 2.5 kg steps, kettlebells 8, 12, 16, 20, 24, 28 or 32 kg).
Women's amounts are about 0.7 × the men's unless the source says otherwise. Dumbbell and kettlebell loads are per hand unless \`notes\` says one implement. Bodyweight movements have no load.

## Pairs

With \`participants: 2\`:

- Every \`timed\` and \`task\` node has both \`A\` and \`B\`. They may differ (A rows while B does burpees) or match.
- In For time, strength and EMOM sections every \`task\` needs \`completion: team\` (one Done for both) or \`completion: both\` (each athlete taps Done). AMRAP and you-go-I-go tasks take no \`completion\`.
- \`assignmentPolicy: alternate\` on a \`repeat\` swaps the A and B columns after every round.
- In a you-go-I-go section one athlete works through the listed tasks while the other rests, then they switch.

## Limits

- At most ${MAX_BLOCK_TASKS} tasks in an AMRAP, EMOM or you-go-I-go list.
- At most ${MAX_OCCURRENCES.toLocaleString('en')} work and rest slots once rounds are expanded, and ${MAX_MS / 3_600_000} hours in total.
- At most ${MAX_FILE_BYTES / 1_048_576} MB per file. No YAML anchors or aliases (\`&\`, \`*\`) and no duplicate keys.

## Checklist before you answer

- \`format\`, \`formatVersion\` and \`schemaVersion\` exactly as shown, and every required key present.
- Ids unique across the whole file.
- Timed circuits hold only \`timed\`, \`rest\`, \`sequence\` and \`repeat\` nodes.
- Each section carries only the settings its format allows, and the ones it needs.
- Pair workouts have \`A\` and \`B\` on every work slot and \`completion\` where it is required.
- Movement and equipment names come from the lists below wherever one fits.

## Movement names

Use these names exactly where one fits, plural as written. A movement that is not listed is allowed: give it a clear plural English name in Title Case and the app marks it as new.

${movementNames(movements)}

## Equipment names

${equipment.join(', ')}

${EXAMPLES.map(([title, id]) => `## ${title}\n\n${yaml(serialiseWorkoutFile({ ...bundledWorkout(id), sharing: undefined }))}`).join('\n\n')}
`;
}

/**
 * The workout file inside an assistant's reply: the fenced block that holds an OpenWOD document, else the first
 * fenced block, else everything after an opening fence that was never closed, else the whole reply.
 */
export function extractWorkoutYaml(reply: string): string {
  const text = reply.replace(/\r\n?/g, '\n');
  const blocks = [...text.matchAll(/^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm)].map(match => match[2]);
  const open = /^[ \t]*(?:`{3,}|~{3,})[^\n]*\n/m.exec(text);
  const chosen = blocks.find(block => /^\s*format:\s*openwod\./m.test(block)) ?? blocks[0] ?? (open ? text.slice(open.index + open[0].length) : text);
  return chosen.replace(/^\s*\n/, '').trimEnd() + '\n';
}
