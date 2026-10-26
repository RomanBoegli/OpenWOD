import type { CSSProperties, ReactNode } from 'react';
import styles from './MasterList.module.css';

export interface MasterColumn { key: string; caption: string; width?: string; align?: 'start' | 'end' }
export interface MasterRow {
  id: string;
  cells: Record<string, ReactNode>;
  /** A variant shown under its family head. */
  indent?: boolean;
  /** Shown for context only (a family head whose variant matched the search). */
  muted?: boolean;
  select?: { checked: boolean; label: string; onChange: (checked: boolean) => void };
  actions?: ReactNode;
}

/**
 * The one list every master-data page uses: a caption row, dense rows in a grid, an optional selection column for
 * merges, and a right-aligned action cell. Rows stay `li` elements so the list keeps its accessible name.
 */
export function MasterList({ label, columns, rows, selectable, empty, actionsWidth = '120px' }: { label: string; columns: MasterColumn[]; rows: MasterRow[]; selectable?: boolean; empty: ReactNode; /** Width of the action cell, the same in the caption row and every row so the columns line up. */ actionsWidth?: string }) {
  const style = {
    '--columns': [selectable ? '28px' : '', ...columns.map(column => column.width ?? 'minmax(0, 1fr)'), actionsWidth].filter(Boolean).join(' '),
    '--narrow-columns': `${selectable ? '28px' : '0'} minmax(0, 1fr) auto`,
  } as CSSProperties;
  return <div className={styles.list} style={style}>
    <div className={styles.head} aria-hidden="true">{selectable && <span />}{columns.map(column => <span key={column.key} data-align={column.align}>{column.caption}</span>)}<span /></div>
    <ul aria-label={label}>
      {rows.map(row => <li key={row.id} data-indent={row.indent || undefined} data-muted={row.muted || undefined}>
        {selectable && <span className={styles.select}>{row.select && <input type="checkbox" checked={row.select.checked} aria-label={row.select.label} onChange={event => row.select?.onChange(event.target.checked)} />}</span>}
        {columns.map(column => <span key={column.key} className={styles.cell} data-align={column.align} data-caption={column.caption}>{row.cells[column.key]}</span>)}
        <span className={styles.actions}>{row.actions}</span>
      </li>)}
      {rows.length === 0 && <li className={styles.empty}>{empty}</li>}
    </ul>
  </div>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'accent' }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}
