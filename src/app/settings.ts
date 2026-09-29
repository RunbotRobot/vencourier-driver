import { SEED_RULES, type LocationRule } from '../core/locations';
import type { MapApp } from '../core/routing';
import { DEFAULT_TZ } from '../core/time';

export interface Settings {
  mapApp: MapApp;
  timezone: string;
  rules: LocationRule[];
  /** Empty = demo mode (in-browser sample data, nothing is emailed). */
  apiToken: string;
}

const KEY = 'vencourier.settings.v1';
export const DEFAULT_SETTINGS: Settings = { mapApp: 'google', timezone: DEFAULT_TZ, rules: SEED_RULES, apiToken: '' };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: keep in-memory only */ }
}
