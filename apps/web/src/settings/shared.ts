import type { Catalogue } from '../../../../packages/domain/src/catalogue';
import type { WorkoutAudio } from '../audio';
import type { LibraryEntry } from '../Library';
import type { MasterData } from '../master-data';
import type { Preferences } from '../preferences';
import type { SettingsSection } from '../router';
import type { BackendCounts } from '../data/backend';
import type { DataMode } from '../data/mode';
import type { Connection, LegacyData } from '../data/use-library-data';
import type { ExportDocument, RestoreReport } from '../../../../packages/household/src/types';
import type { LogbookProps } from '../History';

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
  household: HouseholdStatus;
  /** The sessions and their actions for the Logbook section (UI-22). */
  logbook: Omit<LogbookProps, 'mode' | 'entries'>;
}

export interface HouseholdStatus {
  /** Which shape this build is: a household server, or this browser alone. */
  mode: DataMode;
  connection: Connection;
  schemaVersion?: number;
  serverVersion?: string;
  pendingCount: number;
  legacy?: LegacyData;
  migrating: boolean;
  onMigrate: () => Promise<unknown>;
  onRefresh: () => Promise<void>;
  /** Static shape only: what this browser holds. */
  stats?: BackendCounts;
  /** Replaces the whole library with a backup (DAT-11); `backup` names the server's pre-restore copy. */
  onRestore: (document: unknown) => Promise<RestoreReport & { backup?: string }>;
  /** The whole library as one restorable JSON document. */
  onExportAll: () => Promise<ExportDocument>;
  /** Opens the export preview for a pack of these workouts (SHR-01/03). */
  exportPack: (title: string, workoutIds: string[]) => void;
}

export const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;
export const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';
