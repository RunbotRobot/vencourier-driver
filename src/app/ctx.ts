import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Job } from '../core/types';
import type { Gateway } from './gateway';
import type { Settings } from './settings';

export interface AppCtx {
  gateway: Gateway;
  settings: Settings;
  setSettings(s: Settings): void;
  /** Re-rendered every 15 s so timers (the 5-minute dispatch nudge) stay current. */
  now: number;
  /** Replace a job in the list after an update. */
  put(job: Job): void;
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
