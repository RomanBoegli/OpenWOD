import { afterEach, expect, it, vi } from 'vitest';
import { CUE_NAMES, pickDefaultVoice, sortVoices, WorkoutAudio } from '../../apps/web/src/audio';
import { WorkoutEngine } from '../../packages/engine/src';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { partnerCircuit, partnerEmom16, partnerSprints, runSledRun } from '../../packages/domain/src/fixtures';
import type { Workout } from '../../packages/domain/src';

afterEach(() => vi.unstubAllGlobals());

interface Source { at?: number; cancelled: boolean; kind: 'beep' | 'clip'; clip?: string }

function setup({ clips = false, workout = partnerCircuit as Workout } = {}) {
  const sources: Source[] = [];
  const spoken: string[] = [];
  class FakeContext {
    state = 'running'; currentTime = 100; destination = {}; onstatechange?: () => void;
    async resume() { this.state = 'running'; }
    private source(kind: Source['kind']) {
      const record: Source = { at: undefined, cancelled: false, kind };
      sources.push(record);
      return { frequency: { value: 0 }, buffer: undefined as unknown, connect: (target: unknown) => target, disconnect: () => {}, start: (at: number) => { record.at = at; record.clip = (this as unknown as { lastBuffer?: string }).lastBuffer; }, stop: (at?: number) => { if (at === undefined) record.cancelled = true; }, onended: undefined, set bufferName(name: string) { record.clip = name; } };
    }
    createOscillator() { return this.source('beep'); }
    createBufferSource() {
      const record: Source = { at: undefined, cancelled: false, kind: 'clip' };
      sources.push(record);
      return { buffer: undefined as { name: string } | undefined, connect: (target: unknown) => target, disconnect: () => {}, start(at: number) { record.at = at; record.clip = this.buffer?.name; }, stop: (at?: number) => { if (at === undefined) record.cancelled = true; }, onended: undefined };
    }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ destination: {} }), disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { name: new TextDecoder().decode(data) }; }
  }
  const context = new FakeContext();
  vi.stubGlobal('AudioContext', function () { return context; });
  vi.stubGlobal('window', { speechSynthesis: { cancel() {}, getVoices: () => [], speak: (utterance: { text: string }) => spoken.push(utterance.text) } });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('fetch', async (url: string) => !clips ? { ok: false } : url.endsWith('packs.json') ? { ok: true, json: async () => [{ id: 'british', label: 'British male (Alan)' }, { id: 'american', label: 'American female (Amy)' }] } : url.includes('/british/') ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url.replace(/^.*\/(.*)\.mp3$/, '$1')).buffer } : { ok: false });
  let now = 0;
  const engine = new WorkoutEngine(compileWorkout(workout), () => now, 'audio-test');
  engine.command({ id: 'play', type: 'play', occurrenceId: 'ready' });
  now = 10_000; engine.tick();
  let n = 0;
  const command = (type: Parameters<WorkoutEngine['command']>[0]['type'], extra: Partial<Parameters<WorkoutEngine['command']>[0]> = {}) => engine.command({ id: `c${++n}`, occurrenceId: engine.occurrenceId, type, ...extra });
  return { audio: new WorkoutAudio(), sources, spoken, context, engine, command, advance(ms: number) { now += ms; engine.tick(); } };
}

it('schedules future cues on the audio clock and cancels/rebases them after pause and resume', async () => {
  const { audio, sources, context, engine, advance } = setup();
  await audio.unlock(); await audio.preload(); sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.map(source => source.at)).toEqual([137, 138, 139, 140]);
  expect(sources.every(source => source.kind === 'beep')).toBe(true);
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

it('uses recorded clips for countdown and boundary cues at the same instants as the beeps, and speaks only the assignments', async () => {
  const { audio, sources, spoken, engine, advance } = setup({ clips: true });
  await audio.unlock(); await audio.preload();
  expect(audio.clipsReady).toBe(true);
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks()); // Work slot 1: 40 s left, a 10 s transition follows.
  expect(sources.filter(source => source.kind === 'clip').map(source => [source.clip, source.at])).toEqual([['three', 137], ['two', 138], ['one', 139], ['rest', 140]]);
  expect(sources.some(source => source.kind === 'beep')).toBe(false);
  expect(spoken).toEqual([]);
  advance(38_500);
  audio.update(engine.project(), engine.readClocks());
  expect(spoken).toEqual([]); // No late spoken numbers when clips were scheduled ahead.
  advance(1_500); // Transition: next assignment is announced by the rest clip plus spoken names; the boundary clip is "go".
  sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.filter(source => source.kind === 'clip').map(source => source.clip)).toEqual(['three', 'two', 'one', 'go', 'rest']);
  expect(spoken).toEqual(['A, Kettlebell swings. B, Row.']);
  expect(CUE_NAMES).toHaveLength(10);
  expect(audio.packs.map(pack => pack.id)).toEqual(['british', 'american']);
  audio.cuePack = 'american';
  await audio.preload();
  expect(audio.clipsReady).toBe(false); // The second pack has no clips in this fixture: back to beeps and device speech.
});

it('falls back to beeps and device speech when clips are missing', async () => {
  const { audio, sources, spoken, engine } = setup();
  await audio.unlock(); await audio.preload();
  expect(audio.clipsReady).toBe(false);
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.every(source => source.kind === 'beep')).toBe(true);
});

it('prefers enhanced voices in the interface language and never a novelty voice', () => {
  const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) => ({ name, lang, voiceURI: name, localService: false, default: false, ...extra } as SpeechSynthesisVoice);
  const voices = [voice('Bahh', 'en-US', { default: true }), voice('Anna', 'de-DE', { localService: true }), voice('Daniel', 'en-GB', { localService: true }), voice('Samantha (Enhanced)', 'en-US', { localService: true })];
  expect(pickDefaultVoice(voices)?.name).toBe('Samantha (Enhanced)');
  expect(sortVoices(voices).map(item => item.name)).toEqual(['Samantha (Enhanced)', 'Daniel', 'Anna', 'Bahh']);
  expect(pickDefaultVoice([voice('Bahh', 'en-US')])).toBeUndefined();
});

it('plays the Switch clip on a handoff, confirms a Done with a short beep, and announces manual tasks', async () => {
  const sprints = setup({ clips: true, workout: partnerSprints });
  await sprints.audio.unlock(); await sprints.audio.preload();
  sprints.audio.update(sprints.engine.project(), sprints.engine.readClocks());
  sprints.sources.length = 0; sprints.spoken.length = 0;
  sprints.advance(30_000);
  sprints.command('switch');
  sprints.audio.update(sprints.engine.project(), sprints.engine.readClocks());
  expect(sprints.sources.filter(source => source.kind === 'clip').map(source => source.clip)).toContain('switch');
  // The cap countdown is rescheduled against the cap, not a slot.
  expect(sprints.sources.filter(source => source.kind === 'clip').map(source => source.clip)).toEqual(expect.arrayContaining(['three', 'two', 'one']));

  const emom = setup({ workout: partnerEmom16 });
  await emom.audio.unlock();
  emom.audio.update(emom.engine.project(), emom.engine.readClocks());
  emom.sources.length = 0; emom.spoken.length = 0;
  emom.advance(20_000);
  emom.command('done');
  emom.audio.update(emom.engine.project(), emom.engine.readClocks());
  expect(emom.sources.filter(source => source.kind === 'beep')).toHaveLength(1);
  expect(emom.spoken).toEqual(['Next. A, Burpees. B, Row.']);

  const manual = setup({ workout: runSledRun });
  await manual.audio.unlock();
  manual.audio.update(manual.engine.project(), manual.engine.readClocks());
  manual.spoken.length = 0; manual.sources.length = 0;
  manual.advance(300_000);
  manual.command('done');
  manual.audio.update(manual.engine.project(), manual.engine.readClocks());
  expect(manual.spoken).toEqual(['Go.', 'Sled push.']);
  expect(manual.sources.map(source => source.kind)).toEqual(['beep']); // The acknowledgement beep; nothing is scheduled for open-ended work.
});
