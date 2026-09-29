# Architecture

## Push, not polling

```
Gmail inbox ──(users.watch)──▶ Cloud Pub/Sub topic ──(push subscription, HTTPS POST)──▶ Worker /hooks/gmail
                                                                                          │ history.list → fetch new mail
                                                                                          │ parse → store (D1)
                                                                                          ▼
                                                              Web Push "wake-up" ──▶ phone shows notification
```

- Delay from email arrival to phone alert is typically seconds. Nothing polls Gmail on a timer.
- `users.watch` expires after 7 days; a daily cron renews it and catches up on anything a dropped push missed.
  The app also syncs when opened, so a missed push is never a missed job.
- Pushes carry **no payload**. The service worker asks the API what happened, so job details (medical/aerospace)
  never pass through Apple/Google/Mozilla's push services.
- iPhone: Web Push only works once the PWA is added to the Home Screen (iOS 16.4+).
- Pub/Sub, Workers and D1 free tiers should cover one driver (verify current limits).

**Gmail OAuth gotcha:** for an external OAuth app left in "Testing" status, refresh tokens expire after 7 days.
For personal use, set the consent screen to "In production" (you'll see an "unverified app" warning only you will see).
Using other people's mailboxes commercially needs Google's app verification and a security assessment for the
restricted Gmail scopes — plan for that before selling it.

## Dispatch-first vs driver-first

Driver-first with email as the transport is the right start: Moving Forward's jobs arrive as email from Airspace and
dispatchers work in their own mail, so the driver app is useful on day one without anyone else adopting anything.
The code keeps the door open: the driver app only knows `Job` objects; email is just an "ingest" function
(`src/worker/sync.ts`) and a "send" function. A Dispatch app would become another source (and replace the email send
with an API call), with email demoted to an optional notification channel — no change to `src/core`.

## Parsing: each fact appears exactly once

1. **Airspace template** (`parser/airspace.ts`) — deterministic, no LLM. Each labelled section maps to one field.
2. **Free-form dispatcher email** (`parser/freeform.ts`) — heuristics for labelled blocks, `Dims:`, refs, subject.
3. **Optional LLM** (`parser/llm.ts`) — only when heuristics find < 75% of the essentials. Sorts leftovers into
   fields; whatever fits nowhere lands in `notes`. Boilerplate (greetings, signatures, logos) is dropped; the
   original email is always one tap away.

Gemini has a free API tier for personal use, but free-tier terms have allowed Google to use submitted content to
improve its products. These emails contain hospital/aerospace shipment details, so check current terms (and what
Moving Forward would expect) before enabling it. It is off unless `GEMINI_API_KEY` and `GEMINI_MODEL` are set.
The paid Gemini tier or the Claude API are drop-in alternatives (`parser/llm.ts`).

## The email-size problem

Replies are built from scratch (`worker/mime.ts`): only the status line, your notes and the attachments you add.
No quoted history and no HTML signature, so logos and earlier photos can't compound. Photos are resized in the
browser (~1800px JPEG, ≈300 KB) before upload; the server enforces a 20 MB total.

## Routes and ETAs

- Distance/ETA come from the Google Routes API via the Worker (`/api/eta`): one call for
  *you → pickup → delivery*. Delivery ETA adds expected pickup time: 15 min by default, then the median of your own
  past visits to that pickup location (`core/stats.ts`).
- Navigation is handed to your map app. Google Maps and Apple Maps links carry the whole route
  (current location → pickup → delivery); Waze accepts one stop, so it's leg by leg. No map app can encode the
  15-minute pause, so it's shown in the app's own ETA.
- **Location rules** (`core/locations.ts`) fix where a map app's default pin is wrong. Seeded: Boeing Everett —
  before 1700, deliveries go to the E70 gate. **Verify that rule's search text** (`E70 Gate, Boeing Everett Factory,
  Everett, WA`) by tapping "To delivery" once and checking the pin; edit it in Settings.

## Paperwork

`core/paperwork.ts` reads dispatch's instructions (e.g. "last page of the alert printed and affixed to all boxes")
and proposes pages/copies per PDF, with the reason shown. You edit before generating one merged PDF. The rules were
written from the email text only, not the actual PDFs — expect to tune them on the first real jobs.

## Assumptions to confirm

- Decline sends "Unable to cover this job." (no decline wording was specified).
- Replies go to the address the job email came from.
- Only mail from `DISPATCH_SENDERS` creates jobs — personal-use scope; the rest of your inbox is ignored.
- Times are `America/Los_Angeles`, editable in Settings.
- Auth is one shared token (fine for one driver; use real accounts before other drivers use it).
