import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutAudio } from '../../apps/web/src/audio';
import { WorkoutEngine } from '../../packages/engine/src';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { partnerCircuit } from '../../packages/domain/src/fixtures';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const sources: { at?: number; cancelled: boolean }[] = [];
  const spoken: string[] = [];
  class FakeContext {
    state = 'running'; currentTime = 100; destination = {}; onstatechange?: () => void;
    async resume() { this.state = 'running'; }
    createOscillator() {
      const record = { at: undefined as number | undefined, cancelled: false };
      sources.push(record);
      return { frequency: { value: 0 }, connect: (target: unknown) => target, disconnect: () => {}, start: (at: number) => { record.at = at; }, stop: (at?: number) => { if (at === undefined) record.cancelled = true; }, onended: undefined };
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ destination: {} }), disconnect() {} }; }
  }
  const context = new FakeContext();
  vi.stubGlobal('AudioContext', function () { return context; });
  vi.stubGlobal('window', { speechSynthesis: { cancel() {}, getVoices: () => [], speak: (utterance: { text: string }) => spoken.push(utterance.text) } });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  let now = 0;
  const engine = new WorkoutEngine(compileWorkout(partnerCircuit), () => now, 'audio-test');
  engine.command({ id: 'play', type: 'play', occurrenceId: 'ready' });
  now = 10_000; engine.tick();
  return { audio: new WorkoutAudio(), sources, spoken, context, engine, advance(ms: number) { now += ms; engine.tick(); } };
}

it('schedules future cues on the audio clock and cancels/rebases them after pause and resume', async () => {
  const { audio, sources, context, engine, advance } = setup();
  await audio.unlock(); sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.map(source => source.at)).toEqual([137, 138, 139, 140]);
  advance(17_000);
  engine.command({ id: 'pause', type: 'pause', occurrenceId: engine.occurrenceId });
  audio.update(engine.project(), engine.readClocks());
  expect(sources.every(source => source.cancelled)).toBe(true);
  sources.length = 0; context.currentTime = 500;
  engine.command({ id: 'resume', type: 'resume', occurrenceId: engine.occurrenceId });
  audio.update(engine.project(), engine.readClocks());
  expect(sources.map(source => source.at)).toEqual([520, 521, 522, 523]);
});

it('drops stale countdowns instead of speaking a burst after a delayed observation', async () => {
  const { audio, spoken, engine, advance } = setup();
  await audio.unlock(); audio.update(engine.project(), engine.readClocks()); spoken.length = 0;
  advance(38_500);
  audio.update(engine.project(), engine.readClocks());
  audio.update(engine.project(), engine.readClocks());
  expect(spoken).toEqual(['2']);
});
