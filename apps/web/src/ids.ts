/**
 * Session, command, sharing and device ids. `crypto.randomUUID` exists only in secure contexts, so a phone opening the
 * app over plain HTTP on a LAN address has none and starting a workout threw; `getRandomValues` is available everywhere,
 * so the fallback builds the same RFC 4122 version 4 UUID from it.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = 0x40 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
