import type { Place } from './types';
import { DEFAULT_TZ, hhmm } from './time';

/**
 * Per-location routing knowledge learned on the road: where the map app's default pin is wrong.
 * Rules are user data (editable in Settings); these are the seeds.
 */
export interface LocationRule {
  id: string;
  name: string;
  /** Regex source tested against "name address" of the place. */
  match: string;
  when?: { beforeHhmm?: string; atOrAfterHhmm?: string };
  destination: { query: string; label: string };
  note?: string;
}

export const SEED_RULES: LocationRule[] = [
  {
    id: 'boeing-everett-e70',
    name: 'Boeing Everett — E70 gate before 1700',
    match: 'boeing|3003 w(est)?\\.? casino',
    when: { beforeHhmm: '1700' },
    destination: { query: 'Gate E70 - Truck Inspection BOEING company, Everett, WA 98203', label: 'Boeing Everett — E70 gate' },
    note: 'Before 1700, deliveries go to the E70 gate, not the 45-68G guard shack the map shows by default.',
  },
];

export interface ResolvedStop {
  /** What to hand the map app. */
  query: string;
  label: string;
  note?: string;
  ruleId?: string;
}

export function resolveStop(place: Place, arrival: Date | undefined, rules: LocationRule[], tz = DEFAULT_TZ): ResolvedStop {
  const text = `${place.name ?? ''} ${place.address ?? ''}`;
  const t = hhmm(arrival ?? new Date(), tz);
  for (const r of rules) {
    if (!new RegExp(r.match, 'i').test(text)) continue;
    if (r.when?.beforeHhmm && !(t < r.when.beforeHhmm)) continue;
    if (r.when?.atOrAfterHhmm && !(t >= r.when.atOrAfterHhmm)) continue;
    return { query: r.destination.query, label: r.destination.label, note: r.note, ruleId: r.id };
  }
  const query = [place.name, place.address].filter(Boolean).join(', ');
  return { query: place.address ?? query, label: place.name ?? place.address ?? 'Stop' };
}
