import { useMemo, useState } from 'preact/hooks';
import { composeBody, deliveryVerb, pickupVerb } from '../../core/emails';
import { hhmm, hhmmToIso, normalizeHhmm } from '../../core/time';
import type { Job, StepRequest } from '../../core/types';
import { needsPrintConfirmation, shouldSuggestCallingDispatch } from '../../core/workflow';
import { useApp } from '../ctx';
import { MAX_TOTAL_BYTES, totalBytes } from '../image';
import { Photos } from './Photos';

type Step = StepRequest['step'];

interface FormSpec {
  step: Step;
  title: string;
  submit: string;
  time?: boolean;
  eta?: 'pickup' | 'delivery';
  photos?: string;
  photosRequired?: boolean;
}

/** One emailed step: shows the exact line that will be sent, before it is sent. */
function StepForm({ job, spec, defaultEta, onDone, onCancel }: {
  job: Job; spec: FormSpec; defaultEta?: string; onDone(j: Job): void; onCancel?(): void;
}) {
  const { gateway, settings, put } = useApp();
  const [time, setTime] = useState('');
  const [eta, setEta] = useState(defaultEta ?? '');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [skipPhotos, setSkipPhotos] = useState(false);

  const request = useMemo((): StepRequest => ({
    step: spec.step,
    at: (time && hhmmToIso(time, new Date(), settings.timezone)) || undefined,
    notes,
    ...(spec.eta === 'pickup' ? { eta: normalizeHhmm(eta) ?? undefined } : {}),
    ...(spec.eta === 'delivery' ? { etaToDelivery: normalizeHhmm(eta) ?? undefined } : {}),
  }), [time, eta, notes, spec.step, spec.eta, settings.timezone]);

  const preview = composeBody(job, request, settings.timezone);
  const needPhotoConfirm = spec.photosRequired && !files.length && !skipPhotos;
  const tooBig = totalBytes(files) > MAX_TOTAL_BYTES;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (needPhotoConfirm) { setError('Add a photo, or tick "send without photos".'); return; }
    if (time && !normalizeHhmm(time)) { setError('Time must look like 1805.'); return; }
    if (eta && !normalizeHhmm(eta)) { setError('ETA must look like 1805.'); return; }
    setBusy(true); setError('');
    try {
      const next = await gateway.step(job, request, files);
      put(next); onDone(next);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <form class="stepform" onSubmit={submit}>
      <h3>{spec.title}</h3>
      {spec.time && (
        <label>Time <span class="muted small">(blank = now, {hhmm(new Date(), settings.timezone)})</span>
          <input inputMode="numeric" placeholder="hhmm" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
        </label>
      )}
      {spec.eta && (
        <label>{spec.eta === 'pickup' ? 'ETA to pickup' : 'ETA to delivery'} <span class="muted small">(hhmm, optional)</span>
          <input inputMode="numeric" placeholder="hhmm" value={eta} onInput={(e) => setEta(e.currentTarget.value)} />
        </label>
      )}
      <label>Notes <span class="muted small">(added to the email)</span>
        <textarea rows={3} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />
      </label>
      {spec.photos && (
        <>
          <Photos files={files} onChange={setFiles} hint={spec.photos} />
          {spec.photosRequired && !files.length && (
            <label class="check"><input type="checkbox" checked={skipPhotos} onChange={(e) => setSkipPhotos(e.currentTarget.checked)} /> Send without photos</label>
          )}
        </>
      )}
      <div class="preview"><span class="small muted">Email to dispatch</span><pre>{preview || '(no email — this step is only recorded)'}</pre></div>
      {error && <p class="warn">{error}</p>}
      <div class="row">
        {onCancel && <button type="button" class="btn" onClick={onCancel}>Back</button>}
        <button class="btn primary" disabled={busy || tooBig}>{busy ? 'Sending…' : spec.submit}</button>
      </div>
    </form>
  );
}

/** The walk-through: shows only what the driver can do next. */
export function StepPanel({ job, suggestedEta, onNeedPrint }: {
  job: Job;
  /** hhmm of the calculated ETA to pickup (from the route panel). */
  suggestedEta?: string;
  /** Called before onsiting at pickup when paperwork is unprinted. Resolve true to continue. */
  onNeedPrint(): Promise<boolean>;
}) {
  const { gateway, put, now } = useApp();
  const [mode, setMode] = useState<null | 'accept' | 'decline' | 'enRoute' | 'onsitePickup'>(null);
  const [leaveNow, setLeaveNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const done = () => setMode(null);

  const complete = async () => { setBusy(true); try { put(await gateway.step(job, { step: 'complete' }, [])); } finally { setBusy(false); } };

  switch (job.step) {
    case 'offered':
      if (mode === 'decline')
        return <StepForm job={job} spec={{ step: 'decline', title: 'Decline this job', submit: 'Send decline' }} onDone={done} onCancel={done} />;
      if (mode === 'accept')
        return (
          <div>
            <div class="seg">
              <button class={leaveNow ? 'on' : ''} onClick={() => setLeaveNow(true)}>Leave now</button>
              <button class={!leaveNow ? 'on' : ''} onClick={() => setLeaveNow(false)}>Leave later</button>
            </div>
            <AcceptForm job={job} leaveNow={leaveNow} suggestedEta={suggestedEta} onDone={done} onCancel={done} />
          </div>
        );
      return (
        <div class="row">
          <button class="btn danger" onClick={() => setMode('decline')}>Decline</button>
          <button class="btn primary" onClick={() => setMode('accept')}>Accept — can cover</button>
        </div>
      );
    case 'confirmed':
      if (mode === 'enRoute')
        return <StepForm job={job} defaultEta={suggestedEta} spec={{ step: 'enRoute', title: 'Leaving for pickup', submit: 'Send en route', eta: 'pickup' }} onDone={done} onCancel={done} />;
      if (mode === 'onsitePickup') return <OnsitePickup job={job} onDone={done} onCancel={done} onNeedPrint={onNeedPrint} />;
      return (
        <div class="stack">
          <p class="muted">Coverage confirmed. Not moving yet.</p>
          <div class="row">
            <button class="btn primary" onClick={() => setMode('enRoute')}>Leaving now — en route</button>
            <button class="btn" onClick={() => setMode('onsitePickup')}>Onsite at pickup</button>
          </div>
        </div>
      );
    case 'enRoute':
      if (mode === 'onsitePickup') return <OnsitePickup job={job} onDone={done} onCancel={done} onNeedPrint={onNeedPrint} />;
      return (
        <div class="stack">
          <p class="muted">En route to pickup{job.etaToPickup ? ` — ETA ${job.etaToPickup}` : ''}.</p>
          <button class="btn primary" onClick={() => setMode('onsitePickup')}>Onsite at pickup</button>
        </div>
      );
    case 'onsitePickup':
      return <StepForm job={job} spec={{
        step: 'pickedUp', title: `Cargo ${pickupVerb(job)} and onboard`, submit: 'Send to dispatch', time: true, eta: 'delivery',
        photos: 'Photo of each box as it is loaded.', photosRequired: true,
      }} onDone={done} />;
    case 'pickedUp': {
      const call = shouldSuggestCallingDispatch(job, now);
      const phone = job.dispatcher?.phones[0];
      return (
        <div class="stack">
          {call ? (
            <div class="notice">
              It has been over 5 minutes with no OK from dispatch. It may be worth calling to check in
              {phone && <> — <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>call {phone}</a></>}. You can still continue.
            </div>
          ) : (
            <p class="muted">Waiting for dispatch to say you're good to go{job.dispatchClearedAt ? '' : '…'}</p>
          )}
          {job.dispatchClearedAt && <div class="ok">Dispatch cleared you to go.</div>}
          {mode === 'enRoute'
            ? <StepForm job={job} spec={{ step: 'onsiteDelivery', title: 'Onsite at delivery', submit: 'Send onsite', time: true }} onDone={done} onCancel={done} />
            : <button class="btn primary" onClick={() => setMode('enRoute')}>Onsite at delivery</button>}
        </div>
      );
    }
    case 'onsiteDelivery':
      return <StepForm job={job} spec={{
        step: 'delivered', title: `Cargo ${deliveryVerb(job)}`, submit: 'Send to dispatch', time: true,
        photos: 'Photo of the delivery paperwork with the signature.', photosRequired: true,
      }} onDone={done} />;
    case 'delivered':
      return (
        <div class="stack">
          <p class="muted">Waiting for dispatch to verify the shipment is complete.</p>
          <button class="btn" disabled={busy} onClick={complete}>Dispatch confirmed — mark complete</button>
        </div>
      );
    case 'complete': return <div class="ok">Complete.</div>;
    case 'declined': return <p class="muted">Declined.</p>;
  }
}

function AcceptForm({ job, leaveNow, suggestedEta, onDone, onCancel }: { job: Job; leaveNow: boolean; suggestedEta?: string; onDone(): void; onCancel(): void }) {
  // remount when the choice flips so the ETA field appears / disappears with the right default
  return (
    <StepFormAccept key={String(leaveNow)} job={job} leaveNow={leaveNow} suggestedEta={suggestedEta} onDone={onDone} onCancel={onCancel} />
  );
}

function StepFormAccept({ job, leaveNow, suggestedEta, onDone, onCancel }: { job: Job; leaveNow: boolean; suggestedEta?: string; onDone(): void; onCancel(): void }) {
  const { gateway, put, settings } = useApp();
  const [eta, setEta] = useState(suggestedEta ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const req: StepRequest = { step: 'accept', leaveNow, eta: leaveNow ? (normalizeHhmm(eta) ?? undefined) : undefined, notes };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (leaveNow && eta && !normalizeHhmm(eta)) { setError('ETA must look like 1805.'); return; }
    setBusy(true); setError('');
    try { put(await gateway.step(job, req, [])); onDone(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form class="stepform" onSubmit={submit}>
      {leaveNow && (
        <label>ETA to pickup <span class="muted small">(hhmm — defaults to the calculated ETA; blank to leave it out)</span>
          <input inputMode="numeric" placeholder="hhmm" value={eta} onInput={(e) => setEta(e.currentTarget.value)} />
        </label>
      )}
      {!leaveNow && <p class="muted small">Sends "Coverage confirmed." You'll send the en route message with an ETA when you leave.</p>}
      <label>Notes <span class="muted small">(added to the email)</span>
        <textarea rows={2} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />
      </label>
      <div class="preview"><span class="small muted">Email to dispatch</span><pre>{composeBody(job, req, settings.timezone)}</pre></div>
      {error && <p class="warn">{error}</p>}
      <div class="row">
        <button type="button" class="btn" onClick={onCancel}>Back</button>
        <button class="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}

/** Onsite at pickup, with the explicit "print first?" choice when paperwork exists but is unprinted. */
function OnsitePickup({ job, onDone, onCancel, onNeedPrint }: { job: Job; onDone(): void; onCancel(): void; onNeedPrint(): Promise<boolean> }) {
  const [cleared, setCleared] = useState(!needsPrintConfirmation(job));
  if (!cleared) {
    return (
      <div class="stack">
        <div class="notice">Are you sure you want to onsite yourself before printing paperwork?</div>
        <div class="row">
          <button class="btn" onClick={onCancel}>Back</button>
          <button class="btn" onClick={async () => { if (await onNeedPrint()) setCleared(true); else onCancel(); }}>Print first</button>
          <button class="btn danger" onClick={() => setCleared(true)}>Skip — onsite now</button>
        </div>
      </div>
    );
  }
  return <StepForm job={job} spec={{ step: 'onsitePickup', title: 'Onsite at pickup', submit: 'Send onsite', time: true }} onDone={onDone} onCancel={onCancel} />;
}
