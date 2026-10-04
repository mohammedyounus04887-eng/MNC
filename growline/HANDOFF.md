# HANDOFF — mobile ↔ PC round-trip test

This file is the baton. Whoever finishes a stretch of work writes the last
entry; whoever picks it up next reads the last entry first.

Branch under test: `claude/mobile-pc-workflow-test-alhnwl`

---

## The round-trip test

Three legs. Each leg is done from a different place. If all three land, the
flow works and we can trust it for real work.

- [x] **Leg 1 — phone → cloud.** Asked from the phone, ran in a Claude Code
      web session, wrote this file, pushed to the branch. (Done, see entry
      below.)
- [x] **Leg 2 — cloud → PC.** Done. Fetched, checked out, installed, and ran the
      whole verification chain on Windows. It did not pass as received — four
      things only a real PC could surface. See "What the PC leg found" below.
- [ ] **Leg 3 — PC → phone.** From the phone, ask this session (or a new one)
      to pull and read the file back. If it can read the line the PC wrote,
      the loop is closed.

---

## Handoff log

Append a row every time you hand the work over. Newest at the bottom.

| # | From | What was done | Where it stopped / what's next |
|---|------|---------------|-------------------------------|
| 1 | Phone → Claude Code web | Pulled the repo, created this file on the test branch, pushed. | Waiting on the PC leg. |
| 2 | Phone → Claude Code web | Landed `BUILD_PROMPT_V2.md`; pointed `CLAUDE.md` and `DECISIONS.md` at it so v2 wins on conflict. No code touched. | v2.1a not started. |
| 3 | Phone → Claude Code web | Wrote `PLAN_V2.1a.md` (read the real code first) and `RULES.md`. Found a sequencing conflict in v2 §11 — see plan §5. Still no code touched. | **Waiting on 3 approvals in `PLAN_V2.1a.md` §9.** Emulator work can start the moment they land. |
| 4 | Phone → Claude Code web | Built the v2.1a foundation: Firebase config, emulator setup, `collections.ts`, migration + seed + verify scripts. 16/16 verification checks pass; `next build` and `tsc --noEmit` clean. | Auth swap and the 18 `lib/db` call sites are next. App still runs on Prisma. |
| 5 | Phone → Claude Code web | Auth swapped onto Firebase: session cookies, phone auth in the browser, signup tokens retired. Deleted `otp.ts`, `referral.ts`, both OTP routes. Build + typecheck clean, 16/16 migration checks. | ~15 data call sites still on Prisma (prospects, logs, targets, team, push, reports). |
| 6 | Phone → Claude Code web | Ported to Firestore: team tree (no `groupBy`), prospects, reports, public routes. Found and fixed an erasure bug — Firestore does not cascade deletes. Build clean, 27/27 checks. | **13 files still on Prisma** — see below. |
| 7 | Phone → Claude Code web | Ported everything left: daily log, follow-ups, targets/proofs, push, remaining routes and pages. **Prisma removed from the app.** 40 assertions pass. | v2.1a code complete. Cutover needs a real Firebase project; login flow unproven in a browser. |
| 8 | Phone → Claude Code web | Playwright e2e in real Chromium: signup with referral, existing-coach login, public capture noindex, **and the offline queue with the signal cut mid-capture**. 4/4 pass. | 6 of 9 parity-gate items closed. Next: v2.1b. |
| 9 | Phone → Claude Code web | v2.1b: real Security Rules + **21 rules checks incl. both mandatory ones**, Cloud Functions (counter, morning reminder, 180-day purge), Storage rules, realtime QR listener. | FCM delivery + deploy need a real project. |
| 10 | Phone → Claude Code web | v2.2a started: Dark Achiever token layer, theme switching (5 tests), NeoPOP/gem/metal components. Recorded D39 — "dark by default" vs "respect the system" genuinely conflict on the web. | Screens not yet reskinned; v1 palette aliases still in place. |
| 11 | Phone → Claude Code web | Target ring (remaining arc) + streak flame wired into targets and log. 4 design-rule tests: arc direction, no-money copy, no backdrop-filter anywhere, theme switch persists. | 14 e2e, 21 rules, 29 data — all green. Home + Today's Mission next. |
| 12 | Phone → Claude Code web | Today's Mission card + home reskin. Recorded **D40** — v2 §4's own example copy carries a "₹-equivalent" that L4/D30 forbid; built with points only. | 15 e2e, 21 rules, 29 data. v2.2b (capture/pipeline/report/team/settings) next. |
| 13 | Phone → Claude Code web | v2.2b: full token sweep (v1 aliases removed), contrast tripwire in both themes, Weekly Recap card. Found and fixed 3 invisible-text bugs the sweep itself introduced. | 18 e2e, 21 rules, 29 data. v2.2 done bar the Jewel assets. |
| 14 | PC (Windows) | Verified the branch end to end on real hardware. Fixed 4 things that only fail off-container: root tsconfig compiled `functions/`, 3 setState-in-effect lint errors, a Linux-only Chromium path in `playwright.config.ts`, and an undocumented `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST`. Now green: 18/18 e2e, 21/21 rules, migrate:verify all-pass, build + typecheck + lint clean. Also ran a 6-lens audit — phases 1-6 parity survived intact, but it found a **critical missing-index problem the emulator structurally cannot catch**. | Leg 3 is open: read this from the phone. Before cutover, work the "Audit findings" list — the index gap and referral-code uniqueness are the two that bite in production. |
| 15 | PC (Windows) | Worked the audit list. Closed 8 of 9 findings and **withdrew one as measured wrong** (the 20-`get()` cap — a query is evaluated once against its constraints, not per document). Found two bugs the audit missed: a redirect loop from the proxy treating cookie presence as authentication, and an unguarded read race in the offline pending list. Also learned the hard way that the e2e suite is not idempotent — a green 18/18 went to 6 failed with no code change because the emulator had accumulated state; `npm run e2e:reset` now exists so that cannot recur. Green: 19/19 e2e, 27/27 rules, migrate:verify all-pass, build + typecheck + lint. D41–D50 record every decision. | **Merge to `master`.** The branch is 42+ commits ahead and `master` is still the initial commit — every phase, the whole migration and the design system live only here. Then v2.3: items 2, 4, 5 and 7 (Mode A consent, the trilingual privacy notice, committed Noto TTFs, and CI — there is no `.github` at all). And the indexes need a real project; nothing local can verify them. |
| 16 | PC (Windows) | **v2.4 Threads** (F8): compose, direct-line vs entire-line scope over `uplinePath`, live seen/ack counters, re-broadcast with attribution. D51 records why a thread is addressed by its sender rather than by a stored recipient list; D57 the body/link validation. | Threads done. No CI existed at all. |
| 17 | PC (Windows) | **CI** (`.github/workflows/ci.yml`) plus a unit-test runner on `node:test` — zero new dependencies (D53). | The runner existed but almost nothing used it. |
| 18 | PC (Windows) | **158 unit tests**, which found four real bugs: the healthy-weight range (D54), a private copy of the day boundary that reintroduced the E1 bug (D55), the streak flame calling an intact streak lost from midnight (D56), and thread validation gaps. **D58 files the Streak Shield as three `todo` tests** — v2 §4 requires it, it does not exist, and a green test asserting today's behaviour would have quietly become the spec. Merged to `master`. | `master` now carries everything through here. |
| 19 | PC (Windows) | **Kannada, Hindi, Tamil and Telugu** (D59) — brought forward from v1 §8 at the owner's explicit ask. Cookie not `localStorage`, because the strings are in server-rendered markup; no `/[locale]` prefix, because F9 puts the portfolio at the root. **The report card stays English** — satori has no Indic shaper. | Translations are a working draft; every one needs a native-speaker review before launch. |
| 20 | PC (Windows) | **Demo mode** (D60) — a real session issued by the server, not a bypass branch inside the session check. Role switching in one tap. | — |
| 21 | PC (Windows) | **v2.3 item 2: Mode A consent** (D61). A timestamp rather than a boolean, stamped server-side, enforced in the API and carried through the offline queue. Null means *not recorded*, and the migration deliberately does not backfill. | D61 flags the itemized privacy notice as **not buildable here** — it needs the grievance officer, the legal entity and a contact address. |
| 22 | PC (Windows) | **F12 admin panel** (D62, D63): env-allowlist gate, six metrics, coaches, tree, subscriptions, broadcast, audit log. | Internal tooling only. |
| 23 | PC (Windows) | Closed the **last open audit finding** (D64) — `dailyLogs` and `targets` no longer authorize off a write-time `uplinePath` snapshot, so access follows re-parenting. Then **"Link my line"** (D65): attach to an upline after signup, both directions, always two-sided, with `verify-reparent.ts` in CI. | The audit list is now fully closed. |
| 24 | PC (Windows) | **v2.3 item 5: the report fonts** (D66). Ten Noto faces committed, loaded per script, cached. This closed a real leak, not just the missing bold: `next/og` was sending the **prospect's name to Google as a query parameter** on every Indic render. Two traps — registering every face under one family name silently discards the Indic ones, and five scripts is not "no fetches" until coverage is read from each `cmap`. 18 tests incl. a control proving the leak was real. **The "and correct" half of v2 §5.5 cannot be met with satori**: it does no complex-script shaping, so Indic names still draw with misplaced matras — equally true before, so this is strictly better, but it needs a different renderer, not a different font. | 208 unit tests (205 pass, 3 `todo`), build + typecheck + lint clean. **Next: the Streak Shield** (D58's three `todo` tests), then v2.5 Portfolio. **Blocked on the owner:** the privacy notice needs three facts — see below. |

---

## Waiting on the owner (nothing here is an engineering problem)

1. **The privacy notice** (v2 §5.4, the last open v2.3 item) needs facts only the owner
   has, and a notice with invented ones is worse than none: the **legal entity name**,
   a **grievance officer** with a contact, and a **postal address**. Human translation
   for the four Indian languages should follow, since this is the one surface where a
   machine draft is not good enough.
2. **The Firebase project** — see "Blocking cutover" below. Still true.
3. **A native-speaker review of the four translations** (D59). They are a working
   draft produced by this build, with a flagged list per language.

---

## What the PC leg found

The branch arrived claiming "build + typecheck clean, 18 e2e, 21 rules". On a Windows
PC, **none of the three suites could run as received.** Every cause was environmental
— which is exactly the class of bug a cloud container cannot see, and the reason
rule 4 puts verification here.

1. **Root `tsconfig.json` compiled `functions/`.** `include: ["**/*.ts"]` swept in the
   Cloud Functions source, whose deps live in `functions/node_modules` and were never
   installed. 4 errors. `functions/` has its own tsconfig and a `predeploy` build, so
   it is now in the root `exclude`.
2. **Three `setState`-in-effect lint errors** in `TargetRing.tsx` (×2) and
   `ThemeToggle.tsx`, from the late v2.2 commits. `ThemeToggle` now reads
   `data-theme` through `useSyncExternalStore` — the attribute is an external store,
   not component state. `TargetRing` defers both to `requestAnimationFrame`.
3. **`playwright.config.ts` hardcoded `/opt/pw-browsers/chromium`** — a Linux path.
   The e2e suite could not start on Windows at all. Now resolved per machine:
   `PW_CHROMIUM_PATH`, else the container binary, else the installed Chrome. Never a
   download.
4. **`NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` was undocumented.** `src/lib/firebase.ts:74`
   needs it for the browser Firestore client, but `.env.example` only had the
   server-side var. Without it the browser silently talks to a **real** project while
   the server talks to the emulator: nothing errors, the realtime row just never
   arrives. That was the `realtime.spec.ts` failure.

`offline-capture.spec.ts` also failed in-suite while passing alone. It was collateral:
the Weekly Recap test's `delete navigator.share` is a no-op (`share` is on
`Navigator.prototype`), so in a real Chrome the app correctly called Web Share and the
stubbed `window.open` never fired. Fixing the stub with `Object.defineProperty` fixed
both tests. **The app was right; the test was wrong.** Headless Chromium has no
`navigator.share`, which is why the container never saw it.

## Audit findings — work these before cutover

Six independent lenses over the port. **The good news first: parity held.** 12 of 13
phase 1-6 guarantees verified intact — wa.me country codes, the disclaimer on all six
surfaces, non-clinical BMI labels, body-fat ranges, plausibility guards, under-18
refusal, ~130-bit tokens with expiry on every surface, neutral OG image, capture
idempotency (moved from a unique constraint to the doc id), canvas re-encode, no
level-name suggestions, direct-only target authorization, the 6-field log.

**All of these are now CLOSED except the last one.** Statuses below; the reasoning for
each lives in `DECISIONS.md` D41–D50, not here.

- ~~CRITICAL — `firestore.indexes.json` is missing composite indexes.~~ **FIXED (D42),
  but NOT verified.** 4 declared → 8. **The emulator creates composite indexes on
  demand, so no suite here can ever confirm them** — a green local run carries zero
  information about this. The four added cover the daily log's read *and* write path,
  My Team + Targets, the QR rate limit, and the 180-day purge, which had been throwing
  silently once a night. **First deploy to a real project must exercise all four paths
  and check the console for index-build errors.** This is still the largest cutover
  risk, now because it is unverifiable rather than because it is unfixed.
- ~~HIGH — `unique(referralCode)` was dropped.~~ **FIXED (D41).** Reservation document
  `referralCodes/{CODE}` claimed inside `createUser`'s transaction; resolved through
  rather than queried; client read and write both denied; migration backfills and
  throws on collision. `reports.token` is left undefended **on purpose** at ~131 bits
  from a CSPRNG — a reservation there would cost a write per report to defend against a
  collision rarer than silent disk corruption.
- ~~HIGH — logout never invalidates the session.~~ **FIXED (D46).** `endSession()`
  revokes on the Auth backend and only then clears the cookie. It signs the coach out
  of **every** device — Firebase has no per-session handle — and the button says so.
  A failed revoke returns 502 and keeps them logged in, so the retry still knows whose
  session to end. Also kills the client SDK's persisted refresh token, which was a
  second key to the same prospect data via `RealtimeProspects`.
- ~~HIGH — the boot guard checks only the Firestore emulator var.~~ **FIXED (D45), and
  it was worse than written.** With only the Auth host set, the SDK swaps in a verifier
  using `algorithms: ['none']` and stops requiring `kid`/RS256 — an **unsigned** cookie
  naming any uid would be accepted against real data. Now two configurations boot and
  four throw at boot naming the offending variable. Verified across all six
  combinations, each in its own process.
- ~~HIGH — Storage rules let any signed-in coach read any other coach's proof media.~~
  **FIXED (D49) by going deny-all.** Nothing uses Storage, and `firebase.json` already
  pointed at the file, so it was one `firebase deploy` from live rather than inert. The
  path design that the real rules will need is written into `storage.rules` itself.
- ~~MEDIUM — an upline reads the downline's whole user document.~~ **FIXED (D48).**
  `users` is now closed to clients entirely, including self-read. Nothing in the
  browser read it; the team tree is server-rendered. The grant included `plan` (so, a
  failed mandate) and `shareProspects` itself — the toggle's value readable by the
  party it protects against.
- ~~MEDIUM — the shared-prospect listing does two `get()` per document.~~
  **WITHDRAWN — measured, not a bug (D48).** A query is evaluated once against its own
  constraints, not once per returned document, and the budget is per request. The rule
  now spends **one** lookup. Emulator-verified: a 60-document shared listing passes,
  while the toggle-off listing is still refused at 60. Do **not** "fix" this by copying
  `shareProspects` onto prospects — `PLAN_V2.1a.md` §4 rejected that for revocation
  latency, and it would push the privacy predicate out of the rules into every call
  site.
- ~~MEDIUM — the F11 toggle's allow-branch is unreachable.~~ **FIXED (D50).** Strict
  boolean on `PATCH /api/me` (no coercion — `Boolean("false")` is `true`) plus
  `settings/PrivacyToggle.tsx`. Note it grants a capability **nothing consumes yet**:
  no upline-facing prospect reader exists.
- **STILL OPEN — MEDIUM — `dailyLogs` and `targets` authorize off a write-time
  `uplinePath` snapshot,** so access does not follow re-parenting. `prospects` resolves
  the coach live; these two do not. Not touched this session.

Two bugs found while closing the above, neither in the original audit:

- **`src/proxy.ts` treated cookie *presence* as being signed in** and bounced `/login`
  to `/`. Once logout actually revoked, that became a three-route redirect loop for
  anyone holding a dead cookie. Fixed (D47) by letting the authenticated layout be the
  only authority — the proxy cannot verify a JWT in the edge runtime, so it must not
  pretend to.
- **The offline queue's pending list had no read-ordering guard** (D43). Three events
  re-read IndexedDB when the signal returns, and a stale read could win, pinning a
  synced prospect to "On this phone" forever beside its real row. Found by
  `offline-capture.spec` failing on a *clean* emulator while passing on a polluted one.

Full detail, including the low-severity items and the non-atomic `saveLog` /
`setTarget` reads, is in the audit transcript for this session.

## Rules that keep this from breaking

1. **One branch at a time.** Both devices work on the same branch. Do not
   start a second branch for the same task — that is how the two copies drift.
2. **Pull before you touch anything.** Every session, both devices, no
   exceptions. `git pull` costs two seconds; a conflict costs an evening.
3. **Push before you put the device down.** Uncommitted work on a PC that is
   sitting at home is work the phone cannot see. The cloud session's container
   is wiped when it goes idle, so unpushed work there is simply gone.
4. **Phone decides, PC verifies.** Anything that needs a running app, a build,
   a device, or a real look at the screen belongs on the PC. Everything else —
   planning, reading, writing code, reviewing, small fixes — is fine from the
   phone.
5. **Write the handoff row before you stop.** Future-you on the other device
   has none of the context current-you has.
6. **Push after every change, however small.** Not once at the end of a session —
   after *each* discrete change, as it is finished. A file written, a bug fixed,
   a script proven to run: commit it and push it, then carry on. Never batch a
   session's work into one commit at the end.

   Two reasons, and the second is the one that bites. An hour of unpushed work
   is an hour a reclaimed container can delete. And a single fat commit is
   unreviewable from a phone — small commits are the only way the other device
   can actually see what changed.

   This also means pushing *before* asking a question: a question can wait in a
   chat window for hours, but unpushed work cannot. Never end a turn holding it.

---

## Running the migration locally

```bash
npm run emulators        # auth :9099, firestore :8080, UI :4000
npm run db:seed          # representative dev.db (3-level tree, month boundary)
npm run migrate:firestore
npm run migrate:verify   # 16 assertions — the real parity evidence
```

Both migration scripts are safe to re-run. The migration refuses to touch a real
project unless `MIGRATE_ALLOW_PRODUCTION=1` is set deliberately.

## Running the e2e suite

```bash
npm run emulators          # terminal 1 — if it says "port taken", kill the
                           # orphan first: pkill -f cloud-firestore-emulator
                           # The emulator holds state in MEMORY and dies easily.
                           # After any restart, re-run migrate:firestore or the
                           # e2e suite fails with "element not found" at login.
npm run db:seed && npm run migrate:firestore
npm run build && npx next start    # terminal 2
npm run e2e                # 5 tests, real Chromium
npm run test:rules         # 21 Security Rules checks
# e2e is now 10 tests: signup, offline, realtime, theme
```

The Auth emulator exposes the codes it "sends" over REST, so phone auth is
drivable with no SMS and no reCAPTCHA. Chromium is already on the machine —
`playwright.config.ts` points at it, so **do not run `playwright install`**.

## v2.1a code work: DONE

Nothing in `src/` imports a database layer any more. `db.ts` and `jose` are gone.
Prisma remains only as a devDependency, because the migration script reads the
SQLite source; it goes when cutover is done.

40 assertions pass (`npm run migrate:verify`), `next build` and `tsc --noEmit`
clean.

**Four Firestore traps found while porting — worth knowing before v2.1b:**

1. **No cascading deletes.** Erasure deleted the prospect and left the reports —
   live bearer tokens to the health data being erased. Returned `{ok: true}`.
2. **`null` sorts before every timestamp.** A plain `< today` range counted every
   prospect with no follow-up date as overdue.
3. **No relational filters.** `where: { target: { coachId } }` cannot reach
   through a reference; `coachId` is denormalised onto proofs instead.
4. **`settings()` may be called once per Firestore instance, ever.** Caching it
   only in dev — the shape D1 used for Prisma — breaks `next build`.

None of these announce themselves. Two would have passed every test that existed.

## Blocking cutover (not the build)

**The project now exists: `grow--line`** (note the DOUBLE hyphen — `grow-line` is a
different string and will fail silently as a wrong project id). `.firebaserc` carries it
as the `prod` alias, so every command below takes `-P prod` and nothing has to be typed
from memory. `default` is still `growline-dev`, the emulator project, so a forgotten flag
targets the emulator rather than production.

The owner supplied the web app config on 2026-08-20. Four of its seven fields are read by
this app; the rest are for products it does not use yet:

| Firebase console field | Env var | Used today |
|---|---|---|
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` | yes |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` | yes |
| `storageBucket` | — | Storage is deny-all and unwired |
| `messagingSenderId` | — | no FCM; push is still Web Push/VAPID |
| `measurementId` | — | Firebase Analytics is not in this codebase |

**The values are deliberately not committed, and not because they are secret.** A Firebase
web config ships in every browser bundle by design; it is not a credential. They stay out
because `NEXT_PUBLIC_*` is inlined at BUILD time, so production values belong to the
hosting environment, and because `.env.example` is a template — a real project id in it
becomes the value somebody copies into a test deployment by accident.

### The order, and why it is an order

Do not point anything at `grow--line` until step 2 has run. This is the whole point of the
sequence:

1. **`firebase deploy -P prod --only firestore:indexes`** — 26 composite indexes. They
   build asynchronously and a query against a still-building index fails, so this goes
   first and gets a few minutes.
2. **`firebase deploy -P prod --only firestore:rules,storage`** — **the step that must
   precede any traffic.** A fresh project is either locked (the app looks broken) or in
   test mode (every prospect name, phone number and health field is world-readable to
   anyone holding the project id — which is public by design). `storage.rules` is deny-all,
   which is correct until Pro portfolio needs it.
3. **`npm run verify:indexes` with `FIRESTORE_EMULATOR_HOST` and
   `FIREBASE_AUTH_EMULATOR_HOST` UNSET and `FIREBASE_SERVICE_ACCOUNT` set.** This is
   STATUS launch blocker #1. The emulator invents missing indexes; production throws
   `FAILED_PRECONDITION` the first time a coach opens the screen. Cheapest possible
   insurance against a launch-day outage.
4. **`firebase deploy -P prod --only functions`** — all nine. They are inert without
   `CRON_SECRET`, so set that in the function environment in the same pass or the boards,
   qualifications, silence alerts, reminders and the health purge all fail closed.
5. **`npm run backfill:prospect-activity`** once, before the first purge can run (D69).
   `--check` exits non-zero while any prospect lacks `lastActivityAt`.
6. **`npm run backfill:workspaces`** — same shape, `--check` gates it (STATUS bug 15).

### App Check is not optional here

The repository is **public** and Phone auth is enabled. The config being public is fine;
the consequence is not. Anyone can read the project id and drive OTP sends at it, and SMS
to Indian numbers is billed per message. Turn on **App Check with reCAPTCHA Enterprise**
for the Auth provider before the pilot, not after the first bill. Nothing in the code
prevents this — it is a console setting, and it is the only one on this list that costs
money to skip.

### Still outstanding for the cutover

- **`FIREBASE_SERVICE_ACCOUNT`** — the server half. The boot guard (D45) requires both
  emulator hosts unset AND this set; get it wrong in one direction and half the app talks
  to production while the other half talks to nothing.
- **Classic Hosting is ruled out — see D79.** Not a preference: firebase-tools 15's
  Next adapter declares `supportedRange = "12 - 16.0"` and this project is on 16.3.0, so
  `semver.satisfies` is false and the CLI refuses the build. `firebase deploy --only
  hosting` will never work here, and `firebase.json` has no hosting block on purpose.
  App Hosting is configured in `apphosting.yaml` and runs the project's own `npm run
  build`, so it is not version-pinned the same way. **Still unverified against a real
  build** — if it fails on Next 16.3 too, v2 §3's Vercel-front fallback is the answer and
  D79 is where the reason goes.
- Blaze plan, and SMS delivery to Indian numbers confirmed with a real handset.

## Where this repo sits, and what needs a PC

Current state: phases 1–6 complete. Build order is now **v2 §11**, one session at
a time — so the natural unit of a handoff here is one build session.

Keep these on the PC leg — they cannot be confirmed from a phone session:

- The Android/Capacitor build and anything Play Store related.
- Razorpay mandate testing and webhook delivery (needs a reachable local
  tunnel and a real UPI app).
- Looking at a screen: the 30-second rule in `CLAUDE.md` §4 is a stopwatch
  test on a real cheap Android, not something a cloud session can judge.
- Scanning a real QR code with a real phone camera for the Mode B capture
  flow.

Everything else — planning a phase, writing the code, schema work, reviews,
copy — runs fine in a cloud session started from the phone.

Per `CLAUDE.md` §5, nothing in this repo names a nutrition or direct-selling
company. That applies to this file too.
