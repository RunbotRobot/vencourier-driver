/** Registers the service worker and (optionally) subscribes this device to job alerts. */
export async function registerServiceWorker(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  const send = () => reg.active?.postMessage({ type: 'token', token });
  send();
  navigator.serviceWorker.ready.then(send);
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function enablePush(token: string): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    return 'Push is not supported here. On iPhone, add the app to your Home Screen first (iOS 16.4+).';
  if ((await Notification.requestPermission()) !== 'granted') return 'Notifications were not allowed.';
  const cfg = await (await fetch('/api/config', { headers: { authorization: `Bearer ${token}` } })).json();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) }));
  const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  return res.ok ? 'Job alerts are on for this device.' : 'Could not register for alerts.';
}
