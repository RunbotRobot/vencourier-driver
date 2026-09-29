import type { Job, StepRequest } from './types';
import { DEFAULT_TZ, hhmm, hhmmToIso } from './time';

/** "Name <a@b.c>" -> "a@b.c" */
export const addressOf = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from.trim();

export const pickupVerb = (job: Job) => (job.pickup.place.kind === 'airline' ? 'recovered' : 'picked up');
export const deliveryVerb = (job: Job) => (job.delivery.place.kind === 'airline' ? 'tendered' : 'delivered');

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Resolves the ETA the driver typed ("1745") against the moment of the action. */
function etaText(eta: string | undefined, at: Date, tz: string): string | undefined {
  const iso = eta ? hhmmToIso(eta, at, tz) : null;
  return iso ? hhmm(iso, tz) : undefined;
}

/**
 * The one-line status message for a step. Military time, no colon, always ends with a period.
 * Free-form driver notes are added underneath by composeEmail.
 */
export function statusLine(job: Job, req: StepRequest, tz = DEFAULT_TZ): string {
  const at = req.at ? new Date(req.at) : new Date();
  const t = hhmm(at, tz);
  const eta = etaText(req.eta, at, tz);
  switch (req.step) {
    case 'accept':
      return req.leaveNow
        ? `Coverage confirmed. En route to pickup location${eta ? `, ETA ${eta}` : ''}.`
        : 'Coverage confirmed.';
    case 'decline':
      return 'Unable to cover this job.';
    case 'enRoute':
      return `En route to pickup location${eta ? `, ETA ${eta}` : ''}.`;
    case 'onsitePickup':
      return `Onsite at pickup location ${t}.`;
    case 'pickedUp': {
      const d = etaText(req.etaToDelivery, at, tz);
      return `Cargo ${pickupVerb(job)} and onboard ${t}.${d ? ` ETA to delivery ${d}.` : ''}`;
    }
    case 'onsiteDelivery':
      return `Onsite at delivery location ${t}.`;
    case 'delivered':
      return `Cargo ${deliveryVerb(job)} ${t}.`;
    case 'complete':
      return '';
  }
}

export function composeBody(job: Job, req: StepRequest, tz = DEFAULT_TZ): string {
  const line = statusLine(job, req, tz);
  const notes = req.notes?.trim();
  return [line, notes].filter(Boolean).join('\n\n');
}

/** A free-form reply is just the driver's own text — no status line. */
export function composeFreeReply(notes: string): string {
  return notes.trim();
}
