import { useEffect, useState } from 'preact/hooks';
import { resolveStop } from '../../core/locations';
import { computeEtas, formatDuration, formatMiles, mapLink, type Etas, type MapApp, type RoutePlan } from '../../core/routing';
import { expectedDwell, type DwellStats } from '../../core/stats';
import { hhmm } from '../../core/time';
import type { Job } from '../../core/types';
import { useApp } from '../ctx';

const APPS: { id: MapApp; label: string }[] = [
  { id: 'google', label: 'Google Maps' },
  { id: 'apple', label: 'Apple Maps' },
  { id: 'waze', label: 'Waze' },
];

const BEFORE_PICKUP = ['offered', 'confirmed', 'enRoute'];

/** Distance/ETA from where you are, expected pickup time, and one-tap hand-off to your map app. */
export function RoutePanel({ job, onSuggestedEta }: { job: Job; onSuggestedEta(hhmm: string): void }) {
  const { gateway, settings, setSettings, now } = useApp();
  const [origin, setOrigin] = useState<{ lat: number; lng: number }>();
  const [plan, setPlan] = useState<RoutePlan | null>();
  const [stats, setStats] = useState<DwellStats>({});
  const [geoError, setGeoError] = useState('');
  const beforePickup = BEFORE_PICKUP.includes(job.step);
  const active = job.status === 'offered' || job.status === 'active';

  const locate = () => {
    setGeoError('');
    navigator.geolocation?.getCurrentPosition(
      (p) => setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setGeoError(e.message || 'Location unavailable'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };
  useEffect(() => { if (active) { locate(); gateway.dwell().then(setStats); } }, [job.id, job.step]);

  const dwell = expectedDwell(stats, job.pickup.place);
  const scheduledDelivery = job.delivery.time ? new Date(job.delivery.time) : undefined;
  const pickupStop = resolveStop(job.pickup.place, undefined, settings.rules, settings.timezone);
  const roughDeliveryStop = resolveStop(job.delivery.place, scheduledDelivery, settings.rules, settings.timezone);

  useEffect(() => {
    if (!origin || !active) return;
    let stale = false;
    gateway.eta(origin, beforePickup ? pickupStop.query : null, roughDeliveryStop.query).then((p) => { if (!stale) setPlan(p); });
    return () => { stale = true; };
  }, [origin?.lat, origin?.lng, job.step]);

  const at = new Date(now);
  const etas: Etas | undefined = plan ? computeEtas(beforePickup ? plan : { ...plan, toPickup: { meters: 0, seconds: 0 } }, at, beforePickup ? dwell.minutes : 0) : undefined;
  const deliveryArrival = etas?.arriveDelivery ?? scheduledDelivery;
  const deliveryStop = resolveStop(job.delivery.place, deliveryArrival, settings.rules, settings.timezone);

  useEffect(() => { if (etas && beforePickup) onSuggestedEta(hhmm(etas.arrivePickup, settings.timezone)); }, [etas?.arrivePickup.getTime()]);

  if (!active) return null;
  const late = etas && scheduledDelivery && etas.arriveDelivery > scheduledDelivery;
  const link = (stops: typeof pickupStop[]) => mapLink(settings.mapApp, stops);

  return (
    <section class="card">
      <h2>Route</h2>
      {!origin && <p class="muted small">{geoError || 'Locating you…'} <button class="link" onClick={locate}>Retry</button></p>}
      {origin && plan === null && <p class="muted small">ETA service unavailable — routes still open in your map app.</p>}
      {etas && plan && (
        <ul class="etas">
          {beforePickup && (
            <li>
              <b>Pickup</b> ETA {hhmm(etas.arrivePickup, settings.timezone)} · {formatMiles(plan.toPickup.meters)} · {formatDuration(plan.toPickup.seconds)}
            </li>
          )}
          <li class={late ? 'warn' : ''}>
            <b>Delivery</b> ETA {hhmm(etas.arriveDelivery, settings.timezone)} · {formatMiles(plan.pickupToDelivery.meters)} · {formatDuration(plan.pickupToDelivery.seconds)}
            {beforePickup && <span class="muted small"> (includes {dwell.minutes} min at pickup{dwell.samples ? `, from ${dwell.samples} past visit${dwell.samples > 1 ? 's' : ''}` : ', default'})</span>}
            {late && scheduledDelivery && <span> — after the {hhmm(scheduledDelivery, settings.timezone)} deadline</span>}
          </li>
        </ul>
      )}
      {deliveryStop.note && <div class="notice small">📍 {deliveryStop.label}: {deliveryStop.note}</div>}
      <div class="row wrap">
        {beforePickup && <a class="btn primary" href={link([pickupStop])} target="_blank" rel="noopener">→ To pickup</a>}
        <a class="btn" href={link([deliveryStop])} target="_blank" rel="noopener">→ To delivery</a>
        {beforePickup && settings.mapApp !== 'waze' && <a class="btn" href={link([pickupStop, deliveryStop])} target="_blank" rel="noopener">Full route</a>}
      </div>
      <label class="small muted">Map app{' '}
        <select value={settings.mapApp} onChange={(e) => setSettings({ ...settings, mapApp: e.currentTarget.value as MapApp })}>
          {APPS.map((a) => <option value={a.id}>{a.label}</option>)}
        </select>
      </label>
      {beforePickup && settings.mapApp === 'waze' && <p class="muted small">Waze takes one stop at a time — navigate to pickup first, then delivery.</p>}
    </section>
  );
}
