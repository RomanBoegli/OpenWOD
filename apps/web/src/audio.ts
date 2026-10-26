import type { ClockValues, Projection } from '../../../packages/engine/src';

export type SoundMode = 'voice' | 'beeps' | 'silent';

/** Disposable audio adapter. Scheduled sound never advances the workout. */
export class WorkoutAudio {
  private context?: AudioContext;
  private sources: OscillatorNode[] = [];
  private token = '';
  private spoken = new Set<string>();
  mode: SoundMode = 'voice';
  voiceURI = '';
  rate = 1;
  volume = .7;
  onError?: (message: string) => void;

  async unlock() {
    if (this.mode === 'silent') return;
    try {
      this.context ??= new AudioContext();
      this.context.onstatechange = () => {
        this.token = '';
        if (this.context?.state !== 'running') this.cancel();
      };
      await this.context.resume();
      // A local oscillator unlocks the output from the user's explicit gesture.
      this.beep(this.context.currentTime, .035, 660, .05);
    } catch { this.onError?.('Sound unavailable. The workout will continue visually.'); }
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
    this.sources.push(source);
    source.onended = () => { source.disconnect(); volume.disconnect(); this.sources = this.sources.filter(item => item !== source); };
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
    const voice = window.speechSynthesis.getVoices().find(item => item.voiceURI === this.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.rate = this.rate;
    utterance.volume = this.volume;
    utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) this.onError?.('Voice unavailable. Local beeps are still enabled.'); };
    window.speechSynthesis.speak(utterance);
  }

  async test() {
    await this.unlock();
    if (this.context && this.mode !== 'silent') this.beep(this.context.currentTime + .1, .15, 880);
    this.speak('Ready to train. A: row. B: kettlebell swings.');
  }

  update(projection: Projection, clocks: ClockValues) {
    const token = `${projection.sessionId}:${projection.occurrenceId}:${projection.status}`;
    if (this.token === token) {
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
      if (projection.status === 'completed' && this.context) this.beep(this.context.currentTime + .01, .35, 1047);
      this.speak(projection.status === 'completed' ? 'Workout complete. Well done.' : 'Workout ended.');
      return;
    }
    if (projection.status === 'paused') { this.speak('Paused.'); return; }
    if (!['running', 'preparing'].includes(projection.status)) return;
    if (wasPaused) this.speak('Resume.');
    if (this.context?.state === 'running') {
      const audioNow = this.context.currentTime;
      const secondsLeft = clocks.remainingMs / 1000;
      // Only schedule cues that are still in the future. Missed numbers are dropped.
      for (const seconds of [3, 2, 1]) if (secondsLeft > seconds + .05) this.beep(audioNow + secondsLeft - seconds, .08, 620);
      if (secondsLeft > .03) this.beep(audioNow + secondsLeft, .18, 880);
    }
    const cueId = `${projection.sessionId}:${projection.occurrenceId}`;
    if (this.spoken.has(cueId)) return;
    this.spoken.add(cueId);
    const assignment = projection.status === 'preparing' ? projection.current.assignments : projection.current.phase !== 'work' ? projection.nextWork?.assignments : undefined;
    if (assignment && clocks.remainingMs > 5000) {
      this.speak(`${projection.status === 'preparing' ? 'Get ready.' : 'Rest.'} A: ${assignment.A.spokenName ?? assignment.A.name}.${assignment.B ? ` B: ${assignment.B.spokenName ?? assignment.B.name}.` : ''}`);
    } else if (projection.status === 'running' && clocks.slotMs < 1000) this.speak(projection.current.phase === 'work' ? 'Go.' : 'Rest.');
  }
}
