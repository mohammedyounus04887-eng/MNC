# Architecture Decisions

Deviations from the Section 10 stack recommendation, with reasons (as Section 10 requires).

> **⚠️ The migration target changed in v2. Several decisions below name Supabase as
> the destination — that is now WRONG.** [BUILD_PROMPT_V2.md](./BUILD_PROMPT_V2.md) §3
> replaces it with Firebase. Read the swap points in these entries as pointing at
> Firebase, not Supabase:
>
> | Decision | Says "swap to…" | Actually swap to |
> |---|---|---|
> | D1 (SQLite database) | Supabase Postgres + RLS | **Cloud Firestore + Security Rules** |
> | D2 (custom OTP + JWT) | Supabase Auth | **Firebase Auth, Phone provider** |
> | D3 (data-URL photos) | Supabase Storage | **Firebase Storage** (+ resize Function) |
> | D22 (Web Push/VAPID) | FCM later, for Android only | **FCM now, replacing VAPID entirely** |
> | D33 (no video proofs) | blocked on object storage | **Unblocked** — Firebase Storage |
>
> The *reasoning* in each entry still holds; only the destination moved. D11 is
> unaffected — v2 §3 does not ask for report blobs in Storage, so reports keep
> rendering on demand from the frozen snapshot.

## D1 — Local dev database: Prisma + SQLite instead of Supabase (2026-08-08, Phase 1)

**Why:** No Supabase project/credentials exist yet, and the user asked to start with a dev-mode OTP stub (no external services). Prisma + SQLite gives a zero-setup local database.

**Migration plan:** The Prisma schema mirrors Section 11 table/column names exactly (`users`, `daily_logs`, `targets`, snake_case columns via `@map`). When Supabase credentials arrive: switch the datasource to Postgres, run migrations against Supabase, and add RLS policies (the privacy toggle in Section 5.4 must be enforced in RLS, not just app code). All DB access goes through `src/lib/db.ts` and API routes — no client-side DB calls — so the swap is contained to the server layer.

## D2 — Auth: custom phone+OTP with JWT session cookie instead of Supabase Auth (2026-08-08, Phase 1)

**Why:** Same as D1 — no Supabase project yet. The UX (phone → OTP → profile) is identical to Supabase's phone OTP flow, so screens won't change when we swap.

**Implementation:** OTPs are random 6-digit codes, SHA-256 hashed in the `otp_codes` table, 10-minute expiry, max 5 verify attempts, basic per-phone rate limit. In dev mode the code is echoed back to the UI and console instead of sent via SMS (`src/lib/otp.ts` — the `sendOtp` function is the single swap point for a real SMS provider: Twilio/MSG91 via Supabase Auth later). Sessions are 30-day HS256 JWTs (`jose`) in an httpOnly `gl_session` cookie.

**Route protection:** `src/proxy.ts` (Next 16's replacement for middleware) does a cheap cookie-presence redirect; real JWT verification happens in the authenticated layout and in every API route. Auth-near-routes is the Next 16 recommended pattern.

## D3 — Profile photos: client-side resized data URLs in the DB instead of Supabase Storage (2026-08-08, Phase 1)

**Why:** No storage bucket yet. Photos are downscaled client-side to 256px JPEG (~20 KB) before upload, so DB bloat is bounded. Swap point: upload the same resized blob to Supabase Storage and store the URL — the `photo_url` column already holds a string either way.

## D5 — Capture requires only name + phone (2026-08-09, Phase 2)

**Why:** F2 lists six fields, and all six are on the screen. But the 30-second rule
means a coach stopping someone on a morning walk often won't know their age or
weight yet. Blocking the save would cost them the person. So name and phone are
required; age, gender, height and weight are optional and range-validated when
given. The Phase 3 report engine asks for whatever is missing before it can
generate a report.

## D6 — `clientId` column added to `prospects` (2026-08-09, Phase 2)

**Why:** The offline queue retries. Without an idempotency key, one weak-signal
capture could become three people after a flaky sync. Each queued capture carries
a client-generated UUID, unique per coach, so replays return the original row
(`duplicate: true`) instead of inserting again. Null for QR self-fills, which are
created online in a single request. This extends the Section 11 model, which
invites extension.

## D7 — Public capture form lives at `/c/<referralCode>` (2026-08-09, Phase 2)

**Why:** The QR encodes this URL, so it should be short enough to also read aloud
or type. It is deliberately **not** at the root: F9 reserves `growline.in/<username>`
for portfolios, and a root-level capture path would eventually collide with a
username. `/c/` is added to the public allowlist in `src/proxy.ts`. The page is
`noindex, nofollow` — prospect details must never be crawlable.

## D8 — Minimal hand-written service worker (2026-08-09, Phase 2)

**Why:** "Prospect capture must work offline" is not satisfied by the IndexedDB
queue alone — a cold open with no network needs cached HTML and JS. `public/sw.js`
is ~60 lines with no build step or Workbox dependency: cache-first for hashed
`/_next/static/` assets, network-first with cache fallback for pages, and `/api/`
never cached (stale auth or stale prospect lists would be worse than an error).

**Honest limit:** a route works offline only after being opened once with network.
There is no precache, because precaching authenticated routes at install time
risks caching a `/login` redirect under a real path.

Registered in production only (`ServiceWorkerRegistrar`) — in development a cache
layer fights HMR and hides code changes. Verified against `next start`, not `next dev`.

## D9 — Queue sync is driven from the app layout, not the Prospects screen (2026-08-09, Phase 2)

**Why:** First implementation drained the queue inside the Prospects list
component. A coach who captures ten people on a walk and never opens that list
would have kept ten unsynced captures on their phone. `OfflineSync` now lives in
the authenticated layout and drains on mount, on `online`, and when the tab
becomes visible again, from any screen.

Capture also skips the network entirely when `navigator.onLine` is false and caps
any attempt at 8 seconds — a hanging request on a weak signal otherwise leaves the
coach staring at a stuck "Saving…" button well past 30 seconds.

## D10 — QR submissions are not yet pushed in real time (2026-08-09, Phase 2)

F2 says a QR self-fill "appears instantly in the coach's pipeline with a
notification." The row is written immediately and shows on the next load of the
Prospects screen, but there is **no push notification yet** — FCM is Phase 4.
Polling was rejected deliberately: background polling burns data on the cheap
plans this audience uses (Section 4.4).

## D11 — Reports render on demand from a frozen snapshot, not stored blobs (2026-08-09, Phase 3)

**Why:** Section 10 calls for rendering PNG/PDF into Supabase Storage. There is no
Supabase project yet (D1), and storing blobs would also mean managing their
lifecycle and deletion. Instead the `reports` row stores a **frozen metrics
snapshot** plus an unguessable token, and the PNG, the neutral preview image and
the PDF are all rendered on demand from that snapshot. `image_url` / `pdf_url` from
the Section 11 model are therefore not needed — the token *is* the address.

A report row is **immutable**. If a coach later fills in a missing age, a NEW report
with a new token is minted rather than the old one being rewritten: a prospect who
already opened a link must never find the numbers changed underneath them.

`REPORT_SNAPSHOT_VERSION` guards the stored shape. A snapshot from an older version
is treated as unreadable rather than rendered, because coercing an old shape would
either crash a render or — worse — display a figure computed on a basis since
corrected. Bumping it retires old links; the coach's screen mints a fresh one
automatically.

## D12 — BMI bands use the WHO Asia-Pacific cut-offs (2026-08-09, Phase 3)

18.5 / 23 / 25, not the WHO international 18.5 / 25 / 30. South Asian bodies carry
more fat at a given BMI, so the international set would tell a large share of
at-risk Indian adults they are in the clear.

**Consequence to be aware of:** these lower cut-offs place many ordinary Indian
adults above the range, which is precisely why the labels are non-clinical (D13).
The card **names the standard it used**, so the numbers shown and the standard cited
must always change together. A separate Indian consensus (Misra et al. 2009, JAPI —
the set MoHFW/NPCDCS use) puts the lower bound of normal at 18.0 rather than 18.5;
switching to it means editing the citation too.

## D13 — No clinical category word ever describes the person (2026-08-09, Phase 3)

Bands read "Below / In / Just above / Above the general range" — never "Obese",
"Overweight", "Underweight" or "Normal".

**Why this is legal, not cosmetic:** "obesity" is a listed condition in the Schedule
to the Drugs and Magic Remedies (Objectionable Advertisements) Act 1954, whose s.3
bars advertisements suggesting diagnosis or cure of a scheduled condition — and F3
explicitly calls this report a marketing asset for the coach. Separately, CDSCO's
medical-device-software guidance keeps "general wellness" software outside MDR-2017
only while it has no medical purpose; naming a disease state and attaching a next
step is the shortest path to being argued into SaMD licensing.

Consequences enforced in code: labels describe where the **number** sits, not what
the person **is**; one neutral accent colour for every band with no red/green,
arrows or severity icons; below-range treated exactly as calmly as above-range; and
the encouraging line is chosen from a fixed pool by a hash of the report id,
**independently of the band** — copy that varies with a health estimate is
advice-by-algorithm. All report copy lives in `src/lib/report-copy.ts` and none of
it is coach-editable at runtime.

A second disclaimer line travels with the Section 5.2 line, because the Consumer
Affairs / ASCI guidance for health-and-wellness influencers requires saying this is
not a substitute for professional advice and encouraging a consult, which the
Section 5.2 wording does neither of.

## D14 — Maintenance calories are NOT produced (2026-08-09, Phase 3)

Section 5.2 *permits* calorie guidance; it does not require it, and F3's report list
does not include it. Producing one would mean applying an invented activity
multiplier, because capture collects no activity level — and adding an activity
field would put the capture screen at seven inputs, over the Section 5.6 limit.

A fabricated low calorie figure, sent by someone who sells meal replacements, is a
real mechanism of harm rather than a missing feature. BMR is shown instead, hedged
as an estimate. If this is ever added, it needs its own step to ask activity level,
must be framed as a range against a stated assumption, and must never display a
number below BMR.

## D15 — Refuse rather than degrade; no snapshots for under-18s (2026-08-09, Phase 3)

A report needs age **and** height **and** weight, or it is not made. A card with
blanks invites the coach to supply the number verbally, off the record, which is the
one channel no control reaches.

Under-18s are refused outright. The DPDP Rules 2025 (Rule 10) require verifiable
parental consent before processing a child's data, which a roadside conversation
cannot deliver; Deurenberg also has a separate children's equation and adult BMI
bands do not apply below 19. Capture itself still accepts partial details — the
30-second rule from Phase 2 is unchanged; only report generation is gated.

Note the age gate is 18 (the legal threshold) while WHO's BMI-for-age reference runs
to 19; at 18 the adult curves have effectively converged, so the practical error is
negligible.

## D16 — Water guidance is EFSA/ICMR adult intake, not weight × 35 ml (2026-08-09, Phase 3)

The per-kg rule is **not** an evidence-based population recommendation. It is a
clinical IV-maintenance heuristic for hospitalised patients, descended from a 1945
suggestion of 1 ml per kcal; Valtin (2002) found no evidence for it in healthy
adults. Multiplying a prospect's weight by it and presenting the product as their
personal target would be inventing a requirement.

The card now shows EFSA's Adequate Intake for total water — 2.0 L for women, 2.5 L
for men, and a 2–2.5 L span when sex is unknown — which agrees with ICMR-NIN's 2024
"about 8 glasses" for Indian adults, and states that it counts all fluids including
water in food. This is why water no longer varies with weight.

Body fat is shown as a **range**, never a single decimal: the Deurenberg standard
error is ~4 percentage points, and one decimal would claim precision the formula
does not have. Body fat and BMR are both omitted for gender "other" rather than
guessed — every published equation is keyed to binary sex, and averaging the two has
never been validated.

## D17 — The snapshot link is treated as a bearer credential (2026-08-09, Phase 3)

The link travels over WhatsApp to someone with no account, so the token is the whole
access control: ~130 bits, rejection-sampled so every character is uniform, with no
lookalike glyphs, and validated before any database lookup.

Around it: a 90-day expiry (checked on every public surface); `noindex, nofollow`,
`Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` via
`next.config.ts`; **first name only** and never the prospect's phone on any rendered
surface; nothing but the opaque token in the URL; and a link-preview image that is
**neutral branding with no metrics**, because a forwarded link renders its preview
inside whatever group chat it lands in.

There is also a public "Not you, or want this removed?" control that deletes the
prospect. Holding the link is the authorisation — the same bearer secret that grants
read access — and deletion is the safe direction to fail.

**Known limitation:** the snapshot HTML keeps Next's own
`Cache-Control: no-cache, must-revalidate`, which overrides both the proxy and
`next.config` headers on dynamic page responses. Revalidation is enforced but the
response is not marked `private`. The card, preview and PDF routes do carry
`private, no-store`, because a Route Handler controls its own headers.

## D18 — Card typography is size-and-colour, not weight (2026-08-09, Phase 3)

The card is rendered with `next/og` (satori + resvg, already bundled with Next — no
new dependency, no native build). satori only ships one font, Geist **Regular**, and
`fontWeight: 700` against a single 400-weight face is a silent no-op producing a
byte-identical PNG. So the card builds hierarchy from size and colour instead, which
still satisfies Section 9's "numbers large and bold" in spirit but not in weight.

**To get real bold:** add Inter Regular + Bold `.ttf` files to the repo and pass them
via the `fonts` option. satori cannot parse `woff2`, so the files Next caches for
`next/font` are unusable, and `next/font` emits CSS rather than font bytes. This
needs font files added to the project — flagged rather than done, since it means
committing binaries.

**Non-Latin names are a live limitation.** Devanagari and Kannada names do render,
but satori has no glyphs for them in the bundled font and fetches a fallback from
Google Fonts **at render time**. That means a runtime network dependency on the
image path, added latency, and the name being sent to a third party. Verified
working online; it will degrade if egress is blocked. The fix is the same: ship Noto
Sans Devanagari / Kannada / Tamil `.ttf` files. The image routes now fail soft
(logged 500, no stack trace) so the web snapshot still works if a render fails.

The prospect's name is also kept out of the PDF's `Content-Disposition` filename —
HTTP headers are byte strings, so a Devanagari name threw outright, and the filename
would have followed the file into the prospect's downloads.

## D19 — Portfolio link on the report is deferred to Phase 8 (2026-08-09, Phase 3)

F3 and F4 say the report carries the coach's portfolio link. The portfolio (F9) does
not exist until Phase 8, and shipping a dead link on a prospect-facing marketing
asset is worse than shipping none. The report carries the coach's name, photo, city,
phone and a "Message me on WhatsApp" button; the portfolio URL slots in when Phase 8
lands.

## D20 — Report identity is a hash of its inputs (2026-08-09, Phase 3)

`reports` carries `inputs_hash` with `UNIQUE (prospect_id, inputs_hash)`, and
`ensureCurrentReport` upserts on it.

**Why:** report creation runs during a GET page render, so two tabs — or a save
racing the `router.refresh()` that follows it — could each insert a row. That meant
two live 90-day bearer tokens to the same person's health data, only one of which
the coach ever saw or could mark as sent. With the constraint, concurrent writers
converge on one row; verified with six simultaneous requests returning a single
token. An expired row is refreshed in place, keeping one identity per set of inputs.

## D21 — Public URLs come from NEXT_PUBLIC_SITE_URL (2026-08-09, Phase 3)

QR capture URLs, snapshot links and the Open Graph image base all resolve through
`src/lib/site-url.ts`, which prefers `NEXT_PUBLIC_SITE_URL` and falls back to the
request's Host header so local development needs no configuration.

**Why:** the Host header is attacker-controlled, and Next needs an absolute
`metadataBase` for relative `og:image` URLs — without one they resolve to localhost
off Vercel, so a forwarded snapshot link renders in WhatsApp with no preview card at
all and nothing in development reveals it. **Set this in production.**

## D22 — Web Push over VAPID instead of FCM (2026-08-09, Phase 4)

Section 10 specifies FCM. Reminders use the **Web Push API with VAPID keys**
(`web-push` + the existing service worker) instead.

**Why:** FCM's web delivery *is* Web Push underneath — Firebase mainly adds a
console, a vendor account and an SDK. VAPID keys are generated locally
(`npx web-push generate-vapid-keys`), so follow-up reminders work today with no
external account, consistent with D1/D2. FCM stays available later for the
Capacitor Android build, where native delivery does need it; the subscription table
and the send wrapper (`src/lib/push.ts`) are the only pieces that would change.

Notifications are treated as an enhancement throughout: with no keys configured
everything no-ops and the in-app follow-up queue still does the job. A dead
subscription (404/410 from the push service) is deleted rather than retried forever.

## D23 — The daily reminder runs hourly and decides per coach (2026-08-09, Phase 4)

`POST /api/notifications/daily` is meant to be called **every hour** by a scheduler,
not once a day. Each coach is notified only when it is morning in *their* timezone
(captured at subscribe time) and only once per local day, tracked by
`users.followup_push_on`.

**Why:** one daily cron fires at a single UTC moment, which is the middle of the
night for some users. An hourly job with a per-coach morning check serves every
timezone from one schedule and can be retried safely. Verified: a Kolkata coach at
17:00 local is skipped as `not-morning-there` while a New York coach at 08:00 is
selected, and a second run in the same local day skips as `already-sent-today`.

The endpoint **fails closed** — without `CRON_SECRET` it returns 503, and it
compares the supplied secret in constant time. Otherwise anyone on the internet
could trigger a push to every coach. `?dryRun=1` reports exactly what would be sent
without sending, which is how the logic is verified without a live push service.

**Not verified end to end:** actual delivery and the browser permission grant.
Notification permission cannot be granted in this automated environment, and the
service worker registers in production builds only — so `Settings → Morning
reminder` needs a real device or production build to switch on. The graceful-failure
path was verified against unreachable endpoints; the 404/410 cleanup branch was not
exercised against a live push service.

## D24 — All day boundaries go through a timezone helper (2026-08-09, Phase 4)

`src/lib/day.ts` resolves "which day is it" in a named zone (`Asia/Kolkata` by
default), and every follow-up query and label uses it.

**Why:** a server in UTC is 5.5 hours behind India. A naive `new Date()` comparison
puts every follow-up between 00:00 and 05:30 IST on the wrong day, so "6 follow-ups
today" would be wrong for five and a half hours every night. Verified against known
IST facts: 18:29Z is still 9 August in India while 18:30Z is already the 10th, the
IST day starts at 18:30Z the previous day, a follow-up at 23:00 IST counts as today,
and month/year/leap rollovers are correct.

Buckets and labels are computed **server-side** and passed to the list, so every row
agrees on what "today" is instead of each browser deciding from its own clock.

## D25 — Pipeline edits are a separate endpoint from details (2026-08-09, Phase 4)

`PATCH /api/prospects/[id]/pipeline` handles stage, follow-up and notes;
`PATCH /api/prospects/[id]` still handles the six capture fields as a set.

**Why:** the details route validates name and phone together, so a one-tap stage
move would have had to resend them to succeed. Splitting keeps the 30-second rule
intact and means a stage change cannot fail on unrelated validation. Notes live here
rather than on the capture screen, which is already at the Section 5.6 six-field
ceiling.

`src/lib/followup.ts` is **pure** (no database import) because client components use
its date and copy helpers; the queries live in `followup-queries.ts`. Importing
`./db` into anything a `"use client"` file touches pulls the SQLite driver into the
browser bundle and breaks the build with `Can't resolve 'fs'`.

## D26 — `log_date` stores local midnight as a UTC instant (2026-08-09, Phase 5)

A daily log's `log_date` is the UTC instant of midnight in the coach's timezone, via
`logDateFor()`.

**Why:** that is what makes `unique(user_id, log_date)` mean "one log per coach per
day **in their own day**". Storing a raw timestamp would split an Indian evening
across two UTC days and let one evening produce two rows.

The same fix was applied to `src/lib/team.ts`, which computed the month boundary and
"today" from **server-local** time. On a UTC host that counted the wrong month for
the first 5.5 hours of every 1st and read the wrong "today" every night — it would
have quietly corrupted the roll-ups this phase is built on. Not a refactor: the
Phase 5 roll-ups depend on it being right.

## D27 — Streaks measure from yesterday when today is unlogged (2026-08-09, Phase 5)

`streakFromKeys` anchors on today if today is logged, otherwise on yesterday.

**Why:** a coach who logged ten days straight and opens the app at 4pm should see
"10", not a zero implying they already lost it. The streak only breaks once a whole
day passes unlogged. Verified against ten cases including gaps, duplicate keys,
month boundaries and a future-dated row.

Backfill is capped at 14 days (`MAX_BACKFILL_DAYS`) — enough for any offline log to
sync, but not enough to manufacture a streak after the fact. Milestones fire only on
the **first** save of **today**: a backfilled day is not an achievement to announce,
and correcting a number must not replay a celebration the coach already saw.

Milestone copy celebrates the habit and never earnings (Section 5.3), and the
celebration is a colour change plus one line — Section 4.8 wants recognition, Section
4.4 rules out anything heavy on a cheap phone.

## D28 — The offline queue now carries logs as well as prospects (2026-08-09, Phase 5)

Section 4.3 requires that "prospect capture **and daily logs**" work offline. The
IndexedDB database moves to version 2 with a second store, `pending_logs`, keyed by
day — so re-saving an evening overwrites rather than queueing twice, and last write
for a day wins, which is what correcting a number should do.

The store creation is guarded individually so upgrading a v1 database adds only what
is missing and loses nothing already queued (verified: both stores present after
upgrade, prospects store intact).

Logs sync even when the prospect loop stops early — a stuck prospect must not hold a
coach's streak hostage. A day the server refuses as too old to backfill is **dropped**
rather than retried forever.

## D29 — Level names are free text with no default and no suggestions (2026-08-09, Phase 6)

`users.level_name` is NULL by default, and `LevelNameField` has no placeholder, no
example, no datalist and no picker.

**Why:** F7 says level names are user-editable labels "never pre-filled with any
company's rank names", and Section 5.1 forbids any direct-selling or nutrition
company's trademarks appearing anywhere in this app. A suggestion list would be
exactly that — us shipping the rank names. The only way a rank name can appear is a
coach typing their own words, which is their choice about their own screen. **Do not
add suggested levels here**, however helpful it looks.

The label is shown to the coach's upline on the targets screen, because it is the
coach's own description of what they are working toward.

## D30 — A target is a count of points and nothing else (2026-08-09, Phase 6)

No currency, no conversion, no projection, no "at this rate you would…". Section 11
calls the field `target_points` and F7 says "points/volume"; the UI says **points**
only — "volume" is loaded language in this industry and invites a money reading.

Section 5.3 forbids income promises, so the celebration copy recognises effort
("Target reached. Your line can see this.") and never earnings. Verified by grep:
no rank names, no ₹, no income/commission/payout wording anywhere in the target code.

## D31 — Achievement is derived from the numbers, not the stored status (2026-08-09, Phase 6)

`targets.status` is maintained for querying, but every display asks
`isAchieved(progress, target)` instead.

**Why:** the stored status is only refreshed when a target or its progress is
written. A row last touched before it was met — an old month, a seeded row, a
migration — showed "105%" beside no "Reached" badge and a bar that never turned
green, which reads as a bug to the coach. Caught on real data: a Phase 1 seeded
target sitting at 420/400 with `status = "active"`.

Overshoot is shown honestly ("105% — past the target") while the bar clamps at 100%.

## D32 — All target and proof authorization lives in targets-queries.ts (2026-08-09, Phase 6)

Every mutation re-derives permission from the database; routes are thin. The matrix,
verified end to end:

| Actor | set target | move progress | ask proof | attach evidence | approve/reject |
|---|---|---|---|---|---|
| the coach | ✗ | ✓ | ✗ | ✓ | ✗ |
| their DIRECT upline | ✓ | ✗ | ✓ | ✗ | ✓ |
| an upline two levels up | ✗ | ✗ | ✗ | ✗ | ✗ |
| anyone else | ✗ | ✗ | ✗ | ✗ | ✗ |

Target-setting is **direct line only**, per F7 — reaching past it would let a
grandparent overwrite the target a coach's own upline set. A coach cannot set their
own target, which is the entire point of the feature. "Not allowed" and "not found"
return the same 404 so no route can be used to probe the tree.

A rejection requires a comment: sending work back with no reason is a dead end for
the downline, who cannot tell what to fix. An approved proof cannot be re-answered.

## D33 — Proof photos are re-encoded, which strips EXIF (2026-08-09, Phase 6)

`fileToProofDataUrl` draws the photo through a canvas and re-encodes it as JPEG,
stepping quality down until it fits rather than rejecting a large photo outright.

The size bound matters for Section 4.4, but the **re-encode matters more for
privacy**: a camera photo carries GPS coordinates and a timestamp, and this image is
about to be sent to the coach's upline. Re-encoding means a proof cannot quietly
disclose where a coach lives. The screen tells them so.

**Video is not supported.** F7 says "photo/video", but there is nowhere to put a
video — no object storage yet (D1/D3), and a video cannot live in a bounded data URL.
Photos plus a note cover the trust case; video needs Supabase Storage or S3 first.

The `proofs` table adds a `submitted` status beyond Section 11's
pending/approved/rejected, because without it there is no way to distinguish "not
answered yet" from "answered, waiting on the upline" — which is the state the
downline is actually waiting on.

## D4 — Next.js 16 notes (scaffolded 2026-08-08)

create-next-app installed Next 16.3.0: `middleware.ts` is now `proxy.ts` (named `proxy` export, Node runtime), and `cookies()` / `headers()` / `params` / `searchParams` are strictly async everywhere. Docs live in `node_modules/next/dist/docs/` per AGENTS.md.

## D34 — Firebase Auth uids are the pre-existing cuids (2026-08-09, v2.1a)

The migration calls `auth.importUsers()` with `uid` set to each user's existing
`cuid`, keyed by phone, instead of letting Firebase mint new uids at first sign-in.

**Why:** every foreign key in the database — `coachId`, `userId`, `setById`,
`requestedById` — points at the cuid, and migrated users do not sign in until
*after* cutover, so a Firebase-minted uid does not exist at migration time. The
alternatives were rewriting every foreign key later, or an `authUid → userId`
mapping collection that costs a `get()` inside **every rule evaluation on every
collection, forever**. Setting the uid ourselves costs one script and keeps
Security Rules as plain `request.auth.uid == …` comparisons with no lookups.

Users still re-verify by SMS exactly as BUILD_PROMPT_V2 §3 requires — they simply
land back on the same id. Verified: `auth.getUser(cuid)` returns the user with the
original E.164 phone intact.

## D35 — Every `@@unique` became a deterministic document id (2026-08-09, v2.1a)

Firestore has no unique constraints, and all four in the Prisma schema were
load-bearing. Each is now expressed as the document id, because a `set()` on a
deterministic id is an upsert and two racing writers converge on one document:

| Was | Now |
|---|---|
| `unique(coachId, clientId)` (D6) | `prospects/{coachId}__{clientId}` |
| `unique(prospectId, inputsHash)` (D20) | `reports/{prospectId}__{inputsHash}` |
| `unique(userId, logDate)` (D26) | `dailyLogs/{userId}__{dayKey}` |
| `unique(coachId, month)` | `targets/{coachId}__{month}` |

**Do not replace these with auto-ids plus a query.** A query is not atomic, and the
constraint silently stops existing — which for D20 means two live 90-day bearer
tokens to one person's health data.

`clientId` arrives from the browser, so `assertValidDocId` rejects ids containing
`/`, the ids `.`/`..`, anything matching Firestore's reserved `__.*__` pattern, and
anything over 1500 bytes. QR self-fills have no `clientId` and keep an auto-id.

A count mismatch after migration is therefore usually two source rows colliding on
one id — the constraint working, not a bug to paper over.

## D36 — `uplinePath` is denormalised onto logs and targets (2026-08-09, v2.1a)

`dailyLogs` and `targets` each carry a copy of their owner's `uplinePath`.

**Why:** `buildTeamTree()` used **four `groupBy` aggregations**, which Firestore
cannot express. BUILD_PROMPT_V2 §11 schedules the Cloud Function counters that
replace them for v2.1b — but the team tree is v1 Phase 1, so v2.1a's parity gate
has to prove it works. As written, v2.1a was asked to pass a gate using machinery
it was not allowed to build yet.

With the path denormalised, an upline's whole-line roll-up is one
`array-contains` + `count()` and needs no Cloud Functions. Verified against the
emulator: 6 August logs across a two-level line, with the 31 July logs correctly
excluded. This also retires `isInDownline()`, which walked the tree with one query
per hop for up to 100 hops.

**Known limitation:** a log's `uplinePath` is frozen at write time, so moving a
coach in the tree leaves historical logs on the old path. There is no UI for tree
moves today and it is rare at pilot scale. If one is ever built, it must re-stamp
that coach's descendants' logs and targets.

## D37 — `importUsers()` is not an upsert, so the migration skips existing uids (2026-08-09, v2.1a)

Discovered by re-running the migration against the emulator: `importUsers()` fails
with *"localId belongs to an existing account — can not overwrite"* rather than
updating. A migration interrupted after the Auth step could therefore never be
re-run — it would fail at the same place every time and nothing downstream would
execute.

The script now looks up existing uids first (`getUsers`, max 100 identifiers per
call) and imports only the missing ones. Combined with `batch.set()` on
deterministic ids, which is already an upsert, the whole migration is safe to
re-run. Verified: a second run reports `0 created, 4 already present` and every
collection count is unchanged.

This is why §3 says run it against a copy first. A one-shot migration that cannot
resume after a partial failure is a trap.

## D38 — Security Rules deny everything during v2.1a (2026-08-09, v2.1a)

`firestore.rules` is `allow read, write: if false`.

**Why:** nothing in the app talks to Firestore from the browser yet. Every read and
write goes through API routes and server components using the Admin SDK, which
bypasses rules entirely — the same server-only shape D1 established. A permissive
placeholder is the kind of thing that survives to production; a deny-all cannot.

The real rules land in v2.1b with the privacy toggle, its mandatory test, and the
client listeners that are the first thing to actually need client reads.

## D39 — "Dark by default" and "respect the system" collide, and the system wins (2026-08-10, v2.2a)

BUILD_PROMPT_V2 §4 asks for both: *"Dark theme is the DEFAULT"* and *"respects
system preference on first run."* On the web those are not fully compatible.

**Why:** `prefers-color-scheme: no-preference` was removed from the CSS spec.
Chromium reports **light** for a device that has expressed no preference at all,
so a browser cannot distinguish "the user chose light" from "the user chose
nothing". Verified in Playwright: a context created with
`colorScheme: "no-preference"` still matches `(prefers-color-scheme: light)`.

**Resolved as:** the system preference decides on first run, so a device
reporting light gets light. Dark remains the default in the two senses that are
actually implementable — it is what the server renders before any script runs,
and it is what a device preferring dark (or any device once the Settings switch
is used) gets.

**Why this way round:** the alternative is ignoring the media query and forcing
dark until someone finds the Settings switch, which overrides a preference the
user has genuinely expressed at OS level. On a ₹10K Android the OS theme is a
real, deliberate setting, not a default nobody touched.

The pre-hydration HTML ships `data-theme="dark"` regardless, because a white
flash on every load for a dark-mode user is the most visible way a theme system
can feel broken — that has its own test.

## D40 — Today's Mission shows points, not a rupee equivalent (2026-08-10, v2.2a)

BUILD_PROMPT_V2 §4's example copy for the Today's Mission card reads:

> "🔥 Log today to keep your 12-day streak · 📞 6 follow-ups waiting ·
> 🎯 **₹-equivalent:** 400 VP to cross 75%"

**Not built as written.** The target item says points and stops.

**Why:** v1 §5.3 forbids income promises anywhere in UI copy, and D30 already
settled that a target is a count of points with no currency, conversion or
projection — "volume" was rejected as loaded language for the same reason. A
rupee figure attached to a progress number on the home screen is the clearest
possible income projection: it tells a coach what their activity is worth, every
time they open the app.

RULES L4 is a legal line. An illustrative string inside a design section does not
outrank it, and the rest of §4 is followed exactly — three items, generated from
the coach's own data, one tap to the action.

The `e2e/design.spec.ts` money-copy check now covers the home screen as well as
targets, so this cannot be reintroduced quietly.

## D41 — `unique(referralCode)` becomes a reservation document (2026-08-10, v2.2b)

D35 re-expressed four Prisma unique constraints as Firestore document ids. The
schema had **six**. `referralCode` and `reports.token` were left with their
read-then-write helpers intact and the constraint underneath them gone.

`referralCode` is the one that matters, and it cannot be a document id: the user
document is already keyed by the Auth uid (D34), and a document has one id. So the
code gets its own **reservation document**, `referralCodes/{CODE}`, holding only the
owning uid — created inside the same transaction that writes the user, which
Firestore aborts if anybody claimed it in between. `createUser` retries with a new
candidate up to 20 times and then throws rather than issue a duplicate.

**Why it is worth a collection:** a shared code silently reroutes one coach's QR
captures and downline placements to a stranger. Nothing errors and nobody notices
until a coach asks where their people went. `getUserByReferralCode` now resolves
through the reservation, so two coaches holding one code is unreachable rather
than merely unlikely — and it costs two document reads instead of a query.

Client reads and writes are both denied in `firestore.rules`. A write would let
anyone squat a code; a read would turn the collection into a directory mapping
every code to a coach's uid. `/join/<code>` resolves server-side.

**`reports.token` is deliberately left undefended.** 26 characters over a 33-char
alphabet from a CSPRNG is ~131 bits. A reservation there would cost a write on
every report to defend against a collision rarer than silent disk corruption.

The migration backfills a reservation per existing user and **throws** on a
collision rather than merging two coaches onto one code.

## D42 — the eight composite indexes, and why the emulator cannot find them (2026-08-10, v2.2b)

`firestore.indexes.json` declared 4 composite indexes. The shipped code needs 8.
The missing four fail with `FAILED_PRECONDITION` against a real project.

**The Firestore emulator creates composite indexes on demand.** No suite run
locally can catch this — not e2e, not the rules tests, not `migrate:verify`. Every
one of them passes against an emulator that silently invents whatever index the
query asked for. This is the one class of defect on this branch where a green
local run carries no information at all, which is why it is written down here
rather than left to the file.

| Index (all `COLLECTION` scope) | Serves | If missing |
| --- | --- | --- |
| `dailyLogs` (userId ASC, dayKey ASC) | `daily-log-queries.ts:38` (the `/log` read **and** every `saveLog`, via the re-read at :129), `team.ts:98`, `weekly-recap.ts:39`, `functions/src/index.ts:50` | F6 breaks on read *and* write — and `saveLog` writes before it re-reads, so the coach sees an error for a log that actually saved |
| `users` (uplineId ASC, createdAt ASC) | `users.ts:220` `getDirectDownlines`, `team.ts:80` once per tree level | My Team and Targets both dead — `getDirectLineTargets` calls `getDirectDownlines` first |
| `prospects` (coachId ASC, source ASC, createdAt ASC) | `api/public/capture/[code]/route.ts:28`, the per-coach hourly rate limit | Every QR self-fill 500s — and the person seeing it is a prospect, not a user (F2 Mode B) |
| `prospects` (createdAt ASC, heightCm ASC) | `functions/src/index.ts:123` `purgeStaleHealthData` | Throws once a night, silently. The 180-day health-data purge never runs — a compliance control, not a nicety |

Two direction calls worth recording, because both look wrong:

1. **`(createdAt, heightCm)`, not `(heightCm, createdAt)`.** The purge combines two
   inequalities on different fields and has no explicit `orderBy`. Firestore sorts
   implicit inequality orderings **lexicographically by field path** —
   `@google-cloud/firestore/build/src/reference/query.js:592` ends
   `getInequalityFilterFields()` with a sort — so the ordering is `createdAt ASC,
   heightCm ASC, __name__ ASC`. Field order in the index is not free choice.
2. **`dailyLogs` ASC even though `daily-log-queries.ts:40` orders `dayKey desc`.**
   `userId` is pinned by an equality filter, so a reverse scan of the ASC index over
   the contiguous `userId == U` segment *is* `dayKey DESC`. The file already bets on
   this same reversal rule elsewhere: the declared `prospects(coachId ASC, createdAt
   DESCENDING)` is the only index that can serve `weekly-recap.ts:46`, whose implicit
   ordering is `createdAt ASC`.

**Not added, on purpose.** `targets(uplinePath CONTAINS, month ASC)` was reported
missing but is already declared. `prospects(coachId ASC, createdAt ASC)` is
redundant with the DESC index by the same reversal rule.

**Two things that look like index problems and must not be fixed with indexes:**
`api/notifications/daily/route.ts:45` reads the entire `pushSubscriptions`
collection every hour with an unfiltered `orderBy` — a cost defect, not a missing
index. And `targets-queries.ts:91` sorts proofs in memory on purpose so the `in`
lookup at :74 needs no composite index; that comment is correct as written.

**Still unverified against a real project.** These are derived from the SDK's own
query planner and the documented rules, not from a `FAILED_PRECONDITION` that
stopped appearing. First deploy must run each of the four paths once and check the
Firebase console for index-build errors.

## D43 — the offline queue's pending list needs a sequence guard (2026-08-10, v2.2b)

`ProspectList` reads the IndexedDB queue on mount, on `QUEUE_CHANGED`, and on
`online`. When the signal returns all three fire within milliseconds, and IndexedDB
reads can resolve **out of order** — the last one to land wins.

That is a duplicate on screen, not a flicker. A read that started before
`OfflineSync` dequeued a synced capture can resolve after the one that started
after it, pinning the prospect to the pending list as "On this phone" while
`router.refresh()` has already brought in their real row. The coach sees the same
person twice, one apparently unsaved, and it never settles.

`refreshPending` now stamps each read with an incrementing sequence and applies
only the newest. The `cancelled` flag it already had guards unmount, which is a
different problem and does not help here.

**Correction to this entry as first written.** It claimed `offline-capture.spec.ts`
had caught this race. It had not, and the original attribution was wrong.

That test was failing on a strict-mode violation — `toBeVisible()` throws rather than
retries when a locator matches two elements — and the two elements were both
server-rendered rows, momentarily present while `router.refresh()` swapped the tree
in. The pending list was not involved at all: the failure snapshot contains neither
the "On this phone" badge nor the "waiting to upload" banner, and the database held
exactly one document for that prospect throughout. Fixed on the test side (D51), and
the transient double-render during a refresh is a Next behaviour, not a defect here.

The race described above is still real and the guard is still correct — three event
sources, unordered IndexedDB reads, last-writer-wins. But it was found by reading the
code, and it has never been observed in the wild. Recorded that way rather than
claiming a test caught it, because a decision record that credits the wrong evidence
sends the next person to the wrong file.

## D44 — `npm run e2e:reset` before every e2e run (2026-08-10, v2.2b)

The e2e suite is not idempotent and cannot be: `signup.spec` creates a coach, and
the offline and QR specs each create a prospect. Run it twice against one emulator
and the second run sees a database that no longer matches the seed.

This is not hypothetical tidiness. A green 18/18 suite went to **6 failed with no
code change**, purely because the emulator had accumulated two signup users and
four extra prospects. It looked exactly like a regression in the commit under test,
and it cost a full debugging cycle chasing a bug that did not exist.

`scripts/reset-emulators.ts` clears Firestore **and Auth** — Auth matters as much,
because signup creates an account and the Phone provider allows one per number
(the invariant behind D34). `npm run e2e:reset` chains it into
`migrate:firestore`, so one command gives a known state.

## D45 — the emulator boot guard describes two switches, not one (2026-08-10, v2.2b)

`src/lib/firebase-admin.ts` derived `usingEmulators` from `FIRESTORE_EMULATOR_HOST`
alone. The Admin SDK resolves emulator routing **per product**, from two independent
variables, so one flag could never describe the state correctly.

**Why it mattered, and it is worse than it sounds.** With only
`FIREBASE_AUTH_EMULATOR_HOST` set in production, `token-verifier.js` swaps in the
emulator verifier — `verifyJwtSignature(token, undefined, { algorithms: ['none'] })`,
which also stops requiring `kid` and RS256. `verifyIdToken` and `verifySessionCookie`
then merely *decode*. An unsigned cookie naming any uid would be accepted against
real Firestore data, while `usingEmulators` read false, so the missing-credential
check was satisfied by a real service account and `migrate-to-firestore.ts` still
printed "PRODUCTION". Nothing would have errored. One variable in a deploy config.

**Resolved as** a `resolveTarget()` returning a discriminated union. Two
configurations boot — both hosts and no credential (dev, e2e, CI), or a credential
and neither host — and the other four throw at boot naming the offending variable.
Because the union carries the service account only on the non-emulator branch,
`createApp()` dropped its own `if (!raw)` check: "real project, no credential"
stopped being a state that function can be called in.

**Three deliberate choices.** The resolver sits at module scope, not inside
`createApp()`, which runs only when `getApps()` is empty — a guard that
initialization order can skip is not a guard. `NODE_ENV` takes no part:
`next build && next start` against the emulators is how the production bundle gets
checked locally, so `NODE_ENV=production` is not evidence of a real deployment, and
the service account is the honest signal of intent instead — which is why one
alongside an emulator host is an error rather than a precedence rule to pick. And
presence is plain truthiness, matching the SDK's own `useEmulator()`, so `FOO=""` is
unset to both and `.env.example`'s empty credential line still boots. A guard that
disagrees with the thing it guards is worse than none.

Verified across all six combinations plus the empty-credential shape, each in its own
process, with the repo's real `.env` as the first case.
`FIREBASE_STORAGE_EMULATOR_HOST` is not in the pair check because nothing uses
Storage (D49); it has to join `resolveTarget` in the same change that switches
Storage on, or the same skew reappears for a third product.

## D46 — logout revokes on the Auth backend, for every device (2026-08-10, v2.2b)

`POST /api/auth/logout` deleted the cookie and stopped. A session cookie is a signed
JWT, not a row, so deleting the browser's copy told the Auth backend nothing: the
cookie stayed valid for the rest of its 14 days. Anyone holding a copy taken before
the logout — the realistic case on shared and second-hand Androids — kept full access
to prospect names, phones and health inputs.

`revokeRefreshTokens(uid)` closes it, and it does apply to session cookies and not
only ID tokens: in the installed SDK, `verifySessionCookie` and `verifyIdToken` both
route through `verifyDecodedJWTNotRevokedOrDisabled`, which compares the token's
`auth_time` against the user's `tokensValidAfterTime`. Nothing had ever set that
stamp, so the `checkRevoked` flag `session.ts` always passed was catching disabled
accounts and no logout at all.

**It signs the coach out of every device, and that is intended.** Revocation is
per-user; Firebase offers no per-session handle. Per-device logout would mean minting
our own session ids and storing them — the hand-rolled session table v2.1a deleted —
and checking one costs a read per request. The price of revoking is one SMS on the
other device; the price of not revoking is a logout button that logs nobody out.
v1 §12 does expect a phone and a club laptop signed in at once, so the button says
plainly that it ends both.

**GET does not revoke.** It is the loop-breaker the authenticated layout redirects
to, and a `SameSite=lax` cookie rides along on a cross-site top-level navigation — so
`location = "…/api/auth/logout"` on any page would otherwise sign a visiting coach
out of every device they own.

**A failed revoke keeps the coach logged in.** POST returns 502 and the cookie
deliberately stays set, so the button keeps them on the screen to retry — the cookie
is the only thing that still names the uid. A coach with a dead network therefore
cannot log out at all: honest, and better than a silent success. Offline-first
(v1 §4.3) covers capture and daily logs, not ending a session on a backend we cannot
reach.

**The browser's own Firebase credentials go too** (`signOut` in `LogoutButton`). The
cookie was never the only key: `RealtimeProspects` reads prospects straight from
Firestore with the client SDK's persisted refresh token, which the rules allow for
`coachId == uid`.

**Revocation has one-second granularity.** `validSince` is stamped in whole seconds
and the check is `auth_time < validSince`, strictly less — so a session created and
revoked inside the same wall-clock second survives its own revocation. No real coach
can hit that; a Playwright script hits it easily, which is why the e2e test crosses
the boundary on purpose. Also note `validSince` comes from our clock and `auth_time`
from Google's: a server clock running fast would reject cookies minted just after a
revoke, which looks like a login loop. Check this first if "I logged out and now I
cannot get back in" ever arrives.

## D47 — `/login` is not redirected away on cookie presence (2026-08-10, v2.2b)

`src/proxy.ts` sent anyone holding a `gl_session` cookie from `/login` to `/`. With
D46 revoking sessions for real, that turned a dead-but-present cookie into a
**redirect loop**:

```
/                 -> layout cannot verify -> /api/auth/logout
/api/auth/logout  -> clears the cookie    -> /login
/login            -> cookie still on THIS request -> /
```

and round again. Found by the D46 e2e test, whose replayed cookie landed on the
authenticated home instead of the login screen — the loop settling on the wrong side.

The proxy runs in the edge runtime with no Admin SDK, so it can only see that a
cookie **exists**. "Has a cookie" and "is signed in" are different questions, and a
revoked or expired session answers yes to the first and no to the second. Sending a
signed-in coach from `/login` to home was a convenience; bouncing a signed-out one
between three routes is a lockout. The convenience loses.

The authenticated layout is the only thing that can actually decide, so it is now the
only thing that decides. The `!hasSession && !isPublic` half is untouched — refusing
a request with no cookie at all needs no verification.

**The e2e assertion changed shape too, and this is the more general lesson.** It
asserted a final URL; a rejected cookie travels through the layout's redirect to
`/api/auth/logout` and on to `/login`, and where that chain settles depends on the
host it started from — `NextResponse.redirect(new URL("/login", req.url))` resolved
to `localhost` for a request made to `127.0.0.1`. The property that must hold does
not care about the route: the replayed cookie buys **no access**. Asserting
capability instead of location is what made the test both correct and stable.

## D48 — `users` is closed to clients, and the shared-prospect `get()` finding is withdrawn (2026-08-10, v2.2b)

Two audit findings on `firestore.rules`, reconciled into one ruleset.

**`users` is now `allow read, write: if false`.** The old grant was
`uid() == userId || inLineOf(resource.data.uplinePath)`, with a comment saying the
upline "sees the summary fields — name, photo, counts". Rules have no field-level
reads, so that comment described an intention, not the grant. What an ancestor at any
depth could actually fetch with a hand-written query was the whole document: `phone`,
`referralCode`, `levelName`, `followupPushOn`, `plan`, `trialEndsAt`, and
`shareProspects`.

**Why the last two decide it.** `plan == "readonly"` means a failed UPI mandate
(F10) — a coach's payment trouble is not their whole upline chain's to read. And a
rule that reports the privacy toggle's current value to the party the toggle protects
against is arguing with v1 §5.4 rather than serving it. The phone number alone would
not have justified this; a direct upline usually has it. But `inLineOf` is the entire
ancestor chain (up to 100 hops, D36), not the person who recruited you.

**Why deny rather than narrow:** nothing in the browser reads this collection. The
only client-SDK call in the repo is the `prospects` listener in
`RealtimeProspects.tsx`; the team tree is built server-side through the Admin SDK,
and drilling goes through `/api/team`, which checks the line itself. D38's discipline
applies — this was the one read in the file no feature asked for. Self-read is denied
too, because leaving it open keeps `plan`/`trialEndsAt` reachable from the client, the
same second-weaker-path this file already rejects for `reports`. If a screen ever
needs another coach's name and photo in the browser (a v2.4 threads UI is the likely
first pressure), the answer is a server-written summary document holding only those
fields.

The privacy rule's `coach()` helper still `get()`s `/users`: a `get()` inside a rule
is not itself subject to the rules. Emulator-verified — all four toggle checks pass
with the collection closed.

**The second finding — "the shared listing does two `get()` per document, so it fails
past ~10 prospects" — is withdrawn as measured wrong.** A query is evaluated once
against its own constraints, not once per returned document; that is the same
machinery that refuses an unfiltered listing here. `coachId` is a single bound value,
so the rule resolves one `/users` document however many prospects come back. Budget
is per request: measured at 10 lookups for a single-document read and 20 for a query
(the docs say 10 for both, so the rule budgets against 10). Emulator-verified — the
shared listing passes at 26 and 60 documents, with and without `orderBy`, while the
toggle-off listing is still refused at 60.

**Changed anyway:** the two `coach()` calls became one `let`-bound lookup in
`sharedUpwardBy()`. Not for the budget — 2 of 10 was never near the ceiling — but
because the docs hedge caching with "may be", and because the invariant that both
halves of the predicate read the SAME coach document is now syntactic instead of a
convention two separate lookups could drift out of.

**Not done, deliberately:** copying `shareProspects` onto prospect documents.
`PLAN_V2.1a.md` §4 already rejected it for revocation latency and that still stands —
a fan-out window where a stale `true` grants access is exactly what a DPDP control
cannot have. `coachUplinePath` is already denormalised on prospects and does not
help: it carries the path but not the toggle, and a rule reading fields the query
does not constrain refuses the query outright, which would push the privacy predicate
out of the rules and into every call site — the opposite of BUILD_PROMPT_V2 §3.

`e2e/rules.test.ts` goes 21 → 27 checks: the two `users` assertions flip to
`assertFails` (plus one for the self read) so a reopening cannot pass quietly, the
mandatory toggle-off denial is re-run against a 26-document fixture, and a canary on
a throwaway ruleset pins the lookup ceilings so "26 documents still pass" cannot go
vacuously green if the emulator ever stops counting. **Honest limit:** the scale and
canary checks pass against the old rules too, because there was no bug there to
catch. They are a regression pin, not a reproduction.

## D49 — Storage rules go back to deny-all until something uploads (2026-08-10, v2.2b)

`storage.rules` shipped in v2.1b as a working ruleset for three folders. Nothing in
the app has ever used Storage: no `storageBucket` in `src/lib/firebase.ts`, no
`firebase/storage` import, no bucket on the Admin app, `npm run emulators` starts only
auth and firestore, and proof media is still a base64 data URL in the Firestore
document (D3, D33).

**Why:** one of those grants was wrong, in the direction that matters.
`/users/{userId}/proofs/{fileName}` allowed `read: if signedIn()` — any signed-in
coach could read any other coach's evidence photos, while the Firestore `proofs` rule
correctly narrows the same evidence to the coach it is about and the upline who
asked. A signed-in client needs no download token to use that: a constructed `ref()`
plus `getBytes` is the whole exploit. The header's "enumeration is not possible"
defence was reasoning about anonymous callers, and its "unguessable id" leaned on the
shape of file names that no code produces yet.

**Resolved as** deny-all, for exactly the reason D38 gave for `firestore.rules` in
v2.1a: a permissive placeholder is the kind of thing that survives to production, and
a deny-all cannot. `firebase.json` already points `storage` at this file, so it was
one `firebase deploy` from live, not inert. The size and contentType bounds were the
useful part and they lose nothing by landing with the uploader that must satisfy them.

**The design is not thrown away.** The path conventions and reasoning now live in
`storage.rules` itself, where the next session will read them. Short version: Storage
rules cannot `get()` a Firestore document, and object metadata is settable by the
uploader, so the identities the rule must compare have to live in the path.
`proofs/{coachId}/{reviewerId}/{rest=**}` reproduces the Firestore predicate from two
fields that never change after `requestProof` writes them, and it sits outside
`users/{uid}/` so a future public-read rule on that prefix cannot swallow evidence
photos. That is correct **only** while those two fields stay immutable — if a proof
request is ever reassigned to a different upline, the baked path goes stale and the
reviewer silently loses access.

`initializeTestEnvironment` accepts a `storage` block, so the check that was never
possible — a coach outside the exchange cannot read the proof — becomes possible the
day there is a proof to read. Note `submitProof` currently demands a
`data:image/jpeg;base64,` prefix, so it changes in the same session as the uploader.

## D50 — the F11 toggle had a rule but no switch (2026-08-10, v2.3)

`firestore.rules` has held the correct privacy predicate since the migration: an
upline reads a downline's prospects only if `shareProspects == true` **and** they are
in that coach's `uplinePath`. `updateUser` accepted the field. But nothing in the app
could produce a `true` — `createUser` writes `false`, and `PATCH /api/me` builds a
whitelist covering `name`, `city`, `photoUrl`, `levelName` and dropped
`shareProspects` silently. The allow branch was reachable only by hand-editing a
Firestore document, which is why the rules tests passed: the fixture sets it directly.

The API now accepts the field as a **strict boolean** — no coercion.
`Boolean("false")` is `true`, and turning sharing ON when the caller meant off is the
one mistake this field must not be able to make. So `"true"`, `1`, `null`, `[]` are
all rejected. The response echoes the saved document's value rather than the
request's, so the client never infers the state of a privacy grant.

`settings/PrivacyToggle.tsx` carries no accent colour and nothing animates: gold on
"share my prospects" would read as the app leaning on the coach to say yes, and a
privacy screen has no opinion about their answer (G1, G3). Turning it ON asks a second
time and names the names and phone numbers out loud; turning it OFF is one tap.
Withdrawing consent must never cost more taps than giving it — the same
no-dark-patterns logic as cancel-anytime. State reads as the words "On." / "Off."
rather than a slider, because a slider's position is the one thing a coach must not
have to guess at. Both states say the activity counts flow up regardless, so nobody
turns it on believing it hides their numbers.

**Copy tension worth knowing about.** F11's mandated phrase is "Share my prospect
details with my upline", so the button carries it verbatim. But the rule grants the
whole `uplinePath`, not just the direct upline — so the state lines and the confirm
body widen it to "your upline — and the coaches above them". A coach who reads only
the button underestimates what they are agreeing to; a button that contradicts the
spec fails a compliance grep. The widening went in the prose.

A coach with no upline gets an explanation instead of the switch: their `uplinePath`
is empty, so the switch would change nothing. That is a deviation from a literal
reading of "this toggle is non-negotiable", taken because a control that does nothing
is its own dishonesty on a privacy screen.

**The switch grants a capability nothing consumes yet.** Every server read scopes
prospects to the session user and the team tree shows counts only. An upline-facing
prospect reader is a separate piece of work — and per D48 the rule now costs one
lookup, so the cap that was thought to block it does not exist.

**The prospect never consents to this**; the coach consents on their behalf. Mode A's
consent tick (v2 §5.2, unbuilt) covers "I am saving your details", not "I may show
them to my upline". Whoever writes that tick decides whether it mentions onward
sharing.

## D51 — Threads: addressed by sender, not by a recipient list (2026-08-10, v2.4)

F8 built. The design question that shaped everything: how does a downline find the
broadcasts meant for them?

**Rejected: a recipient list on the thread.** It breaks on the two things that
actually happen. A senior coach's line of a few thousand does not belong in one
document, and anyone who joins tomorrow would never see what their upline sent last
week — the list is fixed at send time and a line is not.

**Chosen: a thread stores only who sent it.** A coach receives it if the sender is one
of their own ancestors, which they already know from `uplinePath` (D36). The inbox is
`senderId in <my uplinePath>`, so one broadcast is one document however many thousand
people it reaches, there is no fan-out at send time, and a coach who joins later sees
the history. `scope` then narrows it: "all" reaches every descendant, "direct" only
the sender's own direct downlines — resolved against the reader, never stored per
recipient.

**The rules shape follows from how Firestore evaluates a list.** Rules for a query are
evaluated ONCE against the query, not per document (D48), so every field the rule
tests must be pinned by the query's constraints. That is why the rule has a separate
branch for the direct upline instead of one branch testing both path membership and
scope: a client pinning `senderId == <one id>` makes `senderId == me().uplineId` a
decidable boolean, so a coach needs one listener for their upline rather than one per
scope. A deeper ancestor's threads require pinning `scope == "all"` too — which is
correct, because a "direct line only" message from a grandparent is not addressed to
you and the rules will not serve it. The rules tests pin all five query shapes,
including the one that must be refused.

**Re-broadcast copies rather than points.** A forward is a new thread owned by the
forwarder, carrying the ORIGINAL author's name — not the hop it arrived through, so a
chain reads "via Asha" rather than accumulating a map of somebody's team structure. It
then travels by exactly the same rule as anything else that coach sends: no special
case in the query, the rules, or the UI. And the original sender's ack count keeps
counting only the people they wrote to themselves, which is the number they can act
on.

**Receipts are denied to every client.** A sender watches `seenCount` and `ackCount`,
which sit on the thread document they already read. Nothing in the browser needs the
individual receipts, and opening them would hand a sender a per-person read log of
their line — a different and more intrusive thing than a number.

**Counters and idempotency.** `threadReceipts/{threadId}__{userId}` is a deterministic
id for the same reason as the constraints in D35: a doubled tap on a flaky connection
must not increment a count somebody is watching. The receipt and the increment move in
one transaction, and an ack implies a seen, so `ackCount` can never exceed `seenCount`.

**Seen is reported by the client, in one batch, after paint.** Not during the server
render: marking a message read is a write, and a render that writes fires again on
every refresh, so the count would measure renders rather than readers. Not one request
per card either — opening the tab on 3G must not fire thirty requests to move somebody
else's counter.

**Links, not uploads.** F8 asks for "video link", and a URL satisfies it — so Storage
stays deny-all (D49). The scheme is an allow-list of `http` and `https`, parsed with
`new URL` rather than a regex: this is the one field in the app authored by one user
and rendered to thousands, so `javascript:` and `data:text/html` both have to be
unreachable, and a regex on URLs is how `https:/\/evil.com` gets through.

**Not built: the Leader-tier gate.** v2 §8 makes sending a paid feature, but tiers do
not exist yet (v2.6), so gating now would lock every coach out of a feature they can
use. Left open deliberately rather than faked.

**Push is capped at 200 and says so.** One tap from a senior coach would otherwise fan
into thousands of push requests inside one HTTP handler. Past the cap the thread is
still delivered — it is in every inbox the moment it is written — and the route logs
how many were notified versus how many have it. A cap that stays silent reads as
"everyone was notified" when they were not.

## D52 — the offline-capture assertion was brittle, not the sync (2026-08-10, v2.4)

`expect(locator).toBeVisible()` throws a strict-mode violation when the locator
matches two elements, and does not retry it away. The prospects list momentarily holds
two copies of the same row while `router.refresh()` swaps in the server-rendered tree,
so the test failed intermittently — roughly one run in three, and only in-suite, which
is what made it look like state pollution and then like the D43 race.

It was neither. Verified: the failure snapshot contains no "On this phone" badge and no
"waiting to upload" banner, so the pending list is not involved, and the database held
exactly one document for that prospect. Both matches were server-rendered rows.

Fixed by asserting visibility on `.first()` and moving the no-duplicate guarantee onto
`toHaveCount(1)`, which retries until the count SETTLES at one. That is stronger than
the original pair: it catches a duplicate row that persists as well as a duplicate
document, and it cannot pass by racing. Confirmed over four repeats of the interaction
that reproduced it.

The general lesson, since this shape has now cost two debugging cycles on this branch:
`toBeVisible()` on a possibly-duplicated locator tests the renderer's transient state,
not the property you meant. Assert the property.

## D53 — CI, and a unit-test runner that costs nothing (2026-08-10, v2.3)

There was no `.github` directory. 21 e2e tests and 43 Security Rules checks existed and
ran when somebody remembered — which is not a safety net, and BUILD_PROMPT_V2 §5.7 calls
the rules test MANDATORY. "Mandatory" has to mean a machine enforces it.

**One job, not several.** The suites share one Firebase emulator and one seeded
database, so splitting them would mean booting and seeding twice to save no wall clock.
Every step blocks: there is no advisory step, because a check nobody has to pass is a
check nobody reads.

**The unit runner is `node --test` via `tsx`, adding zero packages.** Node has shipped a
test runner since 20 and `tsx` was already a dependency for the seed and migration
scripts. On a project with a stated infra budget (v1 §10) that installs from lockfile on
every push, a runner that adds nothing to `node_modules` is the right default. Vitest
earns its place the day something needs jsdom or module mocking; the pure modules under
test need neither, because they are pure.

**Three things that would each have made this fail only in CI:**

1. `NEXT_PUBLIC_*` values are inlined at BUILD time, so they are set at job level rather
   than before the test step. Set them late and the built bundle talks to a real project
   while the server talks to the emulator — the silent failure `.env.example` warns
   about, where nothing errors and the realtime row just never arrives.
2. `FIREBASE_SERVICE_ACCOUNT` is deliberately **unset**, because both emulator hosts are
   set and the D45 boot guard refuses that combination. A credential added here "for
   completeness" would stop the app booting, which is the guard working.
3. Chromium is resolved explicitly into `PW_CHROMIUM_PATH` rather than falling through
   to `playwright.config`'s `channel: "chrome"` branch, so CI does not depend on
   whichever Chrome the runner image happens to ship.

**The integration script uses `e2e:reset`, not a bare `migrate:firestore`,** even though
CI always starts from an empty emulator where the reset is a no-op. That is what makes
`bash .github/scripts/ci-integration.sh` a faithful local rehearsal — and it is not
theoretical: run it against emulators that have been up all afternoon and without the
reset it fails on a migrate MISMATCH, exactly the D44 trap. A CI script you can only
debug by pushing is a CI script you will not debug.

Rehearsed locally end to end before committing: exit 0, collections match,
`migrate:verify` all-pass, 43 rules checks, server up, 21 e2e passed. **What is still
unverified is everything GitHub-specific** — the runner image, `setup-java`,
`emulators:exec` under Actions, and artefact upload. The first real run is the test of
those, and it is expected to need a fix or two.

**CI still cannot catch a missing composite index** (D42). The emulator creates them on
demand. Nothing in this workflow changes that, and it must not be mistaken for
coverage.

## D54 — the healthy weight range is printable tenths, not bounds × height² (2026-08-10, v2.3)

`healthyWeightKg` published `{ min: 18.5 × h², max: 23 × h² }`. Both ends were wrong,
in opposite directions, at every height from 140 to 200 cm.

**The top.** 23 is the EXCLUSIVE top of the band — `bmiBand` asks `bmi < 23` — and the
band is decided on the ROUNDED figure (D12). So the heaviest weight the card presented
as healthy computed to a displayed BMI of 23.0, which the same card then labelled "Just
above the general range".

That is not cosmetic. Under D13 the entire purpose of the neutral phrasing is that the
card never passes judgement on a person, and telling somebody standing at the top of
their own stated healthy range that they are above it is exactly the judgement the
phrasing exists to avoid. RULES L3 territory.

**The bottom**, found while fixing the top: `18.5 × h²` rounds UP to a weight whose true
BMI is below 18.5 — at 150 cm the old `min` of 41.6 kg is a true BMI of 18.4889 — so it
only read as healthy because the display rounded it up, and it excluded a lighter tenth
that genuinely does read as healthy.

**Resolved as** a search for the extreme printable tenths, each verified against the
same `bmiBand` the card uses. The range is not an algebraic identity; it is a question
about rounding, so the invariant is stated as code rather than trusted to arithmetic.
At 165 cm the range moved from 50.4–62.6 to 50.3–62.4.

The test that used to assert `bounds × h²` is what let this through, so it now asserts
the property instead: every weight offered as healthy bands as healthy, and one tenth
outside either end does not. The unit-slip guard it also provided is kept at a looser
tolerance, because a centimetre/metre confusion is off by 10,000 and nothing else here
would catch it.

## D55 — the Weekly Recap reintroduced the E1 day-boundary bug in a private copy (2026-08-10, v2.3)

`weekly-recap.ts` had its own `startOfLocalDay`, whose comment claimed it was "the D26
rule, reused". It was not reused. It was a second implementation, and it was wrong in a
way that only appears on some machines:

```js
const asLocal = new Date(guess.toLocaleString("en-US", { timeZone }));
```

`toLocaleString` renders the wall clock in `timeZone`; `new Date(string)` parses it back
in the **host process's** timezone. They agree only when the host is UTC. On an IST host
it returned `2026-08-10T00:00:00Z` for "2026-08-10" instead of `2026-08-09T18:30:00Z` —
five and a half hours late.

That instant is the lower bound of the `prospects.createdAt` range query, so the recap
silently dropped every prospect captured between midnight and 05:30 IST on the first day
of the week, under-reporting the number on the card a coach shares to WhatsApp Status.

Fixed by importing `startOfDayInZone`. RULES E1 already said "go through `day.ts`" and
this is the second time that rule has been earned — the first cost a roll-up. Recorded
because the lesson is not "be careful with timezones" but the narrower and more useful
one: **a duplicate that looks obviously equivalent is how the first one got in.** The
deleted function is replaced by a comment saying so, at the site where the next person
would be tempted to write it again.

## D56 — the streak flame showed an intact streak as lost, from midnight (2026-08-10, v2.3)

`log/page.tsx` passed `live={state.hasLoggedToday}`. `hasLoggedToday` is false from IST
midnight until the coach logs, so an intact ten-day streak rendered greyed out with
"Log today to start again" every morning — precisely the "zero implying they already
lost it" outcome D27 was written to prevent.

The prop had nothing left to express. `streakFromKeys` anchors on today OR yesterday, so
it already returns 0 once a whole day has lapsed, and the render is gated on
`streak > 0` — meaning whenever the flame appears at all, the streak IS live. Now
omitted, with the reasoning at the call site.

Worth noting what this says about the shape of the bug: two correct components wired
together wrongly. Neither `StreakFlame` nor `streakFromKeys` was at fault, so no test of
either could have caught it.

## D57 — thread body and link validation: invisible characters, and where a cap applies (2026-08-10, v2.4)

Two gaps in D51's validation, both found by unit tests written against the stated intent
rather than against the code.

**`checkBody` missed zero-width characters.** `String.prototype.trim` follows the
ECMAScript WhiteSpace definition, which excludes U+200B–U+200D, U+2060 and U+FEFF. So a
body of one zero-width space survived the trim and delivered exactly the blank card plus
push notification to an entire line that the source comment said the trim prevented.

Now tested by codepoint. Deliberately **not** by stripping those characters from the
stored body: U+200D (zero-width joiner) is meaningful in Devanagari and Kannada
conjuncts and in emoji sequences, so stripping it from a coach's actual text would
corrupt legitimate Indic spelling in order to fix a blank-message bug. The check decides
whether anything visible is present; it does not edit what was written. The codepoints
are listed as escapes rather than a regex containing the literal characters — a
character class whose source is invisible cannot be reviewed.

**The link cap bounded the input, not the stored value.** `MAX_LINK_URL` was checked
against what was typed, but the value written to the document and rendered into every
recipient's anchor is `new URL(...).toString()`, which percent-encodes. 200 accented
characters arrive as 223 and leave as ~1223; astral characters take the multiplier to
about six.

The obvious fix — check the normalised form against 500 — is wrong, and rejecting it is
the actual decision here: it would refuse a perfectly ordinary link containing Kannada
or Devanagari text, which this audience will paste, and tell them a 223-character URL was
too long. So there are two ceilings: 500 on what is typed, 2000 on what is stored. The
first is a friendly early error, the second is the real bound.

The scheme allow-list was attacked and **held** — case variants, tab/newline splitting,
leading control characters, `data:text/html` plain and base64, `vbscript:`, `file:`,
`blob:`, and the ambiguous forms a regex mis-reads. Parsing with `new URL` rather than a
regex is what makes that true, since the WHATWG parser strips tab/LF/CR and lower-cases
the protocol before the check sees it.

## D58 — the Streak Shield is NOT built, and three failing tests say so (2026-08-10, v2.3)

BUILD_PROMPT_V2 §4 dopamine map #1 requires "one auto grace-day per month so a single
miss doesn't kill motivation". It does not exist. `streakFromKeys` breaks at the first
gap; there is no allowance and no month bookkeeping anywhere.

Worse, `StreakFlame` accepts a `shieldUsed` prop and renders copy for it — but nothing
ever passes it. The shield exists solely as UI text for a state that cannot occur.

**Recorded as three `todo` tests rather than as passing tests of the current
behaviour.** A green test asserting "one miss ends the streak" would read as a decision
and quietly become the spec. Under `node:test` a `todo` runs, prints its assertion
failure with the reason, and still exits 0 — so the gap stays visible on every CI run
without blocking unrelated work. The assertions are written implementation-agnostically
("more than the no-shield answer", not "exactly N") so they should start passing when the
mechanic lands, without being rewritten to match whatever it does.

This is the pattern for any spec requirement found unbuilt: encode it as a `todo`, never
as a passing test of the gap.

## D59 — five languages, by cookie, and NOT on the report card (2026-08-10, brought forward from v1 §8)

Kannada, Hindi, Tamil and Telugu alongside English. v1 §8 parks UI localization until
200 paying users and RULES S7 says do not build Phase 2 early; the owner asked for it
explicitly, which is the one thing that overrides that.

**A cookie, not `localStorage`.** The theme is a `localStorage` value applied before
paint, and that works because a theme is only CSS — the server ships one markup tree and
the browser recolours it. Language is not like that: the strings are IN the markup and
nearly every screen is server-rendered, so the server must know the language while it
renders. `localStorage` does not exist there. The cookie also removes any flash of
English and any layout shift when a longer Kannada word replaces a short English one.

**No `/[locale]` URL prefix,** which is the obvious Next pattern and wrong here: the
public portfolio lives at the ROOT, `growline.in/<username>` (F9), so a locale segment
would be indistinguishable from a coach's username and every prospect-facing link would
grow a prefix.

**No i18n library.** Five languages and a flat dictionary. A library would add a
dependency and a plural-rules engine for a problem this app does not have — its counts
render as bare numerals beside a label. `Intl.PluralRules` is the next step if that
changes, not a framework.

**Completeness is a type, not a convention.** `Dict = Record<keyof typeof en, string>`,
so a missing or misspelled key is a build error. `Record` rather than `typeof en`
deliberately: the values must be strings, not the same literal strings, or a translation
would only typecheck while it was still in English.

**What types cannot see, `tests/i18n.test.ts` does:** a key left in English, an empty
string, a dropped or renamed `{days}` placeholder, a string in the wrong script. All four
ship silently and none is caught by `tsc` or by a screenshot unless a reader of that
language looks at it. Script is asserted as "contains at least one character from this
block", not "only" — "QR" stays in Latin in several translations, and an over-strict test
must not break a real product decision.

**Layout is asserted, not eyeballed.** `e2e/language.spec.ts` switches through all four
and asserts the document never scrolls sideways AND that no nav label is clipped inside
the fixed-height bar. Those are different failures: a clipped label leaves the page
exactly 375px wide and simply becomes unreadable. Assertions are on SCRIPT rather than on
words, because every translator flagged wording they were unsure of and a test pinned to
a specific string would fail on a legitimate copy fix.

**The switcher never translates its own options.** All five always show their native
names. A coach who cannot read English cannot find "Kannada" in a list, but can find
ಕನ್ನಡ — and the case that matters most is somebody who has landed in a language they
cannot read and needs to get out of it. Translating the option labels would break exactly
that.

**The report card and PDF stay in English, and this is the important limitation.** They
are rendered as images by satori, which has no Indic shaper: Devanagari, Kannada, Tamil
and Telugu all come out with vowel marks misplaced and conjuncts broken, and committing
fonts does not fix it. A translated report would look worse than an English one, and the
report is the coach's first impression on a prospect. The switcher says so in plain words
rather than leaving a coach to discover it.

**Every translation needs a native-speaker review before launch.** They were produced by
this build, not by a translator, and each one came back with a flagged list — chiefly
"acknowledge" (no short natural equivalent in any of the four, and the app needs to
distinguish *seen* from *acknowledged*), "prospects" (rendered as the plain word for
"people" in all four, since the sales sense has no short natural translation), and
whether "QR" should stay in Latin. Those lists are in the session record; treat the
current strings as a working draft, not as finished copy.

## D60 — demo mode is a real session, not an auth bypass (2026-08-10)

The owner needs to show the app on the spot — an investor asks, and an OTP round trip
kills the moment. They also need to switch between an upline and a downline view, because
the story being told is a relationship: you set a target, here is how it arrives.

**The tempting implementation is a "skip auth" branch in the session check. Rejected.**
It would put a code path in production that production never exercises, make the demo
prove nothing about the real app, and place a bypass inside the one function that must
never have a way around it.

**Built instead as a real sign-in with the SMS step removed.** `POST /api/demo/session`
mints a custom token, exchanges it for an ID token, and sets an ordinary session cookie —
the same objects the phone flow produces. Downstream nothing knows the difference: same
Security Rules, same queries, same privacy toggle. That also makes it an honest demo,
because what the room sees is the product rather than a mock of it.

**The gate is one environment variable, `DEMO_MODE`.** Unset — which is production —
and `/demo` and `/api/demo/session` both return **404, not 403**: a 403 confirms a route
exists, and on the production deployment this must be indistinguishable from a typo. No
second way in: no query parameter, no header, and deliberately no "unless localhost"
check, because a guess about where the code is running is a guess that can be wrong.

**The uid is never taken from the request.** It is looked up from a fixed table of three
seeded seats, so even with demo mode on this cannot mint a session for an arbitrary
account. Verified: `role=admin` and `role=usr_root0000000000000000` are both refused.

**Three seats, because the story needs a top, a middle and a bottom.** Senior coach with
a team; a coach who is simultaneously somebody's downline and somebody's upline (the
position most coaches are actually in, and the only one where both halves of the
relationship can be shown); and a new coach receiving a target somebody else set. Fewer
than three and "here is what your downline sees" cannot be demonstrated at all.

**The chip stays visible, and that is a deliberate cost to the demo's polish.** Because a
demo session is a real session on real screens, the chip is the only thing distinguishing
this from the live product — the cue that stops demo data being screenshotted as if it
were somebody's own. Muted, `--info`-leaning, no gold and no animation: it is chrome, not
a feature being demonstrated.

**Two mistakes worth recording, both caught by tooling rather than by review:**

1. `window.location.href = next` failed the React Compiler's `react-hooks/immutability`
   rule. `assign()` is the honest form — the rule is right that assigning to a global is
   a mutation it cannot reason about.
2. `e2e/demo-gate.spec.ts` read `DEMO_MODE` from the **test runner's** environment while
   the server read it from `.env` — two different processes — so with the demo enabled
   locally the test asserted "must be 404" against a server correctly answering 200. Fixed
   by loading `.env` in `playwright.config.ts`, so both read one source of truth. CI is
   unaffected: it has no `.env` and sets nothing, so both sides see the flag unset.

The gate test asserts the correct behaviour for whichever mode it finds rather than
skipping when the flag is on — a test that quietly skips half the time teaches everybody
to ignore it. Verified in all three directions: open server + open expectation passes,
closed + closed passes, and closed-expectation against an open server **fails with the
intended message**, which is what makes it more than decoration.

## D61 — Mode A consent: a timestamp, enforced server-side (2026-08-10, v2.3)

v2 §5.2 and RULES P6: manual capture requires the coach to confirm the person knows and
agrees, before save.

**A timestamp, not a boolean.** "Did they consent" and "when" are different questions and
only the second is answerable to a regulator. Under DPDP the burden is on us to show
consent was obtained, and `true` with no date cannot be corroborated against anything.

**Null means NOT RECORDED, which is not the same as refused.** Every prospect captured
before this existed has null, and the migration **deliberately does not backfill** — a
timestamp written there would be invented evidence, which defeats the reason for storing
a date at all.

**Enforced in the API, not only by a disabled button.** The person whose name, phone and
body measurements are being stored is not in the request and cannot object to it, so the
gate has to live where a client cannot skip it. Strict `=== true`, no coercion — same
reasoning as D50: `Boolean("false")` is `true`, and recording a consent nobody gave is the
one mistake this field must not be able to make. The timestamp is stamped server-side; a
date the client chooses is worth nothing as evidence.

**Where the tick sits is a rules decision, not a layout preference.** RULES S2 caps a
screen at six input fields and `CaptureFields` already uses all six. This is not a seventh:
nothing is entered, nothing is stored from it but a timestamp, and it gates the ACTION
rather than collecting data. Splitting capture across two screens to make room would break
the 30-second rule (S1) for a control that costs one tap. So it sits with the Save button,
in the calm register — no gold, no animation. It is the one moment in the flow belonging to
somebody who is not holding the phone.

**It has to survive the offline queue (S5), and that is the subtle part.** The person was
standing there when the coach ticked; by the time the queue drains — hours later, on
another screen — nobody can confirm anything, so re-asking on sync is not an option. The
flag therefore travels in the queued record. A capture that lost it would be refused by
the API on replay and sit in the queue forever while the coach had already been told
"saved on this phone" — a silent loss of the person they just met. `offline-capture.spec`
asserts the tick is required AND that a queued capture still lands, which is why that
assertion lives in the offline test rather than in one of its own.

**Mode B needs no tick, because the act is the consent.** A QR self-fill is the person
scanning the code and typing their own details. Nobody is asserting anything on their
behalf, which makes it the stronger of the two: Mode A records a coach's word that a
conversation happened, Mode B records the person's own submission. Both now stamp
`consentAt`.

**Still outstanding:** the itemized privacy notice that v2 §5.2 wants linked from this
flow. It needs a grievance officer, a contact address and the legal entity — facts only
the owner can supply — and human translation for the four languages, so it is not
buildable here. The consent tick does not depend on it, and the erasure control on the
report page (D17) already gives the prospect a self-serve exit.

## D62 — the admin panel shows counts, and admin access is an env allowlist (2026-08-10, F12)

### Access is `ADMIN_UIDS`, not a database flag

A Firestore `admins/{uid}` document would let an admin be added without a deploy. That
convenience is exactly why it was rejected: it makes "who can see every coach's numbers"
writable by anything that can write to the database, and it makes a privilege grant
invisible in version control. An env allowlist means becoming an admin requires a
deployment, reviewed by whoever deploys. There will be one to three admins, so the
friction costs nothing.

An empty allowlist grants **nothing** and the whole panel 404s. Stated explicitly in code
because the alternative default — unset meaning "everybody" — is the kind of thing that
ships.

**404, not 403,** for a signed-in coach who is not an admin. A 403 tells a curious coach
the panel exists and is worth probing. A signed-out visitor gets the proxy's redirect to
`/login` instead, because the edge runtime cannot verify a JWT — the layout decides once
there is a session to check.

### The rule that governs the whole panel: counts, never identities

**No prospect name and no prospect phone number appears in the admin panel, ever.**

The entire F11 model — the toggle, the Security Rules, D48 closing the users collection —
exists so a coach's prospects stay theirs. An admin screen listing prospect identities
would be a second, unlogged path around all of it, available to whoever holds the deploy
key. Every query in `admin-metrics.ts` is a `count()` or an id-only `select()`, so the
constraint is structural rather than a habit.

The predictable pressure on this is support ("a coach asked us to find their prospect").
The answer is that the coach already has it on their own screen; we do not need a copy, and
holding one makes us worth attacking. The footer says so on every admin screen, because
that is where the argument will happen.

### A metric that cannot be computed says so, and does not show zero

Month-2 paid retention and trial→paid conversion both need paying users, and payments are
unbuilt (v2.6). A north-star retention figure rendering "0%" would be read as a
catastrophe rather than as an unbuilt feature, and somebody would act on it. So
"unmeasurable" is a first-class state with its own card and a reason.

The four that DO compute are the ones that answer "is the app working": coaches logging
(the habit the retention model rests on), captures per coach, reports actually sent, and
thread acknowledgements. Verified against seeded data — 40% logging, 0% sent (seeded
reports were never sent, which is correct), 100% ack.

Each percentage prints its raw pair underneath. "60%" of 5 coaches and of 5,000 are
different facts and a percentage alone hides which one you are reading.

### One known cost

Firestore has no `COUNT(DISTINCT)`, so the distinct-logger metric reads seven days of log
ids — bounded by (coaches × 7), and it fetches no document bodies because the id encodes
the user (D26). Fine at pilot scale. Before it is not, replace it with a counter
maintained by a Cloud Function on log write; do **not** switch it to sampling, because a
heartbeat you cannot trust is worse than none.

## D63 — the rest of the admin panel, and one screen deliberately not built (2026-08-10, F12)

**Coaches list and detail.** The list shows only what lives on the user document, so it
costs one query however wide the table gets; last-logged and streak need a coach's log
history and are computed on the DETAIL page, one coach at a time. Putting them in the list
would multiply a page view by the number of rows — the admin-panel N+1 that is invisible at
ten users and a bill at ten thousand.

Search filters in memory over one capped query. Firestore has no substring search, and the
alternatives are a prefix-only index (which cannot find "asha" in "Vidya Asha") or a search
service. `LIST_CAP` bounds it and the page says when it truncates; when the cap starts
biting, the answer is a real search index, not a bigger cap.

The detail page calls out a coach with no upline in words rather than showing a dash — an
unattached coach is exactly the case "Link my line" exists for, and today it cannot be
fixed after signup.

**Broadcast reuses Threads rather than adding an announcements banner.** Coaches already
know where threads live and already know the acknowledge tap, so the seen and ack counters
come free — which is precisely what you want to know after telling every user something.

`PLATFORM_SCOPE` is deliberately NOT a member of `THREAD_SCOPES`. That one decision is the
whole safety design: `THREAD_SCOPES` is what the composer renders and what `isThreadScope`
accepts, so a coach cannot select it and the coach-facing API rejects it without needing a
separate check. The only writer is the admin-gated route, which re-checks `isAdmin` because
a route is reachable directly whatever the layout does.

Three things this surfaced that were not obvious:

1. **`toAppThread` would have silently rewritten every announcement to "direct".** Its
   "anything unrecognised is the narrower scope" rule is right, and it needed `platform`
   listed explicitly or `canRead` would have hidden announcements from everyone whose
   direct upline was not the admin — i.e. almost everybody.
2. **`listInbox` returned early for a coach with no upline,** which would have hidden
   announcements from exactly the people most likely to be new. Platform threads are now
   fetched unconditionally, by their own query.
3. **The announcement displayed the admin's personal name.** Caught by looking at the
   stored document rather than at the screen. It now displays as "Growline" — partly
   because "Root Coach" reads as a message from another coach and undermines it, but mainly
   because it would tell every user on the platform which account is an admin. `senderId`
   still records the real person, so the document and the audit log agree.

**No push on a platform broadcast, deliberately.** A notification to every user from one
button press needs a rate-limited job behind it. The announcement is in every inbox the
moment it is written; only the buzz is missing, and that is a smaller problem than a
fan-out nobody bounded.

**Typed confirmation on broadcast.** It is the widest-reach, least-undoable action in the
product. A checkbox gets dismissed without reading; typing "SEND TO EVERYONE" requires
having noticed what it says.

**Audit log is denied to clients, including admins.** A trail the audited party can read
from a browser is one they can learn to work around, and one they might be able to write to
if a future session relaxes the rule by half. Entries carry the actor's NAME as well as
their uid, because a uid is unreadable six months later and an audit entry has to stay
legible without a join.

**Subscriptions says it is empty rather than showing zeros,** same reasoning as the
Overview's unmeasurable cards. It also surfaces a row for any unrecognised `plan` value
instead of hiding the discrepancy in a total that does not add up.

**Promo codes: NOT built, and not in the nav.** A promo code exists to grant an extended
Leader trial or a locked founding price, and both are meaningless until tiers and payments
exist (v2.6). A screen that creates codes today creates codes that do nothing — and
somebody would hand them out at a club launch and find out in front of a room. A dead nav
item is worse than an absent one.

## D64 — dailyLogs and targets are closed to clients; the snapshot grant is gone (2026-08-10)

The last open finding from the v2.1 audit: `dailyLogs` and `targets` authorised reads with
`inLineOf(resource.data.uplinePath)`, where that `uplinePath` is a **snapshot** taken when
the row was written. `prospects` resolves the coach live and follows the tree; these did
not.

**Why it had to be fixed before re-parenting, not after.** Left alone it is a stale
roll-up. The moment a coach can be moved — the point of "Link my line" — it becomes a stale
**grant**: every log and target written before the move still names the OLD upline, so that
upline keeps read access to a coach who no longer reports to them, indefinitely, while the
new upline has none. A permission that outlives the relationship it was derived from.

**Resolved by closing both collections to every client, including the owning coach.**

The live-lookup alternative — `uid() in coach(resource.data.userId).uplinePath`, the shape
`prospects` uses — is correct but forces every client query to pin `userId`, and the only
query these collections are read with filters on `uplinePath` instead. So the correct rule
would break the only query shape that exists.

The real answer is that **no browser code reads either collection.** Verified rather than
assumed: the only client-side Firestore reads in the repo are `prospects`
(`RealtimeProspects`) and `threads` (`RealtimeThreads`). This was a grant no feature had
asked for — the same thing D48 closed on `users`, for the same reason.

**Activity still flows up** (v1 §5.4). It always did so through the Admin SDK:
`buildTeamTree()` is server-side and untouched. Confirmed by the full suite passing
unchanged, which is the point — if a screen had depended on the client grant, e2e would have
caught it.

The rules test that used to assert an upline **can** read a downline's log now asserts it
**cannot**, so reopening this has to be somebody's deliberate decision. A `targets` fixture
was added at the same time, because the new assertion would otherwise have passed vacuously
against a document that did not exist.

**A note for whoever adds a client-side team roll-up.** It gets a rule written against the
query it actually makes — and that rule must resolve the coach live, because a
snapshot-based grant is wrong again the day re-parenting ships.

## D65 — "Link my line": attach after signup, both directions, always two-sided (2026-08-10, F1)

`uplineId` was written once at signup and never again. So a coach who installed the app
BEFORE their upline did — which is how adoption actually happens, from the keen person
downward — signed up with no referral code and became a **permanent root**. There was no way
to attach them afterwards, ever.

That, and not a senior coach refusing to install, was what blocked bottom-up adoption. If
the person at the top never joins, the tree simply roots at the highest person who did and
everyone below still works — *provided* attachment can happen after signup.

**Two-sided approval, in both directions, always.** Never one tap:

- attaching yourself UNDER someone would let you see their line, so anyone could help
  themselves to a stranger's team by guessing a code;
- claiming someone as your downline would make their activity flow up to you.

Either direction unilaterally is a privacy hole, so both ask. Enforced in the library from
the stored request — the approver must be the party who did NOT ask — because the route is
reachable directly and a disabled button proves nothing.

**Identified by referral code, not phone number.** Both coaches already know each other; the
app only needs an identifier. Using the code means this cannot be used to test whether a
phone number has an account. And a failed lookup returns one message for both "no such code"
and "malformed", so the endpoint is not an oracle for guessing codes either.

**v1 attaches an unattached coach; it does not MOVE an attached one.** Moving somebody who
already reports to a coach is a different question — whose team are they on, does the old
upline get a say — and that is a product decision.

It also makes the hard part easy, which is why the constraint is worth keeping. Because the
child is a root their `uplinePath` is empty and every descendant's path currently ENDS at
them, so re-parenting is a pure **append** of the child's new ancestors onto every affected
path. No recomputation, and the same operation for the child, their descendants, and all of
those coaches' prospects, logs and targets.

**Two phases, because no Firestore transaction is big enough for the second.** The
authoritative change — the child's `uplineId` and path, the parent's counter, the request
status — is one transaction. The fan-out across four collections is batched afterwards and
**idempotent**: each write is skipped if the path already contains the new immediate parent,
so a fan-out interrupted halfway can simply be re-run. If it is interrupted, the tree is
correct at the top and stale below, and roll-ups under-report until it is re-run. That is the
honest trade; the alternative is holding a lock across thousands of writes, whose failure
mode is a half-attached coach.

**The subtle bug this design has, and how it is handled.** A root's own prospects, logs and
targets have an EMPTY path — that is what being a root means — so `array-contains child.id`
does not match them and the subtree passes miss them entirely. They are rewritten by a
separate owner-scoped pass. This is the single most likely thing to be got wrong here, and it
is asserted directly.

**`scripts/verify-reparent.ts`**, wired into CI. This operation rewrites documents across
four collections and its failure mode is silent: the coach looks attached, their team screen
looks right, and their downlines' work quietly stops rolling up. A unit test cannot reach it
and an e2e test would drive two browsers to assert what is really a data property. 17 checks,
including the grandchild (proving the whole subtree moves, not just the top), the root's own
rows, the cycle guard, the depth cap, that the asker cannot accept their own request, and
that a stranger cannot accept it either. The fixture is prefixed `vrp_` and self-cleaning so
it shares an emulator with the seeded data.

The fixture deliberately has TWO levels above the parent, because a bug that appends only
the immediate parent would pass against a shallower one.

**`lineRequests` is denied to clients entirely**, read included. An open read would let
anyone list who is trying to attach to whom — somebody's team structure assembled from the
outside.

## D66 — the report fonts ship with the repo, and the name stops going to Google (2026-08-11, v2.3)

v2 §5.5 asks for Noto TTFs committed and used by the report renderer, with no network
font fetches at render time. Doing it turned up something worse than the missing bold
weight D18 flagged, and something the spec asks for that **cannot be delivered at all**.

### What was actually broken

D18 recorded that satori ships one face (Geist Regular), so `fontWeight: 700` was a
silent no-op, and that a missing glyph was fetched from Google at render time. The
second half was understated. The call `next/og` makes is:

```
https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari&text=<the string>
```

The **prospect's name is a query parameter**. Every time a Devanagari or Kannada card
was drawn, that name left the server for a third party, on the request path, with the
latency and the hard egress dependency thrown in. For an app whose whole privacy
posture is P1–P6 — a toggle enforced in Security Rules, bearer tokens with expiry,
EXIF stripped off proof photos, health data purged at 180 days — this was the loudest
hole in it, and it was in the one artefact designed to be forwarded.

### Ten faces, five scripts, in `assets/fonts/`

Noto Sans, Devanagari, Kannada, Tamil, Telugu — regular and bold each, plus `OFL.txt`.
2.7MB. The spec names three; the two extra are Tamil and Telugu, because D59 added
those as UI languages and a coach using a Tamil interface will have prospects with
Tamil names. Shipping the app's own language list is the coherent line to draw.

`assets/fonts/`, **not `public/`** — nothing in a browser needs these, and `public/`
would serve 2.7MB to every visitor. They are read with `readFile` at render time and
cached for the life of the process, and only the scripts actually present in the text
are read: a Latin-only card pays for two files, not ten.

Because the path is built at runtime there is no import for the tracer to follow, so
`next.config.ts` names `assets/fonts/**` in `outputFileTracingIncludes` for all three
image routes. Without it the fonts simply would not deploy and the render would fall
straight back to Google — the failure would be invisible locally and total in
production. Verified: 11 files traced into each of the three routes.

### One family name per script — the obvious design is silently wrong

The natural implementation is to register every face as `"Noto Sans"` and let satori
pick per glyph. **It does not work.** satori keeps one face per
(family, weight, style), so the Indic faces are discarded on load and the Devanagari
name goes to Google exactly as before — with no error, and with a font array that
looks correct in a debugger.

What works is satori's cross-family fallback: name one family on the element and
register the others under their own names. Measured across all five scripts — shared
name: four of four Indic scripts still fetched; distinct names: none did.

### `safe()`, and why coverage is read from the `cmap`

Five scripts makes the fetch unlikely, not impossible: a Bengali name would still
trigger it, silently. So each face's `cmap` is parsed once (formats 4 and 12) into a
coverage set, and any character no loaded face can draw is replaced with U+FFFD before
it reaches satori. That is what turns "no network font fetches" from a hope into a
property — satori is never handed a character it has to go looking for.

Coverage is read from the font rather than declared as Unicode ranges because the
declared version would be wrong in both directions: it would substitute `₹`, `·`, `–`
and the accented letters in transliterated names, all of which Noto Sans does carry.
Zero-width characters are dropped rather than substituted — a replacement mark is a
visible box where the writer intended nothing visible, and ZWJ/ZWNJ are ordinary parts
of correctly typed Indic text.

### The clause that cannot be met: "non-Latin names must render bold **and correct**"

Bold: delivered, and asserted pixel-wise, including through the fallback into an
Indic face.

Correct: **not possible with satori, and not because of the fonts.** satori does no
complex-script shaping. It forms no conjuncts (the virama renders as a standalone
stroke) and does not reorder pre-base matras, so `नि` draws as na-then-hook instead of
hook-then-na, and `प्रिया` draws as `प् र य ि ा`. Verified at 88px with the Devanagari
face named directly, so the fallback path is not the cause. D59 said this about UI
strings; it is equally true of names.

**This does not make the change a trade-off.** Fetching from Google supplied glyphs,
never a shaper — the rendering was equally broken before, and merely also leaked. So:
same wrong glyphs, no leak, no latency, no egress dependency, and real bold. Strictly
better on every axis.

It does mean v2 §5.5 is only half closed, and the half that is left needs a different
renderer, not a different font. The realistic options, none of them small: pre-shape
with harfbuzzjs and hand resvg positioned glyph outlines; or render the card in
headless Chromium, which shapes correctly and is already a devDependency but is a
heavy thing to put on a request path. **Until one of those lands, an Indic name on the
card PNG and PDF is wrong.** The HTML report page at `/r/[token]` is fine — the
browser shapes it — so the damage is confined to the two image artefacts.

### Consequences worth knowing

Cards already sent will re-render with the new weights, because the PNG is drawn on
demand from the stored snapshot. No number and no wording changes, so E3 is not in
play: the report's *content* is still immutable, only its typography moved.

Adding a script is one row in `SCRIPTS`, two files, and one line in the test table.
The `console.warn` in `sanitise` is the signal that one is needed.

## D67 — the Streak Shield: one isolated day a month, and it does not count (2026-08-11, v2.2a)

D58 filed this as three `todo` tests because v2 §4 dopamine map #1 requires "one auto
grace-day per month so a single miss doesn't kill motivation" and nothing implemented
it. `StreakFlame` even accepted a `shieldUsed` prop and rendered copy for it, but
nothing passed it — UI text for a state that could not occur. It occurs now.

### Three rules, and where each line sits

**Keyed to the month of the day that was MISSED, not the month the coach is standing
in.** A miss on 28 July and a miss on 3 August are two allowances and both are
absorbed; two misses in August are one allowance and the second breaks the run. This
is the reading that makes "per month" mean anything as you walk backwards through a
long history.

**One shield covers one isolated day, never two in a row** — not even across a month
boundary, where two allowances are technically in reach. "A single miss" is the day
somebody was ill or travelling. A mechanic that sometimes bridges two days is one no
coach can predict, and an unpredictable streak stops being worth keeping.

**A shielded day does not COUNT, it only fails to break the run.** This is Duolingo's
freeze, which v2 §4 cites by name: the streak survives, the number does not advance.
Eleven logged days across a twelve-day span reads as 11.

**Derived, never stored.** The shield is computed from the logged days on every read.
No allowance field, no monthly reset job, nothing that can drift out of step with the
logs it describes — and no new way to manufacture a streak, since `MAX_BACKFILL_DAYS`
still governs what can be written.

### The assertion in D58 that had to change, and why it is recorded here

D58 said its three tests were "implementation-agnostic … so they should start passing
when the mechanic lands, without being rewritten". Two did. The third did not, and the
reason is worth keeping.

`allowance resets each calendar month` asserted
`streak >= daysBetweenKeys("2026-07-20", today) + 1` — the inclusive **span**, 17. That
is not agnostic: it silently requires shielded days to count toward the number, which
rules out the Duolingo behaviour the spec names. Fifteen days were logged in that
fixture. Printing 17 would credit a coach with two days they know perfectly well they
missed, on a screen whose whole value is that its numbers can be trusted.

So the assertion now pins what the test is named for — that July's allowance is back in
August, checked against the seven days the run would have reached without it — and
states the counting rule outright instead of encoding it in arithmetic. **Changing a
test written as a spec marker is exactly the move D58 warned about**, which is why it
is here in full rather than in a commit message.

Two older tests also changed, and those are ordinary consequences rather than
judgement calls: `the streak breaks only once a whole day has passed unlogged` and
`a gap in the middle stops the count at the gap` both encoded the no-shield contract.
Both now assert the shield absorbing the first gap AND the run still stopping at the
second, so the property each was protecting is still protected.

### What the coach sees

`getLogState` returns `shieldUsed` and `log/page.tsx` passes it, so the existing
"Shield used this month — keep going" copy finally fires. It is deliberately about the
current month only: a shield spent in July is not a warning to give somebody in August.

The flame is unchanged otherwise. Losing a streak must never feel like punishment
(v2 §4), and the copy says the shield caught it rather than that a day was lost.

## D68

**The public portfolio lives at the root of the site, not under a prefix — and
`RESERVED_SLUGS` is what makes that safe, in two places at once.**

Every other public route here is prefixed: `/c/<code>` for the prospect's self-fill form,
`/r/<token>` for a wellness snapshot, `/join/<code>` for a referral. `/p/<slug>` would
have matched that convention, cost nothing to build, and been immune to the whole class
of problem below.

It was rejected because for this one route the URL *is* the product. v1 §F9 specifies
`growline.in/<username>` and §7 sells a custom link name as a Pro feature. The string
gets printed on a QR poster on a club wall, it rides on every wellness report, and a
coach reads it down a phone to somebody who has never seen it written. `/p/` loses a word
of that every single time it is spoken.

### What the choice actually costs

Two things, and both are paid rather than hoped away.

**A route added later can shadow a coach whose link is already printed.** Next resolves
static segments before dynamic ones, so shipping `src/app/pricing/` silently steals the
page of any coach who claimed "pricing" — and their poster is already on a wall.
`RESERVED_SLUGS` in `src/modules/portfolio/model.ts` blocks it at claim time: every
current route, plus the words a growing product reaches for (pricing, help, blog, about,
terms, support). Blocking a name today costs a coach one retype. Discovering the clash
later costs them a reprint.

That list is only as good as its maintenance, so the test that enforces it does not
contain a copy of the routes — it **reads `src/app/` and `src/app/(app)/` off the
filesystem** and asserts every directory it finds is reserved. Adding
`src/app/pricing/` fails the suite until somebody reserves "pricing". A hardcoded list
could not have noticed, which is the whole point.

**Every stray URL in the app now reaches this segment.** `/some-typo` used to 404 in the
router; it now runs a page. So `getPublicPortfolio` validates the slug's SHAPE before it
reads anything, and a request for a malformed path never touches Firestore.

### The bug this was one line away from shipping with

`src/proxy.ts` redirects any request with no session cookie to `/login`. A coach's page
lives at the root and its readers have no account — so the entire feature was
unreachable. Fully built, fully typed, 24 unit tests green, `next build` clean, and every
prospect following a printed link would have landed on a login screen for an app they
will never install.

The obvious fix — treat any single segment as public — would have unauthenticated
`/settings`, `/team` and every other app route in one line.

`RESERVED_SLUGS` is the distinction, and it already existed. The gate now treats a
lowercase single segment as a portfolio *unless it is reserved*. The same list that stops
a coach claiming a shadowed name tells the proxy which paths are coach pages, so the two
can never drift apart, and the filesystem-driven test keeps both honest at once: a new
route that nobody reserves fails the suite, and until it is reserved it is also publicly
reachable — one fact, one place, one test.

### The instrument that found it

Nothing in the build, the typecheck, or the unit suite could see this. The only thing
that could was an e2e test that opens the page **in a browser with no session**, which is
also how the same class of bug is caught for `/c` and `/r`.

**Any public surface needs a test that visits it signed-out.** Written down here because
it is the second time this project has learned it and it should be the last.

## D69

**The 180-day health purge measures inactivity, not record age — and a missing
`lastActivityAt` is never purged.**

`purgeStaleHealthData` shipped querying `where("createdAt", "<", cutoff)`. RULES P5 and
v2 §5.3 both say *"180 days of prospect **inactivity** — no stage change, no report
view."* Record age is not inactivity, and the difference is not academic: a prospect
captured 200 days ago and worked yesterday — moved to "Attended", opening their snapshot
every week — had their height, weight, age, gender and every derived metric nulled, and
their reports deleted with them. Live data destroyed on a healthy relationship, by the one
job in this codebase that cannot be undone.

It was the only deliberate-looking simplification in the repo with no entry here, which is
roughly how it survived. Recorded now with the fix.

### What counts as activity, and what deliberately does not

Exactly the two things the rule names: a **stage move**, and the **prospect opening their
own report**. `lastActivityAt` is seeded at capture and pushed forward by those.

Not counted, on purpose:

- **A coach editing notes or nudging a follow-up date.** That is the coach tidying their
  own records, not contact with the person. Counting it would let a prospect's health data
  live indefinitely behind activity they took no part in, which is the retention rule made
  decorative.
- **The coach previewing their own send.** Otherwise any coach could keep somebody's
  health data alive forever by opening a page once a month.

### The throttle, and why a public route forced it

A report view is an unauthenticated page load. Writing on every one puts an unbounded
write on a public route — a cost bomb, and a trivial way for anybody holding a link to run
up a bill. So a touch only writes when the stored value is more than a day old. The
precision given up is one day against a window of 180; it cannot change a purge decision.

### A missing value is never stale

The purge ignores rows without the field, and `isStale(null)` returns false. This fails
toward KEEPING data, which is the wrong direction for a retention obligation and the right
one for an irreversible delete: a row the backfill has not reached must not be mistaken
for one nobody has touched in six months. Keeping data too long is fixable with a script;
deleting it early is not fixable at all.

That gap is closed by `npm run backfill:prospect-activity`, whose `--check` exits non-zero
while any prospect is still missing the field — the same enforceability shape as
`backfill:workspaces` (D-series, workspaces).

**The backfill seeds from `createdAt`, and that has a real cost.** Nothing recorded stage
moves or report views before the field existed, so capture time is the only honest value
available. For a prospect captured 200 days ago and worked yesterday, this seeds a value
already past the window and their health data is purged on the next run — the exact case
the fix prevents, happening once, to the backlog. Seeding "now" was rejected: it would
grant every dormant prospect a fresh 180 days, quietly resetting the retention obligation
for everybody, and unlike this direction it would be invisible.

### The index moved with the query

`firestore.indexes.json` now carries `(lastActivityAt, heightCm)` instead of
`(createdAt, heightCm)`. Changing a query without its index is invisible here — the
emulator invents missing indexes on demand — and would have surfaced as a
`FAILED_PRECONDITION` on the first real run, inside a scheduled job with nobody watching.
A unit test asserts the declared index matches the query the purge actually makes.

## D70

**Tiers are built with every gate open, behind one constant — and the v1 trial is
deleted, not hidden.**

Owner instruction, 2026-08-14: *"start tiers now, don't gate anything yet."*

### What "built but not enforced" means concretely

Everything v2 §8 describes exists: the Starter / Leader / Elite model, the 2nd-downline
qualification, the 30-day trial clock, the pricing screen, the recognition card, the admin
funnel, and a `gateLeaderTool` check standing in the three Leader routes — set targets,
send threads, review proofs. `TIERS_ENFORCED` in `src/modules/tiers/model.ts` is `false`,
which makes every gate answer "allowed" **before it does any read**. Cost of the plumbing
today: zero Firestore reads, zero behaviour change.

The reason to stand the gates now rather than at flip time is that the flip will happen
under launch pressure. One constant, already wired, already tested in both positions, is a
different kind of change from a hunt through routes for the places a check should go.

### Why the gate is standing in exactly three places, and not a fourth

§8 lists Leader's unlocks as: set targets, send threads, validate proofs, team analytics
dashboard, Pro portfolio, watermark removed. The first three have routes; the gate stands
in them. Team analytics and Pro portfolio have no route yet — their gates arrive with them.
The watermark is already `!portfolio.isPro`, which is the same flag by another name.

**Proof submission is not gated.** Only the upline's approve/reject is. §8's word is
"validate", the downline attaching evidence is not validation, and gating it would let a
Starter be *asked* for proof they could not *send* — a dead end nobody should be put in.

### The e2e proof is the one that matters

The unit suite pins `TIERS_ENFORCED === false` as a tripwire, and it pins the enforced
branch too — a gate that always short-circuits hides a broken enforced path until the day
it matters. But neither can tell an accidentally-closed gate from a correctly-open one;
those look identical from outside. So `e2e/tiers.spec.ts` logs in a real unqualified
Starter and has her set a target and send a thread through the real routes. If those ever
return 402, the flip happened by accident.

Writing it surfaced a harness fact worth keeping: `page.request` shares the browser's
cookie jar but does **not** send a `Secure` cookie over plain `http://127.0.0.1`, and
`next start` is production, so `gl_session` is Secure. Browsers carve out a localhost
exception; the request client does not. Every earlier spec that used `page.request` did so
signed-out, which is why nothing had tripped over this. Authenticated API calls in e2e go
through `fetch` inside the page — which is what the app's own components do anyway.

### What the trial-start endpoint does while enforcement is off

Refuses, with a 409 and a reason. Every Leader tool is open to everyone, so starting a
30-day clock now would burn a coach's whole trial on tools they already have — they would
reach the flip with nothing left. The qualification is theirs and keeps; the clock starts
when it buys something. The recognition card says exactly this and celebrates the true
thing (the team grew, Leader is earned and reserved) rather than the spec's literal
"unlocked", because nothing was locked and a celebration that lies stops landing.

### The v1 trial remnants

§8 opens with: the v1 model "is CANCELLED. Delete any remnants." Home and Settings still
carried a 60-day countdown against which nothing happened on day 61 — no charge, no lock.
A countdown to nothing teaches users the app's numbers are decorative, which is fatal for a
product whose entire pitch is that its numbers can be trusted, and it is v1 §4.7's
money-surprise pattern turned inside out. Both are deleted, not reworded. Starter is free
forever and Settings now says that in those words.

`users.plan` and `users.trialEndsAt` still exist on the document and in `AppUser`. They
are unread by any screen and will be removed with the migration that lands paid tiers;
deleting a stored field this week for no user-visible reason is churn on the one week
that cannot afford it.

### The flip, when it comes, is a set of three

`TIERS_ENFORCED = true`; the launch-open banner comes out of `/plans`; the `start-trial`
refusal comes out of `/api/tiers`. The unit test that pins the constant is deliberately
named so that whoever flips it is sent here.

## D71

**The Recognition Wall is earned-only, workspace-scoped, one-reaction and self-expiring —
and every one of those four is a guard against it becoming a social feed.**

Feature B. RULES S7 parks "social feed with video posts" until 200 paying users, and the
distance between a recognition wall and that feed is exactly four decisions:

1. **Nothing is manually posted.** Every card is minted by an event the app already
   records — first prospect, first member, a streak the log itself celebrates, a target
   crossed, a first downline, a qualification met. There is no compose box, so there is
   nothing to moderate, nothing to boast in, and no card asserting something the app
   cannot vouch for. `CARD_COPY` enumerates every string that can appear; the unit suite
   sweeps that table for money, ranks and company names, and there is no free-text path
   onto the wall for a sweep to miss.
2. **Own workspace only.** Cross-workspace visibility would turn recognition into
   comparison between organisations. The query filters on the viewer's own
   `workspaceId`, and `clap` re-checks it rather than trusting the id it was handed.
3. **One 👏, no comments.** RULES S3 bans group chat, and a comment box under a
   recognition card is a group chat that arrives one feature request at a time. The
   one-per-person rule is STRUCTURAL: the clap is a document keyed by the clapper's uid
   in a `claps` subcollection, so "twice" is not expressible. The count on the parent is
   bumped by `increment` in the same transaction, so the two cannot drift.
4. **14-day expiry, derived at read time.** A wall that never clears is a leaderboard
   with extra steps, and old cards bury new ones. Nothing is deleted and no job runs —
   the query is a range on `earnedAt` and `isLive` re-checks the boundary.

### Opt-out is enforced twice, and that is not redundancy

`mint` refuses to create a card for an opted-out coach, AND `getWall` drops cards from
anyone who has since opted out. Write-side alone would leave every card earned before the
switch was flipped sitting on the wall; read-side alone would keep minting cards nobody
sees, which is a slow leak of documents and a nasty surprise if the coach ever opts back
in. A coach who opts out also sees nothing: opting out is leaving the room, not becoming
invisible inside it.

### Which streaks reach the wall, and why it is a subset

`WALL_STREAK_DAYS` is {30, 100, 365} while the log privately celebrates
{3, 7, 14, 30, 60, 100, 200, 365}. Three- and seven-day streaks fire constantly across a
workspace and would drown every other card. A unit test asserts the wall's set is a strict
SUBSET of the log's — a card for a day the log does not celebrate would put a number in
front of somebody's whole group that they had never seen themselves.

### Sharing is the earner's own card only

The share button renders only when `card.earnerId === viewer.id`, and every `shareText`
line is first person. The Weekly Recap established the brag loop (v2 §4.6) as the user's
own pride becoming the product's marketing; sharing a colleague's achievement to your own
WhatsApp Status is a different and much stranger act.

### No Security Rules block, and a suite that pins that

`recognitions` and `wallPrefs` have no `match` block — every read goes through the admin
SDK in a server component, so Firestore's default deny is both the safest rule and the
correct one. But "we meant to leave it out" and "we forgot" look identical in a rules
file, so `e2e/wall-rules.test.ts` asserts the denials explicitly. It includes a PERMITTED
read (workspaceMembers) as a control, because a suite of nothing but denials passes just
as well against a rules file that denies everything the app needs.

### The index moved with the feature

`(workspaceId ASC, earnedAt DESC)` is declared in `firestore.indexes.json` and probed by
`verify:indexes`. The emulator invents missing indexes, so a wall shipped without it would
have worked in every test here and thrown `FAILED_PRECONDITION` on a real coach's first
visit.

## D72

**Native-speaker review of the four Indian-language dictionaries: three changes applied,
three rejected by a second reader, ten unverified.**

Reviewed by one native-register reader per language, with each proposed change handed to a
second independent reader whose only job was to refute it. That second pass earned its
keep immediately — it rejected three of the first reader's suggestions, including two the
first reader had rated as improvements:

- **Hindi `prospects.title` (मेरे लोग → लोग)** — rejected. "मेरे लोग" is not coach-speak
  for a downline; the team tab next to it is literally "मेरी टीम". A bare "लोग" as a
  screen heading reads like a dictionary entry.
- **Hindi `settings.language.reportNote`** — rejected as register churn, not improvement.
- **Telugu `threads.acknowledged` (చూసేశాను)** — rejected: the dialect premise did not
  hold, and the reviewer's replacement was a longer sentence where a word was wanted. The
  second reader's advice was to fix any visual confusability in the chip styling instead.

**Applied:**

- **Hindi `prospects.myQr`: क्यूआर → QR.** Every UPI app's Hindi UI and every
  shop-counter sticker writes "QR कोड" in Latin; the two letters are recognised as a
  picture, while "क्यूआर" makes a semi-literate reader stop and sound it out. The hi.ts
  header previously said "nothing stays in Latin script" — it now records QR as the
  deliberate exception, so the next reader does not revert it.
- **Telugu `threads.passItOn`: ముందుకు పంపండి → ఫార్వర్డ్ చేయండి.** The old string was a
  calque ("send it forward"). This action IS the WhatsApp forward every coach does daily,
  and ఫార్వర్డ్ is the word they say — the same loanword-in-native-script policy te.ts
  already follows for టీమ్/సేవ్/నెట్.
- **Kannada `settings.language.reportNote`: ಸ್ವಾಸ್ಥ್ಯ → ಆರೋಗ್ಯ.** Single-reviewer, applied
  anyway because the claim is factual rather than stylistic and the repo corroborates it:
  ಸ್ವಾಸ್ಥ್ಯ is the cognate of Hindi स्वास्थ्य, which hi.ts's own header already rejects in
  favour of सेहत. The same project made the opposite choice in the sibling language.

**Ten proposals were never verified** — the review ran out of budget mid-pass. They are
all "nicer"-grade register polish (Kannada ರದ್ದು → ರದ್ದುಮಾಡಿ, ಇಂದಿನ → ಇವತ್ತಿನ; Tamil
குறியீடு → கோட், the -ஆயிற்று completive, தொடர்ச்சி → தொடர்ந்து) and are listed in
`STATUS.md` for a human native speaker to settle. **Nothing unverified was applied**, and
the conservative default is the right one here: the second reader rejected half of what it
saw, which is the best evidence available that single-reviewer confidence is not enough.

**No rule violations were found in any of the four languages.** All four were rated
high-quality, genuinely spoken register, with loanwords correctly in native script.

## D73

**The offline queue drains on a LEVEL, not on edges — and the "flaky" e2e test was a real
capture-losing bug the whole time.**

`e2e/offline-capture.spec.ts` failed in every full-suite run and passed in isolation every
time. It was filed as flaky twice (STATUS 2026-08-13, then escalated 2026-08-14). It was
not flaky.

### What the trace said

Exactly one `POST /api/prospects`, status `-1` — the form's own attempt, aborted because
the signal was cut. Then the test brought the signal back, loaded `/prospects`, and **no
second POST ever happened.**

`OfflineSync` drained on four triggers: mount, the `online` event, a queue write, and a
tab becoming visible. Every one of those is an EDGE. And the first line of the drain was:

```ts
if (!navigator.onLine) return;
```

which treats "offline right now" as terminal rather than as "come back in a moment".

The race that killed it: the signal returned a few milliseconds before the next page
loaded, so the `online` event fired on the page being torn down (whose listener was
already removed by cleanup), and the fresh mount read `navigator.onLine` before the
renderer had processed the state change. Both edges missed. Nothing else was ever going to
fire, and the captured person sat in IndexedDB.

### Why this mattered beyond the test

It needs no test to happen. One flaky drain on a weak signal — precisely where walk-and-talk
happens — strands a real capture **after the coach has been told "saved on this phone"**.
That is the silent failure the spec's own header warns about, in production, on the exact
audience v1 §4.3 and RULES S5 wrote the offline requirement for.

The instinct on a test that "passes alone and fails in the suite" is to blame shared
emulator state and quarantine it. That instinct was wrong here, and the cost of being
wrong was a data-loss bug shipping to launch.

### The fix

A timing race cannot be fixed by adding a fifth edge. While anything is queued, the drain
keeps coming back:

- offline with a non-empty queue now **schedules a retry** instead of returning;
- a partial drain (`synced > 0 && remaining > 0` — `syncQueue` stops at the first item the
  server will not take) schedules another pass;
- backoff 2s → 4s → 8s → 15s → 30s, holding at 30s. The tail is the part that matters on a
  phone: a coach offline for an hour drains within half a minute of the signal returning;
- **one timer at a time**, because all four triggers can fire within milliseconds of a
  signal returning and four timers would be a burst rather than a backoff;
- the timer is cleared on unmount, and a returning `online` event resets the backoff since
  the reason the last attempt failed is gone;
- the queue is read BEFORE the network is checked, so an empty queue — every mount, on
  every screen — costs nothing and schedules nothing.

### Verification

Three consecutive full suites at **49/49**, against three consecutive failures immediately
before. `tests/offline-sync.test.ts` pins the shape, and its MANDATORY check was confirmed
to FAIL when the original one-line `return` was reinstated — a source test that passes
against the bug it describes is decorative, so it was run both ways rather than assumed.

## D74

**The four Phase-2 features already built are AUTHORISED to ship. RULES S7 still stands
for everything else.**

Owner decision, 2026-08-14: *"keep the phase 2 features, don't remove anything."*

This closes ⚠️ A, which had been the only open item in STATUS's conflicts list since the
audit on 2026-08-13 and which blocked new work under STATUS standing rule 2.

### What is authorised, precisely

Four things, and only these four:

- **F13 Leaderboards** — weekly/monthly boards with opt-out. This is not an approximate
  match to CLAUDE.md §8's Phase-2 list; it is the line item, verbatim.
- **F14 Event qualification** — conditions, a closing date, a tracker.
- **F20 Duplication score** — plausibly §8's "advanced team analytics".
- **The quick wins** — voice-note log, who-to-call, silence alerts.

### What is NOT authorised, and why this entry says so explicitly

RULES S7 — *"No Phase 2 features early. If it maps to v1 §8, park it"* — is **not
repealed**. §8's remaining items stay parked until the 200-paying-user bar: the social
feed with video posts, the shake-party/event manager, the poster and graphics library,
Kannada/Hindi/Marathi *report* localisation, the club-owner module, and advanced analytics
with PDF export.

The distinction matters because the cheapest way to lose a rule is to let one authorised
exception be read as the rule's repeal. A future session that wants to build the event
manager does not get to cite this entry; it needs its own owner decision.

### What "keep them" obliges, which is more than doing nothing

They now ship, so they have to work for a real coach:

1. **All nine Cloud Functions are exported and compile** — verified against
   `functions/lib/index.js`, which exposes all nine including the six these features need
   (`rebuildLeaderboards`, `evaluateQualifications`, `qualificationReminders`,
   `rebuildDuplicationScores`, `silenceCheck`, `purgeVoiceNotes`). Bug #1's fix is intact.
2. **All four screens are reachable** from `/more` — leaderboards, qualifications,
   duplication, voice-log and who-to-call. None is URL-only any more.
3. **`CRON_SECRET` is still blank in `.env.example`**, and that is now their launch
   blocker rather than a background nag. Every one of those six jobs fails closed without
   it, and the visible consequence is precise and bad: the boards stay empty, the
   duplication page reads "nothing counted yet" forever, and qualifications never
   evaluate or remind. A coach opening a feature that never fills in learns the app does
   not work — which is worse than the feature not existing, and worse than it would have
   been while they were unauthorised and unreachable.

That third point is the substance of this decision. Keeping the features converts a
config gap into a user-visible failure, so `CRON_SECRET` moves up the launch list.

---

## D75

**Razorpay subscriptions: no SDK, one answer to "is this coach paying", and a webhook
that is safe to call from the open internet.**

Phase 9b (v2 §8). The foundation landed in `357fe67` with its reasoning only in a commit
message and some file headers; this is that reasoning in the place RULES E6 asks for,
plus the four things the follow-up session settled.

Files: `src/modules/payments/{model,razorpay,queries,PaymentControls}.ts(x)`,
`src/app/api/payments/{subscribe,confirm,cancel,webhook}/route.ts`,
`e2e/payments.spec.ts`, `tests/payments.test.ts`.

### No SDK

Razorpay's subscription surface is three REST calls and one HMAC. A package for a `fetch`
wrapper would add a dependency whose upgrades this team tracks forever, and give the unit
suite something to mock instead of something to test. `fetch` and `node:crypto` are
already here. `src/modules/payments/razorpay.ts` is the whole client.

### `isPaidLeader` fails CLOSED, in every branch

A false negative costs a coach a Leader tool until the next webhook lands, minutes later.
A false positive gives away a paid tier, silently, for a billing cycle. Those are not
symmetric, so every branch that is unsure answers false — including any status Razorpay
invents after this was written. `created`, `authenticated`-but-unknown, and anything
novel all mean "not paying".

Two branches deliberately answer true where a naive reading says no:

- **Cancelled but paid-up.** Cancelling stops the NEXT charge. A coach keeps Leader
  through `currentEndAt`, because clawing back a month somebody paid for is a dark
  pattern in reverse and v2 §8 says never lock a coach out of their business.
- **In grace.** A failed charge opens five days (v1 F10, `GRACE_DAYS`) before Leader
  tools pause. The window is stamped on FIRST entry and a repeated `pending` does not
  extend it — otherwise a retrying gateway grants indefinite free Leader.

### Cancel is at cycle end, and cancel is two taps

`markCancelled` writes locally BEFORE the Razorpay call, so the coach's screen is honest
the instant they tap even if Razorpay is slow or down; the webhook then agrees. If the
Razorpay call fails they get an error and can tap again — the local mark is idempotent.

Two taps, and the second says exactly what it does. No "are you sure?" modal, no guilt
copy, no discount offer to stay: a retention flow ON the cancel button is precisely the
dark pattern v1 §4.7 forbids.

### Idempotency is structural, not a flag

`webhookEvents/{eventId}` — the document's EXISTENCE is "already processed". Written with
`create()` FIRST, before any other work, so two concurrent deliveries of the same event
cannot both pass the check: one `create` fails with ALREADY_EXISTS and that delivery
returns without touching anything. A boolean field with a read-then-write around it would
have a race exactly the width of a Razorpay retry burst.

Out-of-order delivery is a separate guard: `shouldApply` refuses to move an ended
subscription back to active, so a late `activated` cannot resurrect something cancelled.

### Raw body before parse

`req.text()`, then verify, then `JSON.parse`. The signature is over the exact bytes
Razorpay sent, and `JSON.parse` + `JSON.stringify` does not round-trip byte-for-byte —
key order, whitespace and number formatting all move. Verifying a re-serialised body
would fail on every real event and pass on nothing. The comparison is `timingSafeEqual`
on equal-length buffers.

Once the signature verifies, the route returns 200 whatever happens next — duplicate
event, unknown subscription, unhandled type. Razorpay retries any non-2xx for days, and
none of those is fixed by sending it again.

### Payments FEED the tier record; they are not a second answer

`applySubscription` ends by writing `tiers/{userId}`, the document `effectiveTier`
already reads. There is exactly one place in this codebase that answers "is this coach a
Leader today", and payments is an input to it rather than a rival source the app has to
reconcile. Downgrade is that record changing — `{ tier: "starter", source: "paid" }` —
and not one document is deleted anywhere.

### The four things the follow-up session settled

1. **The controls are gated so they cannot sell what is free.** `/plans` renders
   `PaymentControls` when `pay.hasSubscription || (isConfigured() && TIERS_ENFORCED)`.
   Offering "Get Leader" while every Leader tool is open to everyone would be charging
   for something the coach already has — the buyable-Elite dark pattern with a price tag,
   on a Trust Zone screen. The `hasSubscription` half is the important half: a coach who
   IS being charged sees their plan and their cancel button whatever the flag says, so no
   config constant can ever hide a cancel path from somebody being billed.

2. **The webhook has a signed-out test, because Razorpay has no session.** D68's lesson,
   applied to the surface where it would cost the most. A webhook eaten by
   `src/proxy.ts` answers 307, Razorpay reads a non-2xx, retries for days and gives up —
   and the visible symptom is a coach who paid and never became a Leader, in production,
   with the money already taken. `e2e/payments.spec.ts` visits it in a signed-out browser
   and asserts 400 FROM THE ROUTE; the contrast that makes it meaningful is that
   `/settings` signed-out is 307 to `/login`. The other three routes are asserted to
   refuse a stranger themselves, since the proxy matcher excludes `/api` entirely.

3. **Settings tells a paying coach what they are paying.** The "My plan" card read only
   the tier record, so a coach with a live mandate saw "no payment method is connected,
   and nothing charges by itself" — the money surprise v1 §4.7 exists to prevent. The
   cancelled sentence moved into `cancelledExplainer()` in the model because two screens
   now say it, and two copies of a money sentence drift.

4. **The funnel stopped counting promo Leaders as revenue.** `tierFunnel` counted
   everything non-trial as paying. `granted` is the promo source, and a promo is by
   definition a Leader who is not paying, so the row would have overstated revenue the
   day promo codes shipped. `paid` and `granted` are now counted apart.

### What is NOT built

Promo codes (v2 §8's club-launch codes) were still unwritten when this entry was first
made. They shipped the same day — see **D76**, which is also where the trap that design
walked into is recorded.

### RULES L7, as a type

There is no field on `SubscriptionRecord` in which a card, UPI id or bank detail could be
stored, and a unit test sweeps the key names for `card|upi|vpa|bank|account|ifsc|token|pan`
to keep it that way. The coach types their UPI id into a Razorpay-owned iframe; this
server receives three ids and a signature and re-verifies even those against Razorpay.

### The flip is still an owner decision, and still a set of three (D70)

`TIERS_ENFORCED = true`, the launch-open banner off `/plans`, the `start-trial` 409 out of
`src/app/api/tiers/route.ts`. Keys first. The unit test that pins the constant will fail
and name D70; that is it working.

---

## D76

**A promo code grants DAYS, never money — and `effectiveTier` had to start expiring on
the date rather than on the source before that was safe to ship.**

v2 §8's club-launch codes, the last unbuilt item in the Phase 9b queue (D75).

Files: `src/modules/promo/{model,queries,RedeemField}.ts(x)`, `src/app/api/promo/route.ts`,
`src/app/api/admin/promo-codes/route.ts`, `src/app/admin/promo-codes/`,
`src/modules/tiers/model.ts`, `tests/promo.test.ts`, `e2e/promo.spec.ts`.

### The boundary: days, not price

A code adds free Leader days and never touches Razorpay. It does not discount, does not
set a price, does not create a subscription. The paid conversion afterwards is the
ordinary path through `/api/payments/subscribe`, on the ordinary mandate, at the ordinary
price.

`lockedPlan` exists on the code document because §8 mentions founding pricing, but it is
carried as INFORMATION ONLY — nothing reads it to decide an amount. When founding prices
exist they will be Razorpay plan ids created in the dashboard like any other plan.

The reason for the boundary: a code that could alter what somebody is charged would put
pricing logic into a string handed out at a club launch, and the failure mode is a room
full of people holding a price the system does not honour. Days are safe to give away by
hand; money is not.

### The trap, which the design sketch walked into

The plan was "extend the trial by `leaderDays`, `source: "granted"`". But `effectiveTier`
read:

    if (record.source === "trial") {
      if (!record.trialEndsKey || todayKey > record.trialEndsKey) return "starter";
    }

A `granted` record carrying an end date would therefore **never expire**. One code handed
out at one club launch would have been permanent free Leader for everybody who typed it —
silently, with no error anywhere, discovered whenever somebody wondered why revenue never
started. Nothing writes `granted` today, which is exactly why it had never been wrong and
why this was the cheap moment to find it.

Expiry now keys on the DATE:

    if (record.trialEndsKey !== null && todayKey > record.trialEndsKey) return "starter";
    if (record.source === "trial" && record.trialEndsKey === null) return "starter";

That is also the safer default for whatever source comes next: a new source that forgets
to be listed here expires on its date instead of lasting forever. `paid` is unaffected
because `applySubscription` always writes `trialEndsKey: null` — a subscription ends by
cancellation and its own period end, never by a day key.

`trialDaysLeft` now counts grants as well as trials. A countdown that works for earned
days and reads zero for given ones would look like the app had forgotten a present.

An existing test named *"a paid or granted Leader does not expire on a trial key"* only
ever exercised the paid half, so nothing failed. It is now two tests that assert what is
actually true, plus a third pinning that a dated source with no date is Starter rather
than an endless Leader.

### Days are added, never substituted

`extendedEndKey` extends from the coach's existing end date when it is still live, and
starts today when there is none or it has lapsed. A coach nineteen days into a
qualification trial who redeems a 90-day code gets 90 on top of the nineteen.

Replacing instead of extending would have quietly taken those nineteen days away from
somebody being given a present, and would have looked like a shorter number on a screen
nobody was checking. The unit test asserts extension beats replacement explicitly, rather
than only asserting the resulting date, so the property survives a refactor of the
arithmetic. All of it through `day.ts` (RULES E1), including a month end and a leap
February.

### Structural guards, not checks

- `promoCodes/{CODE}` — the code IS the document id, so minting the same name twice is a
  failed `create()` rather than two sets of terms living under one string that two rooms
  of people are holding.
- `promoRedemptions/{CODE}__{uid}` — existence IS "already redeemed". Created with
  `txn.create()` INSIDE the transaction that increments `uses` and writes the tier, so
  all three move together or not at all. Two taps on a weak signal — which is how this
  feature is actually used, standing in a room at a launch — cannot grant the days twice
  or burn a use without granting anything. Same shape as claps, referral codes, and
  `webhookEvents` (D75).

A coach already on a *paid* Leader plan is refused rather than silently given days that
do nothing: their tier record is `source: "paid"`, and overwriting it with a grant would
lose the subscription's own state.

### An unknown code and an expired code answer identically

Both say "That code is not valid." A code is a bearer credential and distinguishing the
two lets somebody probe which codes exist. A *fully used* code is distinguished, because
there the coach holds a real code and the honest answer is that they were too late.

### Trust Zone (RULES G1)

The field lives on `/plans`, collapsed behind "Have a code?", flat and calm, with no
celebration **even though the outcome is good news**. G1 carves out no exception for
pleasant money events: this sits one scroll above the buttons that charge people, and
teaching a coach that this screen celebrates is the association the Trust Zone exists to
prevent.

The success line says what happened and what did not — Leader until a date, nothing
charged, no payment method connected. A grant that left somebody wondering whether they
had just started paying would be the money surprise of v1 §4.7 arriving through the door
marked free.

It is shown to everyone, including before the flip, unlike the purchase controls: a code
is not a thing being sold, costs nothing, and is only usable by somebody already holding
one, so the reason those are gated does not apply.

### The admin tab that deliberately did not exist

`src/app/admin/layout.tsx` carried a comment explaining why there was no Promo codes tab:
codes were meaningless before tiers and payments, and a screen minting codes that did
nothing would have had somebody hand them out at a club launch and find out in front of a
room. Tiers ship (D70) and payments ship (D75), so the tab exists and the comment is
rewritten rather than deleted — the reasoning is why the tab is safe now.

Minting is bounded at 365 days and audited (`mint-promo-code`, a new `ADMIN_ACTIONS`
member). The bounds guard a specific human error: an admin at 11pm before a launch typing
an extra zero into a field that gives away free Leader.

### Testing

Unit tests cover normalisation, shape, mint bounds, redeemability, and the extension
arithmetic. The e2e drives the parts a unit test cannot reach — the transaction — against
real Firestore: a second redemption is refused and the use count does **not** move,
an expired and an unknown code return byte-identical errors, a capped code stays capped.

The spec puts the emulator back as it found it. `threads.spec.ts` and
`qualifications.spec.ts` both log in as the same coach afterwards and every suite shares
one Firestore instance, so leaving him a Leader would be one spec changing the world
other specs assert about — the coupling that shows up later as a test which only fails in
the full run. Deleting the tier document restores his state exactly, because `tiers`
holds only the coaches who moved: absent IS Starter.

Fixture setup speaks to the emulator as `Bearer owner`, because `promoCodes` has no rules
block and the default deny applies to the REST client surface. That deny is deliberate: a
client-readable `promoCodes` would let anyone enumerate live codes, and a writable one
would let a coach mint themselves a free year.


---

# The N-series — new modules (leaderboards, qualifications, duplication)

Folded in from `src/modules/DECISIONS-new-modules.md` on 2026-08-19 (STATUS ⚠️ C).

**Numbering is untouched.** The N-series is its own sequence and never collided with the
D-series, so nothing was renumbered — an N-number cited in a code comment or a commit
message still resolves, which is the whole reason the fold was safe to do mechanically.
`src/modules/qualifications/evaluate.ts` cites "DECISIONS-new-modules" by name; that
reference now means this section.

Why fold at all: two decision files means two places to look and one of them gets
forgotten. This one lived under `src/modules/`, which is where code goes, so it was
invisible to anybody reading the repo's documentation. These entries are the reasoning
behind F13, F14 and F20 — the three Phase-2 features D74 authorised to ship — and they
belong beside every other decision.

Same purpose and format as the repo's `DECISIONS.md`, kept separate because that
file belongs to the other branch and every line added to it is a merge conflict.
Fold these in when the branches meet.

Numbering is `N1…` so nothing collides with `D1…D67`.

---

## N1 — Four boards, no metric switcher (F13, session 1)

The brief asks for four separate boards and says why in one clause: a single volume
board means the same five people win forever and everybody else stops opening the
app. That is the whole feature, so it is designed around rather than tidied away.

**All four render on one screen, stacked, with no switcher.** A metric switcher
would technically satisfy "four boards" while making three of them something a coach
must already know about before they can find it — the second-class outcome the brief
names. Volume, people met, follow-ups done and logging streak are each winnable by a
different person on a different strength, which only works if a coach sees all four
without asking.

Scope and week/month ARE controls, because they change which people and which days
are in view rather than which board matters.

## N2 — The ranking window looks upward only, and the roster is server-only

The hard requirement: someone in last place must never be able to see that they are
in last place, and nor must anyone else.

A coach is shown the top 3, the few coaches directly AHEAD of them, and the exact gap
to the next one. **Never anybody behind them.** That single asymmetry is what makes
last place unobservable — a coach who is never shown anyone below them cannot tell
whether anyone is there, and the person at the bottom sees the same shape of screen
as the person in the middle.

Two consequences, both load-bearing:

- **The participant count never reaches a client.** "You are #14" plus "41 coaches"
  is a bottom-of-the-board reveal with extra steps.
- **The full ordering never reaches a client.** It lives in a `roster` document that
  Security Rules deny to everybody, including the coach ranked first on it. The page
  is server-rendered and slices each reader's window out of it with the Admin SDK.
  Enforcing this in the component alone would be exactly the "the UI hiding it proves
  nothing" failure RULES P2 exists to prevent.

The podium is the deliberate exception: three names whatever the size of the field,
so it carries no information about where the field ends.

**A board is not published below `MIN_PARTICIPANTS` participants.** Not a performance
threshold. Below the floor the screen teaches instead.

### N2a — The floor was 5 and that was not enough (audit correction)

The floor was originally a hand-picked 5, reasoned from the podium alone: on a field
of three the podium is the whole field, so third place is last place in public, and
five looked like clear air. It was not. The podium and the window are two sets, and
below a certain size they **meet**.

A coach at rank R is shown ranks `1..PODIUM_SIZE`, plus the `WINDOW_ABOVE` coaches
immediately ahead, plus themselves. When `R <= PODIUM_SIZE + WINDOW_ABOVE + 1` those
sets join up and the coach is handed an unbroken `1..R` ending on their own name.
With 3 and 4 that is every board of 5, 6, 7 or 8 participants — measured against the
emulator, a real five-person line board rendered **5 of 5 entries** to the coach in
last place.

"The window never contains anybody behind you" was true the whole time and is not
sufficient. Nothing shown was behind the reader; the reveal is that there was nothing
*between* them either, on a group whose membership a coach already knows from the team
tree. And 5–8 is not an edge case at pilot scale — it is most boards.

So the floor is now **derived**: `PODIUM_SIZE + WINDOW_ABOVE + 2`, the smallest field
that always hides at least one rank between the podium and the window. With the
current 3 and 4 that is **9**.

The cost is honest and belongs to the owner: fewer boards publish at pilot scale, and
more cards show the teaching state. The dial is `WINDOW_ABOVE`, not the floor —
showing fewer coaches ahead lowers the floor one for one (2 gives 7, 1 gives 6).
Lowering the floor on its own is not available; it re-opens the leak.

The unit suite could not see any of this because every window case ran against a
twelve-coach board, and the floor assertion was `MIN_PARTICIPANTS > PODIUM_SIZE + 1`
— true of 5, and silent about the window. It now sweeps every publishable field size
and demands a visible break in the ranks shown to the last-placed coach.

## N3 — Weekly and monthly, and the streak board measures a run inside the window

Both windows exist so one slow month never ends anyone's chance. For that to be true
the streak board cannot rank the coach's LIVE streak: a 200-day run would win every
weekly board for the rest of that coach's life, and the weekly reset would be a lie.
It ranks the longest run of consecutive logged days **inside the window**, so Monday
starts everybody at nothing. Days logged in the window is the silent tiebreak.

The **Streak Shield (D67) does not apply on a board.** A shield is personal
forgiveness for the flame on your own screen; spending it to claim a day you did not
log, in a ranking against other people, is a different thing. A missed day breaks the
run on the board and the flame still survives.

## N4 — Volume ranks on the checked number, and volume is monthly only

Ranking is on **proof-validated** points. Claims no upline has checked are carried
alongside, rendered dimmed as "+N not checked yet", and they order coaches who have
nothing checked among themselves — they can never lift anyone above a checked figure.

**A target counts as validated when its most recent proof is approved.** Per target,
not per point, and that is a known approximation: nothing records how many points
stood at the moment of approval, so a coach who raises progress after approval carries
the increase as validated until somebody asks for proof again (any newer pending,
submitted or rejected proof puts the whole target back in the unchecked column).

The proper fix is to stamp `progressPointsAtReview` on the proof when it is approved,
which means editing `src/lib/targets-queries.ts` — an existing file this branch may
not touch. **Reported, not done.**

**Volume runs monthly only.** It is recorded once a month as a cumulative figure
(F7, D30) and there is no per-day history to slice a week out of. Inventing a weekly
volume number would mean inventing a points formula, which is a business rule this
module has no business making up. The weekly view of that card says so and points at
the monthly one.

## N5 — The four scopes, and what "club" honestly is

| scope | key | membership |
|---|---|---|
| org | the root of the coach's tree (`uplinePath` last, or self) | same root |
| line | the coach's direct upline (or self, for a root) | that id, or that id in `uplinePath` |
| level | `trim().lower()` of the level name the coach typed | same normalised level name |
| club | `trim().lower()` of the coach's city | same normalised city |

- **org is not "every user of Growline".** Two unrelated clubs on one install are not
  one organisation, and a board mixing them is meaningless to both.
- **line is the coach's own team, not every ancestor's.** A coach belongs to as many
  lines as they have ancestors; offering eight of them in a filter is the opposite of
  the 30-second rule. An upline is refused their downline's line board — they lose
  nothing, since their own team board is a strict superset of it, and granting it
  would cost a second document lookup in the rule to prove a containment nobody asked
  for.
- **level groups exist only because a coach typed a name.** No defaults, no
  placeholders, no suggestion list, no canonicalising their spelling into a list we
  chose (RULES L1/L8, D29). A coach with no level name has no level group, and the
  screen teaches instead of showing an empty dropdown.
- **club is city, and the UI says "city".** There is no club entity in the data model
  (F12 lists clubs/cohorts as unbuilt admin work) and this branch may not create one.
  City is the only signal we hold for "who is near me". When a club entity lands, only
  `scopeKeyFor` and one rule branch change. A city board deliberately crosses
  organisations — that is what being near somebody means.

**Normalisation is `trim().lower()` and nothing cleverer**, because Security Rules
have exactly those two string operations. A membership test the rules cannot restate
is a membership test nobody enforces.

## N6 — The opt-out flag lives in `leaderboardSnapshots`, and the trade-off

It belongs on the user document and cannot go there: this branch may not write to an
existing collection. So it is a document in the boards collection, `opt_<uid>`, keyed
by uid, written only by the coach themselves through `/api/leaderboards/opt-out`.

Accepted costs, written down so the next session can price the migration:

- the compute job reads every opt-out document each run (one `kind` query) instead of
  getting the flag free with the user it has already loaded;
- a deleted user leaves an orphan — which fails safe, since an orphan means "not
  listed";
- nothing else in the app can see the flag, so the Settings screen cannot show it and
  the switch has to live on the boards screen;
- opt-outs cannot be listed by anyone (the rule allows a coach only their own), so
  "how many people opted out" is a server-side count, not a query a client can make.
  That is deliberate: who opted out is a list of people who wanted less visibility.

**Absence of the document means listed.** The default for a coach who has never
touched this is to be on the boards, which is what a board is for, and opting out is a
create rather than an update to a field that might not exist.

**Opted-out coaches still see every board.** They are removed from the rows before
ranking, not hidden at render — filtering later would leave holes in the ranks, and a
hole is an observation about the person missing from it.

### N6a — Falling below the floor must UNPUBLISH, not just skip (audit correction)

The job originally `continue`d past a board that had dropped below
`MIN_PARTICIPANTS`. Skipping a write leaves the previous run's documents in place,
still readable by everyone in the scope — and the thing that most often pushes a board
under the floor is precisely a coach opting out of it.

Reproduced against the emulator: a five-person line board, one coach opts out, full
rebuild runs, and the board is still there with that coach's name and numbers on it.
Opting out changed nothing for the rest of the period. An opt-out that silently fails
in exactly the case it caused is worse than no opt-out, because the screen says it
worked.

The skip branch now **deletes** both documents. Deleting what is not there is a no-op,
so no read is needed to find out. It costs two writes per skipped board per run and
that is now the dominant term in this job's write budget, since most scope-metric pairs
sit below the floor at pilot scale. If that ever needs cutting, cut it by reading which
boards exist — never by going back to a silent skip.

## N7 — Three document kinds in one collection

`podium` (top 3, readable by members of the scope), `roster` (full ordering plus the
participant count, denied to everyone) and `optOut` (readable by its owner). One
collection because this branch is allowed one for boards; a `kind` field separates
them and the Security Rule keys off it.

Ids are deterministic (`pod_`/`ros_` + metric, window, period, scope type and a hash
of the scope key), for D35's reason: a rerun must overwrite the board it wrote last
time rather than accumulate copies. The scope key is free text — a level name, a city
— so it is hashed into the id and stored in full in the document.

**Past periods are never recomputed.** A finished week is finished; rebuilding it
would let a late edit rewrite history.

## N8 — Membership is resolved live; the ranking is the only snapshot

D64's rule, applied here: the Security Rule decides who may open a board by reading
the CURRENT user document, never a `uplinePath` stored on the snapshot. The ranking is
a snapshot — that is what a board is — but the permission is not. A coach moved to a
different line loses the old line's boards on their next read.

## N9 — No composite indexes were needed, and no money is anywhere

Every query the job makes is single-field (`createdAt` range, `dayKey` range,
`month ==`, `targetId in`, `kind ==`) or a document-id read, all of which Firestore
indexes automatically. `firestore.indexes.json` is therefore unchanged.

RULES L4 is a test, not a review note: `tests/leaderboards.test.ts` asserts that no
board's copy contains a rupee sign, an earnings word or "at this rate". A leaderboard
is the easiest screen in this app on which to break that rule.

## N10 — The scheduled function exists but is NOT deployed

`functions/src/leaderboards.ts` holds the every-three-hours rebuild, shaped like
`morningReminder`: a thin caller that POSTs `/api/leaderboards/rebuild` with
`CRON_SECRET`, so the aggregation keeps one home in the app and is runnable by hand
against the emulator.

A Cloud Function is only deployed if it is exported from `functions/src/index.ts`,
which this branch may not edit. **One line turns it on:**

```ts
export { rebuildLeaderboards } from "./leaderboards";
```

Until somebody adds it, boards refresh only when something POSTs the route. The screen
always shows when a board was last built, so a stale board says so rather than
presenting last week's ranking as today's.

## N11 — Reachable by URL and from `/more`, not from the bottom bar

`src/components/AppNav.tsx` hardcodes a five-column grid; a sixth tab is a layout
change and the owner's decision. `src/app/(app)/more/page.tsx` is the hub for
everything not on the bar, and sessions 2 and 3 add their entries to its one list.

---

# Session 2 — F14, event qualifications

## N12 — A qualification's conditions are a LIST of typed pairs, not five columns

The brief says the data model is the real work and names what it has to make cheap:
a sixth criterion type, later. So a qualification stores
`criteria: [{ type, target }, …]` against a registry (`criteria.ts`), and every
consumer — the tracker, the nudge, the qualifier list, the drop-off table, the
reminder copy — is written as a loop over that array with a lookup in the registry.

The alternative was five nullable fields on the document (`volumeTarget`,
`membersTarget`, …). Priced against the same change:

| | five fields | a list of pairs |
|---|---|---|
| sixth criterion | schema change, migration, a branch in the evaluator, a branch in every renderer, a key in the summary map | one entry in `CRITERION_SPECS`, one `if (want(…))` block in the collector |
| what else edits | every file that names a criterion | nothing |

Two unit tests hold the property rather than a comment: one proves a type cannot be
listed with a half-written spec, the other runs every type through scoring, nudging
and drop-off generically, so a `switch` appearing downstream fails for the sixth
type instead of shipping.

## N13 — Two ways to measure, declared in the registry

`measure: "windowed" | "cumulative"`.

Four criteria are countable inside the window because their rows carry a time:
prospects captured, members logged, coaches recruited, days logged. Volume is not —
it is one cumulative monthly figure per coach with no per-day history, which N4
already recorded on the boards.

Counting the whole month's figure would credit a coach for points earned before the
qualification was announced. So a cumulative criterion is measured against a
**baseline** captured when the coach enters, and progress is the difference. The
create route evaluates synchronously, so for the audience that exists at
announcement the baseline is taken at that instant; a coach who joins the line later
is baselined on the run that first sees them, which errs towards under-counting
rather than crediting work done under a different upline.

A validated total can go DOWN (an upline asking for fresh proof), so the difference
is clamped at zero. "-40 points" is not a number anybody can act on.

### N13a — `measure` was documentation, not machinery (audit correction)

N12 claims that adding a sixth criterion costs one entry in `CRITERION_SPECS` and one
collector. N13 claims the evaluator reads `measure` to decide what needs a baseline.
The first was true. The second was not: the evaluator chose baselines with
`c.type === "volume"`, and `measure` was read by nothing but a test asserting it was
one of two strings.

Indistinguishable from correct today, because volume is the only cumulative criterion.
Wrong the moment there are two: a sixth cumulative criterion would get no baseline
entry, `base` would fall back to 0, and `done = raw - 0` would credit the coach's
entire lifetime total to a qualification announced last week. That is precisely the
padding the baseline exists to prevent, arriving silently, on the screen a whole line
is reading.

Fixed: `needsBaseline()` and `baselineTypes()` in `criteria.ts`, driven by `measure`,
and the evaluator asks them. Behaviourally identical today by construction.

The interesting part is why nothing caught it. Every scoring test runs against
`progress.ts`, which is pure and takes the baseline as an ARGUMENT — so the tests
proved the arithmetic and never touched the choice. The choice lived one file further
in, in `evaluate.ts`, which imports firebase-admin and therefore cannot be imported by
a unit test at all. So there are now two guards: the contract on the pure function,
and a source assertion that nothing in `evaluate.ts` compares a criterion's type to a
literal. The second one is the one that would actually have failed.

## N14 — Volume counts only CHECKED points, and the unchecked figure is carried

Same rule as N4, and here it matters more. `progressPoints` is typed in by the coach
it belongs to (F7), so a qualification gated on the raw figure is one a coach awards
themselves by typing a bigger number. Only points on a target whose most recent proof
is approved count; any newer proof — pending, submitted or rejected — puts the whole
target back in the unchecked column.

The known approximation is N4's: validation is per TARGET, not per point, because
nothing records how many points stood when the upline approved. The proper fix is
`progressPointsAtReview` on the proof, which means editing `src/lib/targets-queries.ts`
— an existing file this branch may not touch. **Still reported, still not done.**

The unchecked amount is carried alongside and rendered dimmed, because it changes the
instruction. A coach sitting on 400 unapproved points is not behind on the work, they
are behind on the checking, and "go and meet more people" would be the wrong nudge
(G6). That is the one hint in this feature that names a job somebody else has to do.

### N14a — The window bounds volume's MONTHS, not its timing (audit correction)

`LATE_CHECK_DAYS` carried the claim that "only the CHECKING is allowed to arrive late;
the work itself still has to fall inside the window, which the day-key bounds enforce."
For the four windowed criteria that is exactly true — every underlying row carries a
time. For volume it is false, and the comment has been corrected.

`progressPoints` is one self-typed running total per month with no per-point history
(N4, N14). The day-key bounds therefore select which MONTHS are read; they say nothing
about when a point inside one was entered. Two consequences:

- **Late entry.** Points typed into a window month after the deadline count, for the
  seven days late-checking runs. Usually this is a coach catching up on paperwork,
  which is the behaviour we want — and an upline still has to approve it.
- **Back-fill.** The baseline records what a coach had TYPED when they entered, not
  what they had EARNED. A coach who logs the whole month's points in one go afterwards
  has the whole month credited to a qualification announced mid-month.

Neither is fixable from this branch, and both are the same root cause as N14's known
approximation: `progressPointsAtReview` on the proof, in `src/lib/targets-queries.ts`,
an existing file this branch may not touch. **Reported, still not done — and the count
of things blocked on that one field is now three (N4, N14, N14a).**

## N15 — The audience is "direct" or "whole line", not the four board scopes

The brief says "which part of their line it applies to", and a line has two honest
answers: the coaches you brought in yourself, or everyone beneath you at any depth.
Both are the words F8 already put in front of these coaches for the same choice.

The leaderboards' four scopes are deliberately NOT reused. A city board crosses
organisations on purpose (N5), and "everyone in Bengaluru qualifies for my event" is
not something an upline can offer. A level group is free text somebody typed; gating a
prize on it would make the text a claim.

Membership is resolved LIVE on every evaluation and in the Security Rule (D64). No
participant list is stored. A coach who joins the line mid-qualification is in it from
that moment; a coach who moves out has their row DELETED, for N6a's reason — leaving
it behind keeps their name and numbers on a qualifier list belonging to a line they
have left.

### N15a — One predicate, not two copies of one rule (audit correction)

That membership rule decides two different things: whose progress row the evaluator
WRITES, and who may OPEN the screen. It was written out twice — `audienceOf` in
`evaluate.ts` and `isParticipant` in `queries.ts` — and both files import
firebase-admin, so no unit test could reach either. A drift between them would produce
a coach with a tracker who cannot open it, or a page served to somebody the evaluator
never counted.

It is now one pure function, `inAudience()` in `model.ts`, and both call it. Being pure
also means it is finally testable: `tests/qualifications.test.ts` now pins the app-side
half of what `e2e/qualifications-rules.test.ts` pins at the database — a coach outside
the creator's line is in NEITHER audience, a grandchild is not in "direct", and a
creator is never a participant in their own qualification.

The Security Rule states the rule a third time, in its own language. That copy is not
duplication to remove: the app's copy decides what we render, the rules' copy is what
stops a hand-written query, and neither substitutes for the other (the argument
`threads-queries.ts` already makes).

## N16 — Qualified by name, one-step-away by count

The brief asks for a live qualifier list — "who is already in, who is one step away" —
and that second half is where the leaderboard leak N2 reappears in different clothes.

- **Qualified: names, to everyone in the qualification.** Being in is good news, and an
  event list is public by nature; a qualification whose qualifiers were secret could
  not be run at all.
- **One condition away: a COUNT to participants, NAMES to the creator only.** A peer
  does not need to know whose shortfall is whose. The creator does — they are the
  person who makes the phone call, every one of those people is already on their team
  tree, and activity counts flow up the line anyway (P1).

Neither audience ever sees a prospect: names met are counted, never named, and the
evaluator reads nothing off a prospect document but its owning coach's id.

### N16a — What the qualifier list newly discloses (audit note)

Recorded because it was not, and it is a real widening rather than a restatement.

On a WHOLE-LINE qualification, the qualifier list shows every qualified coach's name to
every participant — including coaches in a SIBLING branch, whom the reader cannot see
anywhere else in the app. The team tree only ever looks downward, so before this feature
a level-1 coach had no way to learn the name of somebody under a different level-1 coach.
Now they can, if that person qualifies.

Accepted, and it is the point: a qualification is an announcement to a group and its
qualifier list is the announcement's result — a list that could not be published could
not be run at all, which is N16's first bullet. What is deliberately NOT widened is the
other direction: the one-condition-away group stays a COUNT to participants, so nobody
learns a name attached to a shortfall. A coach's own numbers reach nobody at all (N19).

If this is ever judged too wide, the dial is the qualifier list's scope, not the count:
show names only within the reader's own branch. That is a product decision and it
belongs to the owner, so it is written here rather than taken.

## N17 — "One step away" is exactly one unmet condition, and the label never travels alone

`stepsAway` is the count of unmet criteria. One means one. Not "close on all of them",
not a tuned percentage.

That definition has an honest hole: a coach with four conditions met and zero of two
thousand points IS one step away and is nowhere near. The fix is not a threshold —
picking 60% or 80% would be inventing a business rule to make a label feel right.
The fix is that **the number always travels with the phrase**. Every place this module
says one step away, it prints the gap in that criterion's own units: on the tracker,
in the nudge, in the reminder, and beside every name in the creator's list. A
MANDATORY unit test asserts it.

The "closest" condition is chosen by FRACTION, not by the raw gap. 600 points and 2
members are not comparable numbers, and picking the smaller would send a coach who is
95% of the way to a volume target off to start the thing they have not touched.

## N18 — Qualifying latches

Once a coach has been told they are in, they stay in for that qualification, and
`qualifiedAt` records when. The only way a met condition can un-meet itself is an
upline requesting fresh proof on an already-approved target — somebody else's action,
after the fact — and taking a badge back off a person who has already shared it is not
something this app is going to do.

The per-criterion rows keep telling the truth, so a tracker can show "You are in"
beside a condition that has since slipped. Rare, honest, and better than a bouncing
badge.

## N19 — Two collections; the numbers are readable by nobody

`qualifications` holds the DEFINITION and is readable by its creator and the line it
addresses — a condition nobody can read is not a condition, and the document contains
no numbers about any person.

`qualificationProgress` holds every participant's row and the roll-up (two `kind`s in
one collection, N7's arrangement, because this branch may create one collection for
this feature). It is denied to **every** client — including the coach a row is about
and the creator. Between them the rows carry the audience size, everybody's shortfall
and who is nowhere near; N16's asymmetry is only a guarantee if they cannot be
fetched. Denied to the creator too, because a grant with an exception is a grant
somebody widens, and their dashboard is server-rendered anyway (D48's discipline).

The definition's rule is split into the same two branches F8 uses, for the same
reason: a list request is evaluated once against the query, so each branch must be
decidable from fields the query pins. A grandchild is refused a direct-line
qualification — "my direct line only" means exactly that.

## N20 — A deterministic id, no edit and no delete

The qualification id is a hash of (creator, normalised title, deadline). A
double-tapped Create button therefore lands on the same document instead of putting
identical twins on a whole line's screen with no way to tell which is real.

The route REFUSES an id that already exists rather than overwriting it, and there is
no edit screen and no delete route. A qualification people are already being measured
against must not have its conditions moved — a moving target is not a target — and the
Security Rule says the same thing to a client that tries.

The cost, written down: a genuine mistake cannot be withdrawn, only left to close. If
that becomes a support burden, the answer is a CANCELLED state that stops evaluation
and says so on the card — never a silent delete, which would remove a qualifier list
people were told they were on.

## N21 — Evaluate on create, refresh on open after fifteen minutes

A qualification's numbers are an aggregation across a whole line, so they are stored
rather than computed per screen open — leaderboards' reasoning exactly.

Three things write them:

1. **Creation**, synchronously. A coach tapping through from their upline's message
   sees their own numbers, not an empty frame promising a job will run later. It also
   fixes the cumulative baseline at the moment of announcement (N13).
2. **The scheduled evaluator**, every three hours — which is NOT deployed (N23).
3. **The page itself**, if the stored summary is older than `STALE_AFTER_MS` (15
   minutes) and the qualification has not settled.

(3) exists because of (2)'s deployment problem: without it a tracker would show
whatever creation wrote and nothing after. It is bounded the other way too — however
many coaches open the screen, one qualification is evaluated at most four times an
hour. Racing refreshes are harmless: every write is an upsert on a deterministic id
with the same computed values.

A **settled** qualification is never recomputed. Settling is the deadline plus
`LATE_CHECK_DAYS` (7), and that grace exists for proof approval: a coach whose last
piece of work lands on the deadline needs an upline to approve it, and that happens
when the upline next opens the app. Only the checking is meant to arrive late; for
volume that intent is approximate — see N14a.

### N21a — The LIST does not refresh, so it says how old it is (audit correction)

(3) above is the DETAIL page only. `listForCoach` reads the stored row and renders the
standing straight onto the card — and with the scheduled evaluator undeployed (N23),
that row can be the one creation wrote and nothing since. So a coach who only ever
looks at the list could be shown "0 of 3 conditions met · 3 conditions left" while
they have in fact qualified, until somebody opens the card.

Refreshing per card is not the fix. `ensureFresh` reads a whole slice of the
organisation; doing that once per row would make opening a list cost N of them, which
is the exact expense the stored rows exist to avoid — and a list is the cheapest,
most-opened screen in the feature.

So the card states its age instead. `updatedAt` is already on the row the card reads,
so it costs nothing: silent inside `STALE_AFTER_MS`, and outside it "Counted 2 h ago —
open to refresh", or "Not counted yet" if no row exists. The threshold is imported
from `evaluate.ts` rather than retyped, so the number that decides whether the detail
page recomputes is the same number that decides whether the card admits it has not.

This is the same standard N17 sets for "one step away": the app does not present a
figure as more certain than it is, and the honest fix is to print the qualifier rather
than to hide the number.

## N22 — Deadlines are days in the coach's zone, and the zone travels with them

E1. A deadline of "31 August" evaluated in UTC closes at 05:30 on the 31st for the
person holding the phone: it takes the last evening away from everybody who works in
the evening, which is when this audience works.

So a qualification stores `fromKey`, `deadlineKey` and `timeZone`, the deadline is
INCLUSIVE, and the exclusive instant a Firestore range query needs is derived rather
than stored so the two cannot disagree. The zone is `APP_TIMEZONE` today and is taken
from the server, never from the request body — a client-supplied zone would let a
coach push their own closing date forward by picking one.

`daysLeft` counts today, so the last day is 1 and never 0: zero reads as "it is over"
while a coach can still act.

## N23 — Two scheduled functions, and neither is deployed

`functions/src/qualifications.ts` holds `evaluateQualifications` (every three hours)
and `qualificationReminders` (09:00 Asia/Kolkata daily), both thin callers of app
routes — `morningReminder`'s shape, and N10's for the same reason.

A Cloud Function is only deployed if it is exported from `functions/src/index.ts`,
which this branch may not edit. **One line turns both on:**

```ts
export { evaluateQualifications, qualificationReminders } from "./qualifications";
```

Until then the trackers still work (N21), but nothing is PUSHED. The escalating
reminders are the piece that genuinely does not happen without a scheduler, because
they are the only part that has to reach a coach who is not looking at the app.

## N24 — Escalation shortens the gaps; it does not raise the voice

Bands at 14, 7, 3 and 1 days left. A band fires the first time `daysLeft` drops to or
below it, so the gaps close — seven days, then four, then two. Because days only
decrease, a passed band can never become due again and no bookkeeping is needed beyond
"have we sent this one", which lives on the coach's own progress row (N6's reasoning
about where a flag can live on this branch).

**The band is a schedule, never a label.** The three-day band covers everything at or
under three, so a message worded from the band would say "3 days left" on a day when
two remain. The lead line comes from the real day count and is therefore always true.

There is no countdown timer and no "running out of time" copy. G2 bans fake scarcity
and this is the easiest screen in the app on which to manufacture some; the urgency is
carried by two true things, the day count and the gap. Nobody who has already
qualified is reminded — a notification that arrives after the good news reads as the
app not knowing.

The band is marked as sent even when the coach turned out to have no working device.
Otherwise a coach who never enabled notifications is due on every run for the rest of
the qualification, and the job spends its budget rediscovering that.

## N25 — One route for two seats, and the celebration is local

`/qualifications/[id]` renders the tracker or the creator's dashboard depending on who
is asking. A creator is never in their own audience — a qualification runs DOWN a line
— so the two seats never overlap and a second route would only be a second thing to
remember. Anybody else gets `notFound()`, the same answer as a qualification that does
not exist, so the route cannot be used to discover what an upline in another line is
running (targets-queries.ts's discipline).

The qualified celebration fires once per device, tracked in `localStorage` rather than
a stored field: it is a display preference for one browser, it needs no write path, and
a coach who opens the app on a second phone getting the moment once more is a better
failure than a server round trip to suppress it. Pink diamond, under 1.2s, skippable by
tap, and skipped entirely under `prefers-reduced-motion` (G5).

---

# Session 3 — F20, the duplication score

## N26 — The formula, its inputs, and what it deliberately does not measure

One number answering one question: **is the work happening only at the top, or
genuinely three levels deep?**

For each depth `d` below a coach (`d` = 1, 2, 3), over a rolling window:

```
n_d = people at that depth who have been in the line long enough to count
k_d = how many of those are ACTIVE
m   = (Σ k_d) / (Σ n_d)                        the line's own pooled rate
â_d = (k_d + α·m) / (n_d + α)                  α = 2, the shrinkage pseudo-count

score = 100 · (Σ d·â_d) / (Σ d)                over every d where n_d > 0
```

**Inputs, and only these:**

| Input | Where it comes from | Constant |
|---|---|---|
| Who is in the line, at what depth | `users.uplinePath`, first 3 entries (D36) | `MEASURED_DEPTH = 3` |
| Days a person logged | `dailyLogs.dayKey` inside the window | — |
| The window | 28 local days ending today (E1) | `WINDOW_DAYS = 28` |
| The active bar | days logged, pro-rated by presence | `ACTIVE_DAYS = 4` |
| Who is old enough to count | `users.createdAt` | `MIN_TENURE_DAYS = 7` |
| How much a small level is trusted | — | `SHRINKAGE = 2` |

**What it does NOT measure, on purpose:**

- **How hard anybody works.** Four logged days and twenty-eight count identically.
  Intensity is what the boards rank (N1); this counts how many people are moving at
  all. A line cannot lift this number by having one person at the top do more.
- **The coach's own activity.** Not a parameter of `scoreLine`, and a depth of 0
  passed in by mistake is discarded. If a coach's own diligence could lift their own
  duplication score, the one question the number answers would stop being answerable
  and the hardest-working coach in a dead line would read as the healthiest. Their own
  days are shown beside the number, labelled as not part of it — which is the
  misreading everybody has first, so the screen answers it rather than waiting.
- **Money, in any form.** No rupee figure, no conversion, no rate of change, no "at
  this rate" (L4). A duplication score beside a trajectory is an income projection
  with the arithmetic left to the reader, and the unit tests fail on the vocabulary.

28 days rather than 30 because 28 holds exactly four of every weekday. Clubs run on a
weekly rhythm, and a 30-day window holds five Mondays and four Tuesdays, so the score
would rise and fall with which day the job happened to run.

## N27 — The weight is the depth itself, and a one-level line can score 100

Activity at level 1 can be explained by a coach personally ringing every one of their
direct downlines. Activity at level 3 cannot — those are people the coach has very
likely never met. So the deeper the level, the more it counts, in the simplest ratio
that says so: **`w_d = d`**, level 3 worth three times level 1.

That asymmetry is the feature. Two lines with identical overall activity, one
top-heavy and one bottom-heavy, score 39 and 61 — and a number that scored them the
same would answer no question worth asking.

**A line one level deep is scored on the level it has.** Four direct downlines, all
logging, scores 100. The alternative — capping the score by depth reached, so one
level can never exceed 33 — was considered and rejected outright: it tells a coach in
their first month that they have failed at something they have not had the chance to
start, which is the one reading this number must never produce. The depth a line
actually reaches is reported **separately and prominently**, and framed as what
happens next ("Level 2 appears when somebody at level 1 brings in their own first
person"), never as a level they are missing.

## N28 — What makes 70 mean the same for a line of 6 and a line of 600 — and the limit

Four things, in order of how much work they do:

1. **Every input is a rate, never a count.** A line of 600 has more active loggers
   than a line of 6 by construction, so a count-based score is a size ranking wearing
   another name.
2. **The divisor is the depths that exist, not the people.** `Σd` is 1, 3 or 6. Line
   size never enters the arithmetic, so one enormous level 1 cannot drown out a small
   level 3.
3. **Shrinkage stops one thin level swinging the score — between depths, and only
   between depths.** Each depth is pulled toward the line's **own** pooled rate — not
   toward an imagined healthy average — so a quiet line is never flattered.
   ~~Without it a level of one person scores exactly 0 or exactly 100, so a small
   line's score is assembled from extremes and "70" is a number only a big line could
   ever land on.~~ **That sentence was wrong; see N37.** The prior is estimated from
   the same data, so on a line with only ONE populated depth the shrinkage cancels
   exactly and the score is the raw rate.
4. **The exact invariant.** If every depth has the same rate `r`, then `m = r` and
   every `â_d = r` identically, so **the score is exactly `100r`, at any line size and
   any number of depths.** A uniformly half-active line scores 50 whether it holds 6
   people or 600. That is the guarantee, and it is tested at both sizes.

**The limit, stated rather than hidden.** When depths *differ*, two lines with the
same per-depth rates do **not** score identically at different sizes — they converge
as the line grows. Rates of (100%, 0%) score 39 over four people per level and 33 over
four hundred, approaching the unshrunk 33.3. That is deliberate: promising exact
equality would mean trusting one person out of one as much as four hundred out of four
hundred. The small line's number sits closer to its own overall activity because that
is what the evidence supports.

What that does **not** buy — the two are easy to confuse, and N26–N28 originally
conflated them: it damps a thin level against the *other levels of the same line*. It
does nothing at all to the overall level of a line that has only one depth, so a
single coach who logged once still hands their upline a 100. See N37.

Consequence worth knowing: **one quiet person on a thin deep level cannot crater a
score.** A line at 10/10, 4/4 and 0/1 scores 80, where the unshrunk formula gives 50.

## N29 — Three levels, not the whole ancestry

`uplinePath` carries every ancestor, so measuring ten levels down would cost nothing
extra. We read **the first three entries only**, and the slice is where that decision
physically lives (`line.ts`).

- v1 §11 caps the team tree at three levels, so level 4 is people the coach cannot
  look up on any screen in this app. A number that moves because of people a coach
  cannot see is a number they cannot act on.
- The question is literally "is it three levels deep".
- Nobody is discarded: a person at level 4 is counted at levels 1, 2 and 3 of the
  coaches above them. **Every line is measured once, by the coach who owns it.**

## N30 — A week in the line before you are counted, and a bar pro-rated to your time here

**Nobody is counted until they have been in the line 7 days.** Judging somebody on
their third day measures our onboarding, not their duplication. The larger reason is
structural: without this rule every new joiner arrives as an inactive body in a
denominator and lowers their upline's score, so **growth would depress the number that
exists to reward it** and the screen would be actively harmful to open after a good
week. Waiting people are reported in the breakdown ("2 more people here joined in the
last week — not counted yet"), never silently dropped, or the level would look smaller
than the team actually is.

**The active bar is pro-rated by presence**, floored at one day: 4 days in a full
28-day window, 1 day for somebody who joined eight days ago. A flat bar asks the
newest people in a line for twice the rate it asks of the oldest.

Fairness runs both ways — a brand-new coach who is *already* logging is still not
counted early. The rule is about how much evidence exists, not about generosity.

## N31 — Null is not zero, and the three empty states are three different sentences

`score` is `number | null`, and null is **never** rendered as 0. A zero is a verdict on
a line ("nobody below you logged"), which is a real and useful thing to say — and
saying it to somebody who has no line, or whose line all joined on Tuesday, is a lie
that reads as failure.

Three states, worded as the three different things they are:

| State | What the coach is told |
|---|---|
| No line at all (`noLine`) | Their line has not started; share the invite link, the first level appears when somebody joins and logs. |
| Everyone joined this week (`allTooNew`) | Nobody is judged in their first 7 days; this fills in on its own. The levels still render, showing who is waiting. |
| No reading computed yet | Worked out on a schedule, not on open, because counting a whole line per page load would make the app slow on the phones it has to run on. |

The unit tests assert none of the copy contains failure vocabulary.

## N32 — One document per coach, written on a schedule, and no trend

`duplicationScores/dup_<uid>`. Deterministic (D35, N7): a rerun must overwrite the
reading it wrote this morning, not leave a second copy beside it — two readings for one
coach shows up only as a number flickering between two values. The uid is used raw
because Auth already guarantees a safe id, unlike the free-text scope keys N7 had to
hash.

A coach with **no** line has their reading **deleted**, not skipped — N6a's correction
in a second place, for the same reason. The usual cause of an emptied line is a
downline being reparented, and skipping would leave the coach they left reading a
breakdown of a team that is no longer theirs for as long as nobody looked. One write
per lineless coach per run is the accepted cost; if it ever needs cutting, cut it by
reading which readings exist, never by returning to a silent skip.

**No trend is stored, deliberately.** A 28-day window rolls one day at a time, so a
day-on-day delta is mostly noise; a meaningful "up 12 since last month" needs a stored
series and a sampling interval chosen on purpose, and inventing one to put an arrow on
the card is decoration without behaviour (G6). It is the obvious next thing to build —
a second `kind` of document in this collection holding monthly samples.

Nothing written by this job identifies a person. Levels are counts, and a count is the
shape P1 lets flow up a line at all.

## N33 — Readable by its subject, and the upline grant that was deliberately withheld

Security Rules: `allow read: if signedIn() && resource.data.userId == uid()`, and
`allow write: if false`.

An **upline cannot** read a downline's reading. That is a narrowing, not an oversight,
and it is worth the paragraph. Activity counts genuinely do flow upward under P1, and
a coaching screen showing an upline how their downlines' lines are duplicating would
be legitimate. But it does not exist, and a grant written for a screen nobody has
designed is a grant nobody has thought about. Two things follow the moment it is
written: the ancestry test has to resolve **live** against the subject's current user
document (**D64** — every reading here carries counts frozen at whenever the job last
ran, and a reader moved to another line must lose access on their next read), and it
costs a `get()` on somebody else's user document per request. When that screen is
built it is server-rendered like the team tree, with the Admin SDK reading, and this
rule stays as it is (D48's discipline).

The rules test plants `uplinePath` and `sharedWith` arrays naming the reader **on a
reading document** and confirms the reader is still refused. That makes D64 a property
of the database here: no field a future session adds to these documents can quietly
become the thing that grants access to them.

The collection is not enumerable — an unfiltered list is denied, a list filtered to
your own uid is allowed.

Writes are shut to everybody, including the coach a reading is about. It is the one
figure in these modules that a person has both an obvious motive and, without that
line, the means to fabricate; and a reading somebody dislikes must not be deletable by
them either.

## N34 — No ring, no celebration, one accent

The obvious move was to reuse `TargetRing`, and it would have been wrong. That ring
lights the **remaining** arc on purpose (v2 §4, Zeigarnik) because a target is a thing
a coach is chasing to 100. A duplication score is a **reading**, not a goal: a coach
whose single level is fully active is honestly at 100, while a coach at 60 across three
levels may have the better team. A permanent unfilled arc would tell everybody, every
month, that they are short of something.

So the number is a number, the gold goes on the level bars where the action is, and the
screen keeps to one accent (G3). No green gem on a fully-active level either — `.gem`
is for money, gains and completed conditions, and a level at 100% this fortnight is a
reading that will differ next fortnight, not something anybody completed.

No celebration: crossing a band would need a stored previous reading, and none is
stored (N32). A celebration fired on every page load is decoration without behaviour
(G6). The only motion is a count-up under 400ms that collapses to an instant number
under `prefers-reduced-motion` (G5). Nothing on the screen is operable, which is how it
passes the 30-second rule (S1) — there is nothing to operate.

## N35 — The scheduled function exists but is NOT deployed

`functions/src/duplication.ts` holds `rebuildDuplicationScores`, a thin caller of
`/api/duplication/rebuild` — `morningReminder`'s shape, and N10's and N23's for the
same reason: the aggregation keeps one home in the app, runnable by hand against the
emulator, and `functions/` is a separate build that cannot import from `src/`.

A Cloud Function is deployed only if it is exported from `functions/src/index.ts`,
which this branch may not edit. **One line turns it on:**

```ts
export { rebuildDuplicationScores } from "./duplication";
```

Until then a reading is produced only when something POSTs the route with
`CRON_SECRET`, and the screen says plainly that nothing has been counted yet rather
than showing a zero.

**Daily at 04:00 Asia/Kolkata**, not every three hours like the boards. A 28-day window
rolling one day at a time cannot move enough between breakfast and lunch to justify
eight whole-organisation reads a day, and 04:00 is after the last evening logs are in
and before anybody opens the app.

## N36 — No composite index, and two collection reads per run

The job runs one range query on a single field (`dailyLogs.dayKey`) and one unfiltered
`users` read, so `firestore.indexes.json` needed no entry — the same outcome as N9. The
whole organisation is shaped into every coach's line in **one pass** over the users,
because `uplinePath` is ordered nearest-ancestor-first: no tree walk, no query per
node, and the cost does not grow with how deep the tree is.

## N37 — Shrinkage toward a self-estimated prior is a no-op on a one-level line (audit)

Found auditing N26–N28, which claimed the opposite twice.

Because the prior `m` is estimated from the same data as the observation, a line with
only **one** populated depth cancels exactly, for every `α`, `n` and `k`:

```
m  = k₁/n₁
â₁ = (k₁ + α·k₁/n₁)/(n₁ + α) = k₁(n₁ + α) / (n₁(n₁ + α)) = k₁/n₁
```

The score of a one-level line is therefore its **raw** rate. Consequences:

- A coach with a single downline can only ever score **0 or 100** — there is no middle
  of the scale for them, which is precisely what N28 point 3 claimed shrinkage bought.
- A downline in the line the minimum seven days who logged **one single day** clears
  the pro-rated bar and hands their upline **100**, with the reading "The work is
  happening right through your line." N28's own warning names this as the failure it
  was avoiding. It does not avoid it.
- Most coaches in a pilot club are one level deep, so this is the common case.

**Left as it is, deliberately.** Shrinking toward a fixed constant or toward the whole
organisation's rate would fix it and would destroy the exact size-invariance of N28
point 4, which the entire scale rests on, and would judge a small line against other
people's numbers. Between depths the shrinkage does real work and is worth keeping
(10/10, 4/4, 0/1 → 80 rather than 50).

Fixed in the **words**, not the formula: the false claims in `score.ts` and in N28 are
corrected, the identity is pinned by an exhaustive unit test over seven line sizes so a
future change to `α` or to the prior fails loudly, and the card already states how many
people a reading covers — a 100 over one person is visibly a 100 over one person.

**Still open for the owner:** whether `readingOf`'s top band should say "The work is
happening right through your line" about a line of one. That is a product call, not an
audit one, so it is reported rather than changed.

## N38 — The "nobody logged" headline is a fact about the levels, not a rounded zero (audit)

`readingOf` chose its `none` band on `score <= 0`. The score is rounded to a whole
number, so it reaches 0 whenever the shrunk depth-weighted mean lands under 0.5 — which
a large, nearly-dormant line does **with people still logging**. One active person in a
line of 300 scores 0, and the screen printed:

> **Nobody in your line logged their work in this window.**
> Level 1 — your direct line ······ 1 of 300 people logged.
> Where to look: Level 1 is the thinnest — 299 people there have not logged.

Three sentences, on one card, disagreeing with each other, the loudest of them simply
untrue about somebody's team. Reachable at any overall active share below 0.5%.

`readingOf(score, anyActive)` now takes the fact. `anyoneActive(levels)` reads it off
the same `levels` array the bars are rendered from, so the headline and the breakdown
underneath it answer from one source and cannot contradict each other — deliberately
**not** off `deepestActiveLevel`, because a reading written by an older run may not
carry that field and a missing field must not be able to call a working line dead. A
rounded-down 0 with somebody still working now reads `topHeavy` — "A few people in your
line are working. Most are not." — which is exactly what 1-of-300 is.

The second argument defaults to `score > 0`, which is safe: nobody active always scores
exactly 0 (every shrunk rate is `(0 + α·0)/(n+α)`), so the default can only ever agree
with the fact. Tested both ways.

## N39 — The bars cannot be reconciled with the number, so the card says why (audit)

`LevelBars` renders `rate` (the plain share); the score is built from `weighted` (the
shrunk share). Both come from one `scoreLine` call in one document, so they can never
disagree about *data* — but they disagree *numerically*, and the card invited the
arithmetic by saying "Deeper levels count for more":

| line | bars | that arithmetic gives | the card shows |
|---|---|---|---|
| L1 1/1, L2 2/10 | 100% & 20% | 47 | **31** |
| the same shape ×100 | 100% & 20% | 47 | **46** |

Sixteen points apart on the small line, with nothing on the screen accounting for it.
An unexplained gap between the number and the picture directly beneath it is how a
coach decides the screen is wrong and stops opening it. `WHY_THE_BARS_DIFFER` now sits
under the bars and says it in the terms a coach already has, and is covered by the L4
copy test like every other sentence in the module.

Also noted, not changed: `deepestActiveLevel` is computed, stored and typed all the way
through to `DuplicationView`, and no screen renders it.

---

# Session 4 — voice-note log, call list, silence alert

## N40 — A voice note is a CAPTURE, not a log, and the screen says so before you speak

The brief asks for a ten-second recording instead of six tapped fields, and then asks
the right question about it: what happens to a note that is never transcribed.

The answer had to start from what the daily log is FOR. F6's five counts are what rolls
up to an upline, drives the streak, ranks the boards and feeds the duplication score.
Audio is none of those. So a design where speaking is logging has a silent failure built
into it: a coach records for ten days, believes they have logged, and their upline sees
ten days of silence — while the silence alert built in this same session accuses them of
having gone quiet.

**So the recorder always ends on a confirm step, and `NOT_A_LOG_YET` is shown before the
first tap, not after the recording.** Speech recognition pre-fills the five steppers, the
coach glances and taps once. The confirm step is not friction that survived a review; it
is what makes the 30-second rule true rather than nominally true, because the interaction
is a glance and one tap rather than five.

Six ways this can fail — no microphone, permission refused, no speech recognition on this
phone, a recogniser that heard nothing, one that heard words but no numbers, and a failed
upload — all land on that same confirm screen with steppers the coach can tap. The one
outcome the component cannot produce is a coach who thinks they logged and did not.

## N41 — The numbers go through `PUT /api/logs`, the writer that already exists

This module never writes a `dailyLogs` document. It cannot — that collection belongs to
the other branch — but it would not have anyway. Two doors, one pipe is the rule this
codebase was rebuilt around, and a second writer would validate slightly differently,
stamp `uplinePath` slightly differently, and drift.

The e2e test asserts the consequence directly: after saving from the voice screen it
reads `dailyLogs/{uid}__{today}` out of Firestore and checks the number is there. Without
that assertion every visible thing on the screen could pass while the team saw nothing.

## N42 — What happens to a note that is never counted, decided rather than defaulted

Three states, and all three are stated on the screen:

- **Counted.** The numbers are in the daily log, the transcript became the log's one-line
  note, and the audio is **deleted immediately**. Its job is done, and audio of somebody's
  working day kept for no stated purpose is exactly the thing v2 §5.3 already decided
  about prospect health data.
- **Uncounted.** It counts for nothing — not the streak, not the team's view — and is
  **deleted whole after 30 days**. Not half-deleted: an uncounted note's transcript is a
  record of the same day by another name.
- **Recorded today but never confirmed.** The page says so at the top, in as many words:
  nothing has gone to your team and your streak has not moved. This is the case the whole
  design exists for — the coach spoke, the signal died — and saying it out loud is what
  stops "I logged it" and "your team saw nothing" from both being true.

The uncounted TTL is a config constant and the purge is a scheduled function, landing in
the same change as the recorder: a retention rule that arrives after the data does has
already been broken once.

## N43 — The audio is NOT in Firebase Storage, and no Storage rule was appended

The session brief says to store the audio in Firebase Storage and that `storage.rules`
already has per-user paths. Neither is true of this repository.

`storage.rules` is a deliberate **deny-all**. There is no `storageBucket` in
`src/lib/firebase.ts`, no bucket on the Admin app, no `firebase/storage` import anywhere
in `src`, and the emulator set does not start Storage. The header of `storage.rules`
explains at length why it was reverted to deny-all and states that the bucket, the
uploader and the rules must land in ONE change — a permissive placeholder is the kind of
thing that survives to production.

Wiring it needs edits to `src/lib/firebase.ts` and `firebase.json`, and this branch may
not touch either. **So nothing was appended to `storage.rules`** — appending a grant for
an uploader that cannot exist is precisely what that header warns against.

The audio rides on the note document as base64 instead, which is the precedent already
set for proof media (D3, D33). Bounded hard: 15 seconds, 24 kbps Opus, a 200 KB raw
ceiling that becomes ~273 KB encoded — a quarter of Firestore's 1 MiB document limit, so
a long note lands with room rather than failing at save time. Both caps are enforced
client-side AND in the route, because a client-side cap is a courtesy and a server-side
cap is the limit.

When Storage is wired, `saveNote` is the only function that changes.

## N44 — The parser refuses rather than guesses

A parser that guesses is worse than no parser. These counts reach an upline's screen, and
a fabricated "3 sessions" is a number the coach will not recognise and cannot trace —
after which they believe no number in the app.

- Only digits and explicit English number words. **"a couple" and "a few" are ignored** —
  guesses wearing a number's clothes.
- **Four-digit runs are discarded, not clamped.** Recognisers render years and phone
  numbers as digit runs, and clamping 2026 to 999 is a fabricated number with a straight
  face. Dropping it leaves a blank the coach can see.
- A number cannot be spent on two fields; the second keyword finds its own or goes
  uncounted.
- A keyword with no number is reported as **mentioned-without-number**, so the screen can
  say "I heard you mention shakes but not a number" instead of showing a silent zero.
- **The last mention of a field wins.** In ten seconds of speech a repeat is a repair, not
  arithmetic: "five — sorry, six" must be six, never eleven.

English number words only. This audience thinks in Kannada, Hindi and Marathi and v1 §8
parks localisation in Phase 2, so the honest position is that the parser understands one
language, the screen claims no more, and anything it cannot parse falls through to
tap-in steppers with the audio kept. Half-verified Hindi digits would produce confident
wrong numbers, which is the one outcome the rule above forbids.

## N45 — A voice note is the most restricted document in these modules

`voiceLogs` is readable by its author and by nobody else — not an upline at any depth,
**and not an upline whose downline has `shareProspects` ON.** That is a deliberate
narrowing beyond P1, and the rules test asserts it against a fixture where the toggle is
on.

Every other collection here holds counts. This one holds unstructured speech. A coach
dictating on a road says whatever is in their head — "met Ramesh on the walk, he's coming
Tuesday, his number is…" — and no product decision can stop that. The privacy toggle was
presented to a coach as sharing their prospect RECORDS; nobody offered them a switch that
shares the raw material those records were extracted from. So the raw material is
protected harder than the structured data the toggle governs.

Writes are denied to every client, and `status` is the reason it matters most: that field
is the server's statement that a `dailyLogs` document exists, and the purge job reads it
to decide what to delete. A client that could set it could keep recordings past their
retention or drop somebody else's audio.

## N46 — The call list derives on read and writes nothing

"Who to call today" reads `prospects` filtered to one coach and writes nothing anywhere —
no cached score, no `lastRankedAt`, no touch. That is what lets the ranking be a pure
function with unit tests rather than a pipeline with state to get out of step.

P1 is structural rather than remembered: no function in the module accepts a coach id
other than the session's, so an upline cannot ask this question about a downline at all.

The whole set is read rather than a narrowed query, because the three bands — overdue,
due today, and no date at all — cannot be one Firestore query: null sorts before every
timestamp, so an inequality catching the overdue also catches everyone with no date (the
trap `followup-queries.ts` documents). One coach's prospects is a personal address book,
not an organisation-wide read.

## N47 — Three ordering properties, each one a way the list could look right and be wrong

- **A missed promise outranks everything.** The person already let down must not be let
  down twice. Stage weights break ties WITHIN a band and can never lift a cold contact
  above a promise, or the top of the list stops meaning anything.
- **Lateness escalates but CAPS at 30 days.** Uncapped, two forgotten names pin themselves
  to the top forever and the list never moves — which is how a coach learns to ignore it.
- **Nobody from the future.** A follow-up set for next Tuesday is not today's work; a list
  that includes it is the pipeline with a different heading. The timezone test covers the
  case that has bitten this codebase before: 9am IST tomorrow is an instant a UTC
  comparison reads as already past this evening (E1).

There is no "last contacted" field in the data model and this module does not invent one,
so the silence signal says what it actually knows: days since the coach saved them.

The cap of 12 is stated on the screen — a list you cannot finish is a list you do not
start, and a cap that hides itself is a list that lies about being complete.

**The reason on each row and its position come from one calculation.** A row reading
"3 days late" while sorted as though it were two makes the whole screen untrustworthy,
and nothing else on it could recover that.

## N48 — The silence alert is written to survive being wrong

Assume it misfires. The coach was on honeymoon, in hospital, or had their phone stolen —
all three look identical to "nobody logged". The upline reads it and rings them anyway.
Everything in `copy.ts` exists so that conversation starts well, and four restraints are
implemented rather than intended:

1. **The copy states a fact about the app's own records and the limit of what it knows.**
   No fault language, no imperative, no exclamation marks, no income framing. A test greps
   every generated body for all four, because the growth-minded rewrite of this
   notification is one sentence away and would read as a summons.
2. **A leg too young to have been quiet is not assessable.** A team that has existed four
   days cannot have been silent for seven, and the newest relationship an upline has is
   the one a misfire damages most.
3. **One alert per episode, then a fortnight of silence.** Even a wrong alert is a single
   remark rather than a drumbeat — and the drumbeat is what gets Growline muted, which
   costs the follow-up reminder too, since a coach cannot mute one and keep the other.
4. **Only the DIRECT upline hears it.** A quiet fortnight becoming a grandparent-upline's
   business is how an alert turns into a report card, and the person who should ring them
   is the person who knows them.

"A call, not a chase" is the clause the feature turns on. Without it this is a
productivity dashboard telling a manager who is behind — a different product for a
different relationship.

## N49 — Episode identity, and why a dormant leg is mentioned once

The stored row keeps `quietSinceKey` — the first day of the silence — rather than only the
alert date. Comparing episodes is what lets a leg that logged, stopped, and stayed stopped
be raised immediately while a continuing silence waits out the cooldown. Comparing dates
alone could not tell those apart.

A **dormant** leg — nothing in the whole 60-day lookback — is told once and then left
alone entirely, cooldown or not, until it comes back to life. A team quiet for months does
not become news again every fortnight. Its state is visible on the team tree whenever the
upline chooses to look, which is where the notification sends them.

Dormant is also kept separate from quiet in the COPY: a precise day count is useful at
nine days and false precision at four months, so past the lookback the number is dropped
rather than stretched.

## N50 — At most two legs per upline per morning, shortest silence first

An upline with twelve direct downlines and six quiet legs would get six notifications in
one morning. Two names is somebody to ring; six is a report delivered as six buzzes, and
the whole channel gets muted.

The two chosen are quiet for the SHORTEST time, which is the opposite of what a dashboard
would rank. Eight days is a conversation that can still be picked up; fifty is a different
problem a call this morning will not solve. The rest are not recorded as alerted, so they
surface on later runs — a natural drip rather than a swallowed backlog.

## N51 — Two queries for the whole organisation, and ancestry rebuilt live (D64)

The naive shape — per upline, per leg, query that leg's logs — grows with the square of
the organisation, which is the shape the team tree was rewritten to avoid (D36). Instead:
all users once, all logs in the lookback once, and every subtree assembled in a single
pass by pushing each person into each of their ancestors' buckets.

Legs are rebuilt from the CURRENT user documents on every run. Nothing is trusted off the
stored alert row except what was already said and when, so a coach moved to another line
leaves their old upline's legs on the next run with nothing to migrate — D64 as a property
of the job, matching how the rules treat every other collection here.

## N52 — `silenceAlerts` is readable by nobody, including the upline it was written for

Root received the notification about Asha's leg; the record of it is not his to query.

The plain reason is that nothing in the browser reads it — the notification opens the team
tree, which is server-rendered (D48's discipline). The stronger reason is that this is the
one artifact in these modules whose subject is not its reader: a durable, queryable log of
when the app reported a named coach as quiet. Asha discovering she can read it is the
exact failure the copy was written to avoid, made inspectable. Deletes are denied too —
deleting the row would reset the cooldown, which is a way to make the app mention a
downline every single morning.

## N53 — Two more collections than these branches were scoped to

The branch brief named four new collections, all from sessions 1–3. Session 4 needs two
more and both are load-bearing:

- **`voiceLogs`** — the session brief asks for it in as many words, because the daily log
  collection may not be written to from here.
- **`silenceAlerts`** — a scheduled alert with no memory of what it has already said sends
  the same notification every morning, which is the failure the whole module is designed
  around. The memory is not optional.

Recorded here rather than assumed, because a fifth and sixth collection appearing without
a reason is how a schema stops being a schema.

## N54 — Neither scheduled function is deployed

`functions/src/silence.ts` and `functions/src/voice-logs.ts` exist and are NOT deployed: a
function ships only if it is exported from `functions/src/index.ts`, and this branch may
not edit that file. Each header names the one line that turns it on.

**The purge is the one that matters.** A leaderboard that stops rebuilding shows a stale
date and says so on screen. A retention rule that never runs is invisible: the app tells
every coach their recording is deleted after thirty days, and nothing deletes it. Whoever
wires the first of these should wire that one.

---

# Final audit

## N55 — A note could be filed under a day the purge can never reach (audit fix)

N54 says a retention rule that never runs is invisible. This is the same failure one
layer down: the rule runs, and a note can be placed where it will never look.

`saveNote` validated `dayKey` against `^\d{4}-\d{2}-\d{2}$` and nothing else. Two things
that admits, and the second is the bug:

- **"2026-99-99"** — shaped like a day, not a day. No screen can ever show it either,
  because `getNoteSummary` only ever asks for today's key.
- **Any day in the FUTURE.** `purgeExpiredNotes` selects `dayKey < today −
  UNCOUNTED_TTL_DAYS`, compared as STRINGS (D26). Every past key eventually falls behind
  that cutoff. **No future key ever does.**

So `POST /api/voice-logs` with `dayKey: "2099-01-01"` stored a recording that nothing in
this system will ever delete, under a screen that tells its owner an uncounted note is
deleted after thirty days. Reproduced against the emulator: saved, then a purge run dated
400 days out removed nothing and left the document in place.

Not a disclosure — `voiceLogs` is readable only by its author (N45), so a coach can only
do this to themselves. It is a **stated retention control that silently does not hold**,
which is the class v2 §5.3 exists for and the one N42 committed this module to.

**Fixed** with `isSavableDayKey(key, todayKey)` in `model.ts`, which the writer calls:
calendar-shaped, not in the future, and not already past its own deletion date. Yesterday
stays inside the window deliberately — a coach who stops speaking at 23:59:58 holds the
page's day key while the save lands on the next one, and that note is real.

Nothing legitimate was ever refused by this: `/voice-log` computes the day on the SERVER
and hands it to the recorder, which sends it straight back, so the only value an honest
client supplies is today's. The check exists because the body is a body — the same
argument this module already makes about the audio size, applied to the one field that
had been left out of it.

**Why nothing caught it.** Every other value in that route is bounded (audio bytes, mime
type, duration, transcript length, the `heard` array is filtered against `LOG_FIELDS`).
`dayKey` was the only one checked for shape alone, and it is the only one that feeds a
QUERY rather than a document field. The e2e drives the honest client, which cannot
produce the value. `saveNote` imports firebase-admin so no unit test can reach it — the
N13a split again — so the decision was extracted into the pure half, where
`tests/voice-log.test.ts` now pins it, including a sweep asserting the accepted window is
exactly the window the purge can still reach. A change to either end that breaks that
pairing fails there rather than in production.

## N56 — What the audit verified, and the two things it did not

Recorded because "the suite is green" and "the feature works" are different claims, and
the gap between them is where the next session will look.

**Verified end to end, against the emulator, beyond what the committed suite reaches.**
The suite covers the empty and small-org states — which is the right thing for it to
cover, since that is what a pilot club sees on day one — but every aggregation job was
therefore only exercised through its pure helpers. Each was run against real Firestore:

- **Boards on a real field of 14.** All four scopes publish; podium is exactly 3; the
  last-placed coach is shown ranks `1,2,3,10,11,12,13,14` — the **break** N2a's floor
  exists to guarantee, on every scope and both windows. Gap exact, window strictly ahead
  only, no participant count on any client-readable document. Volume publishes monthly
  only. Different boards have different winners, which is the whole point of four.
- **Volume's validation split.** Six coaches with an approved proof rank on 1000; six
  with none rank at 0 carrying 1000 unchecked; and a target whose approved proof is
  superseded by a newer pending one goes back to the unchecked column. An unchecked claim
  never lifts anyone above a checked figure.
- **All five criterion types**, including the two the e2e never reaches: `volume`
  (baseline captured at entry, never moves, only points earned SINCE entry count) and
  `newCoaches`. Qualifying latches while the per-criterion rows keep telling the truth;
  a coach reparented out of the line has their row deleted.
- **The three seats in a browser** — participant sees the badge and NAMES of qualifiers
  plus a COUNT of who is one step away; creator sees the per-criterion drop-off and the
  one-step coach BY NAME; a peer in a sibling branch sees neither. N16's asymmetry is a
  property of what is served, not of what is rendered.
- **Silence**: active leg silent, 20-day leg quiet, 100-day leg dormant, 2-day-old leg
  not assessable, at most two per upline per morning shortest-first, cooldown holds on a
  second run, dry run writes nothing.
- **Voice**: the 40-day uncounted note purges, today's survives, counting deletes the
  audio, a counted note is never purged.
- **Duplication**: rolling 28-day window, per-depth levels, a lineless coach's reading
  deleted rather than zeroed, a rerun overwrites rather than duplicating.

**Not verified, and honestly cannot be from here:**

1. **Nothing is on a schedule.** Six `onSchedule` functions exist across five files and
   none is exported from `functions/src/index.ts`, which this branch may not edit
   (N10, N23, N35, N54). Every job above was proven correct by being CALLED. In a
   deployed system nothing calls them. `CRON_SECRET` is also unset in `.env`, so even a
   manual POST is refused — which is what the e2e asserts. Until those exports land,
   "server-side snapshots on a schedule" is built and runnable, not running.
2. **The indexes are declared, not proven.** Two composite indexes were added —
   `qualificationProgress(qualificationId, kind)` and `voiceLogs(status, dayKey)` — and
   every other new query is single-field or a document-id read. That was checked by
   reading every `.where()` in the new code, because **the emulator creates composite
   indexes on demand and a green local run carries no information here** (D42). First
   deploy must still run the two paths once against a real project.

**One narrow race, reported and NOT fixed.** `evaluateQualification` writes each progress
row with a full `set()`, carrying `remindersSent` forward from the row it read at the top
of the call. `sendDueReminders` appends to that same field with `arrayUnion`. A reminder
landing between the evaluator's read and its commit is therefore overwritten, and the
band comes due again on the next run — one duplicate notification, which is exactly the
drumbeat N24 is written to avoid. The window is small (the evaluator does no I/O between
its read and its commit for an audience under 400) and the reminders job runs daily, so
this is unlikely rather than impossible. It is reported rather than patched because the
complete fix is a decision about **who owns `remindersSent`** — a partial one that used
`arrayUnion` in the evaluator would still clobber a coach's FIRST band, which is the
common case, while reading as though it were solved.


---

## D77

**App Check ships as a client half that does nothing, because the console half would be an
outage if it went first.**

Owner asked (2026-08-20) to "enable App Check and deploy the rules". Neither is possible
from a session with no credentials: App Check is console-only, and `firebase deploy` needs
an authenticated CLI. What *is* code is the client attestation, and it turns out that half
has to land first regardless of who does the other.

Files: `src/lib/app-check.ts`, `src/lib/firebase.ts`, `tests/app-check.test.ts`,
`.env.example`.

### What it defends is the bill, not the data

`firestore.rules` already defends the data. The repository is public and a Firebase web
config ships in every browser bundle by design, so the project id is knowable by anyone
who wants it. With Phone auth enabled that is enough to drive OTP sends at the project,
and SMS to Indian numbers is billed per message. This is the only item on the cutover list
that costs money to skip.

### The ordering, which is the whole decision

Enforcement in the console with no attesting client rejects every Auth and Firestore
request — the app goes down for everyone the moment the toggle flips. So the sequence is:
client ships inert → register reCAPTCHA Enterprise → watch the App Check metrics page show
real traffic attesting → *then* enforce. Written into `HANDOFF.md`, because it is the kind
of ordering that looks like bureaucracy right up until somebody flips it the other way.

### Fails open in three directions

A wrong guard here costs everybody's login, so all three are explicit and tested:

- **Unconfigured** — no site key, nothing happens. Today's state and CI's, which is what
  makes shipping this a no-op until somebody sets a key.
- **Emulators** — skipped whenever an emulator host is set. A real reCAPTCHA key cannot
  attest `127.0.0.1`, and without this the e2e suite would begin failing at login the day
  a developer added a key to their `.env`.
- **Throws** — caught and logged. A bad key must not be a blank login screen.

The decision is a pure function taking its environment as an argument, so the three
branches are unit tests rather than conditions tangled into an initialiser only a browser
can exercise. It attaches in `firebaseApp()`, the single function `firebaseAuth()` and
`firebaseDb()` both pass through.

### The SDK is imported dynamically, and that was measured not assumed

The first version imported `firebase/app-check` statically. Measuring the login page's
initial JavaScript both ways:

| | login initial JS |
|---|---|
| static import | 1220 KB |
| dynamic import | **552 KB** |

668 KB on every page load, for a feature doing nothing. v1 §4.4 names a ₹10K Android on
slow data as the target device; that is seconds of load time bought for zero benefit.

The cost accepted in exchange is that startup becomes asynchronous, leaving a window
before attestation is ready. Nothing in this app makes a Firebase call in that window —
the first is the OTP send, which cannot happen until a coach has typed a number and
pressed a button.

---

## D78

**The privacy notice is published or absent. There is no third state.**

v2 §5.4, DPDP Act 2023 and its 2025 Rules. The longest-standing launch blocker in
`STATUS.md`, and the only one where the blocking part was never code.

Files: `src/modules/privacy/{model.ts,PrivacyLink.tsx}`, `src/app/privacy/page.tsx`,
`src/proxy.ts`, `tests/privacy.test.ts`, `e2e/payments.spec.ts`, `.env.example`.

### Four facts are not derivable from code

The legal entity, a named grievance officer, their email, a postal address. Everything
else in a privacy notice — what is collected, why, who sees it, how long it lives, how to
have it removed — is a fact about this codebase, and is now written.

So the route 404s until all four are configured, exactly as the admin panel and demo mode
do. A notice reading "grievance officer: TBD" is worse than no notice: it is a document
that looks like a legal commitment while failing the single duty it exists to discharge,
and it is the kind of thing that gets screenshotted. All-or-nothing, because three out of
four is still unusable. The email is checked for an `@` — the cheapest possible guard
against a placeholder reaching production.

`PrivacyLink` renders nothing while the notice is unpublished, so no screen offers a
prospect a dead end at the moment they are being asked for their height and weight.

### It had to be added to PUBLIC_PATHS, and that is D68 with a regulator attached

`privacy` is a `RESERVED_SLUG`, so `isPortfolioPath` correctly refuses to treat it as a
coach's page — which means the proxy would have sent it to `/login`. A legal notice that
renders perfectly, passes every unit test, and is unreachable by the prospects it was
written for. Found before shipping this time, and pinned by a signed-out e2e that asserts
the response is 200 or 404 and *never* a 307.

### The numbers are imported, not typed

`180 days` comes from the purge job's own `RETENTION_DAYS`; `90 days` from the report
token's `REPORT_TTL_DAYS`. A notice promising a deletion the code does not perform is a
false statement to a regulator, and nothing else in the suite compares prose to behaviour.
A first draft wrote both as fresh literals under a comment claiming they were stated
once — which would have made the notice a third copy, and the one that goes stale
silently.

`REPORT_TTL_DAYS` is imported by the page rather than re-exported through the privacy
model: `@/lib/report` reaches the Firestore admin client, and routing it through the model
made the publication gate unimportable from anything a client component touches (RULES
E2). The unit suite caught it on the admin boot guard.

### It describes the product that exists

Three things a comfortable notice would omit, and this one states:

- a report link is a **bearer credential** — anyone holding it can open it (RULES P3);
- activity counts flow **upward regardless** of the sharing toggle, which is the part a
  prospect would not expect;
- the app refuses to calculate cholesterol, blood pressure, sugar or disease risk, named
  explicitly, because that is the reassurance somebody handing over a weight actually
  wants (RULES L2).

Tests assert the affirmative disclaimers rather than merely the absence of claims: silence
about "medical advice" is not a denial of it.

### Outstanding

**Kannada and Hindi.** v2 §5.4 requires all three languages and only English exists.
Machine-translating a legal document is not acceptable, and D72 already forbids shipping
unverified translations, so this needs a human. Recorded in `STATUS.md` rather than
quietly treated as done.

---

## D79

**Classic Firebase Hosting cannot serve this app, and the tooling says so numerically.
App Hosting is the only Firebase path.**

`HANDOFF.md` has carried an open question since v2 §3 was adopted: *"confirm whether App
Hosting actually supports Next.js 16.3 — if not, v2 §3 pre-approves the Vercel-front
fallback."* Asked to deploy to Firebase Hosting on 2026-08-20, so it got answered.

Files: `apphosting.yaml`, `firebase.json` (deliberately unchanged).

### Three paths, and two of them are closed

**1. Classic Hosting, serving static files — impossible.** Hosting serves what is on disk.
This app forces a dynamic render on nine pages, runs middleware in `src/proxy.ts`, and
every API route uses the Admin SDK against Firestore. There is no static export of it.

**2. Classic Hosting with the `webframeworks` experiment — refused by the tooling.** This
is the older path that predates App Hosting: `firebase experiments:enable webframeworks`
teaches `firebase deploy --only hosting` to build a Next app and put the SSR half behind
Hosting on Cloud Functions. It is a real product and it does support Next SSR, so it was
worth checking rather than dismissing.

It does not support this Next. From the installed firebase-tools 15.26.0:

```
node_modules/firebase-tools/lib/frameworks/next/index.js
    supportedRange = "12 - 16.0"
```

and this project is on `next@16.3.0`:

```
semver.satisfies("16.3.0", "12 - 16.0")  →  false
```

`12 - 16.0` is a semver range meaning `>=12.0.0 <=16.0.x`. 16.3.0 is outside it, so the
CLI refuses the build rather than producing something subtly broken. Downgrading Next to
16.0 to unlock a worse hosting product is not a trade worth making.

**3. App Hosting — the remaining path, and the one v2 §3 already named.** It differs in
the way that matters here: it does not carry its own pinned adapter version, it runs the
project's own `npm run build` in a container. So the Next version is ours to choose rather
than the CLI's to approve.

### What this means operationally

`firebase deploy --only hosting` is not a command that will ever work on this repository,
and `firebase.json` has no `hosting` block on purpose — adding one configures the wrong
product and produces a confusing failure rather than a clear one.

App Hosting also does not deploy from `firebase deploy` at all. It builds from a git push
against a backend created once, interactively, because it needs a GitHub connection and a
region:

```
firebase apphosting:backends:create --project grow--line
```

### The fallback is still pre-approved, and is now one step closer to needed

v2 §3 pre-approves Vercel front + Firebase backend if App Hosting does not work out, with
the reason recorded here. That has not been exercised: App Hosting is configured
(`apphosting.yaml`) and not yet run. If its build fails on Next 16.3 the way the
webframeworks adapter does, the fallback is the answer and this entry is where the second
half of the reason goes.

---

## D80

**The boot guard accepts Application Default Credentials on Cloud Run, so deploying this
app requires no secret at all.**

`apphosting.yaml` declared fifteen `secret:` entries. A `secret:` in App Hosting is a hard
reference: absent from Secret Manager, the **rollout** fails — not the feature, the whole
release. So the first deploy would have failed on Razorpay keys and a grievance officer's
postal address, decisions nobody has made yet, fifteen times, each retry costing a push.

Fourteen were commented out first, each beside a note saying what stays switched off until
it exists (`CRON_SECRET` missing means leaderboards look *broken*, not empty — worth
knowing before someone debugs it). One was deleted outright: **`SESSION_SECRET`, which
nothing in `src/` has read since Firebase Auth replaced the custom JWT in v2.1a.** It was
marked required, so the very first rollout would have failed over a variable no code uses.
`.env.example` still lists it; that is the next cleanup, not this one.

That left `FIREBASE_SERVICE_ACCOUNT`, required because `src/lib/firebase-admin.ts` refuses
to boot without a credential (D45). This entry removes that one too.

### Why a key file on Cloud Run is worse than no key file

App Hosting deploys onto Cloud Run, which attaches a service account to every revision.
The Admin SDK finds it through Application Default Credentials with no configuration. A
service-account JSON in Secret Manager therefore buys **nothing** and costs a second,
longer-lived credential granting the same access — one more thing to store, rotate, leak
in a log line, and forget about. The idiomatic setup on this platform is no key at all.

### The gate is the entire safety of the change

The guard exists to make a half-configured process fail at boot rather than at the first
query. "No credential, no emulator → try ADC" would defeat it on a laptop, where ADC
either does not exist (boot succeeds, every request fails later — precisely the failure
D45 was written to move forward in time) or *does* exist and points at whichever project
that person last used with `gcloud auth`, which is worse than either.

So the ADC branch is reachable only when **`K_SERVICE`** is set. That is part of the Cloud
Run container runtime contract — the platform sets it on every instance and nothing else
does. Inside Cloud Run neither laptop failure is possible: the attached credential is the
one the deployment was configured with.

Deliberately not probed: `NODE_ENV` (set by `next start` on a laptop), `GCLOUD_PROJECT`
(set by the Firebase CLI), `GOOGLE_APPLICATION_CREDENTIALS` (set by this repo's own
rules-deploy workflow). None of them means "the platform attached a credential to this
process". There is a test asserting each of those does not stand in for `K_SERVICE`.

Precedence: **emulators > explicit credential > ADC**. An explicit
`FIREBASE_SERVICE_ACCOUNT` still wins, because somebody who put one in the environment
meant *that* account, and silently preferring the platform's would point a deployment at a
different project than the operator configured. Emulator hosts beat both, because the SDK
routes to them regardless of which credential resolves — a guard that disagreed with the
thing it guards would be worse than no guard.

### The part that made this testable

`resolveTarget()` read `process.env` at module scope, on purpose (D45), which meant it
could never be unit-tested: a test importing it exercises only the configuration its own
process started with, and the interesting cases are the ones that must **throw**. It moved
to `src/lib/firebase-target.ts` as a pure function of an env object, with no Admin SDK
import — a decision, not a connection.

Three configurations now boot and eight are refused, all of them stated once in
`tests/firebase-target.test.ts`. That file is also the first test this guard has ever had,
including for the state that motivated it: `FIREBASE_AUTH_EMULATOR_HOST` set alone, where
the SDK swaps in the emulator token verifier (`algorithms: ['none']`) so a cookie signed
with nothing, naming any uid, is accepted against a real project.

---

## D81

**`next build` is a fourth legal configuration for the boot guard: no credential, no
emulator, no Cloud Run — and no Firebase.**

App Hosting build 022bb1bb, the first to get past the yaml preparer, failed at
"Collecting page data" with the guard's own message: *FIREBASE_SERVICE_ACCOUNT is not
set, no emulator host is configured, and this process is not running on Cloud Run
(K_SERVICE is unset)*. Next evaluates every route module during the build, which runs
`firebase-admin.ts` at module scope — inside Cloud **Build**, where `K_SERVICE` is a
Cloud **Run** runtime variable that does not exist. The D80 guard, written to protect a
server, was refusing a build.

The failure was invisible in every local check for two reasons, both instructive:

- The local production build passes because `next build` loads `.env` itself, and `.env`
  carries both emulator hosts — the emulator branch boots.
- The scrubbed "App Hosting simulation" run before shipping D80 passed because it set
  `K_SERVICE=growline` — the author's own assumption, baked into the author's own test.
  The one variable that mattered was the one invented. Reproduced honestly (no `.env`, no
  `K_SERVICE`), the local build fails byte-for-byte like the cloud one.

The fix: `resolveTarget` returns the ADC-shaped target when
`NEXT_PHASE === "phase-production-build"`. A build must not talk to Firebase at all —
every page in this app renders dynamically, so nothing queries at build time — which
means demanding a credential from the build protects nothing. `firebase-admin` resolves
ADC lazily at first token use, and a build has no first use.

The runtime guarantee D45/D80 exist for is untouched, structurally: the runtime is a
DIFFERENT process. `next start` never sets `NEXT_PHASE`, so a misconfigured server still
refuses at boot with the full message. `next dev` sets a different phase value and DOES
talk to Firebase, so only the exact string `phase-production-build` unlocks the branch —
pinned by test alongside the decoy list.

Also recorded here so the pattern is legible: this was the second consecutive rollout
failure caused by a file behaving differently under App Hosting than anywhere else. The
first (fah/invalid-apphosting-yaml, nine rollouts) fell to stripping `apphosting.yaml`
to the documented schema surface — `scripts:` block out (the build command moved into
package.json's `build`, which the adapter runs anyway), flow-style arrays out, prose
comments out to `docs/app-hosting.md`. The lesson both times: the deploy platform's
validators and phases are part of the program, and "passes locally" only counts when the
local run reproduces the platform's environment variable-for-variable.

---

## D82

**Email + password sign-in is the interim default because production SMS does not
deliver; phone OTP stays intact one tap away, and the coach's phone number stays
required — as contact data now, not as the credential.**

Production `sendVerificationCode` returns 400 on every attempt. The suspected root
cause is the billing account not being verified / SMS not being provisioned for the
project; the exact response body has not been captured yet, and running that down is a
separate chase. What could not wait for it is that the only door into the app errored
for every real coach. On 2026-08-24 the owner decided email is enough for now.

### Why email + password and not email-link

Firebase's passwordless email-link flow was the other candidate and was rejected: a
sign-in link needs authorized-domain configuration plus working email delivery — more
moving parts, in exactly the layer (provider-side message delivery) that is currently
broken. A password is the one credential with no delivery dependency at sign-in time.

### Additive, not a replacement

The OTP flow is untouched and reachable from the login screen in one tap. Which step a
visitor lands on is a single constant — `INITIAL_STEP` in
`src/app/login/LoginFlow.tsx` — so putting phone back on top when SMS works is a
one-line revert, not a rebuild.

### The trade, recorded openly

An email signup's phone number comes from the profile form and is **unverified**. That
is a real regression against v1 §F1's phone-first intent, accepted knowingly because
the number is load-bearing either way — every report, WhatsApp link and portfolio
prints it, so it stays REQUIRED at signup. Three bounds on the trade:

- The uniqueness guard still applies: `complete-signup` refuses a number that already
  has an account, so an unverified number cannot collide with or quietly claim an
  existing one.
- When a token carries a Firebase-verified number (phone sign-in), that verified
  number still wins unconditionally over anything typed in the form.
- Re-verifying these numbers later needs no schema change: the email address lives
  only in Firebase Auth, the user document is unchanged, and the Security Rules are
  unchanged. There is no new field anywhere to migrate.

### Why the privacy notice moved in the same change

`/privacy` said of the coach's phone number: "it is how you sign in. Verified by SMS."
For an email signup both halves are false — the number is neither the credential nor
verified — and a legal document making a false statement about an unverified field is
not debt to schedule, it is a misrepresentation from the moment the first email
account exists. The item now states what the number is actually for (prospects, the
team, reports, the public page) and which sign-in path verifies it; a new item covers
the email address (sign-in and password reset, nothing else); and the third-party
list says plainly that Google holds the email and password for coaches who sign in
that way.

---

## D83

**The deployment diagnoses itself: `/status` runs the home screen's own queries and
prints each verdict in the browser, so a production failure no longer needs anyone to
read Cloud Run logs.**

Two days of a live 500 on `/` produced the motivating shape: the home screen fires seven
Firestore queries in parallel, any one failing yields a bare digest number, the real
exception sits in Cloud Run's log viewer, and the person who can reproduce the outage —
the owner, on a phone — is not the person who can read that viewer. Every diagnostic
round-trip cost hours. `/status` inverts it: the same query functions the home screen
calls (imported, not copied, so the page cannot drift), run one probe at a time against
an id that matches no document, each verdict printed with its full error text — which
for a Firestore FAILED_PRECONDITION includes the exact create-this-index link.

Three properties are load-bearing, each proven before shipping:

- **Bounded.** Every probe races an 8-second timeout, and the probes run concurrently,
  so the page answers in at most ~8s no matter what. Against a network that black-holed
  Firestore entirely, the first version never responded at all — a status page that
  hangs in sympathy with the outage it exists to explain. Verified after: HTTP 200 in
  8.3s with nine legible FAILs under total backend failure.
- **Public, and tested signed out.** It must work precisely when nobody can log in.
  "status" joined RESERVED_SLUGS (a coach could otherwise claim it and be shadowed) and
  PUBLIC_PATHS (a reserved slug is refused by isPortfolioPath, so without the proxy line
  the page would bounce to /login — D68's exact shape). e2e visits it in a signed-out
  browser and asserts nine PASS verdicts.
- **Incapable of leaking.** The probe id matches nothing, probes return counts and
  booleans, the page takes no input. Error text is shown verbatim because it IS the
  diagnosis; it names collections and the project id, all already public in this repo.

Found while building it, recorded because it cost an hour: **document ids matching
`__.*__` are reserved by Firestore.** Production rejects them with INVALID_ARGUMENT; the
emulator hangs forever instead of answering. The first probe id was `___diagnostic-probe___`
and every doc-get against it timed out. A probe id must be boring.

---

## D84

**The design system was rebuilt three times in one week — Dark Achiever → Voltage →
Sunrise — and the token NAMES were deliberately not renamed with it.**

v2 §4 specified "Dark Achiever": near-black navy `#0B1020`, champagne gold, serif
display face. It shipped. The owner's verdict on the running app was that it read like
"some 1990s banking application", and that no part of the colour or type choice was
liked. A five-way visual comparison was built and shown; **Voltage** (near-black ground,
one electric lime accent, glass panes instead of solid cards) was chosen, then corrected
within the same session to **Sunrise with glassmorphism**, and finally to **Nunito** as
the single type family. That is the whole history: 3.0 Voltage, 3.1 Sunrise, 3.2 Nunito.

What Sunrise 3.2 actually is: warm cream ground `#fff9f2`, burnt terracotta accent
`#c4490a`, glass built from alpha fills, hairline borders, an inner highlight and a
drop shadow — never `backdrop-filter`, which RULES G4 forbids outright as too heavy for
a ₹10K Android. A dark theme still exists (`#17120e`, a warm near-black) and follows the
system preference; light is now the default, which reverses v2 §4. The reason is the
audience and the setting: this app is used outdoors, in Indian daylight, on a cheap
screen at low brightness. A near-black UI in that setting is a mirror.

**Three contrast failures were found by measuring rather than looking**, and all three
had been shipped: `#6f9c00` at 3.27:1, `#e8590c` at 3.58:1, `#8a6f5c` at 4.45:1 — each
one plausible to the eye and each below WCAG AA. They are now `#5a7d00`, `#c4490a` and
`#7a6050`. Eyeballing a palette does not work; the ratios have to be computed.

**The `--gold-*` tokens are a deliberate lie, and this is where it is written down.**
`--gold`, `--gold-hi`, `--gold-lo`, `--on-gold` and `--gold-ink` all alias the terracotta
accent, because roughly two hundred class names across the app say "gold". Every
`bg-gold`, `text-gold-ink` and `metal-gold` in a component renders burnt orange. Renaming
them is a mechanical commit that touches almost every file and would have buried the
design work inside a rename diff; it is worth doing, separately, and has not been done.
Until then: **anyone reading a component in isolation will believe the app is gold.**
`TargetRing`'s `stroke="var(--gold)"` is the line most likely to be "fixed" by mistake.

The corollary that cost a bug: **`STATUS.md`'s design section still describes Dark
Achiever as the shipped state**, and `CLAUDE.md`'s START HERE tells the next developer to
read `STATUS.md` first. Three reskins landed with none of this written here, which is a
straight RULES E6 miss — the reasoning lived only in commit bodies (`b877e88`, `d8d9788`,
`c212ceb`, `fbb0350`, `3a8ceb8`, `5ef1fe2`) where no handoff reads it. D84–D88 exist
because an audit went looking for them and found nothing.

---

## D85

**One imperative `celebrate()` function, hand-rolled, that enforces the motion budget
centrally — and the discovery that the confetti it replaced had never once executed.**

The moments worth celebrating are scattered across screens that share no ancestor: a
target ring, a pipeline control, a log form. Threading a React context through all of
them to draw pixels on top of everything would be architecture in service of confetti.
`src/lib/celebrate.ts` is therefore a plain function callable from anywhere, and it holds
every G5 rule so that no call site has to re-argue them: `pointer-events: none` (a
celebration a coach cannot tap through is a modal, and the 30-second rule does not
survive a 1.4s modal on the save path), a 1400ms cap the loop applies to itself rather
than trusting a caller to stop it, one-tap skip, and silence under
`prefers-reduced-motion`. G1 is the one rule it cannot enforce — a Trust Zone screen
simply must not call it — so that is stated at every call site instead.

Hand-rolled rather than `canvas-confetti` (~5KB gzipped): the mechanism is one canvas,
one rAF loop and some gravity, and 5KB of parser work is a real cost on these phones for
something that runs a handful of times a week. Particle colours are read from the **live
CSS tokens**, not hard-coded, so the next reskin carries the confetti with it — a
previous one left a hard-coded gold glow behind that clashed for a full release.

**The finding that justifies the whole exercise:** `TargetRing`'s celebration was gated
on a `previousPercent` prop that **no caller had ever passed**. The effect returned on its
first line, every time, forever. The confetti was written, reviewed, shipped and had never
run once. It now remembers the last percentage per device in `localStorage` keyed by
month, written **before** the crossing is evaluated so a crash mid-celebration cannot
leave it armed to fire again. Per-device rather than per-account is deliberate: a
celebration is a moment, not a record, and storing it server-side would mean a write on
every view of the screen. The cost is that a coach who crosses 50% on their phone and
later opens a laptop sees it celebrated twice, and one in a private window sees nothing
(a storage failure is treated as "first view this month", which suppresses rather than
duplicates).

This is the **third** instance of the same failure mode in this codebase — a finished
`StreakFlame` no screen rendered, `.neopop`/`.metal-gold` defined and used on two buttons,
and this. It is now a named trap in `HANDOFF-NEXT.md` §4: **before building anything,
grep for it — it may already exist.**

---

## D86

**Delight weeks 1 and 2: what shipped, and the one thing each move is allowed to do.**

RULES G6 governs the whole programme — every mechanic maps to a behaviour we need
repeated, and decoration without behaviour is banned. The moves, and the behaviour each
one is buying:

- **Metal buttons + universal press feedback** → the app answers a tap at all. Every
  button, link, `[role=button]` and `summary` scales to 0.965 over 120ms; `.neopop` opts
  out of the shrink so the two press metaphors never stack. Trust Zones and the public
  self-capture form are deliberately excluded (G1).
- **The streak flame** → daily logging. On the home header and the log screen, dim below
  a streak of 1 rather than absent, so a day-one coach sees the thing they are being
  asked to start. Transform-only keyframe, so it composites on the GPU.
- **Count-up numbers** → the number is the emotional content (v1 §9). Renders AT the true
  value on the server so there is no hydration mismatch, animates from 0 on first load and
  from the OLD value on change, 380ms, instant under reduced motion.
- **Haptics** → confirmation you can feel without looking, which is the whole point on a
  road. Three named patterns; fails silently on every path.
- **The Member moment** → the stage move the business exists for. Member is the only
  stage that celebrates, and it is the one place the reserved green is spent.
- **Milestone events** → streak retention. A milestone renders in the reserved pink and
  carries a WhatsApp share at the emotional peak. Habit only — no earnings, no rank name
  (RULES L4/L8).
- **The capture tick** → "did that save?". A checkmark drawn in one stroke over the whole
  screen, 520ms, `pointer-events: none`. It takes **no network state**, deliberately: it
  means "your phone has this", which is the only honest promise capture can make on a
  weak signal, and it is why it fires on the offline path too. Reduced motion needs no
  code — the global override forces the duration to ~0 and the animation is `forwards`,
  so it lands on a complete still tick. An earlier version read the media query in an
  effect and drew one frame of motion before the state arrived, shown to exactly the
  people who asked not to see it.

**Scarcity is itself the mechanic.** `celebrate()` deliberately has no "small" variant for
routine saves: if an ordinary day fired confetti, day 30 would feel like nothing.

---

## D87

**Today's Mission gets a depleting arc only on the row where a denominator actually
exists, and the follow-up row's missing arc is a data-layer gap, not an oversight.**

The delight plan asked for "each item a depleting arc". Exactly one row can honestly
carry one: the target, whose next mark (25/50/75/100%) is a fixed number of points the
coach is walking towards. It runs to the **mark**, not to the month's target — that is
the distance the row is actually talking about, and a ring that visibly closes this week
beats one that barely moves all month.

The follow-up row does not get one. "3 of 6 done today" needs a count of follow-ups
**completed** today, and nothing records that: completing one simply moves
`nextFollowupAt` forward and it leaves the due set. The available shortcut was to bank
the morning's due-count in `localStorage` and treat it as the denominator — the same
per-device pattern D85 uses for the target crossing. It was rejected. A coach who
reschedules two people would watch the arc jump backwards for reasons the app could not
explain, and a number a coach cannot trust is worse than no picture on the one card
whose entire job is to be believed. The honest version needs a `followupsCompletedAt`
write on stage and date changes, plus a query; that is a data-layer task and is now
written down as one in the component and in `HANDOFF-NEXT.md`.

What the row gets instead is the **overdue split**, which IS known and was never shown:
"6 follow-ups waiting / 2 from earlier days — start there". Silent when nothing is late,
and silent when the caller does not know, rather than claiming zero.

`MiniRing` is a separate component from `TargetRing` rather than a `size` prop on it,
because `TargetRing` carries the celebration — a localStorage read, milestone detection,
the confetti call, a dismiss handler. None of that belongs on a card a coach scrolls
past, and worse, it would **consume the crossing** so the real ring never fires it. Given
D85, that failure does not get to happen twice. `MiniRing` takes `size` and `stroke`
precisely because it is only geometry: resizing it cannot change what it means.

---

## D88

**The launcher identity outlived the design system by two reskins, and the test defended
it.**

`manifest.ts` painted the splash `#0B1020`, `layout.tsx` set the same status-bar colour,
and `icon.svg` filled its rounded rect with it. That is Dark Achiever's ground (D84). So
on Android — the entire target platform — every cold start painted a near-black
rectangle and then loaded a cream app. It survived because **nothing compared the
launcher to the app**, and because `tests/manifest.test.ts` pinned those exact hexes
under the title "splash and status bar use the dark ground, not white". The suite had
been agreeing with the bug through two design systems.

The fix, and the shape of it:

- `background_color` / `theme_color` are the app's real ground. The manifest takes a
  single value and cannot carry a media query, so it takes the default and a
  dark-system coach still gets one wrong frame.
- `viewport.themeColor` DOES take a media query, so the status bar follows the system
  theme with each theme's actual `--bg`. It is the only slot the platform gives us where
  both halves of the audience can be right. It is metadata, not CSS, so it cannot read a
  custom property — the two values must be kept in step with `globals.css` by hand, and a
  test now enforces that.
- The icon is repalette. The relationship worth preserving was never the colours, it was
  the contrast job: a bright mark on a deep ground, so the shape survives at 48px among
  thirty other icons. Sunrise assigns those roles to different hues, so the ground is the
  terracotta core and the mark is the cream. One value could not be carried over
  literally — the gradient's depth stop was a brown gold that still read against
  near-black, and the same move here (`--accent-lo` on `--accent`) is 1.3:1, so the foot
  of the stroke would vanish into the ground. It is now 2.8:1.

**The lesson is about the test, not the colour.** A test that pins a VALUE becomes an
argument for the bug the moment the value moves. It now pins the RELATIONSHIP — the
splash equals `--bg`, read from `globals.css` — which was true all along and would have
caught the drift on the reskin commit that caused it.

---

## D89

**The "flaky" realtime spec was a real window in which a QR capture was silently
dropped — the second time in this codebase that an intermittent test was describing a
bug the product actually had.**

`RealtimeProspects` set `ready` — the `data-live="1"` flag the e2e asserts on — the
moment Firebase Auth resolved, one line *above* the `onSnapshot` subscription and
independent of whether it ever attached. The listener deliberately discards its first
snapshot, because that snapshot carries the rows the server already rendered. Put those
two together:

1. Auth resolves. `data-live="1"`. The screen claims to be listening.
2. A prospect submits the public QR form. The document is written.
3. `onSnapshot` attaches, or its first payload is still in flight.
4. The baseline snapshot arrives **containing that prospect**, is discarded as the
   baseline, and its `added` change is never seen.
5. Nothing further ever arrives. The row sits in Firestore, invisible on screen until
   something unrelated causes a reload.

The window is small and biased towards the worst case: it is widest on a slow phone on a
weak signal, which is exactly where Mode B lives. `e2e/realtime.spec.ts` hit it whenever
the machine was busy — **it passed alone in 3.6s and failed inside the full suite** — and
had been filed as an environment problem twice. `HANDOFF-NEXT.md` and `CLAUDE.md` both
described it as a container intermittency; both were wrong.

The trace is what settled it, per the standing D73 rule. It showed the listener flag set,
the POST accepted, and delivery simply never happening — which ruled out the setup half
of the spec and left only the discard.

Fix: `ready` is set from **inside** the snapshot callback when the baseline lands. So
`data-live="1"` now means what the test always assumed — the listener has delivered its
baseline, and everything after it is genuinely new. `RealtimeThreads` had the identical
defect (a broadcast landing in the gap was discarded the same way) and needed a small
extra step, since it attaches two listeners: `live` waits for every baseline it actually
subscribed, which is two when the coach has an upline and one when they do not.

Verified: three consecutive full e2e suites, 71 passed / 1 skipped / 0 failed, on the
container where the spec had been failing.

**The rule this reinforces, now with two instances behind it:** "passes alone, fails in
the suite" is not a diagnosis. Pull the trace. Both times that phrase was used in this
project it was hiding a capture the product lost for real.
