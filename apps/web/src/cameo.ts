import { useCallback, useRef, useState } from 'react';
import { isWebKit } from './data/device';
import justDoItWebm from './assets/just-do-it.webm';
import justDoItMov from './assets/just-do-it.mov';

/**
 * The Just do it clip (UI-32), for the training view and for the try-out in the settings: one video element that waits
 * without a file. The file is asked for at the first tap and never with the app (ENG-11), the one this engine shows
 * transparent: WebKit the HEVC, every other the VP9. Playback starts inside the tap, which is what an iPhone asks of a
 * video with sound.
 */
export function useCameo(volume: number) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (!element.paused) { element.pause(); setOn(false); return; }
    if (!element.getAttribute('src')) element.src = isWebKit() ? justDoItMov : justDoItWebm;
    try { element.currentTime = 0; } catch { /* Nothing loaded yet: it starts at the beginning anyway. */ }
    element.volume = Math.min(1, Math.max(0, volume));
    setOn(true);
    void element.play().catch(() => setOn(false));
  }, [volume]);
  const end = useCallback(() => setOn(false), []);
  /** What the video element takes: `<video {...cameo.props} />`. */
  return { on, toggle, props: { ref: video, playsInline: true, preload: 'none', onEnded: end, onError: end } as const };
}

/** With reduced motion the clip stays away, and so does its button. */
export const stillOnly = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
