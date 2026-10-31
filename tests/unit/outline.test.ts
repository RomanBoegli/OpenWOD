import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { outlineWorkout, roundProgress } from '../../packages/domain/src/outline';
const fullBodyPartner = bundledWorkout('full-body-partner');
const partnerCircuit = bundledWorkout('partner-circuit');

describe('workout outline', () => {
  it('collapses five identical rounds of the partner circuit into one group with the between-round rest', () => {
    const [section] = outlineWorkout(compileWorkout(partnerCircuit));
    expect(section.title).toBe('Conditioning');
    expect(section.durationMs).toBe(1_190_000);
    expect(section.rounds).toHaveLength(1);
    const [group] = section.rounds;
    expect(group.label).toBe('Rounds 1–5 of 5');
    expect(group.repetitions).toBe(5);
    expect(group.roundRestMs).toBe(60_000);
    expect(group.rows.map(row => [row.A?.name, row.B?.name, row.workMs, row.restAfter.map(rest => rest.ms)])).toEqual([
      ['Row', 'Kettlebell Swings', 40_000, [10_000]],
      ['Kettlebell Swings', 'Row', 40_000, [10_000]],
      ['Burpees', 'Air Squats', 40_000, [10_000]],
      ['Air Squats', 'Burpees', 40_000, []],
    ]);
  });

  it('AT-29: keeps alternating rounds separate, with the rest between rounds after a round and the block rest after the section', () => {
    const sections = outlineWorkout(compileWorkout(fullBodyPartner));
    expect(sections.map(section => section.title)).toEqual(['Warm-Up', 'Legs & Strength', 'Upper Body & Arms', 'Abs & Core', 'HYROX Finisher', 'Cool-Down']);
    expect(sections[0].rounds).toHaveLength(1);
    expect(sections[0].rounds[0].label).toBe('');
    expect(sections[0].rounds[0].rows).toHaveLength(5);
    const block = sections[1];
    expect(block.durationMs).toBe(580_000);
    expect(block.rounds.map(round => round.label)).toEqual(['Round 1 of 2', 'Round 2 of 2']);
    expect(block.rounds[0].rows[0].A?.name).toBe('Air Squats');
    expect(block.rounds[1].rows[0].A?.name).toBe('Dumbbell Thrusters');
    expect(block.rounds[0].rows.at(-1)?.restAfter).toEqual([]);
    expect(block.rounds[0].roundRestMs).toBe(20_000);
    expect(block.rounds[0].restAfter).toEqual([]);
    expect(block.rounds[1].rows.at(-1)?.restAfter).toEqual([]);
    // The block rest is the rest after the section (BLD-14), told once beside the transition.
    expect(block.rounds[1].restAfter).toEqual([]);
    expect(block.restAfterMs).toBe(120_000);
  });

  it('labels nested repeats with sets and rounds', () => {
    const workout = structuredClone(partnerCircuit);
    const body = workout.sections[0].body;
    if (body.type !== 'repeat') throw new Error('fixture');
    body.count = 2;
    workout.sections[0].body = { id: 'sets', type: 'repeat', count: 2, betweenIterationsRestMs: 120_000, body };
    const [section] = outlineWorkout(compileWorkout(workout));
    expect(section.rounds.map(round => round.label)).toEqual(['Set 1 of 2 · Rounds 1–2 of 2', 'Set 2 of 2 · Rounds 1–2 of 2']);
    expect(section.rounds[0].rows.at(-1)?.restAfter).toEqual([]);
    expect(section.rounds[0].roundRestMs).toBe(60_000);
    expect(section.rounds[0].restAfter).toEqual([{ kind: 'roundRest', ms: 120_000 }]);
    expect(section.rounds[1].restAfter).toEqual([]);
  });
});

describe('round progress (UI-24)', () => {
  const positions = (id: string) => {
    const plan = compileWorkout(bundledWorkout(id));
    const progress = roundProgress(plan);
    return plan.occurrences.filter(item => item.phase === 'work').map(item => progress.get(item.id));
  };

  it('places each movement in its round and counts the rounds of the innermost repeat', () => {
    const circuit = positions('partner-circuit');
    expect(circuit.slice(0, 5)).toEqual([1, 2, 3, 4, 1].map((position, index) => ({ position, size: 4, round: index < 4 ? 1 : 2, rounds: 5 })));
    expect(circuit.at(-1)).toEqual({ position: 4, size: 4, round: 5, rounds: 5 });
    // A block outside any repeat is one round; the next block starts its own count.
    const fullBody = positions('full-body-partner');
    expect(fullBody[4]).toEqual({ position: 5, size: 5, round: 1, rounds: 1 });
    expect(fullBody[5]).toEqual({ position: 1, size: 4, round: 1, rounds: 2 });
  });

  it('follows the EMOM cycle, keeps a chipper as one round, and leaves AMRAP blocks to the athletes', () => {
    expect(positions('partner-emom-16').slice(0, 3)).toEqual([{ position: 1, size: 2, round: 1, rounds: 8 }, { position: 2, size: 2, round: 1, rounds: 8 }, { position: 1, size: 2, round: 2, rounds: 8 }]);
    expect(positions('fran').map(item => item?.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(positions('cindy')).toEqual([undefined]);
  });
});
