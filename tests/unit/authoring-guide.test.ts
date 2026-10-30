import { describe, expect, it } from 'vitest';
import { buildAuthoringGuide, extractWorkoutYaml } from '../../packages/domain/src/authoring-guide';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { compileWorkout, FORMAT_SETTINGS } from '../../packages/domain/src/compiler';
import { seedMovements } from '../../packages/domain/src/movements';
import { DURATION_KEYS, LOAD_LEVELS, parseWorkoutFile, SECTION_FORMATS, serialiseWorkoutFile } from '../../packages/domain/src';

const equipment = [...new Set(seedMovements.flatMap(record => record.equipment ?? [])), 'Exercise mat', 'Running route'];
const guide = buildAuthoringGuide({ movements: seedMovements, equipment });
const rowOf = (first: string) => guide.split('\n').find(line => line.startsWith(`| \`${first}\` |`));

describe('the authoring guide (SHR-07)', () => {
  it('describes every format with the settings the compiler allows, every node type, duration key and load level', () => {
    for (const format of SECTION_FORMATS) {
      expect(rowOf(format), format).toBeDefined();
      for (const key of FORMAT_SETTINGS[format]) expect(rowOf(format), `${format} ${key}`).toContain(`\`${DURATION_KEYS[key] ?? key}\``);
    }
    for (const type of ['timed', 'task', 'rest', 'sequence', 'repeat']) expect(rowOf(type), type).toBeDefined();
    for (const key of Object.values(DURATION_KEYS)) expect(guide).toContain(`\`${key}\``);
    for (const level of LOAD_LEVELS) expect(guide).toContain(`\`${level}\``);
  });

  it('carries a solo and a pair example that import and compile as they stand', () => {
    const examples = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(match => match[1]).filter(block => block.includes('sections:'));
    expect(examples).toHaveLength(2);
    for (const example of examples) {
      expect(example).not.toContain('sharing:');
      expect(compileWorkout(parseWorkoutFile(example)).occurrences.length).toBeGreaterThan(0);
    }
    expect(examples.map(example => parseWorkoutFile(example).participants)).toEqual([1, 2]);
  });

  it('lists the movements and equipment it is given and stays small enough to paste', () => {
    for (const record of seedMovements) expect(guide).toContain(record.name);
    for (const name of equipment) expect(guide).toContain(name);
    const own = buildAuthoringGuide({ movements: [...seedMovements, { id: 'yoke-carry', name: 'Yoke carries' }], equipment: ['Yoke'] });
    expect(own).toContain('**Other:** Yoke carries');
    expect(own).toContain('## Equipment names\n\nYoke\n');
    expect(new TextEncoder().encode(guide).length).toBeLessThan(25_000);
  });

  it('keeps clear of the words the static build keeps off the library page', () => {
    expect(guide).not.toMatch(/household server|\bservers?\b|upload/i);
  });
});

describe('extractWorkoutYaml', () => {
  const file = serialiseWorkoutFile({ ...bundledWorkout('cindy'), sharing: undefined });
  it.each([
    ['a yaml fence with prose around it', `Assumed a twenty-minute cap.\n\n\`\`\`yaml\n${file}\`\`\`\n\nEnjoy!`],
    ['a yml fence', '```yml\n' + file + '```'],
    ['a bare fence', '```\n' + file + '```'],
    ['a tilde fence', '~~~yaml\n' + file + '~~~'],
    ['CRLF line ends', ('Here it is:\n```yaml\n' + file + '```\n').replace(/\n/g, '\r\n')],
    ['another block before it', '```text\nCindy, scaled\n```\n\n```yaml\n' + file + '```'],
    ['a fence that was never closed', 'Here it is:\n```yaml\n' + file],
    ['a reply without a fence', file],
  ])('finds the file in %s', (_case, reply) => {
    expect(extractWorkoutYaml(reply)).toBe(file);
  });
});
