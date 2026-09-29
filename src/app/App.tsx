import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { formatLocal } from '../core/time';
import type { Job } from '../core/types';
import { JobView } from './components/JobView';
import { Settings } from './components/Settings';
import { Ctx } from './ctx';
import { demoGateway, liveGateway, type Gateway } from './gateway';
import { loadSettings, saveSettings, type Settings as S } from './settings';
import { registerServiceWorker } from './push';

type Tab = 'offered' | 'active' | 'completed' | 'declined';
const TABS: { id: Tab; label: string }[] = [
  { id: 'offered', label: 'Offered' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'declined', label: 'Declined' },
];

const STEP_LABEL: Record<Job['step'], string> = {
  offered: 'Awaiting your answer', confirmed: 'Coverage confirmed', enRoute: 'En route to pickup', onsitePickup: 'Onsite at pickup',
  pickedUp: 'Cargo onboard', onsiteDelivery: 'Onsite at delivery', delivered: 'Delivered — awaiting dispatch', complete: 'Complete', declined: 'Declined',
};

const jobIdFromHash = () => decodeURIComponent(location.hash.match(/^#\/job\/(.+)$/)?.[1] ?? '') || undefined;

export function App() {
  const [settings, setSettingsState] = useState<S>(loadSettings);
  const gateway: Gateway = useMemo(() => (settings.apiToken ? liveGateway(settings.apiToken) : demoGateway()), [settings.apiToken]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<Tab>('offered');
  const [openId, setOpenId] = useState(jobIdFromHash());
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const setSettings = (s: S) => { setSettingsState(s); saveSettings(s); };
  const put = useCallback((job: Job) => setJobs((js) => js.map((j) => (j.id === job.id ? job : j))), []);
  const refresh = useCallback(async () => {
    try { setError(''); await gateway.sync(); setJobs(await gateway.listJobs()); } catch (e) { setError((e as Error).message); }
  }, [gateway]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (settings.apiToken) registerServiceWorker(settings.apiToken); }, [settings.apiToken]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onHash = () => setOpenId(jobIdFromHash());
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onSw = (e: MessageEvent) => { if (e.data?.type === 'open') { location.hash = e.data.hash.replace(/^\//, ''); refresh(); } };
    addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onSw);
    return () => { removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', onVisible); navigator.serviceWorker?.removeEventListener('message', onSw); };
  }, [refresh]);

  const byTab = (t: Tab) => jobs.filter((j) => j.status === t);
  const open = openId ? jobs.find((j) => j.id === openId) : undefined;

  return (
    <Ctx.Provider value={{ gateway, settings, setSettings, now, put }}>
      <div class="shell">
        <header class="appbar">
          {open ? <button class="link back" onClick={() => { location.hash = ''; }}>‹ Jobs</button> : <strong>Vencourier · Driver</strong>}
          <span class="grow" />
          {gateway.mode === 'demo' && <span class="badge">DEMO</span>}
          <button class="icon" aria-label="Refresh" onClick={refresh}>⟳</button>
          <button class="icon" aria-label="Settings" onClick={() => setShowSettings(true)}>⚙</button>
        </header>
        {error && <div class="notice">{error}</div>}

        {open ? (
          <main><JobView job={open} /></main>
        ) : (
          <main>
            <nav class="tabs" role="tablist">
              {TABS.map((t) => (
                <button role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  {t.label}{byTab(t.id).length > 0 && <span class="count">{byTab(t.id).length}</span>}
                </button>
              ))}
            </nav>
            {byTab(tab).length === 0 && <p class="empty muted">No {tab} jobs.</p>}
            <ul class="joblist">
              {byTab(tab).map((j) => (
                <li key={j.id}>
                  <a href={`#/job/${encodeURIComponent(j.id)}`} class="jobcard">
                    <div class="row between"><b>{j.name}</b>{j.orderNumber && <span class="muted small">#{j.orderNumber}</span>}</div>
                    {(j.pickup.time || j.pickup.timeText || j.delivery.time || j.delivery.timeText) && (
                      <div class="small">
                        {j.pickup.time ? formatLocal(j.pickup.time, settings.timezone) : j.pickup.timeText ?? '—'} → {j.delivery.time ? formatLocal(j.delivery.time, settings.timezone) : j.delivery.timeText ?? '—'}
                      </div>
                    )}
                    <div class="small muted">{j.pickup.place.name ?? j.pickup.place.address ?? 'Pickup'} → {j.delivery.place.name ?? j.delivery.place.address ?? 'Delivery'}</div>
                    <div class="small status">{STEP_LABEL[j.step]}</div>
                  </a>
                </li>
              ))}
            </ul>
          </main>
        )}
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      </div>
    </Ctx.Provider>
  );
}
