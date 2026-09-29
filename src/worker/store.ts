import type { Job } from '../core/types';
import type { Env } from './env';

export async function getJob(env: Env, id: string): Promise<Job | null> {
  const row = await env.DB.prepare('SELECT json FROM jobs WHERE id = ?').bind(id).first<{ json: string }>();
  return row ? (JSON.parse(row.json) as Job) : null;
}

export async function listJobs(env: Env): Promise<Job[]> {
  const { results } = await env.DB.prepare(
    "SELECT json FROM jobs WHERE status != 'completed' OR updated_at > datetime('now','-30 days') ORDER BY updated_at DESC LIMIT 200",
  ).all<{ json: string }>();
  return results.map((r) => JSON.parse(r.json) as Job);
}

export async function saveJob(env: Env, job: Job): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO jobs (id, status, updated_at, json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET status=?2, updated_at=?3, json=?4',
  ).bind(job.id, job.status, new Date().toISOString(), JSON.stringify(job)).run();
}

export async function kvGet(env: Env, k: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first<{ v: string }>())?.v ?? null;
}
export async function kvSet(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v=?2').bind(k, v).run();
}

/** True if this message was already processed; marks it as seen otherwise. */
export async function markSeen(env: Env, messageId: string): Promise<boolean> {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO seen_messages (id) VALUES (?)').bind(messageId).run();
  return (r.meta.changes ?? 0) === 0;
}
