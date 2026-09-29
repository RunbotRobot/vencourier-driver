import type { Attachment } from '../core/types';
import { buildMime, fromBase64Url, type MimeMessage } from './mime';
import type { Env } from './env';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

let tokenCache: { token: string; exp: number } | undefined;

export async function accessToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function gmail<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken(env)}`, ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) throw new GmailError(res.status, await res.text());
  return (await res.json()) as T;
}
export class GmailError extends Error {
  constructor(public status: number, body: string) { super(`Gmail ${status}: ${body.slice(0, 300)}`); }
}

/** Asks Gmail to publish to our Pub/Sub topic on INBOX changes. Expires after 7 days — renew daily. */
export async function watchInbox(env: Env): Promise<{ historyId: string; expiration: string }> {
  return gmail(env, '/watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topicName: env.PUBSUB_TOPIC, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
  });
}

export async function currentHistoryId(env: Env): Promise<string> {
  return (await gmail<{ historyId: string }>(env, '/profile')).historyId;
}

/** New message ids since `startHistoryId`. Throws GmailError(404) if the id is too old. */
export async function messagesSince(env: Env, startHistoryId: string): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gmail<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId?: string }>(env, `/history?${q}`);
    for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
    historyId = r.historyId ?? historyId;
    pageToken = r.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId };
}

export async function searchMessageIds(env: Env, q: string): Promise<string[]> {
  const r = await gmail<{ messages?: { id: string }[] }>(env, `/messages?${new URLSearchParams({ q, maxResults: '25' })}`);
  return (r.messages ?? []).map((m) => m.id);
}

interface Part {
  mimeType?: string; filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
}
interface RawMessage {
  id: string; threadId: string; internalDate: string; labelIds?: string[];
  payload: Part;
}

export interface FetchedMessage {
  id: string; threadId: string; at: string; from: string; subject: string; rfcMessageId?: string;
  text: string; attachments: Attachment[]; sent: boolean;
}

const header = (p: Part, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
const decode = (data: string) => new TextDecoder().decode(fromBase64Url(data));
const htmlToText = (html: string) =>
  html.replace(/<(br|\/p|\/div|\/tr)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");

export async function fetchMessage(env: Env, id: string): Promise<FetchedMessage> {
  const m = await gmail<RawMessage>(env, `/messages/${id}?format=full`);
  let plain = '';
  let html = '';
  const attachments: Attachment[] = [];
  const walk = (p: Part) => {
    if (p.filename && p.body?.attachmentId) {
      // Signature logos and pasted images are inline decoration (this is what used to pile up in replies).
      const inline = /^inline/i.test(header(p, 'Content-Disposition') ?? '') || !!header(p, 'Content-ID');
      if (!inline || /pdf/i.test(p.mimeType ?? '')) {
        attachments.push({ filename: p.filename, mimeType: p.mimeType ?? 'application/octet-stream', gmailAttachmentId: p.body.attachmentId, messageId: id });
      }
    } else if (p.mimeType === 'text/plain' && p.body?.data) plain += decode(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data) html += decode(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  return {
    id: m.id,
    threadId: m.threadId,
    at: new Date(Number(m.internalDate)).toISOString(),
    from: header(m.payload, 'From') ?? '',
    subject: header(m.payload, 'Subject') ?? '',
    rfcMessageId: header(m.payload, 'Message-ID') ?? header(m.payload, 'Message-Id'),
    text: plain || htmlToText(html),
    attachments,
    sent: !!m.labelIds?.includes('SENT'),
  };
}

export async function fetchAttachment(env: Env, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const r = await gmail<{ data: string }>(env, `/messages/${messageId}/attachments/${attachmentId}`);
  return fromBase64Url(r.data);
}

/** Sends within an existing thread using the multipart upload endpoint (handles large photo attachments). */
export async function sendInThread(env: Env, threadId: string | undefined, msg: MimeMessage): Promise<{ id: string; threadId: string }> {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(threadId ? { threadId } : {})}\r\n` +
    `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${buildMime(msg)}\r\n--${boundary}--`;
  return gmail(env, 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
}
