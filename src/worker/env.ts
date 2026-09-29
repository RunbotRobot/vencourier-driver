export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** Bearer token the PWA sends. Personal-use auth; replace with real accounts before commercial use. */
  APP_TOKEN: string;
  /** Secret in the Pub/Sub push URL (?token=…). */
  PUBSUB_TOKEN: string;

  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  /** Full topic name: projects/<project>/topics/<topic> */
  PUBSUB_TOPIC: string;
  /** The driver's own address. */
  MY_EMAIL: string;
  /** Comma-separated dispatch sender addresses; anything else is ignored (personal-use scope). */
  DISPATCH_SENDERS: string;

  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_SUBJECT: string;

  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GOOGLE_MAPS_API_KEY?: string;
}
