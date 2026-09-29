import { fromBase64Url, toBase64Url } from './mime';

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url — also given to the browser as applicationServerKey. */
  publicKey: string;
  /** Private key as JWK (kty EC, crv P-256, with d, x, y). */
  privateJwk: JsonWebKey;
  subject: string;
}

/**
 * VAPID auth header for a Web Push request. We send pushes with no payload (a "wake-up"),
 * so no message content ever transits the push service; the service worker fetches details itself.
 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = toBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = toBase64Url(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: keys.subject }));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${toBase64Url(sig)}, k=${keys.publicKey}`;
}

export interface PushSubscriptionRecord { endpoint: string }

/** Returns false when the subscription is gone (404/410) and should be deleted. */
export async function sendWakeUp(sub: PushSubscriptionRecord, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuthorization(sub.endpoint, keys), TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
  });
  return !(res.status === 404 || res.status === 410);
}

export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { publicKey: toBase64Url(raw), privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey, subject };
}

export { fromBase64Url };
