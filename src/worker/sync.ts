import { addressOf } from '../core/emails';
import { parseJobEmail } from '../core/parser';
import { stripQuoted } from '../core/parser/text';
import type { Job } from '../core/types';
import { applyDispatchReply, classifyDispatchReply } from '../core/workflow';
import type { Env } from './env';
import { currentHistoryId, fetchMessage, GmailError, messagesSince, searchMessageIds, watchInbox, type FetchedMessage } from './gmail';
import { getJob, kvGet, kvSet, markSeen, saveJob } from './store';
import { notify } from './notify';

const dispatchSenders = (env: Env) => env.DISPATCH_SENDERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Handles one Gmail message: a new job offer, or a reply in a job's thread. */
export async function ingest(env: Env, m: FetchedMessage): Promise<void> {
  if (await markSeen(env, m.id)) return;
  const sender = addressOf(m.from).toLowerCase();
  const mine = sender === env.MY_EMAIL.toLowerCase();
  let job = await getJob(env, m.threadId);

  if (!job) {
    // Personal-use scope: only new (non-reply) mail from known dispatch addresses becomes a job.
    if (mine || !dispatchSenders(env).includes(sender) || /^\s*re:/i.test(m.subject)) return;
    const llm = env.GEMINI_API_KEY && env.GEMINI_MODEL ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : undefined;
    job = await parseJobEmail(
      { subject: m.subject, text: m.text, from: m.from, receivedAt: m.at, gmailThreadId: m.threadId, gmailMessageId: m.id, rfcMessageId: m.rfcMessageId, attachments: m.attachments },
      { llm },
    );
    await saveJob(env, job);
    await notify(env, { title: 'New job offer', body: job.name, jobId: job.id });
    return;
  }

  if (!mine && !dispatchSenders(env).includes(sender)) return;
  const text = stripQuoted(m.text);
  job = {
    ...job,
    thread: [...job.thread, { id: m.id, direction: mine ? 'out' : 'in', from: m.from, at: m.at, text, attachments: m.attachments }],
    source: mine ? job.source : { ...job.source, gmailMessageId: m.id, rfcMessageId: m.rfcMessageId ?? job.source.rfcMessageId },
  };
  if (!mine) {
    const kind = classifyDispatchReply(text);
    const before: Job = job;
    job = applyDispatchReply(job, kind, m.at);
    await saveJob(env, job);
    const changed = job.step !== before.step || job.dispatchClearedAt !== before.dispatchClearedAt;
    await notify(env, {
      title: changed ? (job.status === 'completed' ? 'Job complete' : 'Dispatch: good to go') : 'Dispatch replied',
      body: `${job.name}: ${text.slice(0, 80)}`,
      jobId: job.id,
    });
  } else await saveJob(env, job);
}

/** Pulls everything new since the last sync. Called by the Pub/Sub webhook, the cron, and app open. */
export async function syncMailbox(env: Env): Promise<number> {
  const last = await kvGet(env, 'historyId');
  let ids: string[];
  let historyId: string;
  if (!last) {
    historyId = await currentHistoryId(env);
    ids = await searchMessageIds(env, `newer_than:2d from:(${dispatchSenders(env).join(' OR ')})`);
  } else {
    try {
      ({ ids, historyId } = await messagesSince(env, last));
    } catch (e) {
      if (!(e instanceof GmailError) || e.status !== 404) throw e;
      // History expired (>~1 week offline): fall back to a bounded search.
      historyId = await currentHistoryId(env);
      ids = await searchMessageIds(env, `newer_than:7d from:(${dispatchSenders(env).join(' OR ')})`);
    }
  }
  for (const id of ids.reverse()) await ingest(env, await fetchMessage(env, id));
  await kvSet(env, 'historyId', historyId);
  return ids.length;
}

export async function renewWatch(env: Env): Promise<void> {
  const w = await watchInbox(env);
  await kvSet(env, 'watchExpiration', w.expiration);
  if (!(await kvGet(env, 'historyId'))) await kvSet(env, 'historyId', w.historyId);
}
