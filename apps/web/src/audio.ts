import type { ClockValues, Projection } from '../../../packages/engine/src';

export type SoundMode = 'voice' | 'beeps' | 'silent';
export type CueSource = 'clips' | 'device';
export type CueName = 'get-ready' | 'go' | 'rest' | 'switch' | 'three' | 'two' | 'one' | 'paused' | 'resume' | 'complete' | 'a' | 'b' | 'next' | 'last-interval' | 'a-waiting' | 'b-waiting' | 'ended';
/** A recorded voice pack: fixed cues plus, when `names` is set, one clip per bundled movement under names/<id>.mp3. */
export interface CuePack { id: string; label: string; voice?: string; names?: number }
export const CUE_NAMES: CueName[] = ['get-ready', 'go', 'rest', 'switch', 'three', 'two', 'one', 'paused', 'resume', 'complete', 'a', 'b', 'next', 'last-interval', 'a-waiting', 'b-waiting', 'ended'];
type Lane = { name: string; spokenName?: string; movement?: string };
type Assignment = { A: Lane; B?: Lane };
const COUNTDOWN: Record<1 | 2 | 3, CueName> = { 1: 'one', 2: 'two', 3: 'three' };

const PREFERRED = /enhanced|premium|siri|natural|neural|hd\b/i;
const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;

/** Ranks installed voices: the user's choice first, then enhanced/neural voices in the interface language, then local ones. */
export function voiceScore(voice: SpeechSynthesisVoice, lang = 'en'): number {
  const sameLanguage = voice.lang.toLowerCase().startsWith(lang.toLowerCase());
  return (sameLanguage ? 40 : 0) + (PREFERRED.test(voice.name) ? 30 : 0) + (voice.localService ? 10 : 0) + (voice.default ? 5 : 0) - (NOVELTY.test(voice.name) ? 50 : 0);
}

export function sortVoices(voices: SpeechSynthesisVoice[], lang = 'en'): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang) || a.name.localeCompare(b.name, 'en'));
}

export function pickDefaultVoice(voices: SpeechSynthesisVoice[], lang = 'en'): SpeechSynthesisVoice | undefined {
  return sortVoices(voices, lang).find(voice => voiceScore(voice, lang) > 0);
}

/** Disposable audio adapter. Scheduled sound never advances the workout. */
export class WorkoutAudio {
  private context?: AudioContext;
  private sources: AudioScheduledSourceNode[] = [];
  private token = '';
  private spoken = new Set<string>();
  private clips = new Map<CueName, AudioBuffer>();
  private preloading?: Promise<void>;
  mode: SoundMode = 'voice';
  cueSource: CueSource = 'clips';
  rate = 1;
  volume = .7;
  /** Base URL for the pre-rendered cue clips; packs live in subfolders listed by packs.json. */
  clipBase = '/cues/';
  /** Chosen pack id; '' means the first available. */
  cuePack = '';
  packs: CuePack[] = [];
  private loadedPack = '';
  /** Recorded movement names of the loaded pack, by movement id (see prepareNames). */
  private names = new Map<string, AudioBuffer>();
  private namesPack = '';
  /** Maps a prescription to its exercise record id so its recorded name can be found; set by the app from the catalogue. */
  resolveMovement?: (lane: Lane) => string | undefined;
  onError?: (message: string) => void;
  /** Reports whether every clip decoded, once preloading finishes. */
  onClips?: (ready: boolean) => void;
  /** Reports the installed packs once packs.json was read. */
  onPacks?: (packs: CuePack[]) => void;

  private ensureContext() {
    this.context ??= new AudioContext();
    this.context.onstatechange = () => {
      this.token = '';
      if (this.context?.state !== 'running') this.cancel();
    };
    return this.context;
  }

  private listing?: Promise<CuePack[]>;
  /** Reads packs.json once; needs no audio context, so the settings page can list the packs before any sound was unlocked. */
  listPacks(): Promise<CuePack[]> {
    this.listing ??= (async () => {
      if (typeof fetch === 'function') {
        try {
          const response = await fetch(`${this.clipBase}packs.json`);
          if (response.ok) {
            const listed: unknown = await response.json();
            if (Array.isArray(listed)) this.packs = listed.filter((item): item is CuePack => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.label === 'string'));
          }
        } catch { /* No pack list: fall back to device speech. */ }
      }
      this.onPacks?.(this.packs);
      return this.packs;
    })();
    return this.listing;
  }

  /** Fetches and decodes every clip once so a session never needs the network after Play (ENG-11). Failure is silent: beeps and device speech remain. */
  preload(): Promise<void> {
    const wanted = this.cuePack || this.packs[0]?.id || '';
    if (this.preloading && this.loadedPack === wanted && (this.packs.length || !this.clips.size)) return this.preloading;
    this.preloading = (async () => {
      if (typeof fetch !== 'function') return;
      let context: AudioContext;
      try { context = this.ensureContext(); } catch { return; }
      await this.listPacks();
      const pack = this.packs.find(item => item.id === this.cuePack) ?? this.packs[0];
      this.loadedPack = pack?.id ?? '';
      if (this.namesPack !== this.loadedPack) { this.names.clear(); this.namesPack = this.loadedPack; }
      this.clips.clear();
      if (!pack) { this.onClips?.(false); return; }
      await Promise.all(CUE_NAMES.map(async name => {
        try {
          const response = await fetch(`${this.clipBase}${pack.id}/${name}.mp3`);
          if (!response.ok) return;
          this.clips.set(name, await context.decodeAudioData(await response.arrayBuffer()));
        } catch { /* Missing or undecodable clip: this cue falls back to beeps and device speech. */ }
      }));
      this.onClips?.(this.clipsReady);
    })();
    return this.preloading;
  }

  /** Fetches and decodes the recorded names a session will announce. Names the pack lacks (your own exercises) fall back to device speech. */
  async prepareNames(ids: string[]): Promise<void> {
    if (typeof fetch !== 'function' || this.cueSource !== 'clips') return;
    await this.listPacks();
    const pack = this.packs.find(item => item.id === this.cuePack) ?? this.packs[0];
    if (!pack?.names) return;
    let context: AudioContext;
    try { context = this.ensureContext(); } catch { return; }
    if (this.namesPack !== pack.id) { this.names.clear(); this.namesPack = pack.id; }
    await Promise.all([...new Set(ids)].filter(id => !this.names.has(id)).map(async id => {
      try {
        const response = await fetch(`${this.clipBase}${pack.id}/names/${id}.mp3`);
        if (response.ok) this.names.set(id, await context.decodeAudioData(await response.arrayBuffer()));
      } catch { /* No clip: the device voice reads this name. */ }
    }));
  }

  get clipsReady() { return this.clips.size === CUE_NAMES.length; }
  private get useClips() { return this.mode === 'voice' && this.cueSource === 'clips' && this.context?.state === 'running'; }

  async unlock() {
    if (this.mode === 'silent') return;
    try {
      const context = this.ensureContext();
      await context.resume();
      // A local oscillator unlocks the output from the user's explicit gesture.
      this.beep(context.currentTime, .035, 660, .05);
      void this.preload();
    } catch { this.onError?.('Sound unavailable. The workout will continue visually.'); }
  }

  private track(source: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
    this.sources.push(source);
    source.onended = () => { source.disconnect(); nodes.forEach(node => node.disconnect()); this.sources = this.sources.filter(item => item !== source); };
  }

  private beep(at: number, length: number, frequency: number, gain = this.volume * .13) {
    if (!this.context || this.context.state !== 'running') return;
    const source = this.context.createOscillator();
    const volume = this.context.createGain();
    source.frequency.value = frequency;
    volume.gain.setValueAtTime(0, at);
    volume.gain.linearRampToValueAtTime(gain, at + .006);
    volume.gain.exponentialRampToValueAtTime(.001, at + length);
    source.connect(volume).connect(this.context.destination);
    source.start(at);
    source.stop(at + length + .02);
    this.track(source, volume);
  }

  /** Plays a decoded buffer at an exact AudioContext time and returns when it ends. */
  private play(buffer: AudioBuffer, at: number): number {
    const source = this.context!.createBufferSource();
    const volume = this.context!.createGain();
    source.buffer = buffer;
    volume.gain.value = this.volume;
    source.connect(volume).connect(this.context!.destination);
    source.start(at);
    this.track(source, volume);
    return at + (buffer.duration || .6);
  }

  /** Plays a pre-rendered clip at an exact AudioContext time. Returns false when the clip is unavailable. */
  private clip(name: CueName, at: number): boolean {
    const buffer = this.clips.get(name);
    if (!buffer || !this.context || this.context.state !== 'running') return false;
    this.play(buffer, at);
    return true;
  }

  cancel() {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } }
    this.sources = [];
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.token = '';
  }

  reset() { this.cancel(); this.spoken.clear(); }

  speak(text: string) {
    if (this.mode !== 'voice' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickDefaultVoice(window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    utterance.rate = this.rate;
    utterance.volume = this.volume;
    utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) this.onError?.('Voice unavailable. Local beeps are still enabled.'); };
    window.speechSynthesis.speak(utterance);
  }

  /** A fixed cue: the clip when available, otherwise device speech. */
  private cue(name: CueName, text: string, at = this.context?.currentTime ?? 0) {
    if (this.useClips && this.clip(name, at)) return;
    this.speak(text);
  }

  private static assignmentText(assignment: Assignment): string {
    const name = (lane: Lane) => lane.spokenName ?? lane.name;
    return assignment.B ? `A, ${name(assignment.A)}. B, ${name(assignment.B)}.` : `${name(assignment.A)}.`;
  }

  /**
   * Says who does what. With a recorded pack: the lead clips, then "A", the movement, "B", the movement, as clips in
   * sequence when the pack has every name; otherwise the device voice reads the names after the lead clips.
   * Without a pack the device voice says everything, lead text included.
   */
  private announce(assignment: Assignment, leadText: string, leadClips: CueName[] = [], at = this.context?.currentTime ?? 0) {
    if (this.useClips && this.clipsReady) {
      let time = at;
      for (const name of leadClips) time = this.play(this.clips.get(name)!, time) + .1;
      const sequence: AudioBuffer[] = [];
      const lanes: [CueName | undefined, Lane][] = assignment.B ? [['a', assignment.A], ['b', assignment.B]] : [[undefined, assignment.A]];
      const complete = lanes.every(([athlete, lane]) => {
        const id = this.resolveMovement?.(lane) ?? lane.movement;
        const buffer = id ? this.names.get(id) : undefined;
        if (!buffer) return false;
        if (athlete) sequence.push(this.clips.get(athlete)!);
        sequence.push(buffer);
        return true;
      });
      if (complete) { for (const buffer of sequence) time = this.play(buffer, time) + .08; return; }
      this.speak(WorkoutAudio.assignmentText(assignment));
      return;
    }
    this.speak(`${leadText} ${WorkoutAudio.assignmentText(assignment)}`.trim());
  }

  async test() {
    await this.unlock();
    await this.preload();
    const sample: Assignment = { A: { name: 'Row', movement: 'row' }, B: { name: 'Kettlebell swings', movement: 'kettlebell-swing' } };
    await this.prepareNames(['row', 'kettlebell-swing']);
    if (this.context && this.mode !== 'silent') this.beep(this.context.currentTime + .1, .15, 880);
    this.announce(sample, 'Ready to train.', ['get-ready'], (this.context?.currentTime ?? 0) + .4);
  }

  private lastTurn?: { key: string; number: number };
  private lastAcks = '';
  private lastEnded?: { occurrenceId: string; manual: boolean; status: string };

  update(projection: Projection, clocks: ClockValues) {
    const token = `${projection.sessionId}:${projection.occurrenceId}:${projection.status}:${projection.clockScope}`;
    const clips = this.useClips && this.clipsReady;
    if (this.token === token) {
      this.acknowledgementCue(projection, clocks);
      // Device-voice countdown is spoken late, as each second arrives; clips were scheduled ahead at the token change.
      if (clips || projection.clockScope === 'elapsed') return;
      const count = Math.ceil(clocks.remainingMs / 1000);
      const cue = `${token}:countdown:${count}`;
      if (this.mode === 'voice' && ['running', 'preparing'].includes(projection.status) && count >= 1 && count <= 3 && !this.spoken.has(cue)) {
        this.spoken.add(cue);
        this.speak(String(count));
      }
      return;
    }
    const wasPaused = this.token.includes(':paused:');
    const previous = this.lastEnded;
    this.lastEnded = { occurrenceId: projection.occurrenceId.replace(/\/turn:\d+$/, ''), manual: projection.timing === 'manual' && !projection.tasks, status: projection.status };
    this.cancel();
    this.token = token;
    this.lastAcks = `${projection.acks.A}${projection.acks.B}${projection.acks.team}`;
    if (this.mode === 'silent') return;
    const terminal = ['completed', 'aborted'].includes(projection.status);
    if (terminal) {
      if (projection.status === 'completed') {
        if (this.context) this.beep(this.context.currentTime + .01, .35, 1047);
        this.cue('complete', 'Workout complete. Well done.', (this.context?.currentTime ?? 0) + .4);
      } else this.cue('ended', 'Workout ended.');
      return;
    }
    if (projection.status === 'paused') { this.cue('paused', 'Paused.'); return; }
    if (!['running', 'preparing'].includes(projection.status)) return;
    if (wasPaused) this.cue('resume', 'Resume.');
    // A handoff: the Switch cue names the incoming athlete.
    const turnKey = `${projection.sessionId}:${projection.current.id}:${projection.index}`;
    const switched = projection.turn !== undefined && this.lastTurn?.key === turnKey && projection.turn.number > this.lastTurn.number;
    this.lastTurn = projection.turn ? { key: turnKey, number: projection.turn.number } : undefined;
    if (switched && !wasPaused) {
      const incoming: CueName = projection.turn!.athlete === 'A' ? 'a' : 'b';
      if (clips && this.clips.has('switch') && this.clips.has(incoming)) this.play(this.clips.get(incoming)!, this.play(this.clips.get('switch')!, this.context!.currentTime) + .1);
      else this.speak(`Switch. ${projection.turn!.athlete}.`);
    }
    const scheduled = this.scheduleBoundary(projection, clocks, clips);
    const cueId = `${projection.sessionId}:${projection.occurrenceId}`;
    if (this.spoken.has(cueId)) return;
    this.spoken.add(cueId);
    const sameOccurrence = previous?.occurrenceId === this.lastEnded.occurrenceId;
    const assignment = projection.status === 'preparing' ? projection.current.assignments : projection.current.phase !== 'work' ? projection.nextWork?.assignments : undefined;
    if (assignment && (clocks.remainingMs > 5000 || projection.clockScope === 'elapsed')) {
      const lead = projection.status === 'preparing' ? 'get-ready' : 'rest';
      this.announce(assignment, lead === 'get-ready' ? 'Get ready.' : 'Rest.', [lead]);
      return;
    }
    if (projection.status !== 'running' || clocks.slotMs >= 1000 || wasPaused || switched || sameOccurrence) return;
    // A fresh start that no scheduled boundary announced: after a Done, a Ready gate, or into a manual task.
    const announced = previous === undefined || (!previous.manual && previous.status !== 'awaitingReady' && previous.status !== 'ready');
    if (previous?.manual && this.context?.state === 'running') this.beep(this.context.currentTime + .01, .06, 740); // The Done that ended the last task.
    if (projection.current.phase !== 'work') { if (!announced) this.cue('rest', 'Rest.'); return; }
    if (!announced || projection.timing === 'manual') {
      this.cue('go', 'Go.');
      if (projection.timing === 'manual' && !projection.tasks && projection.current.assignments) this.announce(projection.current.assignments, '', [], (this.context?.currentTime ?? 0) + .7);
    }
    if (projection.interval && projection.interval.index === projection.interval.count) this.cue('last-interval', 'Last interval.', (this.context?.currentTime ?? 0) + 1);
    void scheduled;
  }

  /** Schedules the 3-2-1 countdown and the boundary cue on the audio clock for slot, interval, turn and cap scopes. */
  private scheduleBoundary(projection: Projection, clocks: ClockValues, clips: boolean): boolean {
    if (this.context?.state !== 'running' || projection.clockScope === 'elapsed') return false;
    const audioNow = this.context.currentTime;
    const secondsLeft = clocks.remainingMs / 1000;
    // Only schedule cues that are still in the future. Missed numbers are dropped (AUD-06).
    for (const seconds of [3, 2, 1] as const) if (secondsLeft > seconds + .05) {
      if (!clips || !this.clip(COUNTDOWN[seconds], audioNow + secondsLeft - seconds)) this.beep(audioNow + secondsLeft - seconds, .08, 620);
    }
    if (secondsLeft <= .03) return false;
    let boundary: CueName | undefined;
    if (projection.clockScope === 'turn') boundary = 'switch';
    else {
      // What the boundary announces: work, rest, or nothing when a manual Ready gate or the end follows.
      const nextIsWork = projection.status === 'preparing' || projection.current.phase !== 'work' || projection.restBeforeNextMs === 0;
      const gateFollows = projection.nextWork !== undefined && projection.nextWork.sectionIndex !== projection.current.sectionIndex && projection.section.transitionAfter === 'manualReady' && (projection.current.phase === 'work' ? projection.restBeforeNextMs === 0 : true);
      const last = projection.nextWork === undefined && projection.current.phase === 'work';
      boundary = last || gateFollows ? undefined : nextIsWork ? 'go' : 'rest';
    }
    if (!clips || !boundary || !this.clip(boundary, audioNow + secondsLeft)) this.beep(audioNow + secondsLeft, .18, 880);
    return true;
  }

  /** A short confirmation when a Done lands; a partial both-done tells the pair who is waiting (device voice only). */
  private acknowledgementCue(projection: Projection, clocks: ClockValues) {
    const acks = `${projection.acks.A}${projection.acks.B}${projection.acks.team}`;
    if (acks === this.lastAcks) return;
    this.lastAcks = acks;
    if (this.mode === 'silent' || projection.status !== 'running') return;
    if (this.context?.state === 'running') this.beep(this.context.currentTime + .01, .06, 740);
    const partial = (projection.acks.A !== projection.acks.B) && !projection.acks.team;
    if (partial) this.cue(projection.acks.A ? 'a-waiting' : 'b-waiting', projection.acks.A ? 'A done. Waiting for B.' : 'B done. Waiting for A.', (this.context?.currentTime ?? 0) + .15);
    // An early EMOM Done previews the next interval while there is time to hear it.
    if (projection.timing === 'interval' && !partial && projection.nextWork?.assignments && clocks.remainingMs > 5000) this.announce(projection.nextWork.assignments, 'Next.', ['next'], (this.context?.currentTime ?? 0) + .2);
  }
}
