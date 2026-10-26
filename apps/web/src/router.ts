import { useCallback, useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'new' } | { name: 'workout'; id: string } | { name: 'play'; id: string } | { name: 'edit'; id: string };

/** Hash routes keep the back button and reloads working on a static host without server rewrites. */
export function parseRoute(hash: string): Route {
  if (/^#\/new\/?$/.test(hash)) return { name: 'new' };
  const match = /^#\/wod\/([^/?#]+)(?:\/(play|edit))?\/?$/.exec(hash);
  if (!match) return { name: 'library' };
  return { name: match[2] === 'play' ? 'play' : match[2] === 'edit' ? 'edit' : 'workout', id: decodeURIComponent(match[1]) };
}

export const workoutHref = (id: string) => `#/wod/${encodeURIComponent(id)}`;
export const playHref = (id: string) => `#/wod/${encodeURIComponent(id)}/play`;
export const editHref = (id: string) => `#/wod/${encodeURIComponent(id)}/edit`;
export const NEW_HREF = '#/new';

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
