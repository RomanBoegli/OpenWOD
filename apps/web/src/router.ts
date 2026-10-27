import { useCallback, useEffect, useState } from 'react';

export const SETTINGS_SECTIONS = ['general', 'player', 'equipment', 'movements', 'collections'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type Route = { name: 'library' } | { name: 'new' } | { name: 'settings'; section: SettingsSection } | { name: 'draft'; id: string } | { name: 'workout'; id: string } | { name: 'play'; id: string } | { name: 'edit'; id: string } | { name: 'copy'; id: string } | { name: 'history' } | { name: 'historyPlay'; id: string } | { name: 'notFound' };

/** Hash routes keep the back button and reloads working on a static host without server rewrites. */
export function parseRoute(hash: string): Route {
  if (/^#\/new\/?$/.test(hash)) return { name: 'new' };
  if (/^#\/history\/?$/.test(hash)) return { name: 'history' };
  const snapshot = /^#\/history\/([^/?#]+)\/play\/?$/.exec(hash);
  if (snapshot) return { name: 'historyPlay', id: decodeURIComponent(snapshot[1]) };
  const settings = /^#\/settings(?:\/([a-z]+))?\/?$/.exec(hash);
  if (settings) return { name: 'settings', section: settings[1] === 'exercises' ? 'movements' : settings[1] === 'sound' ? 'player' : (SETTINGS_SECTIONS as readonly string[]).includes(settings[1]) ? settings[1] as SettingsSection : 'general' };
  const draft = /^#\/draft\/([^/?#]+)\/?$/.exec(hash);
  if (draft) return { name: 'draft', id: decodeURIComponent(draft[1]) };
  const match = /^#\/wod\/([^/?#]+)(?:\/(play|edit|copy))?\/?$/.exec(hash);
  if (!match) return /^#?\/?$/.test(hash) ? { name: 'library' } : { name: 'notFound' };
  return { name: match[2] === 'play' ? 'play' : match[2] === 'edit' ? 'edit' : match[2] === 'copy' ? 'copy' : 'workout', id: decodeURIComponent(match[1]) };
}

export const workoutHref = (id: string) => `#/wod/${encodeURIComponent(id)}`;
export const playHref = (id: string) => `#/wod/${encodeURIComponent(id)}/play`;
export const editHref = (id: string) => `#/wod/${encodeURIComponent(id)}/edit`;
export const copyHref = (id: string) => `#/wod/${encodeURIComponent(id)}/copy`;
export const NEW_HREF = '#/new';
export const SETTINGS_HREF = '#/settings';
export const HISTORY_HREF = '#/history';
/** Plays the workout saved with a session, for workouts that have left the library. */
export const snapshotPlayHref = (sessionId: string) => `#/history/${encodeURIComponent(sessionId)}/play`;
export const settingsHref = (section: SettingsSection) => section === 'general' ? SETTINGS_HREF : `#/settings/${section}`;
/** An imported file is edited as an unsaved draft before it joins the library. */
export const draftHref = (id: string) => `#/draft/${encodeURIComponent(id)}`;

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = useCallback((hash: string) => { window.location.hash = hash; }, []);
  return { route, navigate };
}
