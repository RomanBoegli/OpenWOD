import { useEffect, useRef, type ReactNode } from 'react';
import styles from '../App.module.css';

interface FormDialogProps { open: boolean; title: string; children: ReactNode; submitLabel: string; cancelLabel?: string; disabled?: boolean; wide?: boolean; onSubmit: () => void; onClose: () => void }

/** A modal form: Enter submits, Escape cancels, the first field is focused on open. Create and Edit share one of these per page. */
export function FormDialog({ open, title, children, submitLabel, cancelLabel = 'Cancel', disabled, wide, onSubmit, onClose }: FormDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useRef(`form-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { element.showModal(); element.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus(); }
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className={`${styles.dialog} ${wide ? styles.dialogWide : ''}`} aria-labelledby={id.current} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (!disabled) onSubmit(); }}>
      <h2 id={id.current}>{title}</h2>
      {children}
      <div className={styles.dialogActions}><button type="button" className={styles.quietButton} onClick={onClose}>{cancelLabel}</button><button type="submit" className={styles.primaryButton} disabled={disabled}>{submitLabel}</button></div>
    </form>
  </dialog>;
}
