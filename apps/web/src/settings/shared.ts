import type { Catalogue } from '../../../../packages/domain/src/catalogue';
import type { WorkoutAudio } from '../audio';
import type { LibraryEntry } from '../Library';
import type { MasterData } from '../master-data';
import type { Preferences } from '../preferences';
import type { SettingsSection } from '../router';

export interface SettingsProps {
  section: SettingsSection;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  masterData: MasterData;
  onMasterDataChange: (update: (value: MasterData) => MasterData) => void;
  catalogue: Catalogue;
  entries: LibraryEntry[];
  clipsReady?: boolean;
  packs: { id: string; label: string }[];
  audio: WorkoutAudio;
}

export const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;
export const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';
