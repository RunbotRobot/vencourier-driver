// Generates VAPID keys for Web Push. Usage: npm run vapid -- mailto:you@example.com
import { webcrypto as crypto } from 'node:crypto';

const subject = process.argv[2] ?? 'mailto:you@example.com';
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log('Public key (VAPID_PUBLIC_KEY, also VITE_VAPID_PUBLIC_KEY):\n' + raw + '\n');
console.log('Private key (store as a secret: wrangler secret put VAPID_PRIVATE_JWK):\n' + JSON.stringify(jwk) + '\n');
console.log('Subject (VAPID_SUBJECT):\n' + subject);
