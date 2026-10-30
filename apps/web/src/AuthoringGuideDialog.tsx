import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAuthoringGuide } from '../../../packages/domain/src/authoring-guide';
import type { Catalogue } from '../../../packages/domain/src/catalogue';
import { FILE_EXTENSION, publishedSchema, WorkoutFileSchemaV3 } from '../../../packages/domain/src/exchange';
import { downloadBlob } from './download';
import { Icon } from './Icon';
import shared from './App.module.css';
import styles from './AuthoringGuideDialog.module.css';

interface AuthoringGuideDialogProps {
  open: boolean;
  catalogue: Catalogue;
  equipment: string[];
  onClose: () => void;
  /** Hands the pasted reply to the import preview. */
  onPreview: (reply: string) => void;
}

/**
 * SHR-07: the authoring guide to copy into an AI assistant, and a box for its answer. The app contacts no assistant
 * (NFR-11); the guide is built here from the format rules, the effective catalogue and the equipment names.
 */
export function AuthoringGuideDialog({ open, catalogue, equipment, onClose, onPreview }: AuthoringGuideDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const guideText = useRef<HTMLPreElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState('');
  const guide = useMemo(() => open ? buildAuthoringGuide({ movements: catalogue.records, equipment }) : '', [open, catalogue, equipment]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { setCopied(''); element.showModal(); }
    if (!open && element.open) element.close();
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(guide);
      setCopied('Copied. Paste it into your assistant, then describe the workout.');
    } catch {
      // Clipboard access needs a secure page and permission; select the text so a keyboard copy works instead.
      if (details.current) details.current.open = true;
      const selection = window.getSelection();
      if (guideText.current && selection) { const range = document.createRange(); range.selectNodeContents(guideText.current); selection.removeAllRanges(); selection.addRange(range); }
      setCopied('This browser blocked copying. The guide is selected below: press ⌘C or Ctrl+C.');
    }
  }

  return <dialog ref={dialog} className={`${shared.dialog} ${shared.dialogWide}`} aria-labelledby="authoring-title" onClose={onClose}>
    <div className={shared.dialogHeading}><h2 id="authoring-title">Create a WOD with AI</h2><button className={shared.iconButton} aria-label="Close AI guide" onClick={onClose}><Icon name="close" /></button></div>
    {open && <>
      <p className={shared.dialogIntro}>Use the AI assistant you already have, such as ChatGPT, Claude or Gemini. OpenWOD never contacts it: you copy a guide over and paste the answer back.</p>
      <section className={styles.step} aria-labelledby="authoring-copy">
        <h3 id="authoring-copy"><span className={styles.stepNumber}>1</span>Copy the guide</h3>
        <p>It explains the workout file with every option, lists your movement and equipment names, and shows two examples. Paste it into a new chat and add what you want, such as “a 30-minute dumbbell session for two, legs and core”.</p>
        <div className={styles.actions}>
          <button className={shared.primaryButton} onClick={() => void copy()}><Icon name="copy" size={18} />Copy guide</button>
          <button className={shared.quietButton} onClick={() => downloadBlob(new Blob([guide], { type: 'text/markdown' }), 'openwod-guide.md')}><Icon name="download" size={18} />Download guide</button>
          <button className={shared.quietButton} title="For assistants and tools that take a JSON Schema for structured output" onClick={() => downloadBlob(new Blob([publishedSchema(WorkoutFileSchemaV3)], { type: 'application/schema+json' }), 'workout-file.v3.schema.json')}><Icon name="download" size={18} />JSON Schema</button>
        </div>
        <p role="status" className={styles.status}>{copied}</p>
        <details ref={details} className={styles.details}><summary>Show the guide</summary><pre ref={guideText} className={styles.guide} tabIndex={0} aria-label="Authoring guide">{guide}</pre></details>
      </section>
      <section className={styles.step} aria-labelledby="authoring-paste">
        <h3 id="authoring-paste"><span className={styles.stepNumber}>2</span>Paste the answer</h3>
        <p id="authoring-answer-note">Paste the whole reply. OpenWOD picks the workout file out of it and shows a preview before anything is saved. If that doesn’t work, save only the YAML part as a file ending in <code>{FILE_EXTENSION}</code> and open it with Import WOD.</p>
        <label className={styles.answer}>Assistant’s answer
          <textarea value={reply} onChange={event => setReply(event.target.value)} aria-describedby="authoring-answer-note" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        </label>
        <div className={shared.dialogActions}><button className={shared.primaryButton} disabled={!reply.trim()} onClick={() => onPreview(reply)}>Preview</button></div>
      </section>
    </>}
  </dialog>;
}
