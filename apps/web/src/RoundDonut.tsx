import type { Ref } from 'react';
import type { RoundProgress } from '../../../packages/domain/src/outline';
import styles from './RoundDonut.module.css';

/** What the donut shows: the round position (see roundProgress), how many movements of the round are done, and whether the next one is under way. */
export interface RoundView extends RoundProgress { done: number; active: boolean }

const GAP = .04;
/** A rounded rectangle, wider than tall so "15/24" fits inside, drawn clockwise from the top centre (where the round starts). */
const OUTLINE = 'M30 4 H44 A12 12 0 0 1 56 16 V26 A12 12 0 0 1 44 38 H16 A12 12 0 0 1 4 26 V16 A12 12 0 0 1 16 4 Z';

/**
 * The round donut (UI-24), beside the big clock: one ring segment per movement of the round, filled as the round goes
 * on, and a dot per round of the block, the rounds left still empty. The segment under way fills with the slot clock
 * through `fill`, which the player writes per frame (UI-15); manual work pulses instead, because the clock does not know its end.
 */
export function RoundDonut({ view, timed, fill }: { view: RoundView; timed: boolean; fill?: Ref<SVGPathElement> }) {
  const { position, size, round, rounds, done, active } = view;
  const roundDone = done >= size;
  const left = rounds - round;
  const segment = 1 / size;
  const gap = size > 1 ? Math.min(GAP, segment / 4) : 0;
  const length = segment - gap;
  const arc = (index: number, part = length) => ({ strokeDasharray: `${part} ${1 - part}`, strokeDashoffset: -(index * segment + gap / 2) });
  const label = `Movement ${position} of ${size}, round ${round} of ${rounds}, ${left} ${left === 1 ? 'round' : 'rounds'} left`;
  return <div className={styles.progress} role="img" aria-label={label} data-testid="round-donut">
    <span className={styles.stack}>
    <svg className={styles.donut} viewBox="0 0 60 42" aria-hidden="true">
      {Array.from({ length: size }, (_, index) => <path key={index} className={styles.segment} data-state={index < done ? 'done' : 'open'} d={OUTLINE} pathLength={1} style={arc(index)} />)}
      {active && !roundDone && <path key={`${round}:${done}`} ref={fill} className={styles.fill} data-timed={timed} data-length={length} d={OUTLINE} pathLength={1} style={arc(done, timed ? 0 : length)} />}
      <text x="30" y="21" className={styles.count}>{roundDone ? '✓' : `${position}/${size}`}</text>
    </svg>
    {rounds > 1 && rounds <= 12 && <span className={styles.dots}>{Array.from({ length: rounds }, (_, index) => <span key={index} className={styles.dot} data-state={index < round - 1 || (index === round - 1 && roundDone) ? 'done' : index === round - 1 ? 'current' : 'open'} />)}</span>}
    {rounds > 12 && <span className={styles.roundText}>{round} / {rounds}</span>}
    </span>
  </div>;
}
