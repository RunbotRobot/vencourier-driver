import { useRef, useState } from 'preact/hooks';
import { formatLocal } from '../../core/time';
import type { Job, LocationKind, Place } from '../../core/types';
import { useApp } from '../ctx';
import { PaperworkPanel } from './PaperworkPanel';
import { RoutePanel } from './RoutePanel';
import { StepPanel } from './StepPanel';
import { Thread } from './Thread';

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

function PlaceCard({ title, leg, editKind }: { title: string; leg: Job['pickup']; editKind(k: LocationKind): void }) {
  const { settings } = useApp();
  const p: Place = leg.place;
  return (
    <section class="card">
      <h2>{title}</h2>
      <div class="big">{leg.time ? formatLocal(leg.time, settings.timezone) : leg.timeText ?? 'No time given'}</div>
      {p.name && <div><b>{p.name}</b></div>}
      {p.address && <div class="muted">{p.address}</div>}
      {p.contact && (p.contact.name || p.contact.phone) && (
        <div class="small">
          {p.contact.name}{' '}
          {p.contact.phone && <a href={tel(p.contact.phone)}>{p.contact.phone}</a>}
        </div>
      )}
      {leg.notes && <div class="notes"><span class="small muted">Notes</span><p>{leg.notes}</p></div>}
      <label class="small muted">Facility{' '}
        <select value={p.kind} onChange={(e) => editKind(e.currentTarget.value as LocationKind)}>
          <option value="ground">Ground</option>
          <option value="airline">Air cargo (recovered / tendered)</option>
        </select>
      </label>
    </section>
  );
}

export function JobView({ job }: { job: Job }) {
  const { put, settings } = useApp();
  const [printing, setPrinting] = useState(false);
  const printResolve = useRef<(ok: boolean) => void>();
  const [suggestedEta, setSuggestedEta] = useState<string>();
  const accepted = job.status === 'active';

  // Onsite-before-print prompt hands control here; resolves once the paperwork sheet closes.
  const onNeedPrint = () => new Promise<boolean>((resolve) => { printResolve.current = resolve; setPrinting(true); });
  const closePrint = (ok: boolean) => { setPrinting(false); printResolve.current?.(ok); printResolve.current = undefined; };

  const setKind = (which: 'pickup' | 'delivery') => (kind: LocationKind) =>
    put({ ...job, [which]: { ...job[which], place: { ...job[which].place, kind } } });

  const c = job.cargo;
  return (
    <div class="job">
      <header class="jobhead">
        <h1>{job.name}</h1>
        <div class="chips">
          {job.orderNumber && <span class="chip">Order {job.orderNumber}</span>}
          {job.references.map((r) => <span class="chip" key={r.label + r.value}>{r.label} {r.value}</span>)}
        </div>
      </header>

      <section class="card next"><StepPanel job={job} suggestedEta={suggestedEta} onNeedPrint={onNeedPrint} /></section>

      <RoutePanel job={job} onSuggestedEta={setSuggestedEta} />

      {accepted && (
        <section class="card">
          <h2>Paperwork</h2>
          <div class="row">
            <button class="btn" onClick={() => setPrinting(true)}>🖨 Print paperwork</button>
            {job.paperworkPrintedAt && <span class="ok small">Printed {formatLocal(job.paperworkPrintedAt, settings.timezone)}</span>}
          </div>
        </section>
      )}

      <PlaceCard title="Pickup" leg={job.pickup} editKind={setKind('pickup')} />
      <PlaceCard title="Delivery" leg={job.delivery} editKind={setKind('delivery')} />

      <section class="card">
        <h2>Cargo</h2>
        <dl>
          {c.pieces !== undefined && <><dt>Pieces</dt><dd>{c.pieces}</dd></>}
          {c.weight && <><dt>Weight</dt><dd>{c.weight}</dd></>}
          {c.dimensions && <><dt>Dimensions</dt><dd>{c.dimensions}</dd></>}
          {c.commodity && <><dt>Commodity</dt><dd>{c.commodity}</dd></>}
          {c.vehicleType && <><dt>Vehicle</dt><dd>{c.vehicleType}</dd></>}
          {c.dangerousGoods && <><dt>Dangerous goods</dt><dd>{c.dangerousGoods}</dd></>}
          {c.pieceIds?.length ? <><dt>Piece IDs</dt><dd>{c.pieceIds.join(', ')}</dd></> : null}
        </dl>
        {!Object.values(c).some((v) => v !== undefined) && <p class="muted small">None listed.</p>}
      </section>

      {job.notes && <section class="card"><h2>General notes</h2><p class="pre">{job.notes}</p></section>}

      {job.dispatcher && (
        <section class="card">
          <h2>Dispatcher</h2>
          <div>{job.dispatcher.name}{job.dispatcher.title ? ` — ${job.dispatcher.title}` : ''}</div>
          {job.dispatcher.phones.map((p) => <div class="small"><a href={tel(p)}>{p}</a></div>)}
          {job.portalUrl && <div class="small"><a href={job.portalUrl} target="_blank" rel="noopener">Airspace partner portal</a></div>}
        </section>
      )}

      <Thread job={job} />

      <details class="card">
        <summary>Original email <span class="muted small">(parsed by {job.source.parser})</span></summary>
        <div class="small muted">{job.source.subject}</div>
        <pre class="raw">{job.source.rawText}</pre>
      </details>

      {printing && <PaperworkPanel job={job} onClose={() => closePrint(false)} onPrinted={() => printResolve.current?.(true)} />}
    </div>
  );
}
