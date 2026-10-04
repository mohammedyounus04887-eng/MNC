# Handoff — what to build next

Written 2026-08-28, at the point the project changed hands. Everything here was
verified against the code on the day it was written, not recalled.

**Audited 2026-08-29.** A parallel audit was run against this document — seven
areas, each grounded in files rather than memory. Four returned (delight,
features vs spec, production readiness, auth & legal); three did not (UX gaps,
architecture debt, test-coverage) because the run hit a session limit, and the
adversarial verification pass that was supposed to check every finding never ran
at all. So: what follows has been corrected where the audit contradicted it, and
§7 lists those corrections. Treat the four audited areas as sharper than what was
here before, and the unaudited ones — **architecture debt and test coverage
especially** — as still written from memory. The audit also could not reach the
live site (the container's proxy refuses it), so every claim about production
behaviour in this document is inferred from configuration, not observed. §7 says
which single page load settles most of it.

**If you read nothing else, read [§2 The critical path](#2-the-critical-path-to-a-real-pilot).**
It is the difference between "the app is live" and "a coach can use it."
**§7 lists where this document was wrong** and how it was found out.

---

## 1. Where things stand

Growline is **live in production** at
`https://growline--grow--line.asia-east1.hosted.app`, on Firebase App Hosting,
project `grow--line`. A coach can sign up with email, capture a prospect, generate
a wellness report, send it on WhatsApp, log their day, and see their team.

The build is substantial: **38 screens, 52 API routes, 16 feature modules**, and
**736 unit tests + 20 e2e specs + 8 Security Rules suites**, all green. Phases 1–9
of the original plan are built. Design System 3.2 ("Sunrise": warm cream ground,
burnt terracotta accent, glassmorphism, Nunito) is the current identity.

**What it cannot yet do:** send an SMS OTP, run any background job, show a legally
required privacy notice, take money, or notify anybody. None of those are missing
code — they are missing configuration and owner decisions. That is what §2 is.

---

## 2. THE CRITICAL PATH TO A REAL PILOT

Nothing below is optional if a coach who is not the owner is going to use this.
Ordered by what blocks what.

### Owner tasks — nobody else can do these

| # | Task | Why | Breaks if skipped |
|---|---|---|---|
| O1 | **Verify the Google Cloud billing account** | An unverified account is the suspected cause of the phone-OTP failure, and Google can suspend the project outright | SMS never works; project may be suspended |
| O2 | **Supply four legal facts**: legal entity name, named grievance officer, their email, postal address | DPDP Act 2023 + Rules 2025 require a reachable grievance officer *before* collecting a prospect's data | `/privacy` returns 404 by design; collecting prospect data is unlawful |
| O3 | **Decide the notification cap** (proposed: 2/day, morning + evening, never about money) | Needed before FCM copy is written | Nudges get built to a guess |
| O4 | **Commission the Jewel Asset Pack** (8 rendered 3D objects — flame, trophy, tier medals, growing tree, badge frame) | The only item in the whole plan that money buys and code cannot replace | Every hero moment stays an emoji |
| O5 | **Decide on Razorpay** — whether to charge at all yet | Five env vars + a dashboard setup | Everything stays free (which is a valid choice) |

### Developer tasks — in this order

**D0. Confirm the Security Rules are actually deployed. Do this before anything
else, and before another coach signs up.** `.github/workflows/deploy-rules.yml`
has **zero recorded runs**, and the only production deployment anything in this
repo evidences is the *indexes*, applied by hand through Cloud Shell. Nobody has
established that `firestore.rules` or `storage.rules` were ever pushed.

The app cannot tell you, and this is the trap: every server path uses the Admin
SDK, which bypasses rules entirely. A green app proves nothing. Two silent states
are possible, and they fail in opposite directions:

- **Locked (default deny)** — the `onSnapshot` listeners in `RealtimeProspects`
  and `RealtimeThreads` fail, so a QR capture never appears without a refresh.
  Annoying, visible eventually.
- **Test mode (open)** — every prospect's name, phone, height and weight is
  readable by anyone holding the public project id, which is in the client
  bundle. The entire P1/P2 privacy commitment rests on rules being live, and this
  state looks *identical* to a correct one from inside the app.

**Partly settled, 2026-08-29.** `npm run verify:rules` asks production from
outside, with no credentials at all, and it passes 6/6: an anonymous client
holding the public project id is refused on `prospects`, `users`, `reports`,
`dailyLogs`, `goalSheets` and the Storage bucket. **The catastrophic branch is
closed** — production is not in test mode.

What that cannot tell you is whether the denial comes from *our* ruleset or from
the default lock, because they look identical from outside. To settle it, pass a
Firebase ID token for any signed-in coach (yours; it lasts an hour and carries no
more privilege than that account):

```
npm run verify:rules -- --id-token="$TOKEN"
```

Our rules allow a coach to read their own prospects; the default lock allows
nothing. If that probe is REFUSED, the default lock is live and every client
listener in the app is failing right now.

Then deploy them regardless — it costs nothing and ends the question:

```
npx firebase login
npx firebase deploy -P prod --only firestore:rules,storage:rules
npm run verify:rules            # 6/6 must still pass afterwards
```

**From a phone, none of that works.** There is no laptop for `firebase login`,
the GitHub mobile app cannot dispatch the Actions button, and pasting seven
hundred lines of `firestore.rules` into the Firebase console by hand is not a
plan. Use Google Cloud Shell — a real terminal in a mobile browser, already
signed in as the project owner, no key to create. The indexes were deployed that
way once already. One paste:

```
rm -rf ~/growline-deploy && git clone -q --depth 1 \
  https://github.com/TheRealVDevelopers/GrowLine.git ~/growline-deploy \
  && bash ~/growline-deploy/scripts/deploy-rules.sh
```

It deploys `firestore:rules,storage` only, then re-runs the anonymous probes with
plain `curl` so the check needs no `npm ci`. If it says you are not signed in it
prints the one `login --no-localhost` command that works without a redirect to
localhost.

**The better fix is still the Actions button.** `deploy-rules.yml` exists and is
correct; it needs a `FIREBASE_SERVICE_ACCOUNT` repo secret that has never been
created (Firebase Rules Admin + Cloud Datastore Index Admin, nothing more). Once
it exists the deploy is one tap from a browser, every run is attributable, and no
credential is ever retyped. **Note the workflow has never run once** — there are
no `workflow_dispatch` runs in this repo's history at all.

Never run `firebase deploy` without `--only`: it would ship the nine Cloud
Functions as a side effect of a rules change. And re-run `verify:rules` **after**
every rules deploy — a permissive ruleset deploys just as cleanly as a correct
one, and this is the only check that would notice.

**D1. Deploy the nine Cloud Functions. Nothing else on this list matters more.**
They have **never been deployed**. Eight are scheduled jobs; the ninth,
`onDailyLogWritten`, maintains `users.thisMonthActivity` — *the number the team
tree displays*. Until it ships, an upline watches their team and sees nothing
move: the accountability loop the entire product is built around (v1 §F6).

Prerequisites, both of which will fail the deploy if skipped:
- `CRON_SECRET` must exist in Secret Manager **first** — seven functions declare
  `secrets: ["CRON_SECRET"]`, and an unresolvable secret reference fails the
  *whole* deploy, not just that function.
- `functions/.env.grow--line` must carry `SITE_URL`. Seven functions call the
  app's own HTTP routes and return immediately without it — they deploy, report
  healthy, run on schedule, and **do nothing**. See `functions/.env.example`.

```
firebase functions:secrets:set CRON_SECRET --project grow--line
firebase deploy -P prod --only functions
```

**From a phone**, the same one paste into Cloud Shell:

```
rm -rf ~/growline-deploy && git clone -q --depth 1 \
  https://github.com/TheRealVDevelopers/GrowLine.git ~/growline-deploy \
  && bash ~/growline-deploy/scripts/deploy-functions.sh
```

It creates `CRON_SECRET` only if it does not already exist — overwriting a live
one would leave the app runtime holding a value the functions no longer send —
builds, and deploys `--only functions`.

**It deliberately does not run the backfill, and that ordering is the point.** The
purge ignores any prospect with no `lastActivityAt`, so deploying without it means
the job quietly does nothing: under-deletion, the safe failure. The backfill seeds
the field from `createdAt`, and its own header spells out the cost — a prospect
captured 200 days ago but worked yesterday gets a value already past the window
and goes on the next run. The backfill is what **arms** the purge. Give it its own
session, with `--check` first.

**Four independent switches sit behind "background jobs work", and each fails
silently on its own.** Getting three of four right produces a system that reports
healthy in Cloud Logging and does nothing a coach can see:

1. the functions are deployed;
2. `CRON_SECRET` exists in Secret Manager, for the functions;
3. the **same** `CRON_SECRET` reaches the app runtime — `checkCronSecret` answers
   503 without it, so a deployed job calls a route that refuses it;
4. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` exist — `isPushConfigured()`
   is false without them and `sendToUser` returns `{sent: 0}` immediately, so
   every morning reminder, qualification nudge and silence alert is a no-op.

The VAPID keys are self-generated and blocked on nobody. Neither they nor
`CRON_SECRET` nor `ADMIN_UIDS` appear in `apphosting.yaml`, which declares seven
variables and no secrets at all.

**Do the first functions deploy interactively** (`npx firebase login`), as
`deploy-functions.yml`'s own header advises. The alternative is a service account
with ten broad roles — `secretmanager.admin`, `run.admin`, `artifactregistry.admin`,
`storage.admin` among them — held as a GitHub secret on a **public** repository.

**D2. Fix phone OTP, or formally accept email-only for the pilot.** (D82)
Production `sendVerificationCode` returns 400. **Capture the response body
before spending a day on the fix** — D82's root cause (unverified billing /
unprovisioned SMS) is *suspected*, never confirmed, and the identitytoolkit
response has never been read. One person, one browser, five minutes on the live
login screen. If it turns out to be an unauthorised domain or an SMS region
policy, a day on billing verification is a day wasted. Reverting to phone-first is one
line — `INITIAL_STEP` in `src/app/login/LoginFlow.tsx` — once SMS works. Until
then, note that phone numbers collected via email signup are **unverified**;
`complete-signup` still enforces uniqueness, and a verified token always wins, so
re-verification later needs no schema change.

**D3. Wire the four `PRIVACY_*` values** (from O2) into App Hosting as secrets.
`/privacy` publishes itself only when all four are present — deliberately
all-or-nothing, because a notice naming three of four fails the duty it exists to
discharge. See `src/modules/privacy/model.ts`.

**D4. Build coach-facing erasure.** `deleteProspect` has exactly **one** caller —
the prospect's own report-link removal route, which 404s once the link expires
(90 days). There is no coach-facing delete, no account deletion, and no data
export. The privacy notice was reworded to stop promising what does not exist,
but a DPDP erasure right currently has a human process behind it, not a button.
STATUS §16b. **Effort: M.**

**D5. Run `npm run verify:indexes` against production.** 15 indexes are
*documented* as deployed with `/status` reporting 9/9 — but nobody has re-checked
that since, and this exact class already took the app down once (the first
coach's home screen 500'd on `FAILED_PRECONDITION` for two days). `/status` probes
9 of roughly 21 query shapes; the verifier walks all of them, including screens
nobody has opened yet. The emulator invents any index a query needs, so CI is
*structurally incapable* of catching the rest. Needs a service-account key
locally. **Effort: S.**

**D5b. Run the two backfills on production, then their `--check` modes.**

```
npm run backfill:prospect-activity && npm run backfill:prospect-activity -- --check
npm run backfill:workspaces        && npm run backfill:workspaces -- --check
```

Without the first, every pre-existing prospect lacks `lastActivityAt`, is
invisible to the purge, and their health data is retained past the window the
privacy notice states. Without the second, a coach can exist with no
`workspaceId` and a referral tree can straddle two workspaces — the one thing the
referral rule exists to prevent. Both `--check` modes exit non-zero while any row
remains, which is what makes them enforceable rather than advisory. **Do this
before the purge job ever runs**, not after: its first run destroys data
irreversibly, 400 rows at a time, unattended, at 03:00 IST.

**D6. Fix the health purge.** `functions/src/index.ts` filters
`.where("heightCm", "!=", null)`, and Firestore `!=` **excludes documents where
the field is absent** — capture requires only name and phone, so a prospect saved
with a weight but no height is never purged and their health data lives forever,
while the privacy notice promises deletion at 180 days. This is an
*under*-deletion bug, so current behaviour is the safe side; it is unfixed
deliberately because it lives in the one job that destroys data irreversibly and
wants a careful test. STATUS §16c. **Effort: M.**

> **The obvious fix is a trap.** `heightCm != null` is doing double duty as the
> *already-purged* guard, because a purge sets `heightCm` to null. Remove the
> filter without replacing it and the job re-selects every previously purged
> prospect on every run — and with `.limit(400)` it spends its whole daily budget
> re-purging the same rows forever, never reaching a new one. Any fix needs an
> explicit `healthPurgedAt == null` guard (or a maintained `hasHealthData`
> boolean) plus a new composite index. Note also why the shortcut was taken:
> Firestore cannot express "heightCm != null OR weightKg != null OR age != null"
> in a single query.
>
> And the test suite gives false comfort here. `tests/privacy.test.ts` asserts the
> notice quotes the purge constant rather than restating it — but nothing compares
> the notice's *promise* to what the query actually *selects*. The suite stays
> green through a purge that matches zero documents.

**D6b. Close the phone-number hole the email interim opened.** Two small, related
gaps, both consequences of D82:

- **Uniqueness is a read-then-write race.** `collections.ts` records the
  invariant's justification — "Auth's Phone provider allows one account per
  number, and the user doc id IS that account's uid" — and that reasoning does
  not survive the email path, where the number is typed into a form. `createUser`
  reserves the referral code structurally and the phone not at all. This is
  exactly the TOCTOU that D41 fixed for codes; the same reservation-document
  shape applies. **Effort: S.**
- **A typo is permanent.** `PATCH /api/me` accepts name, city, photo, level name
  and `shareProspects` — not the phone. That number is printed on every wellness
  report card, is the target of the WhatsApp button on every report page, and is
  the contact on every portfolio. Decide now whether a change re-verifies (needs
  OTP) or only re-checks uniqueness, so the field does not have to move twice.
  **Effort: S.**

Both compound: because the number is unverified, anyone can claim a number that
is not theirs, which surfaces as a hard conflict the day phone OTP comes back on
and the real owner cannot sign up.

**D7. App Check.** Ship the reCAPTCHA key, watch metrics for a few days, *then*
enforce. Enforcing before a key ships rejects every request. `src/lib/app-check.ts`.

---

## 3. The build queue after that

In dependency order. Effort: S = hours, M = a day or two, L = a week, XL = more.

### The delight programme (mid-flight)

A five-way visual comparison was run and "Sunrise" chosen; a ten-move plan follows
from a screen-by-screen audit that scored the app **3.3/10** against its own
design spec. Weeks 1 and most of 2 shipped. Remaining:

| Move | What | Effort |
|---|---|---|
| ~~9~~ | ~~**Target ring on home**~~ — **done 2026-08-29.** `MiniRing` on the My Target card; a 26px arc on the target mission row. The follow-up row deliberately has no arc: nothing records follow-ups *completed* today, so any denominator would be invented. The honest version needs a `followupsCompletedAt` write on stage and date changes — a data-layer task, argued in `TodaysMission.tsx` | — |
| 10 | **Mission completion states** — items flip to a tick in place rather than vanishing; all three seals a "Day complete" state feeding a monthly tally. Neither half is stubbed: a done mission simply stops being generated, so the card never shows the coach evidence the session accomplished anything. There is no monthly rollup anywhere — the only one that exists is the 7-day `weekly-recap.ts`, and v2 §3's `thisMonthActivity` map is unbuilt | M |
| System B | **Share-card generator** — the biggest remaining win. Both delight share paths currently send **plain text**, which carries no branding and no viral surface at all. Reuse the satori pipeline (`src/app/r/[token]/card.png`) to render the Weekly Recap and streak milestones as branded PNGs for WhatsApp Status. The idiom to copy is complete and documented: `ImageResponse` from `next/og`, `cardFonts()` returning `{fonts, safe, safeOrNull}` so satori is never handed a glyph it would fetch from Google (D66), the buffered-not-streamed render with a photo-less retry, and the satori CSS subset in `report-card.tsx` (flexbox only, explicit `display:flex`, margins not `gap`). One new component plus one route — **session-authed, not token-authed** like the report routes | L |
| — | **Jewel Asset Pack integration** — once O4 delivers, swap every emoji stand-in. **Re-spec it first:** the pack was designed for the deleted Dark Achiever metals (silver / champagne gold / platinum). Whether that ladder survives the move to Sunrise terracotta is a design decision, not a production one, and it has to be made before anyone commissions eight renders | M |
| — | **Delight test coverage** — one of the eight shipped artefacts has a test (`celebrate.ts`). Nothing covers `haptic.ts`, `CountUp`, `SuccessTick`, `StreakFlame`'s render, or the member wash — `data-testid="member-wash"` exists with no assertion anywhere against it. Every one fails silently: a celebration that blocks a tap looks fine in review and is obvious only to a coach | M |

### First-run experience — the highest-value unbuilt thing

The owner's verdict on an empty account: *"it looks like a 1990s banking
application… people will not come back tomorrow."* All delight work so far targets
screens **with data**; a new coach has none. Strava and Duolingo both solve this by
getting a user into data inside sixty seconds. This is not in any spec yet and
should be designed. **Effort: L.**

### Features

| What | Notes | Effort |
|---|---|---|
| **Pro portfolio** (v2 §7) | Transformation gallery, testimonials, achievements, 3 themes, custom slug, QR poster — **none of it exists**; the `Portfolio` type has no field for any of it. `isPro` is *read* and **written by nothing**, so the Pro flag can never flip: whoever builds this writes the setter too. **Blocked on Firebase Storage** (deny-all rules, no `storageBucket` in the client config, no `firebase/storage` import anywhere) + a thumbnail Cloud Function. Do not build on data-URLs — that repeats D3/D49 | L |
| **Leader watermark removal** | v2 §8 sells "watermark removed" as one of four things ₹999/month buys. Only the *portfolio* watermark is tier-conditional; `report-card.tsx` prints "Growline" unconditionally — and the report card is the artefact that actually travels. Also: the pricing copy lists "team analytics", and `LEADER_TOOLS` has three entries, none of them that | S |
| **Indic shaping in the report card** | The HTML report page is correct — the browser shapes it. The **PNG and PDF are not**: satori does no complex-script shaping, so it forms no conjuncts and renders the virama standalone (D66). The committed fonts fixed the leak and the missing bold weight, not the shaping. `tests/report-fonts.test.ts` checks glyph *coverage*, so it cannot catch this. The damage lands precisely on the two artefacts designed to be forwarded, and it fails the v2 §10 acceptance clause "Kannada name rendered bold and correct" | M |
| **Onboarding tour** (v2 §9) | 3 screens, skippable. Zero code — no first-run state on the user document, no route. `EmptyState` is imported by only four screens | M |
| **FCM push** | Currently Web Push (VAPID) — there is no FCM anywhere, only three comments saying it will replace this. v2 §3 says FCM replaces VAPID *entirely* and v2 wins on conflict, so this is an unreconciled spec override that needs a `DECISIONS.md` entry either way. Soft today; **hard at Phase 10**, since Web Push cannot reach a Capacitor app | M |
| **QR capture notification** | F2 Mode B promises the prospect "appears instantly in the coach's pipeline **with a notification**". The realtime listener delivers the appearance; the capture route contains no push call at all. Half-built, and reads as built | S |
| **Video proofs** | v2 §3 says Storage "unblocks video proofs". It does not, here: proof media is still a base64 JPEG data URL stored *inside* the Firestore document. Photos only, and every proof inflates a document | M |
| **Capacitor Android + Play Store** | Needs FCM first. Brand-neutral listing, Data Safety form covering health-adjacent fields — which requires a live privacy-policy URL, and `/privacy` 404s today | L |
| **Localisation** | Five languages are *offered*. Measured 2026-08-29: **244 distinct hardcoded English strings across 80 files against 28 dictionary keys — a 10.3% translatable share**, and the scan undercounts (JSX text nodes only, not placeholders, aria-labels, or copy passed as props). A coach who picks Kannada sees a handful of translated labels on otherwise English screens. Note v1 §8 names **Marathi** and there is no Marathi dictionary. Ten proposed translations await a native speaker — do not ship unverified (D72) | XL |
| **Promo codes / tier flip** | Built and tested; the flip is three coordinated changes and an **owner decision** (D70) | S |
| **Admin panel in production** | Built and good — six real tabs, counts-only by rule. It **404s in production**: `adminEnabled()` is false without `ADMIN_UIDS`, which is not among the seven variables in `apphosting.yaml`. Two Overview cards also still assert "Payments and tiers are not built yet (v2.6)", superseded by D70/D75/D76 and false to whoever opens the page | S |

---

## 4. Traps — these have already cost days

**Built but never mounted.** This has happened *three times*. A finished
`StreakFlame` that no screen rendered. A target-ring celebration gated on a prop
its only caller never passed — the confetti had never executed once. `.neopop`
and `.metal-gold` defined in CSS and used on two buttons. **Before building
anything, grep for it — it may already exist.**

**Firestore index direction must match exactly.** An index serves a query only if
*every field direction* matches. Two bugs of this shape shipped: `dailyLogs`
declared ASC where the streak reads DESC, `prospects` declared DESC where the
recap counts ASC. The emulator hides this completely — it invents whatever index
a query asks for. Production is the only place it shows.

**The emulator is more permissive than production, generally.** Missing indexes,
reserved ids, `!=` semantics. Never conclude "it works" from a green e2e run alone.

**Reserved Firestore document ids.** Ids matching `__…__` are reserved: production
rejects them with `INVALID_ARGUMENT`, and the emulator *hangs forever* rather than
answering. Cost an hour. See `DIAG_ID` in `src/app/status/page.tsx`.

**e2e runs whatever is in `.next`.** `playwright.config.ts` runs `next start`,
which never builds. A stale bundle once produced **43 phantom failures** across
unrelated specs. `e2e/global-setup.ts` now refuses to start on a mismatch — do not
remove it.

**One killed run poisons the next.** `reuseExistingServer: true` will attach to a
dying server. If you kill a suite, verify ports 3000/9099/8080 are free before
re-running, or you will debug 50 cascade failures that mean nothing.

**~~A known e2e intermittency exists.~~ It was a real bug. Fixed 2026-08-29 (D89).**
`realtime.spec.ts` failed roughly 1-in-3 on unmodified code and was written off
here as an environment problem. It was not. `RealtimeProspects` flipped its
"listening" flag when Firebase *Auth* resolved, one line above the subscription —
so a QR capture landing in that gap arrived inside the listener's first snapshot,
which is deliberately discarded as the baseline, and the coach's screen never
refreshed. The row sat in Firestore, invisible. `RealtimeThreads` had it too.
Three consecutive full suites now pass.

That is **twice** in this project that "flaky" was hiding a capture the product
actually lost (D73, D89). The rule stands and has teeth: **pull the trace before
calling anything flaky.** The trace is what settled this one — it showed the flag
set, the write accepted, and delivery never happening, which ruled out the whole
setup half of the spec.

**Tests that pin design values break on every reskin.** Three did. They now assert
*relationships* (light is lighter than dark; body background equals the `--bg`
token) rather than hexes. Keep it that way.

**`FIREBASE_SERVICE_ACCOUNT` is a *deploy* credential, not a runtime one.** It
belongs in GitHub Actions secrets, or nowhere if you deploy interactively. It must
**never** go into `apphosting.yaml`: the app deliberately runs on Application
Default Credentials on Cloud Run and needs no key (D80). `.env.example` carries a
blank `FIREBASE_SERVICE_ACCOUNT=""` line that invites exactly this mistake.
`SESSION_SECRET` is the same shape of leftover — still in `.env.example` and
`ci.yml`, read by nothing in `src/`, `scripts/`, `e2e/` or `tests/`. Neither needs
provisioning.

**The `--gold-*` token names are a deliberate lie, and it is documented.**
`--gold`, `--gold-hi`, `--gold-lo`, `--on-gold` and `--gold-ink` all alias the
terracotta accent, because roughly two hundred class names across the app say
"gold". Every `bg-gold`, `text-gold-ink` and `metal-gold` renders burnt orange.
The rename is its own mechanical commit and has not been done. Anyone reading a
component in isolation will believe the app is gold — `TargetRing`'s
`stroke="var(--gold)"` is the line most likely to be "fixed" by mistake.

**The launcher identity is still the deleted dark theme — and a test defends it.**
`manifest.ts` sets `background_color` and `theme_color` to `#0B1020`,
`layout.tsx` sets the same `themeColor`, and `public/icons/icon.svg` fills its
rounded rect with it under a champagne-gold gradient. The default ground is now
cream `#fff9f2`. On Android — the entire target platform — a cold start paints a
near-black navy splash and status bar, then loads a cream app.
`tests/manifest.test.ts` pins those exact hexes under the title "splash and status
bar use the dark ground, not white". **That test will fail the fix and argue
against it**; it has to be rewritten in the same commit. *(Fixed 2026-08-29 — see
§7. Left here because the shape of the problem recurs: a test that pins a value
rather than a relationship becomes an argument for the bug.)*

**`STATUS.md` describes a design system that was deleted.** Its §"Design System
2.0 — done" still asserts a dark-default navy/gold token layer with serif
headings. That was replaced twice. Its header line is dated two weeks before
entries in its own body. `CLAUDE.md`'s START HERE says to read `STATUS.md` first,
so this is the first thing a new developer is told, and it is wrong. Read the
body, not the header; and check `DECISIONS.md` D84+ for what actually shipped.

**`HANDOFF.md` (the older one) says the first deploy is "26 composite indexes".**
`firestore.indexes.json` contains 15. The file is authoritative; `HANDOFF.md` is
stale and will make someone hunt for ten indexes that never existed.

**A failed rollout looks exactly like a working site.** App Hosting keeps serving
the previous good build when a rollout fails, so "the site loads" is not evidence
that your commit is live — and for most of this project's life there was no way
to tell from outside. `/status` now prints the commit and build time it is
serving (`data-testid="build-stamp"`). **That line, not the page loading, is how
you confirm a deploy.** If the SHA is not the one you pushed, the rollout failed
and rolled back silently.

**Deploying the app is a `git push`, and there is a way to check it first.**
App Hosting watches the connected branch (`master`) and rolls out on every push
to it. There is no deploy command for the app itself and no `hosting` block in
`firebase.json` — `firebase deploy --only hosting` will never work here, because
firebase-tools 15's Next adapter declares support for `12 - 16.0` against
next@16.3.0 (D79). To force a rollout of a specific commit, or if the backend's
rollout policy is manual rather than automatic:

```
npx firebase apphosting:rollouts:create growline -P prod -g <commit>
```

Before pushing anything that touches configuration:

```
npm run verify:build
```

It builds with `.env` hidden, `K_SERVICE` unset, and only the variables
`apphosting.yaml` marks BUILD — read out of that file, so the two cannot drift —
then greps the emitted chunks to prove every `NEXT_PUBLIC_*` a client file reads
was actually inlined. A local `npm run build` passing proves close to nothing:
`.env` is gitignored and never uploaded, so the cloud has none of it, and a
variable that resolves empty is compiled in as `undefined` rather than erroring.
The browser then talks to nothing, in production only.

Also never run `firebase deploy` with no `--only`: it would ship the nine Cloud
Functions as a side effect of whatever you meant to deploy.

**`value: ""` is invalid in `apphosting.yaml`.** To a Go validator an empty string
is indistinguishable from unset, so the entry reads as an env var with neither
value nor secret and **the whole file is rejected** — nine rollouts failed on this.
Absent means off; there is no "staged blank".

---

## 5. House rules that are not negotiable

Full list in `RULES.md`. These are the ones most likely to be "improved" by
accident:

- **L2/L3 — no medical claims, and no clinical word ever describes a person.**
  "Below / in / above the general range", never "obese" or "overweight". This is
  the Drugs & Magic Remedies Act, not a style preference.
- **L4 — no income promises.** Targets are points. No ₹ on a target, ever.
- **L1/L8 — no company or rank names**, and level names are never pre-filled.
- **P1/P2 — `shareProspects` defaults OFF and is enforced in Security Rules**, not
  app code. There is a mandatory test.
- **G1 — Trust Zones stay calm.** Payment, cancel, consent, privacy: no
  celebration, no haptics, no confetti. Celebrate earning, never charging.
- **G4 — no `backdrop-filter`.** The glass look is alpha fills + hairline borders
  + soft shadows, which is free. Blur re-samples on every scroll frame and is
  exactly the jank a ₹10K Android cannot absorb.
- **E1 — never `new Date()` for a day boundary.** IST is UTC+5:30; go through
  `day.ts`. This has broken roll-ups once already.
- **E2 — never import `./db` into anything a `"use client"` file touches.**
- **E6 — write the decision down.** `DECISIONS.md` has 83 entries and is the
  reason this handoff could be written at all.

---

## 6. Your first day

**Read, in this order:**

1. `RULES.md` — one page, all non-negotiables. Ten minutes.
2. This file, §2 and §4.
3. `STATUS.md` — the audited state of every feature, including bugs found and
   deliberately not fixed. **Its design-system section is stale** — see §4.
4. `CLAUDE.md` — product definition, personas, the *why*.
5. `DECISIONS.md` — skim the headings; read D45, D68, D70, D73, D79–D87 in full.
   Each records a deviation and its reasoning.

**Get it running:**

```
npm ci
npm run typecheck && npm run lint && npm run test:unit   # expect 736 passing
npm run emulators                                        # second terminal
npm run e2e:reset && npm run e2e                         # expect 71 passing, 1 skipped
```

**Your first four commits, in order:**

1. **Settle the Security Rules** (D0). Not a commit so much as a five-minute
   check with a large downside — this moved to the top after the audit, because
   "we assume they are deployed" is not a state a privacy commitment can rest on.
2. **Deploy the Cloud Functions** (D1). Highest-value single action available;
   the team roll-up has never worked in production. Run D5b's backfills *before*
   the purge job can fire.
3. **Run `verify:indexes` against prod** (D5) and fix whatever it names. Cheap,
   and it closes the outage class that has already taken the app down once.
4. **Coach-facing prospect delete** (D4). Small, self-contained, makes the privacy
   notice true, and teaches you the module conventions on a low-risk path.
   ⚠️ It must delete the *reports* too: `deleteProspect` removes only the prospect
   document, and the existing caller calls `deleteReportsForProspect` first for
   exactly this reason. A delete that skips it leaves orphaned reports whose
   90-day bearer tokens still serve the health data the request was erasing.

**Then** pick up the delight plan at Move 10, or the first-run experience if the
owner prioritises retention over polish. The first-run problem is, in my judgement,
worth more than the remaining polish.

---

## 7. What the 2026-08-29 audit changed in this document

Recorded rather than quietly edited, because the pattern of the errors is more
useful than the corrections. Every one is the same shape: **I described what the
code says, and the code was not the whole system.**

**Contradicted outright:**

- *"All 15 indexes are deployed and `/status` reports 9/9"* — true when written,
  and I stated it as if it were still verified. It is a documented claim from
  2026-08-24 that nobody has re-checked. Now D5 says so.
- *The Security Rules.* I did not mention them at all, having assumed they were
  deployed with the indexes. `deploy-rules.yml` has zero recorded runs. That
  omission is now **D0, ahead of everything else** — the worst case is a
  world-readable prospect database that looks completely normal from inside the
  app.
- *"Roughly nine in ten strings a coach reads are English."* Correct, and now
  measured: 244 strings, 80 files, 10.3% translatable. Also missed that v1 §8
  names Marathi and no Marathi dictionary exists.
- *Pro portfolio "blocked on Storage".* True but incomplete: `isPro` is read and
  **written by nothing**, so the flag cannot flip even once Storage lands.
- *"Watermark removed" for Leader.* I listed it as built. Only the portfolio
  watermark is tier-conditional; the report card — the artefact that travels — is
  unconditional.

**Missed entirely:**

- The admin panel 404s in production (`ADMIN_UIDS` unset).
- VAPID keys are a second, independent switch behind "notifications work".
- Indic shaping is broken in the report PNG and PDF (satori does no complex-script
  shaping), which fails a v2 §10 acceptance clause.
- Phone-number uniqueness became a TOCTOU race the moment email signup landed, and
  there is no way to correct a phone typo afterwards.
- The health-purge fix has a trap in it that would silently starve the job.
- The Android splash and launcher icon still carry the deleted dark palette, with
  a test defending it. **Fixed 2026-08-29.**
- `DECISIONS.md` stopped at D83: none of the delight programme or the three
  design-system rewrites was written down. That is a straight RULES E6 miss, and
  it is mine. D84–D87 now cover it.

**What the audit could not do, so treat as still unverified:**

- **Nothing about the live site was observed.** The audit container's proxy refused
  the deployment, so every production claim here — in this document and in the
  audit — is inferred from `apphosting.yaml`, `STATUS.md` and `DECISIONS.md`. One
  browser tab on `/status` settles most of it. Do that before quoting any of it.
- **Three of seven areas never ran** (UX gaps, architecture debt, test coverage) —
  the run hit a session limit. Architecture debt and test coverage are exactly the
  two areas this document was most written from memory, so they remain the least
  trustworthy sections in it.
- **No finding was adversarially verified.** The verification pass was supposed to
  re-check each claim against the code independently and it never executed. Each
  finding above was file-grounded by its author and cites paths — but a citation
  is not a second opinion. Check before you act on one.

---

## A note on how this codebase is written

Comments here explain **why**, not what — especially where something looks wrong
and is deliberate. If a piece of code seems odd, check `DECISIONS.md` before
changing it; there is a good chance it is load-bearing and the reason is written
down. Where you find something genuinely wrong, fix it *and* add the entry. That
habit is the only reason a handoff this specific was possible.
