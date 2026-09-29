import type { Job, Place } from './types';
import { DEFAULT_PICKUP_DWELL_MIN } from './routing';

/** dwell samples (minutes) per pickup location, newest last. */
export type DwellStats = Record<string, number[]>;

const MAX_SAMPLES = 10;

export function placeKey(place: Place): string {
  return `${place.name ?? ''}|${place.address ?? ''}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
}

/** Minutes between "onsite at pickup" and "cargo onboard", or null if either is missing. */
export function dwellMinutes(job: Job): number | null {
  const a = job.timeline.onsitePickup;
  const b = job.timeline.pickedUp;
  if (!a || !b) return null;
  const m = (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
  return m >= 0 && m < 240 ? Math.round(m) : null; // ignore forgotten-to-tap outliers
}

export function recordDwell(stats: DwellStats, job: Job): DwellStats {
  const m = dwellMinutes(job);
  if (m === null) return stats;
  const key = placeKey(job.pickup.place);
  return { ...stats, [key]: [...(stats[key] ?? []), m].slice(-MAX_SAMPLES) };
}

/** Median of past visits; the default until this location has been visited. */
export function expectedDwell(stats: DwellStats, place: Place): { minutes: number; samples: number } {
  const s = [...(stats[placeKey(place)] ?? [])].sort((a, b) => a - b);
  if (!s.length) return { minutes: DEFAULT_PICKUP_DWELL_MIN, samples: 0 };
  const mid = Math.floor(s.length / 2);
  return { minutes: s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2), samples: s.length };
}
