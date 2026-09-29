import type { Env } from './env';
import { kvSet } from './store';
import { sendWakeUp, type VapidKeys } from './vapid';

export interface Notice { title: string; body: string; jobId: string }

/**
 * Stores the notice, then sends a payload-less push. The service worker fetches /api/notice with the
 * app token, so job details (often medical/aerospace) never pass through the browser vendor's push service.
 */
export async function notify(env: Env, notice: Notice): Promise<void> {
  await kvSet(env, 'notice', JSON.stringify({ ...notice, at: new Date().toISOString() }));
  const keys: VapidKeys = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT };
  const { results } = await env.DB.prepare('SELECT endpoint FROM push_subs').all<{ endpoint: string }>();
  await Promise.all(
    results.map(async (s) => {
      try {
        if (!(await sendWakeUp(s, keys))) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
      } catch { /* one dead endpoint must not block the others */ }
    }),
  );
}
