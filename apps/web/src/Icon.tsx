import type { ReactNode } from 'react';

export type IconName = 'play' | 'pause' | 'sound' | 'settings' | 'next' | 'previous' | 'arrow' | 'back' | 'check' | 'close' | 'download' | 'upload' | 'clock' | 'users' | 'user' | 'list' | 'focus' | 'search' | 'trash' | 'sun' | 'moon' | 'auto' | 'grid' | 'switch' | 'undo' | 'plus' | 'flag' | 'skip' | 'alert' | 'edit' | 'copy';

const paths: Record<IconName, ReactNode> = {
  play: <path d="m9 5 11 7-11 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  sound: <path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
  next: <path d="m5 5 10 7-10 7zM19 5v14" />,
  previous: <path d="m19 5-10 7 10 7zM5 5v14" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  back: <path d="M19 12H5m5 5-5-5 5-5" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
  list: <path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" />,
  focus: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3m-7 0 1 13h6l1-13" />,
  edit: <path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" />,
  copy: <path d="M9 9h11v11H9zM15 9V4H4v11h5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  auto: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></>,
  grid: <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z" />,
  switch: <path d="M4 8h13m-4-4 4 4-4 4M20 16H7m4-4-4 4 4 4" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  flag: <path d="M5 21V4h12l-2 4 2 4H5" />,
  skip: <path d="m5 5 9 7-9 7zM17 5v14" />,
  alert: <><path d="M12 3 2 20h20zM12 10v4" /><circle cx="12" cy="17" r=".6" /></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
