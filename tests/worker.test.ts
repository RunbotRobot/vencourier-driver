import { describe, expect, it } from 'vitest';
import { buildMime, fromBase64Url } from '../src/worker/mime';
import { generateVapidKeys, sendWakeUp, vapidAuthorization } from '../src/worker/vapid';

describe('buildMime', () => {
  it('builds a threaded plain reply with no quoted text', () => {
    const raw = buildMime({ to: 'dispatch@movingforward.vip', subject: 'Re: 4102894 Medline', body: 'Onsite at pickup location 1805.', inReplyTo: '<abc@mail>' });
    expect(raw).toContain('In-Reply-To: <abc@mail>');
    expect(raw).toContain('References: <abc@mail>');
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
    const b64 = raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(new TextDecoder().decode(fromBase64Url(b64))).toBe('Onsite at pickup location 1805.');
  });
  it('attaches files as multipart/mixed and encodes non-ASCII subjects', () => {
    const raw = buildMime({ to: 'a@b.c', subject: 'Re: Café', body: 'hi', attachments: [{ filename: 'box "1".jpg', mimeType: 'image/jpeg', base64: 'AAAA' }] });
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('filename="box _1_.jpg"');
    expect(raw.trimEnd().endsWith('--')).toBe(true);
  });
});

describe('web push wake-up', () => {
  it('signs a verifiable ES256 VAPID token', async () => {
    const keys = await generateVapidKeys('mailto:me@example.com');
    const auth = await vapidAuthorization('https://push.example.net/send/abc', keys, 1_800_000_000);
    const [, t, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = t!.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(c!)))).toMatchObject({ aud: 'https://push.example.net', sub: 'mailto:me@example.com' });
    const pub = await crypto.subtle.importKey('raw', fromBase64Url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromBase64Url(s!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
  it('reports dead subscriptions', async () => {
    const keys = await generateVapidKeys('mailto:me@example.com');
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    const live = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    expect(await sendWakeUp({ endpoint: 'https://p.example/x' }, keys, gone)).toBe(false);
    expect(await sendWakeUp({ endpoint: 'https://p.example/x' }, keys, live)).toBe(true);
  });
});
