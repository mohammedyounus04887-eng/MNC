# Growline

The daily operating system for a wellness coach. Mobile-first PWA + desktop dashboard, one codebase.

Built by The Real V Developers, Bengaluru.

Product context and hard rules live in [CLAUDE.md](CLAUDE.md). Stack deviations are recorded in [DECISIONS.md](DECISIONS.md).

## Getting started

```bash
npm install
```

Create `.env` from the example and fill in a session secret:

```bash
cp .env.example .env
```

`SESSION_SECRET` must be 32+ random bytes of hex. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set up the local database:

```bash
npx prisma migrate dev
```

Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Dev-mode OTP

There is no SMS provider wired up yet. In development the 6-digit code is shown
on the verify screen and printed to the server console. `sendOtp()` in
[src/lib/otp.ts](src/lib/otp.ts) is the single swap point for a real provider.

## Offline capture

Prospect capture **and the daily log** work without network: both queue in IndexedDB
and upload by themselves when signal returns (`src/lib/offline-queue.ts`, drained by
`src/components/OfflineSync.tsx`). The screens themselves stay reachable offline via
`public/sw.js`, which is registered in **production builds only** — to exercise it,
run `npm run build` then `npx next start`, not `npm run dev`.

If you add a third kind of queued item, remember to include it in **both**
`syncQueue()` and the guard inside `OfflineSync` — checking only one queue there is
how queued logs silently stopped syncing during Phase 5.

## The daily log

Six fields exactly (five counts and a note), which is the Section 5.6 ceiling —
[src/lib/daily-log.ts](src/lib/daily-log.ts) holds the field list, streak maths and
milestone copy; queries are in `daily-log-queries.ts`. A log's `log_date` is local
midnight as a UTC instant so one evening can never become two rows, and streaks
measure from yesterday when today is still unlogged.

## Phase status

Phase 1 complete: project setup, phone+OTP auth, user profiles, referral codes,
team tree.

Phase 2 complete: manual capture (Mode A), public QR self-fill form at
`/c/<referralCode>` (Mode B), printable QR poster, and the offline queue.

Phase 3 complete: wellness snapshot engine (PNG card, PDF, public page at
`/r/<token>`) and the one-tap WhatsApp share.

Phase 4 complete: pipeline stages, follow-up dates and notes, search and stage
filters, an overdue-first follow-up queue, and morning reminders over web push.

Phase 5 complete: the daily log with streaks and milestones, offline log capture, and
live roll-ups into the upline's team view.

Phase 6 complete: monthly targets set by the upline, manual progress with a reached
celebration, the ask-for-proof review flow, and user-named levels.

Phases 7–10 per Section 14 of CLAUDE.md.

## Targets and proofs

All authorization for targets and proofs lives in
[src/lib/targets-queries.ts](src/lib/targets-queries.ts) — routes are thin wrappers, so
the whole permission matrix can be read in one file. Target-setting is **direct line
only** and a coach can never set their own; see DECISIONS.md D32 for the full matrix.

Two things that look like ordinary UI choices but are compliance requirements:

- **Level names have no suggestions, placeholder or default** (D29). Section 5.1
  forbids any company's rank names in this app, so the only way one can appear is a
  coach typing their own words. Do not add a suggested-levels list.
- **A target is a count of points** (D30). No currency, no conversion, no projection —
  Section 5.3 forbids income promises, and the celebration recognises effort only.

Proof photos are re-encoded through a canvas, which strips EXIF so a photo sent to an
upline cannot disclose the coach's GPS location (D33). Video is not supported yet — it
needs object storage.

## Follow-up reminders

Reminders are Web Push over VAPID, not FCM (DECISIONS.md D22). Generate keys once:

```bash
npx web-push generate-vapid-keys --json
```

Put them in `.env` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. With no
keys set, reminders simply stay unavailable and the in-app follow-up queue still
works.

`POST /api/notifications/daily` sends the morning reminder and expects to be called
**hourly** — it notifies each coach only when it is morning in their own timezone and
only once per local day, so one schedule serves every timezone. It requires
`CRON_SECRET` as a bearer token and refuses to run without one. To see what it would
send without sending anything:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/notifications/daily?dryRun=1"
```

Switching reminders on needs a real device or a production build — the service worker
registers in production only.

## Dates and timezones

Anything that asks "which day is it" must go through
[src/lib/day.ts](src/lib/day.ts). A UTC server is 5.5 hours behind India, so a naive
date comparison puts follow-ups on the wrong day every night between midnight and
05:30 IST.

## Wellness snapshots — read before changing

The six permitted calculations live in [src/lib/wellness.ts](src/lib/wellness.ts) and
**every word** that appears on a report lives in
[src/lib/report-copy.ts](src/lib/report-copy.ts). Both files carry the reasoning at
the top. Three rules that are easy to break by accident:

- No metric outside the Section 5.2 list, ever. No clinical category word describes
  the person, and the encouraging line must not vary with the person's numbers.
- The disclaimer is drawn into the PNG's **pixels**, not overlaid in HTML. The PNG is
  what gets forwarded and screenshotted. The card is a fixed-height canvas and satori
  crops silently, so **if you add a tile or lengthen a line, re-render the card and
  confirm the disclaimer is still in frame** — the footer is pinned to the bottom
  edge for exactly this reason.
- A report row is immutable and its metrics are frozen at generation time. Changing
  the shape or the basis of a metric means bumping `REPORT_SNAPSHOT_VERSION`.

See DECISIONS.md D11–D19 for why the BMI bands, water basis, calorie omission and
under-18 refusal are what they are.
