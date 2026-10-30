import { useEffect, useRef } from 'react';
import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './router';
import styles from './Settings.module.css';
import shared from './App.module.css';
import type { SettingsProps } from './settings/shared';
import { GeneralSettings } from './settings/GeneralSettings';
import { TrainingSettings } from './settings/TrainingSettings';
import { EquipmentSettings } from './settings/EquipmentSettings';
import { MovementSettings } from './settings/MovementSettings';
import { AuthorSettings } from './settings/AuthorSettings';
import { CollectionSettings } from './settings/CollectionSettings';
import { Logbook } from './History';

const SECTION_LABELS: Record<SettingsSection, { title: string; blurb: string }> = {
  general: { title: 'General', blurb: 'Theme, the player’s look, and who trains here.' },
  player: { title: 'Training view', blurb: 'Units, the look of the timer, and the sound.' },
  equipment: { title: 'Equipment', blurb: 'What you own, and one spelling per item across the library.' },
  movements: { title: 'Movements', blurb: 'Every movement the library knows, with its variants and equipment.' },
  authors: { title: 'Authors', blurb: 'Who wrote your workouts, with one spelling per author across the library.' },
  collections: { title: 'Collections', blurb: 'Named lists of workouts, shown as chips and as a filter.' },
  logbook: { title: 'Logbook', blurb: 'Every session played, with its scores.' },
};

/** Everything about this device and its master data, in sections: general, training view (with sound), equipment, movements, authors, collections, and the logbook of sessions. */
export function Settings(props: SettingsProps) {
  const { section } = props;
  // On a narrow screen the sections scroll sideways; the current one (the Logbook, last) is brought into view.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => { const current = nav.current?.querySelector<HTMLElement>('[aria-current=page]'); if (current && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollLeft = current.offsetLeft - nav.current.offsetLeft - 8; }, [section]);
  return <div className={styles.settings}>
    <div className={shared.workoutHeading}><div><div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> SETTINGS</div><h1>Make it yours</h1><p className={shared.description}>{section === 'logbook' ? '' : 'Saved on this device. '}{SECTION_LABELS[section].blurb}</p></div></div>
    <div className={styles.layout}>
      <nav ref={nav} className={styles.nav} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(item => <a key={item} href={settingsHref(item)} aria-current={item === section ? 'page' : undefined}>{SECTION_LABELS[item].title}</a>)}
      </nav>
      <div className={styles.content}>
        {section === 'general' && <GeneralSettings {...props} />}
        {section === 'player' && <TrainingSettings {...props} />}
        {section === 'equipment' && <EquipmentSettings {...props} />}
        {section === 'movements' && <MovementSettings {...props} />}
        {section === 'authors' && <AuthorSettings {...props} />}
        {section === 'collections' && <CollectionSettings {...props} />}
        {section === 'logbook' && <Logbook mode={props.household.mode} entries={props.entries} {...props.logbook} />}
      </div>
    </div>
  </div>;
}
