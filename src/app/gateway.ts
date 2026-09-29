import { PDFDocument, StandardFonts } from 'pdf-lib';
import { INBOUND_SAMPLES } from '../core/fixtures';
import { composeBody, composeFreeReply } from '../core/emails';
import { parseJobEmail } from '../core/parser';
import type { RoutePlan } from '../core/routing';
import { recordDwell, type DwellStats } from '../core/stats';
import type { Attachment, Job, StepRequest } from '../core/types';
import { applyDispatchReply, applyStep, classifyDispatchReply } from '../core/workflow';

export interface Gateway {
  mode: 'demo' | 'live';
  listJobs(): Promise<Job[]>;
  /** Ask the server to pull anything new from Gmail now (push normally makes this unnecessary). */
  sync(): Promise<void>;
  step(job: Job, req: StepRequest, files: File[]): Promise<Job>;
  message(job: Job, notes: string, files: File[]): Promise<Job>;
  markPrinted(job: Job): Promise<Job>;
  attachmentBytes(job: Job, att: Attachment): Promise<Uint8Array>;
  /** pickup = null once cargo is onboard: only the leg to delivery is returned (in pickupToDelivery). */
  eta(origin: { lat: number; lng: number }, pickup: string | null, delivery: string): Promise<RoutePlan | null>;
  dwell(): Promise<DwellStats>;
  /** Demo only: pretend dispatch replied. */
  simulateReply?(job: Job, text: string): Promise<Job>;
}

// ---------- live: talks to the Worker ----------

export function liveGateway(token: string): Gateway {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
    return res;
  };
  const form = (payload: unknown, files: File[]) => {
    const f = new FormData();
    f.set('payload', JSON.stringify(payload));
    files.forEach((file) => f.append('files', file, file.name));
    return f;
  };
  return {
    mode: 'live',
    listJobs: async () => (await call('/jobs')).json(),
    sync: async () => { await call('/sync', { method: 'POST' }); },
    step: async (job, req, files) => (await call(`/jobs/${encodeURIComponent(job.id)}/step`, { method: 'POST', body: form(req, files) })).json(),
    message: async (job, notes, files) => (await call(`/jobs/${encodeURIComponent(job.id)}/message`, { method: 'POST', body: form({ notes }, files) })).json(),
    markPrinted: async (job) => (await call(`/jobs/${encodeURIComponent(job.id)}/printed`, { method: 'POST' })).json(),
    attachmentBytes: async (job, att) =>
      new Uint8Array(await (await call(`/jobs/${encodeURIComponent(job.id)}/attachment?message=${att.messageId}&att=${encodeURIComponent(att.gmailAttachmentId ?? '')}`)).arrayBuffer()),
    eta: async (origin, pickup, delivery) => {
      try { return await (await call('/eta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin, pickup, delivery }) })).json(); }
      catch { return null; }
    },
    dwell: async () => (await call('/dwell')).json(),
  };
}

// ---------- demo: everything in the browser, nothing is emailed ----------

const DEMO_KEY = 'vencourier.demo.v1';

async function samplePdf(title: string, pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    doc.addPage([612, 792]).drawText(`${title} — page ${i} of ${pages}`, { x: 60, y: 700, size: 20, font });
  }
  return doc.save();
}

export function demoGateway(): Gateway {
  let jobs: Job[] | undefined;
  let stats: DwellStats = {};
  const pdfs = new Map<string, Uint8Array>();

  const persist = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify({ jobs, stats })); } catch { /* ignore */ } };
  const load = async (): Promise<Job[]> => {
    if (jobs) return jobs;
    try {
      const saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null');
      if (saved) { stats = saved.stats ?? {}; return (jobs = saved.jobs); }
    } catch { /* fall through to seed */ }
    jobs = await Promise.all(INBOUND_SAMPLES.map((s) => parseJobEmail(s.email)));
    jobs.forEach((j, i) => {
      const sample = INBOUND_SAMPLES[i]!;
      j.attachments = (sample.pdfs ?? []).map((p) => ({ filename: p.name, mimeType: 'application/pdf', gmailAttachmentId: p.name, messageId: 'demo' }));
      if (sample.dispatchFollowUp) {
        j.thread = [{ id: `${j.id}-fu`, direction: 'in', from: j.source.from, at: j.source.receivedAt, text: sample.dispatchFollowUp, attachments: [] }];
      }
    });
    persist();
    return jobs;
  };
  const replace = (next: Job) => { jobs = jobs!.map((j) => (j.id === next.id ? next : j)); persist(); return next; };
  const outgoing = (job: Job, text: string, files: File[], at?: string): Job => ({
    ...job,
    thread: [...job.thread, { id: crypto.randomUUID(), direction: 'out', from: 'me', at: at ?? new Date().toISOString(), text, attachments: files.map((f) => ({ filename: f.name, mimeType: f.type })) }],
  });

  return {
    mode: 'demo',
    listJobs: async () => [...(await load())],
    sync: async () => {},
    step: async (job, req, files) => {
      await load();
      let next = applyStep(job, req);
      const body = composeBody(job, req);
      if (body || files.length) next = outgoing(next, body, files, req.at);
      if (req.step === 'pickedUp') stats = recordDwell(stats, next);
      return replace(next);
    },
    message: async (job, notes, files) => { await load(); return replace(outgoing(job, composeFreeReply(notes), files)); },
    markPrinted: async (job) => replace({ ...job, paperworkPrintedAt: new Date().toISOString() }),
    attachmentBytes: async (_job, att) => {
      if (!pdfs.has(att.filename)) pdfs.set(att.filename, await samplePdf(att.filename.replace(/\.pdf$/i, ''), /awb/i.test(att.filename) ? 2 : /BOL/i.test(att.filename) ? 1 : 5));
      return pdfs.get(att.filename)!;
    },
    eta: async (_o, pickup) => ({ toPickup: pickup ? { meters: 22_700, seconds: 22 * 60 } : { meters: 0, seconds: 0 }, pickupToDelivery: { meters: 43_500, seconds: 38 * 60 } }),
    dwell: async () => { await load(); return stats; },
    simulateReply: async (job, text) => {
      const at = new Date().toISOString();
      const withMsg: Job = { ...job, thread: [...job.thread, { id: crypto.randomUUID(), direction: 'in', from: job.source.from, at, text, attachments: [] }] };
      return replace(applyDispatchReply(withMsg, classifyDispatchReply(text), at));
    },
  };
}
