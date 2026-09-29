export const DEFAULT_TZ = 'America/Los_Angeles';

/** Military time with no colon, e.g. 1805. Used in every outgoing email. */
export function hhmm(date: Date | string, timeZone = DEFAULT_TZ): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}${m}`;
}

/** Normalises user-entered times ("18:05", "1805", "6:05 pm") to hhmm, or null. */
export function normalizeHhmm(input: string): string | null {
  const s = input.trim().toLowerCase();
  const m = s.match(/^(\d{1,2}):?(\d{2})\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}${String(min).padStart(2, '0')}`;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock time in `timeZone` -> ISO instant. */
export function zonedToIso(
  y: number, mo: number, d: number, h: number, mi: number, timeZone = DEFAULT_TZ,
): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(new Date(guess), timeZone);
  t = guess - tzOffsetMs(new Date(t), timeZone); // second pass handles DST edges
  return new Date(t).toISOString();
}

/**
 * Applies an hhmm entered by the driver to the date of `reference`
 * (today, in the driver's zone). Used for ETA fields.
 */
export function hhmmToIso(value: string, reference: Date, timeZone = DEFAULT_TZ): string | null {
  const n = normalizeHhmm(value);
  if (!n) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone }).format(reference).split('-').map(Number);
  return zonedToIso(ymd[0]!, ymd[1]!, ymd[2]!, Number(n.slice(0, 2)), Number(n.slice(2)), timeZone);
}

export function formatLocal(date: Date | string, timeZone = DEFAULT_TZ): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(d);
  return `${day} ${hhmm(d, timeZone)}`;
}
