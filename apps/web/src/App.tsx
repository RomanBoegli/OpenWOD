import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { canonicalJson, parseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import { fixtureWorkouts, prescriptionText } from '../../../packages/domain/src/fixtures';
import { displayTime, warningLevel, type ClockValues } from '../../../packages/engine/src';
import { useWorkout } from './use-workout';
import type { SoundMode } from './audio';
import styles from './App.module.css';

type IconName = 'play' | 'pause' | 'sound' | 'settings' | 'next' | 'previous' | 'arrow' | 'check' | 'close' | 'download' | 'upload' | 'clock' | 'users' | 'list' | 'focus';
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    play: <path d="m9 5 11 7-11 7z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    sound: <><path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
    next: <><path d="m5 5 10 7-10 7zM19 5v14" /></>,
    previous: <><path d="m19 5-10 7 10 7zM5 5v14" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" /></>,
    focus: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Perimeter({ progress }: { progress: RefObject<SVGPathElement | null> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = size;
  const d = `M${w / 2} 4H${w - 25}Q${w - 4} 4 ${w - 4} 25V${h - 25}Q${w - 4} ${h - 4} ${w - 25} ${h - 4}H25Q4 ${h - 4} 4 ${h - 25}V25Q4 4 25 4H${w / 2}`;
  return <svg className={styles.perimeter} ref={svg} aria-hidden="true"><path className={styles.borderTrack} d={d} /><path ref={progress} className={styles.borderProgress} pathLength="1" strokeDasharray="1 1" d={d} /></svg>;
}

export default function App() {
  const [workout, setWorkout] = useState<Workout>(fixtureWorkouts[0]);
  const [soundMode, setSoundMode] = useState<SoundMode>('voice');
  const [view, setView] = useState<'focus' | 'context'>('focus');
  const [names, setNames] = useState({ A: 'Athlete A', B: 'Athlete B' });
  const [menu, setMenu] = useState(false);
  const [imported, setImported] = useState<Workout>();
  const [importError, setImportError] = useState('');
  const [following, setFollowing] = useState(true);
  const settings = useRef<HTMLDialogElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const stopDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const border = useRef<SVGPathElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const { engine, plan, projection, send, subscribeClock, audio, soundError, wakeStatus } = useWorkout(workout, soundMode);
  const { status, current, nextWork, section } = projection;
  const isPrep = status === 'preparing' || (status === 'paused' && projection.occurrenceId === 'prep');
  const isRest = current.phase !== 'work' && !isPrep;
  const terminal = status === 'completed' || status === 'aborted';
  const editable = status === 'ready' || terminal;
  const active = ['running', 'preparing'].includes(status);
  const showing = isRest ? nextWork?.assignments : current.assignments;
  const round = (isRest ? nextWork : current)?.rounds.at(-1) ?? current.rounds.at(-1);
  const totalRounds = round?.count ?? 1;
  const roundNumber = round?.iteration ?? 1;
  const sectionOccurrences = plan.occurrences.filter(item => item.sectionIndex === current.sectionIndex && item.phase === 'work');
  const contextRows = [...new Map(sectionOccurrences.map(item => [item.anchor, sectionOccurrences.find(candidate => candidate.anchor === item.anchor && (candidate.rounds.at(-1)?.iteration ?? 1) === roundNumber) ?? item])).values()];
  const currentWorkNumber = contextRows.findIndex(item => item.anchor === (isRest ? nextWork?.anchor : current.anchor)) + 1;

  useEffect(() => subscribeClock((clocks: ClockValues) => {
    if (timer.current) {
      const text = status === 'ready' ? displayTime(workout.prepMs || current.durationMs) : terminal ? displayTime(clocks.activeMs) : status === 'awaitingReady' ? displayTime(current.durationMs) : displayTime(clocks.remainingMs);
      if (timer.current.textContent !== text) timer.current.textContent = text;
    }
    if (elapsed.current) elapsed.current.textContent = displayTime(clocks.activeMs, 'floor');
    if (border.current) border.current.style.strokeDashoffset = String(-(1 - (status === 'ready' || status === 'awaitingReady' ? 1 : clocks.fraction)));
    if (player.current) player.current.dataset.warning = warningLevel(clocks.remainingMs, clocks.durationMs);
  }), [subscribeClock, status, terminal, workout.prepMs, current.durationMs]);

  useEffect(() => {
    if (following && view === 'context' && activeRow.current && context.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      context.current.scrollTo({ top: Math.max(0, activeRow.current.offsetTop - context.current.offsetTop - 80), behavior: reduced ? 'instant' : 'smooth' });
    }
  }, [projection.occurrenceId, following, view]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  function reset() { audio.cancel(); setWorkout(structuredClone(workout)); }
  function exportWorkout() {
    const blob = new Blob([canonicalJson({ format: 'wodva.workout', formatVersion: 1, workout })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workout.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workout'}.wod.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_048_576) throw new Error('Choose a workout file smaller than 1 MB.');
      const parsed = parseWorkoutFile(await file.text());
      compileWorkout(parsed);
      setImported(parsed); setImportError('');
    } catch (error) { setImported(undefined); setImportError(error instanceof Error ? error.message : 'This file could not be read.'); }
    importDialog.current?.showModal();
    if (fileInput.current) fileInput.current.value = '';
  }

  const phaseLabel = status === 'ready' ? 'Ready when you are' : status === 'paused' ? projection.pauseReason === 'hidden' ? 'Paused · app was hidden' : 'Workout paused' : status === 'awaitingReady' ? 'Next section · ready?' : status === 'completed' ? 'Workout complete' : status === 'aborted' ? 'Workout ended' : isPrep ? 'Get ready' : isRest ? current.phase === 'roundRest' ? 'Round rest' : current.phase === 'transition' ? 'Transition' : 'Block rest' : 'Work';
  const playerPhase = terminal ? 'complete' : status === 'paused' ? 'paused' : isRest ? 'rest' : isPrep || status === 'ready' ? 'prep' : 'work';

  return <div className={styles.app} data-performing={!editable} data-view={view}>
    <header className={styles.header}>
      <a href="/" className={styles.brand} aria-label="Wodva home"><span className={styles.brandMark}><svg viewBox="0 0 30 30" aria-hidden="true"><path d="m4 8 5 15 6-10 6 10 5-15" /></svg></span>wodva<span className={styles.brandDot}>.</span></a>
      <span className={styles.headerNote}>A little stronger, together.</span>
      <div className={styles.headerActions}>
        <button className={styles.quietButton} onClick={() => void audio.test()} disabled={soundMode === 'silent'}><Icon name="sound" /><span>Test sound</span></button>
        <button className={styles.iconButton} aria-label="Player settings" onClick={() => settings.current?.showModal()}><Icon name="settings" /></button>
      </div>
    </header>

    <main className={styles.main}>
      <div className={styles.workoutHeading}>
        <div>
          <div className={styles.eyebrow}>YOUR TRAINING SPACE <span>/</span> {workout.participants === 2 ? 'PARTNER SESSION' : 'SOLO SESSION'}</div>
          <div className={styles.titleRow}><h1>{workout.title}</h1><div className={styles.workoutPicker}>
            <button className={styles.iconButton} aria-label="Choose workout" aria-expanded={menu} disabled={!editable} onClick={() => setMenu(value => !value)}><span aria-hidden="true">⌄</span></button>
            {menu && <div className={styles.pickerMenu}>{fixtureWorkouts.map(item => <button key={item.id} onClick={() => { setWorkout(item); setMenu(false); }}>{item.title}<small>{displayTime(compileWorkout(item).durationMs)} active</small></button>)}</div>}
          </div></div>
          <p className={styles.description}>{workout.description}</p>
          <div className={styles.metadata}><span><Icon name="clock" size={16} />{displayTime(plan.durationMs + workout.prepMs)} incl. prep</span><span><Icon name="users" size={16} />{workout.participants === 2 ? '2 athletes' : 'Solo'}</span><span className={styles.equipment}>{workout.equipment.join(' + ')}</span></div>
        </div>
        <div className={styles.viewSwitch} aria-label="Player view"><button aria-pressed={view === 'focus'} onClick={() => setView('focus')}><Icon name="focus" size={17} />Focus</button><button aria-pressed={view === 'context'} onClick={() => setView('context')}><Icon name="list" size={17} />Context</button></div>
      </div>

      <div className={styles.player} ref={player} data-phase={playerPhase} data-warning="normal">
        <Perimeter progress={border} />
        <div className={styles.playerTop}><span><span className={styles.liveDot} />{section.title}</span><span>{round ? `ROUND ${roundNumber} / ${totalRounds}` : `SECTION ${current.sectionIndex + 1} / ${plan.sections.length}`}{!editable && <button className={styles.iconButton} aria-label={view === 'focus' ? 'Switch to context view' : 'Switch to focus view'} onClick={() => setView(value => value === 'focus' ? 'context' : 'focus')}><Icon name={view === 'focus' ? 'list' : 'focus'} size={18} /></button>}</span></div>
        <div className={styles.clockBlock}>
          <div className={styles.phase} role="status" aria-live="polite">{phaseLabel}</div>
          <div ref={timer} className={styles.timer} data-testid="primary-timer" aria-label="Primary timer">{displayTime(workout.prepMs)}</div>
          <div className={styles.clockCaption}>{terminal ? 'ACTIVE SESSION TIME' : status === 'ready' || isPrep ? 'PREP COUNTDOWN' : status === 'awaitingReady' ? 'FIRST WORK INTERVAL' : isRest ? 'REST REMAINING' : 'WORK REMAINING'}</div>
        </div>

        {terminal ? <div className={styles.finishMessage}><span className={styles.finishIcon}><Icon name="check" size={28} /></span><h2>{status === 'completed' ? 'That’s a good session.' : 'Every bit of movement counts.'}</h2><p>{status === 'completed' ? 'Take a breath. Grab some water. You earned it.' : 'Your session has ended.'}</p></div> : <>
          <div className={styles.laneHeading}>{isRest ? 'COMING UP AFTER REST' : status === 'awaitingReady' ? 'YOUR NEXT SECTION' : 'YOUR STATIONS'}<span>{currentWorkNumber > 0 ? `${currentWorkNumber} OF ${contextRows.length}` : ''}</span></div>
          <div className={styles.lanes} style={{ '--lane-count': workout.participants } as CSSProperties}>
            {(['A', 'B'] as const).filter(role => role === 'A' || workout.participants === 2).map(role => <section className={styles.lane} data-athlete={role} key={role} aria-label={`Athlete ${role} station`}>
              <div className={styles.athleteLabel}><span className={styles.athleteBadge}>{role}</span><span>{names[role]}<small>{role === 'A' ? 'LEFT LANE' : 'RIGHT LANE'}</small></span><span className={styles.laneTime}>{Math.round((isRest ? nextWork?.durationMs ?? 0 : current.durationMs) / 1000)}s</span></div>
              <h2 data-testid={`movement-${role}`}>{showing?.[role]?.shortName ?? showing?.[role]?.name ?? 'All done'}</h2>
              <p>{showing?.[role] ? prescriptionText(showing[role]) : 'You’re at the finish.'}</p>
            </section>)}
          </div>
          <div className={styles.nextStrip}><span className={styles.nextLabel}>UP NEXT <Icon name="arrow" size={16} /></span><span>{nextWork ? `${nextWork.sectionIndex !== current.sectionIndex && section.transitionAfter === 'manualReady' ? 'Ready for next section, then ' : ''}${!isRest && projection.restBeforeNextMs ? `${displayTime(projection.restBeforeNextMs)} rest, then ` : ''}${nextWork.assignments?.A.name}${nextWork.assignments?.B ? ` / ${nextWork.assignments.B.name}` : ''}` : 'Finished · time to recover'}</span></div>
        </>}

        {view === 'context' && <section className={styles.contextSection} aria-label="Workout context">
          <div className={styles.contextHeading}><div><span className={styles.eyebrow}>THE GAME PLAN</span><h2>{section.title}</h2></div><button className={styles.quietButton} aria-pressed={following} onClick={() => setFollowing(value => !value)}><Icon name="focus" size={17} />{following ? 'Following workout' : 'Follow workout'}</button></div>
          <div className={styles.contextList} ref={context} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
            <div className={styles.contextColumns}><span>#</span><span>A · {names.A}</span><span>B · {names.B}</span><span>WORK</span></div>
            {contextRows.map((item, index) => {
              const selected = item.anchor === (isRest ? nextWork?.anchor : current.anchor);
              return <div key={item.anchor} ref={selected ? activeRow : undefined} className={styles.contextRow} data-active={selected} aria-current={selected ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.assignments?.A.name}</span><span>{item.assignments?.B?.name ?? '—'}</span><span>{Math.round(item.durationMs / 1000)}s</span></div>;
            })}
          </div>
          <div className={styles.contextFootnote}>Assignments follow the current round. Authored rests are included in the total.</div>
        </section>}

        <div className={styles.controls}>
          <div className={styles.secondaryControls}>
            <button className={styles.iconButton} aria-label="Previous interval" disabled={!['running', 'paused'].includes(status) || isPrep || projection.index === section.startIndex} onClick={() => send('previous', projection.occurrenceId)}><Icon name="previous" /></button>
            <button className={styles.iconButton} aria-label="Next interval" disabled={!['running', 'paused'].includes(status) || isPrep || projection.index === section.endIndex} onClick={() => send('next', projection.occurrenceId)}><Icon name="next" /></button>
          </div>
          {terminal ? <button className={styles.primaryButton} onClick={reset}><Icon name="play" />Train again</button> : <button className={styles.primaryButton} onClick={() => send(status === 'ready' ? 'play' : status === 'paused' ? 'resume' : status === 'awaitingReady' ? 'ready' : 'pause', projection.occurrenceId)}><Icon name={active ? 'pause' : 'play'} />{status === 'ready' ? 'Start workout' : status === 'paused' ? 'Resume workout' : status === 'awaitingReady' ? 'Start next section' : 'Pause workout'}</button>}
          <button className={styles.stopButton} disabled={editable} onClick={() => stopDialog.current?.showModal()}>End session</button>
        </div>
        {soundError && <p className={styles.notice} role="status">{soundError}</p>}
        <div className={styles.sessionLine}><span>ELAPSED <span ref={elapsed}>00:00</span>{projection.modified && <span className={styles.modified}> · MODIFIED</span>}</span><span>{status === 'ready' ? workout.prepMs ? `${Math.round(workout.prepMs / 1000)}-second prep. Find your rhythm.` : 'Start when you’re ready.' : isRest ? 'Breathe. Your next stations are above.' : 'Your pace. Keep moving.'}</span></div>
      </div>

      <div className={styles.bottomBar}><div className={styles.readiness}><span className={styles.smallDot} /><span>{soundMode === 'silent' ? 'Silent mode' : soundMode === 'voice' ? 'Voice + beeps' : 'Beeps only'}</span><span className={styles.readinessDivider}>·</span><span>{wakeStatus}</span></div><div className={styles.sharing}><button className={styles.quietButton} onClick={exportWorkout}><Icon name="download" size={17} />Export WOD</button><button className={styles.quietButton} disabled={!editable} onClick={() => fileInput.current?.click()}><Icon name="upload" size={17} />Import WOD</button><input ref={fileInput} hidden type="file" accept=".json,.wod.json,application/json" onChange={event => void importFile(event.target.files?.[0])} /></div></div>
      <footer className={styles.footer}><span>BUILT FOR YOUR EVERYDAY STRONG.</span><span>Player preview · workouts run locally · <a href="/LICENSE" target="_blank" rel="noreferrer">GPLv3</a></span></footer>
    </main>

    <dialog ref={settings} className={styles.dialog} aria-labelledby="settings-title"><div className={styles.dialogHeading}><h2 id="settings-title">Make it yours</h2><button className={styles.iconButton} aria-label="Close settings" onClick={() => settings.current?.close()}><Icon name="close" /></button></div><p className={styles.dialogIntro}>A few things to set before you get moving.</p>
      <div className={styles.nameFields}>{(['A', 'B'] as const).map(role => <label key={role}>Athlete {role}<input maxLength={30} value={names[role]} onChange={event => setNames(value => ({ ...value, [role]: event.target.value }))} /></label>)}</div>
      <label>Sound<select value={soundMode} onChange={event => setSoundMode(event.target.value as SoundMode)}><option value="voice">Voice + beeps</option><option value="beeps">Beeps only</option><option value="silent">Silent</option></select></label>
      <label>Voice<select defaultValue="" onChange={event => { audio.voiceURI = event.target.value; }}><option value="">Device default</option>{voices.map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
      <label>Speech speed<input type="range" min="0.7" max="1.3" step="0.1" defaultValue="1" onChange={event => { audio.rate = Number(event.target.value); }} /></label>
      <label>Volume<input type="range" min="0" max="1" step="0.1" defaultValue="0.7" onChange={event => { audio.volume = Number(event.target.value); }} /></label>
      <p className={styles.dialogIntro}>Switching tabs pauses your workout. Keep this window visible while training. {wakeStatus}.</p>
      <button className={styles.primaryButton} onClick={() => void audio.test()} disabled={soundMode === 'silent'}><Icon name="sound" />Test sound</button>
    </dialog>

    <dialog ref={importDialog} className={styles.dialog} aria-labelledby="import-title"><div className={styles.dialogHeading}><h2 id="import-title">Preview your WOD</h2><button className={styles.iconButton} aria-label="Close import preview" onClick={() => importDialog.current?.close()}><Icon name="close" /></button></div>
      {importError ? <p role="alert" className={styles.importError}>{importError}</p> : imported && <><h3>{imported.title}</h3><p>{imported.description}</p><p>{displayTime(compileWorkout(imported).durationMs)} active · {imported.participants} athletes · {imported.sections.length} sections</p><p>{imported.equipment.join(' + ')}</p><p className={styles.dialogIntro}>This preview loads the workout for this visit. A saved library comes next.</p><button className={styles.primaryButton} onClick={() => { setWorkout(imported); importDialog.current?.close(); }}>Load workout<Icon name="arrow" /></button></>}
    </dialog>

    <dialog ref={stopDialog} className={styles.dialog} aria-labelledby="stop-title"><h2 id="stop-title">End this session?</h2><p>The timer will stop. You can start a new session whenever you’re ready.</p><div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => stopDialog.current?.close()}>Keep training</button><button className={styles.primaryButton} onClick={() => { send('stop', engine.occurrenceId); stopDialog.current?.close(); }}>End session</button></div></dialog>
  </div>;
}
