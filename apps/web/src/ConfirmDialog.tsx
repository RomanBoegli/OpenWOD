import { useEffect, useRef, type ReactNode } from 'react';
import styles from './App.module.css';

interface ConfirmDialogProps { open: boolean; title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onClose: () => void }

/** A native modal dialog with one confirming and one dismissing action. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, onClose }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useRef(`confirm-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={id.current} onClose={onClose}>
    <h2 id={id.current}>{title}</h2>
    {children}
    <div className={styles.dialogActions}><button className={styles.quietButton} onClick={onClose}>{cancelLabel}</button><button className={styles.primaryButton} onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
