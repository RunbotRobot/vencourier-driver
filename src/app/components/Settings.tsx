import { useState } from 'preact/hooks';
import { SEED_RULES } from '../../core/locations';
import { useApp } from '../ctx';
import { enablePush, startGmailAlerts } from '../push';
import { SetupKeys } from './SetupKeys';

export function Settings({ onClose }: { onClose(): void }) {
  const { settings, setSettings, gateway } = useApp();
  const [token, setToken] = useState(settings.apiToken);
  const [rules, setRules] = useState(JSON.stringify(settings.rules, null, 2));
  const [tz, setTz] = useState(settings.timezone);
  const [msg, setMsg] = useState('');
  const [keys, setKeys] = useState(false);

  const save = () => {
    try {
      setSettings({ ...settings, apiToken: token.trim(), timezone: tz.trim() || settings.timezone, rules: JSON.parse(rules) });
      onClose();
      if (token.trim() !== settings.apiToken) location.reload();
    } catch { setMsg('Location rules are not valid JSON.'); }
  };

  return (
    <div class="modal" role="dialog" aria-label="Settings">
      <div class="sheet">
        <h2>Settings</h2>
        <p class="muted small">{gateway.mode === 'demo' ? 'Demo mode: sample jobs, and no email is sent.' : 'Connected to your Vencourier server.'}</p>
        <label>Server access token <span class="muted small">(blank = demo mode)</span>
          <input type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} autoComplete="off" />
        </label>
        <label>Time zone <input value={tz} onInput={(e) => setTz(e.currentTarget.value)} /></label>
        <label>Location rules <span class="muted small">(where a map app's default pin is wrong)</span>
          <textarea rows={10} class="mono" value={rules} onInput={(e) => setRules(e.currentTarget.value)} />
        </label>
        <button class="link" onClick={() => setRules(JSON.stringify(SEED_RULES, null, 2))}>Reset rules to defaults</button>
        {gateway.mode === 'live' && (
          <div class="row"><button class="btn" onClick={async () => setMsg(await enablePush(settings.apiToken))}>🔔 Enable job alerts</button></div>
        )}
        {gateway.mode === 'live' && (
          <div class="row"><button class="btn" onClick={async () => { setMsg('Starting…'); setMsg(await startGmailAlerts(settings.apiToken)); }}>📬 Start Gmail alerts</button></div>
        )}
        <div class="row"><button class="btn" onClick={() => setKeys(true)}>🔑 Generate setup keys (one-time)</button></div>
        {msg && <p class="notice">{msg}</p>}
        <div class="row"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" onClick={save}>Save</button></div>
      </div>
      {keys && <SetupKeys onClose={() => setKeys(false)} />}
    </div>
  );
}
