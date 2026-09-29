# Setup (one-time, ~30–45 min)

1. **Google Cloud project** → enable *Gmail API*, *Cloud Pub/Sub API*, *Routes API*.
2. **OAuth**: create an OAuth client; consent screen → publish "In production" (see the refresh-token note in
   ARCHITECTURE.md). Scopes: `gmail.modify`, `gmail.send`. Get a refresh token once (e.g. OAuth Playground with your
   own client id/secret).
3. **Pub/Sub**: create topic `vencourier-gmail`; grant `gmail-api-push@system.gserviceaccount.com` the
   *Pub/Sub Publisher* role on it. After the Worker is deployed, add a **push subscription** to
   `https://<worker-host>/hooks/gmail?token=<PUBSUB_TOKEN>`.
4. **Cloudflare**: `npx wrangler d1 create vencourier-driver`, paste the id into `wrangler.toml`, then
   `npx wrangler d1 execute vencourier-driver --remote --file src/worker/schema.sql`.
5. **Secrets**: `npm run vapid -- mailto:you@example.com`, then `npx wrangler secret put` for `APP_TOKEN` (make one up),
   `PUBSUB_TOKEN`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_JWK`, and optionally `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`. Edit `[vars]` in `wrangler.toml`.
6. `npm run build && npx wrangler deploy`; run the cron once (or `POST /api/sync`) so the Gmail watch starts.
7. **Phone**: open the site → Add to Home Screen → Settings → paste `APP_TOKEN` → "Enable job alerts".

Test safely first by sending yourself a fake job from an address you add to `DISPATCH_SENDERS`.
