import { useState } from 'preact/hooks';
import { generateVapidKeys } from '../../worker/vapid';
import { toBase64Url } from '../../worker/mime';

interface Generated { label: string; secretName: string; value: string; note: string }

const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * One-time helper for phone-only setup: makes the secrets the server needs, in the browser.
 * Nothing is sent anywhere; copy each value into the Cloudflare dashboard, then close this page.
 */
export function SetupKeys({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<Generated[]>();
  const [copied, setCopied] = useState('');

  const generate = async () => {
    const v = await generateVapidKeys('mailto:runbotrobot@gmail.com');
    setItems([
      { label: 'App access token', secretName: 'APP_TOKEN', value: randomToken(), note: 'Also paste this into this app\'s Settings → Server access token.' },
      { label: 'Pub/Sub token', secretName: 'PUBSUB_TOKEN', value: randomToken(), note: 'Goes in the Pub/Sub push URL as ?token=…' },
      { label: 'Push public key', secretName: 'VAPID_PUBLIC_KEY', value: v.publicKey, note: 'Not secret.' },
      { label: 'Push private key', secretName: 'VAPID_PRIVATE_JWK', value: JSON.stringify(v.privateJwk), note: 'Secret. Paste the whole line, including the braces.' },
    ]);
  };
  const copy = async (i: Generated) => {
    try { await navigator.clipboard.writeText(i.value); setCopied(i.secretName); } catch { setCopied(''); }
  };

  return (
    <div class="modal" role="dialog" aria-label="Setup keys">
      <div class="sheet">
        <h2>Setup keys</h2>
        <p class="muted small">
          Made on this device only. Copy each one into Cloudflare as a secret with the name shown. Generating again
          makes new values — do it once, finish setup, then close this. Don't screenshot or share these.
        </p>
        {!items && <button class="btn primary" onClick={generate}>Generate keys</button>}
        {items?.map((i) => (
          <div class="pdfrow" key={i.secretName}>
            <div><b>{i.label}</b> <span class="muted small">→ secret name <code>{i.secretName}</code></span></div>
            <div class="muted small">{i.note}</div>
            <textarea class="mono" rows={i.value.length > 100 ? 4 : 2} readOnly value={i.value} onFocus={(e) => e.currentTarget.select()} />
            <button class="btn" onClick={() => copy(i)}>{copied === i.secretName ? 'Copied ✓' : 'Copy'}</button>
          </div>
        ))}
        <div class="row"><button class="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
