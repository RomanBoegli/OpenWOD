import { useRef, useState } from 'react';
import { MAX_RESTORE_BYTES, parseExportDocument, summariseExport } from '../../../../packages/household/src/export';
import type { ExportSummary, RestoreReport } from '../../../../packages/household/src/types';
import { ConfirmDialog } from '../ConfirmDialog';
import { STATIC_SESSION_LIMIT } from '../data/local-backend';
import type { DataMode } from '../data/mode';
import { Icon } from '../Icon';
import shared from '../App.module.css';
import { plural } from './shared';

export interface RestoreMessage { text: string; tone: 'status' | 'alert' }
interface RestoreProps {
  mode: DataMode;
  disabled?: boolean;
  onRestore: (document: unknown) => Promise<RestoreReport & { backup?: string }>;
  /** The outcome (or why the file was refused), for the card to show under its actions. */
  onMessage: (message: RestoreMessage | undefined) => void;
}

const when = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
const sentence = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
/** "3 saved workouts, 1 archived workout, 12 sessions and 2 score corrections", leaving out what is zero except workouts and sessions. */
const contents = (summary: ExportSummary) => sentence([
  plural(summary.workouts, 'saved workout'),
  summary.archived ? plural(summary.archived, 'archived workout') : '',
  plural(summary.sessions, 'session'),
  summary.corrections ? plural(summary.corrections, 'score correction') : '',
].filter(Boolean));
const MEGABYTES = MAX_RESTORE_BYTES / 1_048_576;

/**
 * Restore from backup (DAT-12), for both shapes: picks a JSON export, checks it here exactly as the backend will
 * (format, version, every workout and snapshot), shows what it holds and when it was written, and only replaces the
 * library after an explicit confirmation.
 */
export function RestoreFromBackup({ mode, disabled, onRestore, onMessage }: RestoreProps) {
  const input = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<{ value: unknown; summary: ExportSummary; name: string }>();
  const [busy, setBusy] = useState(false);
  const refuse = (text: string) => onMessage({ text, tone: 'alert' });

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    onMessage(undefined);
    if (file.size > MAX_RESTORE_BYTES) { refuse(`“${file.name}” is larger than ${MEGABYTES} MB, more than any OpenWOD backup.`); return; }
    let value: unknown;
    try { value = JSON.parse(await file.text()); } catch { refuse(`“${file.name}” is not a JSON file, so it is not an OpenWOD backup.`); return; }
    try {
      setCandidate({ value, summary: summariseExport(parseExportDocument(value)), name: file.name });
    } catch (error) {
      const { message, path, code } = error as { message?: string; path?: string; code?: string };
      refuse(`“${file.name}” cannot be restored. ${message ?? String(error)}${code === 'VALIDATION_FAILED' && path && path !== '/' ? ` (at ${path})` : ''}`);
    }
  };

  const confirm = async () => {
    if (!candidate) return;
    const { value } = candidate;
    setCandidate(undefined);
    setBusy(true);
    onMessage({ text: 'Restoring the backup…', tone: 'status' });
    try {
      const report = await onRestore(value);
      const pruned = report.pruned ? ` The oldest ${plural(report.pruned, 'session')} did not fit: this browser keeps the newest ${STATIC_SESSION_LIMIT}.` : '';
      const backup = report.backup ? ` The library as it was before is saved as ${report.backup} under /data/backups.` : '';
      onMessage({ text: `Restored ${contents(report)} from the backup of ${when(report.exportedAt)}.${pruned}${backup}`, tone: 'status' });
    } catch (error) {
      onMessage({ text: `The backup was not restored, the library is unchanged. ${error instanceof Error ? error.message : String(error)}`, tone: 'alert' });
    } finally { setBusy(false); }
  };

  const summary = candidate?.summary;
  const overLimit = mode === 'static' && summary ? summary.sessions - STATIC_SESSION_LIMIT : 0;
  return <>
    <button type="button" className={shared.quietButton} disabled={disabled || busy} onClick={() => input.current?.click()}><Icon name="upload" size={15} />{busy ? 'Restoring…' : 'Restore from backup'}</button>
    <input ref={input} hidden type="file" accept=".json,application/json" aria-label="Backup file" onChange={event => void pick(event.target.files?.[0])} />
    <ConfirmDialog open={Boolean(candidate)} title="Replace the library with this backup?" confirmLabel="Replace library" onClose={() => setCandidate(undefined)} onConfirm={() => void confirm()}>
      {summary && <>
        <p>“{candidate.name}” was written on {when(summary.exportedAt)}. It holds {contents(summary)}, plus the movements, equipment and collections of that moment.</p>
        <p>{mode === 'server'
          ? 'Restoring replaces the household’s library on the server for every device, and changes still waiting on this device are dropped. A copy of the current database is kept under /data/backups first.'
          : 'Restoring replaces this browser’s library: every workout and session saved here now is replaced by the backup.'}{overLimit > 0 ? ` This browser keeps the newest ${STATIC_SESSION_LIMIT} sessions, so the oldest ${overLimit} are left out.` : ''}</p>
      </>}
    </ConfirmDialog>
  </>;
}
