import { useCallback, useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'workout'; id: string };

/** Hash routes keep the back button and reloads working on a static host without server rewrites. */
export function parseRoute(hash: string): Route {
  const match = /^#\/wod\/([^/?#]+)/.exec(hash);
  return match ? { name: 'workout', id: decodeURIComponent(match[1]) } : { name: 'library' };
}

export const workoutHref = (id: string) => `#/wod/${encodeURIComponent(id)}`;

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
