import { afterEach, expect, it, vi } from 'vitest';
import { CUE_NAMES, hornSpan, pickDefaultVoice, sortVoices, WorkoutAudio } from '../../apps/web/src/audio';
import { WorkoutEngine } from '../../packages/engine/src';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src';
const partnerCircuit = bundledWorkout('partner-circuit');
const partnerEmom16 = bundledWorkout('partner-emom-16');
const partnerSprints = bundledWorkout('you-go-i-go-sprints');
const runSledRun = bundledWorkout('run-sled-run');

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

interface Source { at?: number; stopAt?: number; cancelled: boolean; kind: 'beep' | 'clip'; clip?: string; frequency?: number; wave?: string }

function setup({ clips = false, horn = false, workout = partnerCircuit as Workout, started = 10_000 } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const sources: Source[] = [];
  const spoken: string[] = [];
  class FakeContext {
    state = 'running'; currentTime = 100; destination = {}; onstatechange?: () => void;
    async resume() { this.state = 'running'; }
    private source(kind: Source['kind']) {
      const record: Source = { at: undefined, cancelled: false, kind };
      sources.push(record);
      return { frequency: { value: 0 }, buffer: undefined as unknown, connect: (target: unknown) => target, disconnect: () => {}, start: (at: number) => { record.at = at; record.clip = (this as unknown as { lastBuffer?: string }).lastBuffer; }, stop: (at?: number) => { if (at === undefined) record.cancelled = true; else record.stopAt = Math.round((at - record.at!) * 100) / 100 + record.at!; }, onended: undefined, set bufferName(name: string) { record.clip = name; } };
    }
    createOscillator() {
      const node = this.source('beep') as ReturnType<FakeContext['source']> & { type?: string };
      const record = sources[sources.length - 1], start = node.start;
      node.start = at => { start(at); record.frequency = node.frequency.value; record.wave = node.type; };
      return node;
    }
    createBufferSource() {
      const record: Source = { at: undefined, cancelled: false, kind: 'clip' };
      sources.push(record);
      return { buffer: undefined as { name: string } | undefined, connect: (target: unknown) => target, disconnect: () => {}, start(at: number) { record.at = at; record.clip = this.buffer?.name; }, stop: (at?: number) => { if (at === undefined) record.cancelled = true; else record.stopAt = at; }, onended: undefined };
    }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ destination: {} }), disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { name: new TextDecoder().decode(data), duration: 2.2 }; }
  }
  const context = new FakeContext();
  vi.stubGlobal('AudioContext', function () { return context; });
  vi.stubGlobal('window', { speechSynthesis: { cancel() {}, getVoices: () => [], speak: (utterance: { text: string }) => spoken.push(utterance.text) } });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('fetch', async (url: string) => url.includes('truck-horn') ? (horn ? { ok: true, arrayBuffer: async () => new TextEncoder().encode('horn').buffer } : { ok: false }) : !clips ? { ok: false } : url.endsWith('packs.json') ? { ok: true, json: async () => [{ id: 'british', label: 'British male (Alan)', names: 190 }, { id: 'american', label: 'American female (Amy)' }] } : url.includes('/british/') ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url.replace(/^.*\/(.*)\.mp3$/, '$1')).buffer } : { ok: false });
  let now = 0;
  const engine = new WorkoutEngine(compileWorkout(workout), () => now, 'audio-test');
  engine.command({ id: 'play', type: 'play', occurrenceId: 'ready' });
  now = started; engine.tick();
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

it('beeps on every countdown second and boundary, lets the recorded word follow each beep, and speaks only the assignments', async () => {
  const { audio, sources, spoken, engine, advance } = setup({ clips: true });
  await audio.unlock(); await audio.preload();
  expect(audio.clipsReady).toBe(true);
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks()); // Work slot 1: 40 s left, a 10 s transition follows.
  expect(sources.filter(source => source.kind === 'beep').map(source => source.at)).toEqual([137, 138, 139, 140]);
  expect(sources.filter(source => source.kind === 'clip').map(source => [source.clip, Math.round(source.at! * 100) / 100])).toEqual([['three', 137.1], ['two', 138.1], ['one', 139.1], ['rest', 140.2]]);
  expect(spoken).toEqual([]);
  advance(38_500);
  audio.update(engine.project(), engine.readClocks());
  expect(spoken).toEqual([]); // No late spoken numbers when clips were scheduled ahead.
  advance(1_500); // Transition: next assignment is announced by the rest clip plus spoken names; the boundary clip is "go".
  sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.filter(source => source.kind === 'clip').map(source => source.clip)).toEqual(['three', 'two', 'one', 'go', 'rest']);
  vi.runOnlyPendingTimers(); // Device speech waits for the recorded words before it.
  expect(spoken).toEqual(['A, Kettlebell swings. B, Row.']);
  expect(CUE_NAMES).toHaveLength(17);
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
  vi.runOnlyPendingTimers(); // Device speech waits for the recorded words before it.
  expect(emom.spoken).toEqual(['Next. A, Burpees. B, Row.']);

  const manual = setup({ workout: runSledRun });
  await manual.audio.unlock();
  manual.audio.update(manual.engine.project(), manual.engine.readClocks());
  manual.spoken.length = 0; manual.sources.length = 0;
  manual.advance(300_000);
  manual.command('done');
  manual.audio.update(manual.engine.project(), manual.engine.readClocks());
  vi.runOnlyPendingTimers();
  expect(manual.spoken).toEqual(['Go.', 'Sled push.']);
  expect(manual.sources.map(source => source.kind)).toEqual(['beep']); // The acknowledgement beep; nothing is scheduled for open-ended work.
});

it('announces who does what from recorded name clips when the pack has them, and lets the device voice read the rest', async () => {
  const { audio, sources, spoken, engine, advance } = setup({ clips: true });
  audio.resolveMovement = lane => ({ 'Kettlebell swings': 'kettlebell-swing', Row: 'row' } as Record<string, string>)[lane.name];
  await audio.unlock(); await audio.preload();
  await audio.prepareNames(['kettlebell-swing', 'row']);
  audio.update(engine.project(), engine.readClocks());
  advance(40_000); // Into the transition: the rest clip, then "A", the movement, "B", the movement, all as clips.
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks());
  const clips = sources.filter(source => source.kind === 'clip').map(source => source.clip);
  expect(clips.slice(-5)).toEqual(['rest', 'a', 'kettlebell-swing', 'b', 'row']); // after the scheduled countdown and Go
  expect(spoken).toEqual([]);
  // A movement the pack does not know falls back to the device voice for the whole announcement.
  audio.resolveMovement = lane => lane.name === 'Row' ? 'row' : undefined;
  advance(10_000); advance(40_000);
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.filter(source => source.kind === 'clip').map(source => source.clip)).toContain('rest');
  vi.runOnlyPendingTimers(); // Device speech waits for the recorded words before it.
  expect(spoken).toHaveLength(1);
});

it('shapes every beep by the chosen tone', async () => {
  const { audio, sources, engine } = setup();
  await audio.unlock(); await audio.preload(); sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.map(source => [source.wave, source.frequency])).toEqual([['sine', 620], ['sine', 620], ['sine', 620], ['sine', 880]]);
  audio.tone = 'soft'; sources.length = 0;
  await audio.testBeeps();
  // The unlock click comes first, then the countdown and the Go, all in the lower rounder tone.
  expect(sources.map(source => [source.wave, source.frequency])).toEqual([['triangle', 495], ['triangle', 465], ['triangle', 465], ['triangle', 465], ['triangle', 660]]);
  audio.tone = 'gym'; sources.length = 0;
  await audio.testBeeps();
  // The gym clock: every beep is a 1 kHz sine, the Go held about three quarters of a second.
  expect(sources.map(source => [source.wave, source.frequency])).toEqual(Array(5).fill(['sine', 1000]));
  expect(sources.map(source => Math.round((source.stopAt! - source.at!) * 100) / 100).slice(1)).toEqual([.34, .34, .34, .74]);
  audio.tone = 'alarm'; sources.length = 0;
  await audio.testBeeps();
  expect(sources.map(source => source.wave)).toEqual(Array(5).fill('sawtooth'));
});

it('plays the recorded truck horn on the audio clock: a short blast per count, the full-level part for the Go, all of it at the end', async () => {
  const { audio, sources, engine } = setup({ horn: true });
  audio.tone = 'horn';
  await audio.unlock(); await audio.loadHorn(); sources.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(sources.map(source => [source.kind, source.clip, source.at])).toEqual([['clip', 'horn', 137], ['clip', 'horn', 138], ['clip', 'horn', 139], ['clip', 'horn', 140]]);
  expect(sources.map(source => Math.round((source.stopAt! - source.at!) * 100) / 100)).toEqual([.31, .31, .31, 1.41]);
  expect([hornSpan(.08, 2.2), hornSpan(.06, 2.2), hornSpan(.18, 2.2), hornSpan(.35, 2.2), hornSpan(.35, .5)]).toEqual([.3, .3, 1.4, 2.2, .5]);
});

it('lets a boundary that has sounded ring out with its word, has the rest names follow it, and still stops one a skip never reached', async () => {
  const { audio, sources, spoken, context, engine, advance, command } = setup({ clips: true, horn: true });
  audio.tone = 'horn';
  await audio.unlock(); await audio.preload(); await audio.loadHorn(); sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks()); // Work slot 1 ends at 140 with the horn, then the Rest word.
  const boundary = sources.filter(source => source.at! >= 140);
  expect(boundary.map(source => source.clip)).toEqual(['horn', 'rest']);
  context.currentTime = 140.02; advance(40_000);
  audio.update(engine.project(), engine.readClocks());
  expect(boundary.every(source => !source.cancelled)).toBe(true);
  // The rest slot's names wait for the ringing Rest word and do not say Rest again.
  expect(sources.filter(source => source.clip === 'rest')).toEqual([boundary[1]]);
  expect(spoken).toEqual([]);
  vi.advanceTimersByTime((1.42 + 2.2 + .1 - .02) * 1000 - 50);
  expect(spoken).toEqual([]);
  vi.advanceTimersByTime(100);
  expect(spoken).toEqual(['A, Kettlebell swings. B, Row.']);
  const next = sources.filter(source => source.clip === 'horn').at(-1)!; // The transition's own boundary, 10 s ahead.
  expect(next.at).toBeCloseTo(150.02);
  command('next');
  audio.update(engine.project(), engine.readClocks());
  expect(next.cancelled).toBe(true);
});

it('says Go once when the prep countdown ends on a task pressed through by hand, and the names follow it', async () => {
  const { audio, sources, spoken, context, engine, advance } = setup({ clips: true, workout: bundledWorkout('fran'), started: 0 });
  await audio.unlock(); await audio.preload(); sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks()); // Preparing: the countdown and the Go at its end are scheduled.
  const prepMs = bundledWorkout('fran').prepMs;
  context.currentTime = 100 + prepMs / 1000 + .02; advance(prepMs);
  audio.update(engine.project(), engine.readClocks());
  expect(sources.filter(source => source.clip === 'go' && source.at! < 120)).toHaveLength(1); // Later ones belong to the cap.
  vi.runOnlyPendingTimers();
  expect(spoken).toHaveLength(1); // The thrusters, read after the recorded Go.
});

it('falls back to the classic beep while the horn is missing', async () => {
  const { audio, sources } = setup();
  audio.tone = 'horn';
  await audio.unlock(); sources.length = 0;
  await audio.testBeeps();
  expect(sources.map(source => [source.kind, source.wave, source.frequency])).toEqual([['beep', 'sine', 660], ...Array(3).fill(['beep', 'sine', 620]), ['beep', 'sine', 880]]);
});

it('holds the first cues of a Start until the audio context has resumed, so Get ready and the prep countdown use the clips', async () => {
  const { audio, sources, spoken, context } = setup({ clips: true });
  await audio.unlock(); await audio.preload();
  audio.resolveMovement = lane => ({ Thrusters: 'thruster', 'Pull-ups': 'pull-up' } as Record<string, string>)[lane.name];
  await audio.prepareNames(['thruster', 'pull-up']);
  const engine = new WorkoutEngine(compileWorkout(bundledWorkout('fran') as Workout), () => 0, 'prep-test');
  engine.command({ id: 'play', type: 'play', occurrenceId: 'ready' }); engine.tick();
  // Start: the unlock's resume is still pending when the same gesture's first frame reaches the audio layer.
  context.state = 'suspended';
  let resumed!: () => void;
  context.resume = () => new Promise<void>(resolve => { resumed = () => { context.state = 'running'; resolve(); }; });
  const unlocking = audio.unlock();
  sources.length = 0; spoken.length = 0;
  audio.update(engine.project(), engine.readClocks());
  expect(spoken).toEqual([]); expect(sources).toEqual([]);
  resumed(); await unlocking;
  audio.update(engine.project(), engine.readClocks());
  expect(spoken).toEqual([]);
  const clips = sources.filter(source => source.kind === 'clip');
  expect(clips.map(source => source.clip)).toEqual(['three', 'two', 'one', 'go', 'get-ready', 'thruster']);
  expect(clips.find(source => source.clip === 'get-ready')!.at).toBe(100);
  // The unlock click, then the three countdown beeps and the Go beep of the 10-second prep.
  expect(sources.filter(source => source.kind === 'beep').map(source => source.at)).toEqual([100, 107, 108, 109, 110]);
});
