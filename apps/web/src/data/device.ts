import { newId } from '../ids';

/** A stable id for this browser profile, used to label where a session or a change came from. Not a security token. */
const KEY = 'openwod.device.v1';
let cached: string | undefined;

export function deviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^[a-z0-9-]{8,80}$/.test(stored)) return (cached = stored);
    const fresh = newId();
    localStorage.setItem(KEY, fresh);
    return (cached = fresh);
  } catch {
    return (cached = newId());
  }
}

export interface DeviceTraits { userAgent: string; maxTouchPoints?: number; standalone?: boolean }

/**
 * A short human name for a device, as another device shows it during a hand-over (ENG-15): what it is and how the app
 * runs on it, "iPad · home screen", "iPhone · Safari" or "Mac · Chrome". iPadOS Safari calls itself a Macintosh, so a
 * Mac with a touch screen is an iPad. Every browser on iOS and most on a desktop carry "Safari" in their user agent,
 * hence the order of the checks.
 */
export function describeDevice({ userAgent, maxTouchPoints = 0, standalone = false }: DeviceTraits): string {
  const has = (pattern: RegExp) => pattern.test(userAgent);
  const ios = has(/iPhone|iPad|iPod/) || (has(/Macintosh/) && maxTouchPoints > 1);
  const device = has(/iPhone/) ? 'iPhone' : has(/iPod/) ? 'iPod' : ios ? 'iPad'
    : has(/Android/) ? (has(/Mobile/) ? 'Android phone' : 'Android tablet')
    : has(/Macintosh|Mac OS X/) ? 'Mac' : has(/CrOS/) ? 'Chromebook' : has(/Windows/) ? 'Windows PC' : has(/Linux|X11/) ? 'Linux PC' : 'Device';
  if (standalone) return `${device} · ${ios || has(/Android/) ? 'home screen' : 'app'}`;
  const browser = has(/EdgiOS|EdgA|Edg\//) ? 'Edge' : has(/OPR\/|OPT\//) ? 'Opera' : has(/SamsungBrowser/) ? 'Samsung Internet' : has(/FxiOS|Firefox\//) ? 'Firefox'
    : has(/CriOS|Chrome\/|Chromium\//) ? 'Chrome' : has(/Safari\//) || ios ? 'Safari' : 'browser';
  return `${device} · ${browser}`;
}

/**
 * Whether the engine is WebKit: Safari, and every browser on an iPhone or iPad. The Just do it clip (UI-32) asks, because each
 * engine plays the other's file without its transparency.
 */
export const isWebKit = (userAgent: string = navigator.userAgent): boolean => /AppleWebKit\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Android/.test(userAgent);

/** This device's name for the others. Read on every call: the display mode differs between a tab and the installed app. */
export function deviceLabel(): string {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return describeDevice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone });
  } catch {
    return 'Device · browser';
  }
}
