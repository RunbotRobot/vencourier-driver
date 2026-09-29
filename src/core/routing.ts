import type { ResolvedStop } from './locations';

export type MapApp = 'google' | 'apple' | 'waze';

export interface LegEstimate { meters: number; seconds: number }
export interface RoutePlan { toPickup: LegEstimate; pickupToDelivery: LegEstimate }

export const DEFAULT_PICKUP_DWELL_MIN = 15;

export interface Etas {
  arrivePickup: Date;
  departPickup: Date;
  arriveDelivery: Date;
}

/** ETA to pickup, and to delivery with the expected time spent at the pickup location. */
export function computeEtas(plan: RoutePlan, now: Date, dwellMinutes = DEFAULT_PICKUP_DWELL_MIN): Etas {
  const arrivePickup = new Date(now.getTime() + plan.toPickup.seconds * 1000);
  const departPickup = new Date(arrivePickup.getTime() + dwellMinutes * 60_000);
  return { arrivePickup, departPickup, arriveDelivery: new Date(departPickup.getTime() + plan.pickupToDelivery.seconds * 1000) };
}

const enc = encodeURIComponent;

/**
 * Deep links that open the driver's own map app with the route laid out.
 * - Google Maps supports origin + waypoints + destination in one link (current location → pickup → delivery).
 * - Apple Maps supports multiple stops via "daddr=A+to:B".
 * - Waze takes a single destination, so it is one leg at a time.
 * A dwell pause can't be encoded in any of them; the app shows it in its own ETA instead.
 */
export function mapLink(app: MapApp, stops: ResolvedStop[]): string {
  if (!stops.length) throw new Error('mapLink needs at least one stop');
  const dest = stops[stops.length - 1]!;
  const via = stops.slice(0, -1);
  switch (app) {
    case 'google': {
      const p = [`api=1`, `destination=${enc(dest.query)}`, 'travelmode=driving'];
      if (via.length) p.push(`waypoints=${enc(via.map((s) => s.query).join('|'))}`);
      return `https://www.google.com/maps/dir/?${p.join('&')}`;
    }
    case 'apple':
      return `https://maps.apple.com/?daddr=${stops.map((s) => enc(s.query)).join('+to:')}&dirflg=d`;
    case 'waze':
      return `https://waze.com/ul?q=${enc(stops[0]!.query)}&navigate=yes`;
  }
}

export const formatMiles = (meters: number) => `${(meters / 1609.344).toFixed(1)} mi`;
export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
