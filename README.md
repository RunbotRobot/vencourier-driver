# Vencourier - Driver

A PWA for independent courier drivers. It turns dispatch emails into jobs, walks the driver through each
step (accept → en route → onsite → picked up → onsite → delivered), and sends the right email at each step —
so the driver never has to open Gmail.

Built first for one driver (Moving Forward / Airspace jobs) but structured to grow: a companion
**Vencourier - Dispatch** app, and other drivers/dispatchers later.

## Try it now (demo mode)

```bash
npm install
npm run dev        # with no server token set it runs on sample jobs; nothing is emailed
npm test           # parsers, workflow, email wording, routing rules, paperwork
```

## What's here

| Path | What |
|---|---|
| `src/core` | Framework-free domain logic shared by app and server: email parsers, step workflow, email wording, routing rules, dwell learning, paperwork planning |
| `src/app` | The PWA (Preact): Offered / Active / Completed / Declined tabs, step-by-step job screen |
| `src/worker` | Cloudflare Worker: Gmail push ingest, threaded replies with photo attachments, Web Push, ETA proxy |
| `docs/ARCHITECTURE.md` | How push delivery works, design decisions, assumptions to confirm |
| `docs/SETUP.md` | Connecting Gmail, Pub/Sub, Cloudflare, and your phone |

## Status

Built and tested locally: parsing, workflow, email composition, routing/ETA logic, paperwork PDF, PWA UI (demo mode), Worker code (typechecked).
**Not yet verified against real services** (needs your Google/Cloudflare credentials): Gmail watch + Pub/Sub push,
sending replies, Web Push delivery, Google Routes ETAs. See `docs/SETUP.md`.
