import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Chip.module.css';

export type ChipKind = 'pair' | 'solo' | 'format' | 'collection' | 'neutral' | 'done';

/** One chip style for every screen: formats, collections and athletes look the same on cards, overview and player. */
export function Chip({ kind, icon, children, title, pressed, onClick }: { kind: ChipKind; icon?: IconName; children: ReactNode; title?: string; pressed?: boolean; onClick?: () => void }) {
  const content = <>{icon && <Icon name={icon} size={13} />}{children}</>;
  if (onClick) return <button type="button" className={styles.chip} data-kind={kind} aria-pressed={pressed} title={title} onClick={onClick}>{content}</button>;
  return <span className={styles.chip} data-kind={kind} title={title}>{content}</span>;
}

export function AthletesChip({ participants }: { participants: 1 | 2 }) {
  return <Chip kind={participants === 2 ? 'pair' : 'solo'} icon={participants === 2 ? 'users' : 'user'}>{participants === 2 ? 'Pair' : 'Solo'}</Chip>;
}
