import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './router';
import styles from './Settings.module.css';
import shared from './App.module.css';
import type { SettingsProps } from './settings/shared';
import { GeneralSettings } from './settings/GeneralSettings';
import { TrainingSettings } from './settings/TrainingSettings';
import { EquipmentSettings } from './settings/EquipmentSettings';
import { MovementSettings } from './settings/MovementSettings';
import { CollectionSettings } from './settings/CollectionSettings';

const SECTION_LABELS: Record<SettingsSection, { title: string; blurb: string }> = {
  general: { title: 'General', blurb: 'Theme, the player’s look, and who trains here.' },
  player: { title: 'Training view', blurb: 'Units, the look of the timer, and the sound.' },
  equipment: { title: 'Equipment', blurb: 'What you own, and one spelling per item across the library.' },
  movements: { title: 'Movements', blurb: 'Every movement the library knows, with its variants and equipment.' },
  collections: { title: 'Collections', blurb: 'Named lists of workouts, shown as chips and as a filter.' },
};

/** Everything about this device and its master data, in sections: general, training view (with sound), equipment, movements, collections. */
export function Settings(props: SettingsProps) {
  const { section } = props;
  return <div className={styles.settings}>
    <div className={shared.workoutHeading}><div><div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> SETTINGS</div><h1>Make it yours</h1><p className={shared.description}>Saved on this device. {SECTION_LABELS[section].blurb}</p></div></div>
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(item => <a key={item} href={settingsHref(item)} aria-current={item === section ? 'page' : undefined}>{SECTION_LABELS[item].title}</a>)}
      </nav>
      <div className={styles.content}>
        {section === 'general' && <GeneralSettings {...props} />}
        {section === 'player' && <TrainingSettings {...props} />}
        {section === 'equipment' && <EquipmentSettings {...props} />}
        {section === 'movements' && <MovementSettings {...props} />}
        {section === 'collections' && <CollectionSettings {...props} />}
      </div>
    </div>
  </div>;
}
