import { useEffect, useState } from 'react';
import { QUICK_TIMER_ID } from '../../../packages/domain/src/library';

export const SETTINGS_SECTIONS = ['general', 'player', 'equipment', 'movements', 'authors', 'collections', 'logbook'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type Route = { name: 'library' } | { name: 'new' } | { name: 'timer' } | { name: 'settings'; section: SettingsSection } | { name: 'draft'; id: string } | { name: 'workout'; id: string } | { name: 'play'; id: string } | { name: 'edit'; id: string } | { name: 'copy'; id: string } | { name: 'historyPlay'; id: string } | { name: 'notFound' };

/** Hash routes keep the back button and reloads working on a static host without server rewrites. */
export function parseRoute(hash: string): Route {
  if (/^#\/new\/?$/.test(hash)) return { name: 'new' };
  // The quick timer (LIB-09) has a page for its numbers and plays as a session of its reserved id.
  if (/^#\/timer\/?$/.test(hash)) return { name: 'timer' };
  if (/^#\/timer\/play\/?$/.test(hash)) return { name: 'play', id: QUICK_TIMER_ID };
  // The History page became the Logbook under Settings (UI-22); old links and bookmarks open it there.
  if (/^#\/history\/?$/.test(hash)) return { name: 'settings', section: 'logbook' };
  const snapshot = /^#\/history\/([^/?#]+)\/play\/?$/.exec(hash);
  if (snapshot) return { name: 'historyPlay', id: decodeURIComponent(snapshot[1]) };
  const settings = /^#\/settings(?:\/([a-z]+))?\/?$/.exec(hash);
  if (settings) return { name: 'settings', section: settings[1] === 'exercises' ? 'movements' : settings[1] === 'sound' ? 'player' : (SETTINGS_SECTIONS as readonly string[]).includes(settings[1]) ? settings[1] as SettingsSection : 'general' };
  const draft = /^#\/draft\/([^/?#]+)\/?$/.exec(hash);
  if (draft) return { name: 'draft', id: decodeURIComponent(draft[1]) };
  const match = /^#\/wod\/([^/?#]+)(?:\/(play|edit|copy))?\/?$/.exec(hash);
  if (!match) return /^#?\/?$/.test(hash) ? { name: 'library' } : { name: 'notFound' };
  // The quick timer is no library workout: its id has no page, no editor and no copy of its own.
  if (decodeURIComponent(match[1]) === QUICK_TIMER_ID) return match[2] === 'play' ? { name: 'play', id: QUICK_TIMER_ID } : { name: 'timer' };
  return { name: match[2] === 'play' ? 'play' : match[2] === 'edit' ? 'edit' : match[2] === 'copy' ? 'copy' : 'workout', id: decodeURIComponent(match[1]) };
}

export const TIMER_HREF = '#/timer';
/** A workout's page and its player. The quick timer's id leads to the timer's own two routes, so every link that follows a session finds them. */
export const workoutHref = (id: string) => id === QUICK_TIMER_ID ? TIMER_HREF : `#/wod/${encodeURIComponent(id)}`;
export const playHref = (id: string) => id === QUICK_TIMER_ID ? `${TIMER_HREF}/play` : `#/wod/${encodeURIComponent(id)}/play`;
export const editHref = (id: string) => `#/wod/${encodeURIComponent(id)}/edit`;
export const copyHref = (id: string) => `#/wod/${encodeURIComponent(id)}/copy`;
export const NEW_HREF = '#/new';
export const SETTINGS_HREF = '#/settings';
/** Every session played, under Settings (UI-22); `#/history` still leads here. */
export const LOGBOOK_HREF = '#/settings/logbook';
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
  return { route };
}
