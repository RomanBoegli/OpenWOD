/** A stable id for this browser profile, used to label where a session or a change came from. Not a security token. */
const KEY = 'openwod.device.v1';
let cached: string | undefined;

export function deviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^[a-z0-9-]{8,80}$/.test(stored)) return (cached = stored);
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return (cached = fresh);
  } catch {
    return (cached = crypto.randomUUID());
  }
}
