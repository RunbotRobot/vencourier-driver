# Setup — phone only, no terminal (about 45 minutes, once)

Everything below is done in a mobile browser. Google's and Cloudflare's menus change from time to time, so
names may differ slightly; the intent of each step stays the same. If you get stuck, tell Claude what
the screen says.

**Already done for you:** the Cloudflare database `vencourier-driver` exists with its tables, and its id is in `wrangler.toml`.

Keep a note (Notes app) as you go. You'll collect these values:
`PROJECT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`, `MAPS_KEY`, and your Worker URL.
Tip: switch your browser to "Desktop site" for the two consoles — they're much easier that way.

## Part 1 — Google Cloud (console.cloud.google.com)

Sign in as runbotrobot@gmail.com.

1. **Create a project.** Project picker (top) → New project → name it `Vencourier`. Write down its **Project ID**
   (shown under the name; may differ from the name, e.g. `vencourier-123456`) → `PROJECT_ID`.
2. **Turn on three APIs.** Menu → APIs & Services → Library. Search each, open it, tap Enable:
   *Gmail API*, *Cloud Pub/Sub API*, *Routes API*. (If it asks for billing for Routes, see the note at the end.)
3. **Login screen (OAuth)** — menu → APIs & Services → OAuth consent screen (newer console: "Google Auth Platform"). Do these in order:
   1. **Branding** page: only three things are required — *App name* (`Vencourier - Driver` is fine), *User support email* and
      *Developer contact email* (both your Gmail). Leave logo, home page, privacy policy and authorized domains **blank**
      (Google only insists on domains if you add links). Save.
   2. **Audience** page: user type **External**. Under **Test users**, **add runbotrobot@gmail.com** (your own account
      too — without this, sign-in fails with "Error 403: access_denied … can only be accessed by developer-approved testers").
   3. **Data access** page: add the scopes `https://www.googleapis.com/auth/gmail.modify` and
      `https://www.googleapis.com/auth/gmail.send`. Save.
   4. **Audience** page again: **Publish app** → In production (confirm). Apps left in "Testing" have their login expire
      every 7 days. Publishing may show an "unverified app" notice; that's expected, and it only affects you.
   If step 4 still refuses, keep going in Testing for now (your test-user entry is enough to sign in), and repeat Part 1
   step 5 after publishing works — a token obtained while in Testing may expire in 7 days.
4. **Credentials.** APIs & Services → Credentials → Create credentials → **OAuth client ID** → type **Web application**.
   Under *Authorized redirect URIs* add exactly `https://developers.google.com/oauthplayground`. Create.
   Copy the **Client ID** → `CLIENT_ID` and **Client secret** → `CLIENT_SECRET`.
5. **Get your refresh token** (this is how the server stays logged in to your Gmail):
   - Open **developers.google.com/oauthplayground**. Tap the gear ⚙ → tick **Use your own OAuth credentials**
     → paste `CLIENT_ID` and `CLIENT_SECRET`.
   - In the left box (Step 1) type the two scopes above (space-separated) → **Authorize APIs** → choose your account →
     continue past the "unverified" warning → Allow.
   - Step 2: **Exchange authorization code for tokens**. Copy the **Refresh token** → `REFRESH_TOKEN`.
6. **Maps key** (for distance/ETA). Credentials → Create credentials → **API key**. Copy it → `MAPS_KEY`.
   Then tap the key → *API restrictions* → Restrict key → **Routes API** → Save.
7. **Pub/Sub topic** (Gmail's push channel). Menu → Pub/Sub → Topics → Create topic → ID `vencourier-gmail`
   (leave "Add default subscription" ticked or not; either works). Then open the topic → **Permissions**
   (or "Add principal") → principal `gmail-api-push@system.gserviceaccount.com` → role **Pub/Sub Publisher** → Save.

**Project ID:** `vencourier-driver` — already committed into `wrangler.toml` (topic
`projects/vencourier-driver/topics/vencourier-gmail`).

## Part 2 — Cloudflare (dash.cloudflare.com)

1. **Deploy from GitHub.** Workers & Pages → Create → **Import a repository** (connect GitHub if asked, allow the
   `vencourier-driver` repo) → branch `main`. Use:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   The Worker name must be `vencourier-driver` (it is in `wrangler.toml`). Every push to `main` redeploys automatically.
2. **Make your secrets.** Open your deployed app's URL (`https://vencourier-driver.<something>.workers.dev`). Tap ⚙ Settings →
   **Generate setup keys**. It shows four values; keep this screen open.
3. **Add secrets.** In Cloudflare: your Worker → Settings → **Variables and Secrets** → Add, type **Secret**, one for each:

   | Name | Value from |
   |---|---|
   | `APP_TOKEN`, `PUBSUB_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK` | the four values on the Setup keys screen (Copy buttons) |
   | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN` |
   | `GOOGLE_MAPS_API_KEY` | `MAPS_KEY` |

   Save/deploy. (Optional later: `GEMINI_API_KEY` + `GEMINI_MODEL`, see ARCHITECTURE.md before enabling.)

## Part 3 — connect them

1. **Pub/Sub → your Worker.** Google Cloud → Pub/Sub → Subscriptions → Create subscription → ID `vencourier-push`,
   topic `vencourier-gmail`, delivery type **Push**, endpoint URL
   `https://vencourier-driver.<something>.workers.dev/hooks/gmail?token=<PUBSUB_TOKEN>` → Create.
2. **In the app** (⚙ Settings): paste `APP_TOKEN` into *Server access token* → Save (the page reloads, and the
   DEMO badge disappears).
3. Tap **📬 Start Gmail alerts**. It should say alerts started. (The server renews this automatically every day.)
4. Tap **🔔 Enable job alerts** and allow notifications.
   **iPhone:** first Share → *Add to Home Screen*, then open the app from the Home Screen icon and do this step there.

## Test it safely

Send an email to yourself from another of your addresses, add that address to `DISPATCH_SENDERS` in
`wrangler.toml` (ask Claude to commit it), and check that a job appears with a notification within seconds. Decline it.
Only mail from `DISPATCH_SENDERS` ever becomes a job.

## Notes

- **Billing:** Google may require a billing account to enable Routes, and Cloudflare's Workers/D1 free tiers should cover
  one driver. Check both current limits. Without a Maps key everything works except in-app distance/ETA (map links still work).
- **Security:** anyone with `APP_TOKEN` can act as you — treat it like a password. If it leaks, change the Cloudflare
  secret and update the app's Settings.
