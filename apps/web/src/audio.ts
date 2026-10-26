import type { ClockValues, Projection } from '../../../packages/engine/src';

export type SoundMode = 'voice' | 'beeps' | 'silent';
export type CueSource = 'clips' | 'device';
export type CueName = 'get-ready' | 'go' | 'rest' | 'switch' | 'three' | 'two' | 'one' | 'paused' | 'resume' | 'complete';
export const CUE_NAMES: CueName[] = ['get-ready', 'go', 'rest', 'switch', 'three', 'two', 'one', 'paused', 'resume', 'complete'];
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
  voiceURI = '';
  rate = 1;
  volume = .7;
  /** Base URL for the pre-rendered cue clips. */
  clipBase = '/cues/';
  onError?: (message: string) => void;
  /** Reports whether every clip decoded, once preloading finishes. */
  onClips?: (ready: boolean) => void;

  private ensureContext() {
    this.context ??= new AudioContext();
    this.context.onstatechange = () => {
      this.token = '';
      if (this.context?.state !== 'running') this.cancel();
    };
    return this.context;
  }

  /** Fetches and decodes every clip once so a session never needs the network after Play (ENG-11). Failure is silent: beeps and device speech remain. */
  preload(): Promise<void> {
    this.preloading ??= (async () => {
      if (typeof fetch !== 'function') return;
      let context: AudioContext;
      try { context = this.ensureContext(); } catch { return; }
      await Promise.all(CUE_NAMES.map(async name => {
        try {
          const response = await fetch(`${this.clipBase}${name}.mp3`);
          if (!response.ok) return;
          this.clips.set(name, await context.decodeAudioData(await response.arrayBuffer()));
        } catch { /* Missing or undecodable clip: this cue falls back to beeps and device speech. */ }
      }));
      this.onClips?.(this.clipsReady);
    })();
    return this.preloading;
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

  /** Plays a pre-rendered clip at an exact AudioContext time. Returns false when the clip is unavailable. */
  private clip(name: CueName, at: number): boolean {
    const buffer = this.clips.get(name);
    if (!buffer || !this.context || this.context.state !== 'running') return false;
    const source = this.context.createBufferSource();
    const volume = this.context.createGain();
    source.buffer = buffer;
    volume.gain.value = this.volume;
    source.connect(volume).connect(this.context.destination);
    source.start(at);
    this.track(source, volume);
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
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(item => item.voiceURI === this.voiceURI) ?? pickDefaultVoice(voices);
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

  private static assignmentText(assignment: NonNullable<Projection['current']['assignments']>): string {
    const name = (lane: { name: string; spokenName?: string }) => lane.spokenName ?? lane.name;
    return assignment.B ? `A, ${name(assignment.A)}. B, ${name(assignment.B)}.` : `${name(assignment.A)}.`;
  }

  async test() {
    await this.unlock();
    await this.preload();
    if (this.context && this.mode !== 'silent') this.beep(this.context.currentTime + .1, .15, 880);
    if (this.useClips && this.clipsReady) { this.clip('get-ready', this.context!.currentTime + .4); this.speak('A, row. B, kettlebell swings.'); return; }
    this.speak('Ready to train. A, row. B, kettlebell swings.');
  }

  update(projection: Projection, clocks: ClockValues) {
    const token = `${projection.sessionId}:${projection.occurrenceId}:${projection.status}`;
    if (this.token === token) {
      // Device-voice countdown is spoken late, as each second arrives; clips were scheduled ahead at the token change.
      if (this.useClips && this.clipsReady) return;
      const count = Math.ceil(clocks.remainingMs / 1000);
      const cue = `${token}:countdown:${count}`;
      if (this.mode === 'voice' && ['running', 'preparing'].includes(projection.status) && count >= 1 && count <= 3 && !this.spoken.has(cue)) {
        this.spoken.add(cue);
        this.speak(String(count));
      }
      return;
    }
    const wasPaused = this.token.endsWith(':paused');
    this.cancel();
    this.token = token;
    if (this.mode === 'silent') return;
    const terminal = ['completed', 'aborted'].includes(projection.status);
    if (terminal) {
      if (projection.status === 'completed') {
        if (this.context) this.beep(this.context.currentTime + .01, .35, 1047);
        this.cue('complete', 'Workout complete. Well done.', (this.context?.currentTime ?? 0) + .4);
      } else this.speak('Workout ended.');
      return;
    }
    if (projection.status === 'paused') { this.cue('paused', 'Paused.'); return; }
    if (!['running', 'preparing'].includes(projection.status)) return;
    if (wasPaused) this.cue('resume', 'Resume.');
    const clips = this.useClips && this.clipsReady;
    if (this.context?.state === 'running') {
      const audioNow = this.context.currentTime;
      const secondsLeft = clocks.remainingMs / 1000;
      // Only schedule cues that are still in the future. Missed numbers are dropped (AUD-06).
      for (const seconds of [3, 2, 1] as const) if (secondsLeft > seconds + .05) {
        if (!clips || !this.clip(COUNTDOWN[seconds], audioNow + secondsLeft - seconds)) this.beep(audioNow + secondsLeft - seconds, .08, 620);
      }
      if (secondsLeft > .03) {
        // What the boundary announces: work, rest, or nothing when a manual Ready gate follows.
        const nextIsWork = projection.status === 'preparing' || projection.current.phase !== 'work' || projection.restBeforeNextMs === 0;
        const gateFollows = projection.nextWork !== undefined && projection.nextWork.sectionIndex !== projection.current.sectionIndex && projection.section.transitionAfter === 'manualReady' && (projection.current.phase === 'work' ? projection.restBeforeNextMs === 0 : true);
        const last = projection.nextWork === undefined && projection.current.phase === 'work';
        const boundary: CueName | undefined = last || gateFollows ? undefined : nextIsWork ? 'go' : 'rest';
        if (!clips || !boundary || !this.clip(boundary, audioNow + secondsLeft)) this.beep(audioNow + secondsLeft, .18, 880);
      }
    }
    const cueId = `${projection.sessionId}:${projection.occurrenceId}`;
    if (this.spoken.has(cueId)) return;
    this.spoken.add(cueId);
    const assignment = projection.status === 'preparing' ? projection.current.assignments : projection.current.phase !== 'work' ? projection.nextWork?.assignments : undefined;
    if (assignment && clocks.remainingMs > 5000) {
      const lead = projection.status === 'preparing' ? 'get-ready' : 'rest';
      if (clips && this.clip(lead, this.context!.currentTime)) this.speak(WorkoutAudio.assignmentText(assignment));
      else this.speak(`${lead === 'get-ready' ? 'Get ready.' : 'Rest.'} ${WorkoutAudio.assignmentText(assignment)}`);
    } else if (projection.status === 'running' && clocks.slotMs < 1000 && !clips) this.speak(projection.current.phase === 'work' ? 'Go.' : 'Rest.');
  }
}
