import { addressOf, composeBody, composeFreeReply, replySubject } from '../core/emails';
import { recordDwell, type DwellStats } from '../core/stats';
import { DEFAULT_TZ } from '../core/time';
import type { StepRequest } from '../core/types';
import { applyStep, canApply } from '../core/workflow';
import type { Env } from './env';
import { fetchAttachment, sendInThread, GmailError } from './gmail';
import type { MimeAttachment } from './mime';
import { getJob, kvGet, kvSet, listJobs, markSeen, saveJob } from './store';
import { renewWatch, syncMailbox } from './sync';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // Gmail's cap is 25 MB total, including encoding overhead

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function readForm(request: Request): Promise<{ payload: any; attachments: MimeAttachment[] }> {
  const form = await request.formData();
  const payload = JSON.parse(String(form.get('payload') ?? '{}'));
  const attachments: MimeAttachment[] = [];
  let total = 0;
  for (const f of form.getAll('files') as unknown as (string | File)[]) {
    if (typeof f === 'string') continue;
    total += f.size;
    if (total > MAX_ATTACH_BYTES) throw new HttpError(413, 'Attachments too large — total must stay under 20 MB');
    attachments.push({ filename: f.name || 'photo.jpg', mimeType: f.type || 'application/octet-stream', base64: toBase64(await f.arrayBuffer()) });
  }
  return { payload, attachments };
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function timezone(env: Env): Promise<string> {
  try { return JSON.parse((await kvGet(env, 'settings')) ?? '{}').timezone ?? DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

async function api(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.APP_TOKEN}`) return json({ error: 'unauthorized' }, 401);
  const path = url.pathname.replace(/^\/api/, '');
  const m = request.method;

  if (m === 'GET' && path === '/config') return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY, myEmail: env.MY_EMAIL, mapsConfigured: !!env.GOOGLE_MAPS_API_KEY });
  if (m === 'GET' && path === '/jobs') return json(await listJobs(env));
  // Starts (or renews) the Gmail push watch, then catches up. Idempotent; the daily cron does the same.
  if (m === 'POST' && path === '/watch') { await renewWatch(env); return json({ processed: await syncMailbox(env) }); }
  if (m === 'POST' && path === '/sync') return json({ processed: await syncMailbox(env) });
  if (m === 'GET' && path === '/notice') return json(JSON.parse((await kvGet(env, 'notice')) ?? 'null'));
  if (path === '/settings') {
    if (m === 'GET') return json(JSON.parse((await kvGet(env, 'settings')) ?? '{}'));
    if (m === 'PUT') { await kvSet(env, 'settings', JSON.stringify(await request.json())); return json({ ok: true }); }
  }
  if (m === 'GET' && path === '/dwell') return json(JSON.parse((await kvGet(env, 'dwell')) ?? '{}'));
  if (m === 'POST' && path === '/push/subscribe') {
    const sub = (await request.json()) as { endpoint: string };
    await env.DB.prepare('INSERT INTO push_subs (endpoint, json) VALUES (?1, ?2) ON CONFLICT(endpoint) DO UPDATE SET json=?2').bind(sub.endpoint, JSON.stringify(sub)).run();
    return json({ ok: true });
  }

  if (m === 'POST' && path === '/eta') {
    if (!env.GOOGLE_MAPS_API_KEY) return json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 501);
    const b = (await request.json()) as { origin: { lat: number; lng: number }; pickup: string | null; delivery: string };
    const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: b.origin.lat, longitude: b.origin.lng } } },
        ...(b.pickup ? { intermediates: [{ address: b.pickup }] } : {}),
        destination: { address: b.delivery },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
    });
    if (!r.ok) return json({ error: `routes api ${r.status}` }, 502);
    const legs = ((await r.json()) as { routes?: { legs: { distanceMeters: number; duration: string }[] }[] }).routes?.[0]?.legs;
    if (!legs || legs.length < (b.pickup ? 2 : 1)) return json({ error: 'no route' }, 502);
    const leg = (l: { distanceMeters: number; duration: string }) => ({ meters: l.distanceMeters, seconds: parseInt(l.duration, 10) });
    // With no pickup stop (cargo already onboard) the only leg is current location -> delivery.
    return json(b.pickup ? { toPickup: leg(legs[0]!), pickupToDelivery: leg(legs[1]!) } : { toPickup: { meters: 0, seconds: 0 }, pickupToDelivery: leg(legs[0]!) });
  }

  const jm = path.match(/^\/jobs\/([^/]+)(?:\/(step|message|printed|attachment))?$/);
  if (jm) {
    const job = await getJob(env, decodeURIComponent(jm[1]!));
    if (!job) return json({ error: 'not found' }, 404);
    const action = jm[2];

    if (m === 'GET' && !action) return json(job);

    if (m === 'GET' && action === 'attachment') {
      const att = url.searchParams.get('att');
      const msg = url.searchParams.get('message');
      if (!att || !msg) return json({ error: 'message and att required' }, 400);
      const known = [...job.attachments, ...job.thread.flatMap((t) => t.attachments)].find((a) => a.gmailAttachmentId === att);
      if (!known) return json({ error: 'not a job attachment' }, 404);
      return new Response(await fetchAttachment(env, msg, att), { headers: { 'content-type': known.mimeType, 'cache-control': 'private, max-age=86400' } });
    }

    if (m === 'POST' && action === 'printed') {
      await saveJob(env, (job.paperworkPrintedAt = new Date().toISOString(), job));
      return json(job);
    }

    if (m === 'POST' && (action === 'step' || action === 'message')) {
      const { payload, attachments } = await readForm(request);
      const tz = await timezone(env);
      const to = addressOf(job.source.from);
      const subject = replySubject(job.source.subject);
      const at = new Date().toISOString();
      let next = job;
      let body: string;

      if (action === 'message') {
        body = composeFreeReply(String(payload.notes ?? ''));
        if (!body && !attachments.length) throw new HttpError(400, 'Empty message');
      } else {
        const req = payload as StepRequest;
        if (!canApply(job, req.step)) throw new HttpError(409, `Cannot ${req.step} while ${job.step}`);
        next = applyStep(job, req);
        body = composeBody(job, req, tz);
      }

      // Send first: if Gmail rejects it, the job's state must not advance.
      if (body || attachments.length) {
        const sent = await sendInThread(env, job.source.gmailThreadId, {
          to, subject, body, attachments, inReplyTo: job.source.rfcMessageId,
        });
        await markSeen(env, sent.id);
        next = {
          ...next,
          thread: [...next.thread, {
            id: sent.id, direction: 'out', from: env.MY_EMAIL, at: payload.at ?? at, text: body,
            attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
          }],
        };
      }
      if (action === 'step' && payload.step === 'pickedUp') {
        const stats = JSON.parse((await kvGet(env, 'dwell')) ?? '{}') as DwellStats;
        await kvSet(env, 'dwell', JSON.stringify(recordDwell(stats, next)));
      }
      await saveJob(env, next);
      return json(next);
    }
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/hooks/gmail' && request.method === 'POST') {
        if (url.searchParams.get('token') !== env.PUBSUB_TOKEN) return new Response('forbidden', { status: 403 });
        // Ack fast so Pub/Sub does not retry; sync runs after the response.
        ctx.waitUntil(syncMailbox(env).catch((e) => console.error('sync failed', e)));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.startsWith('/api/')) return await api(request, env, ctx, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof GmailError) return json({ error: e.message }, 502);
      console.error(e);
      return json({ error: 'internal error' }, 500);
    }
  },

  /** Daily: renew the 7-day Gmail watch and catch up on anything a dropped push missed. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => { await renewWatch(env); await syncMailbox(env); })());
  },
} satisfies ExportedHandler<Env>;
