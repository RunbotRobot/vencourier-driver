import type { Job, JobStep, StepRequest } from './types';

/** Which requests are legal from each step. Anything else is rejected, not silently ignored. */
const ALLOWED: Record<JobStep, StepRequest['step'][]> = {
  offered: ['accept', 'decline'],
  confirmed: ['enRoute', 'onsitePickup'],
  enRoute: ['onsitePickup'],
  onsitePickup: ['pickedUp'],
  pickedUp: ['onsiteDelivery'],
  onsiteDelivery: ['delivered'],
  delivered: ['complete'],
  complete: [],
  declined: [],
};

export const canApply = (job: Job, step: StepRequest['step']) => ALLOWED[job.step].includes(step);

/** How long after pickup before the app suggests phoning dispatch. */
export const CLEARANCE_NUDGE_MS = 5 * 60 * 1000;

export function applyStep(job: Job, req: StepRequest): Job {
  if (!canApply(job, req.step)) throw new Error(`Cannot ${req.step} a job that is ${job.step}`);
  const at = req.at ?? new Date().toISOString();
  const next: Job = { ...job, timeline: { ...job.timeline } };
  const mark = (s: JobStep) => { next.step = s; next.timeline[s] = at; };

  switch (req.step) {
    case 'accept':
      next.status = 'active';
      mark(req.leaveNow ? 'enRoute' : 'confirmed');
      next.timeline.confirmed ??= at;
      if (req.leaveNow && req.eta) next.etaToPickup = req.eta;
      break;
    case 'decline':
      next.status = 'declined';
      mark('declined');
      break;
    case 'enRoute':
      mark('enRoute');
      if (req.eta) next.etaToPickup = req.eta;
      break;
    case 'onsitePickup': mark('onsitePickup'); break;
    case 'pickedUp':
      mark('pickedUp');
      next.clearanceRequestedAt = at;
      break;
    case 'onsiteDelivery': mark('onsiteDelivery'); break;
    case 'delivered': mark('delivered'); break;
    case 'complete':
      next.status = 'completed';
      mark('complete');
      break;
  }
  return next;
}

/** True once the driver has waited 5 minutes for dispatch's OK. Never blocks the workflow. */
export function shouldSuggestCallingDispatch(job: Job, now = Date.now()): boolean {
  return (
    job.step === 'pickedUp' &&
    !job.dispatchClearedAt &&
    !!job.clearanceRequestedAt &&
    now - new Date(job.clearanceRequestedAt).getTime() >= CLEARANCE_NUDGE_MS
  );
}

const PDF = (a: { mimeType: string; filename: string }) => a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.filename);
export const printablePdfs = (job: Job) => [
  ...job.attachments.filter(PDF),
  ...job.thread.flatMap((m) => m.attachments.filter(PDF)),
];

/** The onsite-before-printing prompt applies only when there is paperwork to print. */
export const needsPrintConfirmation = (job: Job) => !job.paperworkPrintedAt && printablePdfs(job).length > 0;

export type DispatchReplyKind = 'clearance' | 'closed' | 'ack' | 'other';

/** Reads dispatch's short replies ("Looks great. You are good to go.", "Copy", "Order Closed"). */
export function classifyDispatchReply(text: string): DispatchReplyKind {
  const t = text.toLowerCase();
  if (/order closed/.test(t)) return 'closed';
  if (/good to\s?go|you(?:'| a)?re (?:all )?(?:good|clear|cleared)|cleared to|\bproceed\b|\bclear to\b/.test(t)) return 'clearance';
  if (/^\s*(copy|received|got it|thank(s| you)|very good|ok(ay)?)\b/.test(t)) return 'ack';
  return 'other';
}

/** Applies an incoming dispatch reply to the job: clearance after pickup, sign-off after delivery. */
export function applyDispatchReply(job: Job, kind: DispatchReplyKind, at: string): Job {
  if (kind === 'clearance' || kind === 'closed') {
    if (job.step === 'pickedUp' || job.step === 'onsiteDelivery') return { ...job, dispatchClearedAt: at };
    if (job.step === 'delivered') return applyStep(job, { step: 'complete', at });
  }
  return job;
}
