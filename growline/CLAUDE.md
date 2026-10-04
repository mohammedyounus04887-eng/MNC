@AGENTS.md
@BUILD_PROMPT_V2.md
@RULES.md

# GROWLINE — Master Build Prompt

> **[RULES.md](./RULES.md) is the one-page version of every non-negotiable** in this
> file, in v2, and in `DECISIONS.md`. Read it before every build session. The rules
> themselves live here and in v2 — `RULES.md` is the index, not a replacement.

> **v2 IS IN EFFECT. Read [BUILD_PROMPT_V2.md](./BUILD_PROMPT_V2.md) alongside this file —
> where the two conflict, v2 WINS.** This document (v1) is still the product
> definition: who the users are, the hard rules, the feature specs. But three things
> below are superseded and must NOT be built as written:
>
> | v1 says | v2 says | Where |
> |---|---|---|
> | Supabase + Postgres + RLS | **Firebase**: Auth, Firestore, Storage, FCM, App Hosting | v2 §3 |
> | 60-day trial + autopay mandate at signup | **CANCELLED.** Freemium tiers, mandate only at paid conversion | v2 §8 |
> | Light theme, navy/gold | **Dark theme by default** ("Dark Achiever"); light is an option | v2 §4 |
>
> Phases 1–6 below are COMPLETE. Remaining work is sequenced by v2 §11, not v1 §14.
> The v1 hard rules (§5) are untouched and still absolute.

---

## ▶ START HERE — what to do next (updated 2026-08-29, cloud · all three branches at parity)

**Read [`HANDOFF-NEXT.md`](./HANDOFF-NEXT.md) first.** It is the current plan: what is
live, what blocks a real pilot, in what order, and — in its §7 — where it was itself
found to be wrong. Then `RULES.md`. `STATUS.md` is still the per-feature audit and worth
reading, but **its design-system section describes a system that was deleted**; D84
supersedes it.

Everything below this heading down to "the remaining build queue" is the 2026-08-14
Razorpay plan and is **finished** — kept for its reasoning, not as instructions. The
live work is in `HANDOFF-NEXT.md` §2.

Three branches — `master`, `feature/new-modules`, `claude/pull-everything-2hzx4h` — and
they are kept at the same commit. Work on one, fast-forward the other two. Every merge so
far has been clean.

### How to start a session on any device

```bash
git pull                       # both branches move together
npm ci
npm run typecheck && npm run lint && npm run test:unit
```

Anything touching the database also needs the emulators, in a second terminal:

```bash
npm run emulators
```

then `npm run e2e:reset` once before the first suite. `npm run e2e` starts its own web
server. **From a phone/cloud session:** the emulators need Java and a port; if the cloud
container cannot run them, unit tests, typecheck, lint and any pure-model work still run
fine, and the e2e/rules suites wait for the PC leg. Say so in the commit rather than
skipping silently.

Current green line: **738 unit · 189 rules checks (8 suites) · 71 e2e passing + 1
skipped · 0 lint errors** — measured on a cloud container, three consecutive full runs.
`e2e/realtime.spec.ts` used to be intermittent here; it was a real bug and is fixed
(D89). Pull the trace before calling anything flaky — that is now twice in this
codebase that "flaky" was a capture the product actually lost (D73, D89).

---

### ~~THE NEXT SESSION — finish Razorpay (Phase 9b)~~ — DONE 2026-08-14/24. See D75, D76.

The foundation is on both branches (D75 pending — see step 6). What is left is wiring,
proof and paperwork. Do it in this order; each step is one commit.

**1. Mount the payment controls on `/plans`.** ← start here
   `src/app/(app)/plans/page.tsx` already imports `getPaymentState`, `isConfigured` and
   `PaymentControls` but does not render them (three lint warnings say so). Add:
   - `const [state, pay] = await Promise.all([getTierState(user), getPaymentState(user.id)]);`
   - `const showPayments = pay.hasSubscription || (isConfigured() && TIERS_ENFORCED);`
   - Replace the closing "No payment method is connected…" paragraph with:
     `{showPayments ? <PaymentControls initial={{…from pay}} configured={isConfigured()} /> : <p>…that paragraph…</p>}`
   The gate matters: showing "Get Leader" while every Leader tool is open to everyone is
   selling something the coach already has — a dark pattern with a price tag, on a Trust
   Zone screen. A paying Leader sees their controls regardless, so cancel is never hidden
   from somebody being charged.

**2. Add `/api/payments/*` to the e2e signed-out sweep.** The webhook MUST be reachable
   without a session (Razorpay has none) and MUST 400 on a bad signature. Add to
   `e2e/tiers.spec.ts` or a new `e2e/payments.spec.ts`:
   - `POST /api/payments/webhook` with no signature → 400
   - `POST /api/payments/webhook` with a body signed by `RAZORPAY_WEBHOOK_SECRET` from
     `.env` → 200 (set the secret in `.env` for the test; it is not a real key)
   - `POST /api/payments/subscribe` signed-in with keys blank → 503 "not switched on"
   The lesson from D68 applies: any public surface needs a test that visits it with no
   session, because nothing else in the stack can tell you the proxy is eating it.

**3. Settings "My plan" card should read from `getPaymentState`** when
   `pay.hasSubscription` — show plan, cancelled/grace state, and a link to `/plans`. Today
   it only reads the tier. Small change in `src/app/(app)/settings/page.tsx`.

**4. Admin funnel: fill the "Paying Leader" row.** `src/app/admin/subscriptions/page.tsx`
   has the row with a "Razorpay is not connected" note; `tierFunnel()` in
   `src/modules/tiers/queries.ts` already counts `source === "paid"` records. Once step 1
   lands the number is real — drop the note when `isConfigured()`.

**5. Promo codes for club launches (v2 §8).** NOT built. Design before code:
   - `promoCodes/{code}` — `{ leaderDays: number, lockedPlan?: PlanKey, maxUses, uses,
     expiresKey }`; admin-created only.
   - Redeem = extend the Leader trial (`tiers/{uid}.trialEndsKey`) by `leaderDays`,
     `source: "granted"`. Never touches Razorpay — a promo is a longer free run, and the
     paid conversion afterwards is the normal path.
   - One redemption per coach per code, structural (`promoRedemptions/{code}__{uid}` with
     `create()`), same shape as claps and referral codes.
   - Admin page to mint codes; a field on `/plans` to enter one. Trust Zone.
   Unit-test the extension arithmetic through `day.ts` (RULES E1).

**6. Write D75 into `DECISIONS.md`.** The design is in the commit message of `357fe67`
   and the file headers of `src/modules/payments/*` — the entry should carry: why no SDK,
   the fail-closed direction of `isPaidLeader`, cancel-at-cycle-end, structural
   idempotency via `webhookEvents/{id}`, raw-body-before-parse, and that payments FEED
   the tier record rather than being a second answer. Then update `STATUS.md`: Phase 9
   moves to DONE-pending-keys, and add `RAZORPAY_*` (5 vars) to the launch-blocker list
   next to `CRON_SECRET`.

**7. The flip — OWNER decision, do not do it unasked.** When keys are in the environment
   and the owner says go: `TIERS_ENFORCED = true` in `src/modules/tiers/model.ts`, remove
   the launch-open banner from `/plans`, remove the `start-trial` 409 in
   `src/app/api/tiers/route.ts`. It is a set of three (D70). The unit test that pins the
   constant will fail and name D70 — that is it working.

---

### After Razorpay — the remaining build queue, in order

1. **v2.5 Phase 8 Pro portfolio** — transformation gallery, testimonials, achievements,
   3 themes, QR poster. **Blocked on Firebase Storage** being enabled (deny-all today,
   D49) plus a thumbnail Cloud Function. Building it on data-URLs would repeat the
   D3/D49 mistake. Ask the owner to enable Storage first.
2. **Goal Sheet dream photo** — same Storage dependency; a small add once Storage exists.
3. **v2.7 Phase 10** — onboarding tour (3 screens, skippable), empty states, low-end
   device pass, Capacitor Android with **FCM** (Web Push cannot reach a native app —
   ⚠️ B), Play Store listing. FCM is the prerequisite; it is not built.
4. **Translation polish** — ten unverified proposals listed in `STATUS.md` under
   🚫 BLOCKED, for a human native speaker to settle. Do not apply them unverified (D72).
5. ~~**Housekeeping**~~ — **DONE 2026-08-19.** The N-series is folded into
   `DECISIONS.md` (⚠️ C), all six cron routes go through `checkCronSecret` (⚠️ D), and
   the stray worktree was already gone.

---

### The launch blockers — none of these is code, and all of them need the owner

1. **Nobody has ever run this against real Firebase.** The emulator invents missing
   composite indexes; production throws `FAILED_PRECONDITION` the first time a coach opens
   the screen. `npm run verify:indexes` with the emulator host vars UNSET, against the
   real project, before launch. Most likely launch-day outage.
2. **Firebase project provisioning** — Blaze plan, Phone auth on, SMS to Indian numbers
   confirmed, service account in `.env`. See "Blocking cutover" in `HANDOFF.md`.
3. **`CRON_SECRET`** — blank; all nine scheduled functions fail closed. Now user-visible
   since the Phase-2 features are authorised (D74): empty boards look broken.
4. **`npm run backfill:prospect-activity`** once on production before the first purge
   (D69). `--check` exits non-zero while any prospect lacks `lastActivityAt`.
5. **`RAZORPAY_*` — five vars** (`.env.example` documents them). Two are secrets. Plans
   are created once in the Razorpay dashboard; the webhook URL is
   `/api/payments/webhook`, events `subscription.*`.
6. **Privacy notice** — needs legal entity name, grievance-officer contact, postal
   address from the owner. Ships with the app or the app does not ship.

### Decisions only the owner can make

- ~~Do the Phase-2 features ship?~~ **DECIDED: yes (D74).** S7 still parks the rest of §8.
- Storage on now? (unblocks Pro portfolio + dream photo)
- FCM now, or with the Capacitor build?
- Who produces the 8-item Jewel Asset Pack? Not derivable from code.
- **The tier flip** (step 7 above) — needs keys first.

---

### What was finished on 2026-08-14 (so you do not re-derive it)

- **Feature A Goal Sheet** — complete except the dream photo (Storage).
- **Portfolio Basic (F9)** — `growline.in/<slug>`, wired into every report.
- **Tier system, gates OPEN** behind `TIERS_ENFORCED = false` (D70).
- **Feature B Recognition Wall** — earned-only, one 👏, 14-day, workspace-scoped (D71).
- **Translation review** — 3 applied, 3 rejected, 10 for a human (D72).
- **Retention purge** now measures real inactivity, not record age (D69).
- **Offline queue** — the "flaky" e2e was a real capture-losing bug; fixed (D73).
- **Phase-2 features authorised** and pinned by a test (D74).
- **Razorpay foundation** — model, client, store, 4 routes, controls, 23 tests. Not yet
  mounted (step 1 above).
- CI: all 8 rules suites block; `functions/` typechecked; e2e starts its own server;
  `e2e:reset` re-seeds.

### Two lessons from 2026-08-14 worth not relearning

**Any public surface needs a test that visits it with no session.** The portfolio shipped
fully typed with 24 green tests and was completely unreachable — `src/proxy.ts` sent every
session-less request to `/login`. Only an e2e in a signed-out browser found it (D68).

**"Passes alone, fails in the suite" is not automatically flaky.** The offline-capture spec
was filed that way twice. The trace showed one aborted POST and no retry — a real bug that
lost captures on a weak signal, in production, needing no test to happen (D73). Pull the
trace before calling anything flaky.

### House rules that bite hardest here

`RULES.md` is the full list; these are the ones that have already cost a session each:

- **E1** — never `new Date()` for a day boundary. IST is UTC+5:30; go through `day.ts`.
- **E2** — never import `./db` or `@/lib/collections` into anything a `"use client"` file
  touches. Split pure model from queries (every module here does this).
- **E5** — one session per v2 §11 item. Name the files. Never refactor completed work
  without asking.
- **E7** — push after every discrete change, not once at the end. Including before asking
  a question.
- **G1** — money, cancel, consent and privacy screens are Trust Zones: flat, calm, no
  celebration, and every money sentence says what happens to the coach's data.
- **L7** — nothing in this codebase may hold a card, UPI or bank detail. The subscription
  record type has no field for one, and a test asserts that.

---

WHY: New app from scratch — plan deep once, then build feature-by-feature cheaply.

How to use this document: This is the persistent project context. Build phases from Section 14 are sent ONE AT A TIME, verifying each phase works before the next. Never build the whole app in one prompt.

## 1. WHAT YOU ARE BUILDING (read this first)

Growline is a mobile-first business management app for independent wellness coaches in India. These coaches build their business through daily human activity — meeting prospects on morning walks, inviting them to wellness clubs, mentoring their team (their "line"), and chasing monthly targets. Today they run all of this on paper, memory, and scattered WhatsApp chats.

One line: Growline is the daily operating system for a wellness coach — capture a prospect in 30 seconds, send them a wellness report on WhatsApp instantly, follow up on time, log today's work, watch your line grow, and hit your targets.

Built by The Real V Developers, Bengaluru. Runs as one responsive codebase: an installable Android app (Play Store) AND the same experience in a desktop browser.

## 2. WHY THIS EXISTS & WHAT THE BUSINESS GAINS

The problem: A coach meets 10 people on a morning walk, writes details on paper, loses the paper, forgets to follow up, and manually calculates BMI on a calculator. Their mentor (upline) has no visibility into what the team actually did today. Targets live in diaries. Motivation lives in one-time speeches that fade by evening.

Why it will work: The daily accountability loop (log your work → upline sees it → upline responds) already exists in this culture offline. Growline digitizes an existing habit — it does not create a new one.

Business model: 60-day free trial → ₹999/month or ₹9,999/year, collected via UPI autopay mandate set up at signup. Distribution is club-by-club through senior coaches, never cold app-store marketing first.

What the business gains: recurring subscription revenue; built-in viral growth (every coach onboards their own team with a referral code); a funnel of club owners for Real V's separate club-management system; and a defensible data moat — by day 60 a user's entire business history lives inside.

## 3. WHO USES IT (three personas)

P1 — The Coach (the paying user). Age 22–50, tier-1/2/3 Indian city, mid-range Android phone (₹8,000–₹15,000), lives on WhatsApp, thinks in Kannada/Hindi/Marathi, English is functional not fluent. Morning: walk & talk on the road. Day: club sessions. Evening: follow-ups. Wants to look professional in front of prospects and impressive in front of their upline.

P2 — The Upline / Senior Coach. Same app, elevated view. Sees their full team tree, sets monthly targets for each downline, sends broadcast threads to the line, validates claimed work, celebrates wins. Reviews the team on a laptop at the club — desktop view matters for them.

P3 — The Prospect (never installs anything). A person met on the road or invited to a club. They scan the coach's QR code and fill their own details on a simple public web form, or the coach types their details. They then receive a wellness report and the coach's portfolio link on WhatsApp. The prospect experience must feel premium — it IS the coach's first impression.

## 4. HOW IT SHOULD WORK — product principles

1. The 30-second rule. Every daily action — capturing a prospect, logging today's work, moving a pipeline stage — must be completable in under 30 seconds, one-handed, standing on a road. If a screen fails this test, redesign it.
2. WhatsApp is the delivery channel. All prospect communication goes out via `wa.me` deep links from the coach's own phone number — free, personal, and trusted. Do NOT integrate the paid WhatsApp Business API in version 1.
3. Offline-first capture. Walk & talk happens where network is weak. Prospect capture and daily logs must work offline and sync when connectivity returns.
4. Built for cheap Androids and slow data. Light bundle, compressed images, skeleton loaders, no heavy animations. Test on a low-end device profile, not a flagship.
5. One codebase, two screens. Responsive design: phone-first layouts that expand into a comfortable desktop dashboard (especially the team tree and target views for uplines).
6. Simple words. "My Team", "My Target", "Today's Work", "New Person". Never SaaS jargon like "CRM", "pipeline analytics", "engagement metrics" in the user-facing UI.
7. Trust-first payments. Trial countdown always visible in settings, reminder notifications before first charge, cancel-anytime in two taps, clear mandate explanation at signup. Money surprises destroy this business permanently.
8. Celebrate progress. Streaks, confetti on target completion, milestone badges. This audience runs on recognition.

## 5. HOW IT SHOULD NOT WORK — hard rules (never violate)

1. NO company names, logos, product names, or trademarks of any direct-selling or nutrition company anywhere — in the app, code, store listing, screenshots, or marketing copy. Growline is a neutral business tool for wellness coaches. This is a legal requirement, not a preference.
2. NO medical claims. Never calculate, estimate, or display cholesterol, blood pressure, muscle mass, sugar levels, or any disease risk from height/weight inputs — it is scientifically impossible and legally dangerous. Permitted calculations only: BMI with category, estimated body fat % (Deurenberg formula), BMR, healthy weight range, daily water intake, daily calorie guidance. Every report carries the line: "Estimates for general wellness only. Not medical advice."
3. NO income promises anywhere in UI copy, notifications, or marketing.
4. Prospect privacy by default. A downline's prospect names and phone numbers are NEVER visible to the upline unless the downline switches sharing ON. Activity counts (how many people spoken to, invited, converted) are always visible upward. This toggle is non-negotiable.
5. NO group chat. Threads are one-way broadcasts with acknowledgments (see F8). Two-way team chatter creates noise and moderation problems — WhatsApp already exists for that.
6. NO screens with more than 6 input fields. Split long flows into steps.
7. NO storing card/bank credentials. All payment data lives with Razorpay.
8. NO building Phase 2 features early. If a request maps to Section 8, park it.

## 6. FEATURE SPEC — PHASE 1 (the MVP)

### F1. Onboarding & Team Tree

* Signup: phone number + OTP. Name, photo, city.
* Join via an upline's referral code → automatically placed in that upline's line. Signup without a code is possible (becomes a root coach).
* My Team screen: visual tree — me at top, my direct line below (level 1), expandable to levels 2 and 3. Each node shows photo, name, and this month's activity summary (logs done, target %).
* Every user gets their own referral code + shareable invite link from day one.

### F2. Walk & Talk Capture (the front door)

* Mode A — Coach enters: one screen: name, phone, age, gender, height, weight. Auto-focus flow, large keys, under 30 seconds.
* Mode B — QR self-fill: every coach has a personal QR code (printable + on-screen). Prospect scans → lands on a clean public web form (no login, no app install) → submits → appears instantly in the coach's pipeline with a notification.
* Both modes work offline (Mode A queues locally; Mode B requires the prospect's network, not the coach's).

### F3. Wellness Report Engine

* On saving a prospect, auto-generate a clean, branded report card (shareable image + PDF): BMI with category, estimated body fat %, BMR, healthy weight range for their height, daily water target, and one encouraging next-step line.
* Report carries the coach's name, photo, phone, and portfolio link — the report itself is a marketing asset for the coach.
* The compliance disclaimer line from Section 5.2 appears on every report.

### F4. One-Tap WhatsApp Send

* "Send on WhatsApp" button → opens `wa.me/<prospect number>` with a pre-filled warm message + report link + portfolio link. Coach presses send in their own WhatsApp. Two taps total.

### F5. Prospect Pipeline

* Stages: Spoken → Interested → Invited → Attended → Member. Swipe or tap to move stages.
* Each prospect has a next-follow-up date. Morning notification: "You have 6 follow-ups today." Overdue follow-ups surface at the top.
* Search + filter by stage. Notes field per prospect.

### F6. Daily Log (the habit engine — this is the heart of the app)

* One screen, designed for evening entry in under 30 seconds: shakes/servings done, new memberships, sessions or parties conducted, invitations given, follow-ups completed, plus an optional one-line note.
* Streak counter for consecutive days logged. Streak milestones celebrated.
* Logs roll up live into the upline's team view — this visibility is the accountability loop that retains users.

### F7. Targets & Validation

* An upline sets a monthly points/volume target for each direct downline. Downline sees a progress bar and updates progress manually.
* "Ask for proof" button: upline requests evidence on any claimed progress → downline attaches photo/video → upline approves or comments. Trust, digitized.
* Level names on progress screens are user-editable labels — never pre-filled with any company's rank names.

### F8. Threads (upline → line broadcasts)

* An upline writes a message — announcement, motivation, technique, video link — and sends it to their line: "direct line only" or "entire line" toggle.
* Downlines see it in a Threads tab + push notification, and tap ✅ acknowledge. Sender sees read and acknowledgment counts.
* Any coach can re-broadcast a received thread to THEIR own line — this is how a message cascades down thousands of people while every sender only ever messages their own people.
* One-way by design. Replies happen on WhatsApp/in person.

### F9. Portfolio — Basic (free, included)

* Public page at `growline.in/<username>`: photo, name, city, short story, "Message me on WhatsApp" button, "Join my club" button.
* This link rides on every wellness report sent (F3/F4).

### F10. Payments & Trial

* 60-day free trial starts at signup. UPI autopay mandate (Razorpay subscriptions) collected during onboarding — mandate amount covers the monthly plan.
* Plans: ₹999/month or ₹9,999/year. The UI visually favors annual ("2 months free").
* Reminder notifications on day 53 and day 58 before the first charge. Cancel-anytime flow inside Settings, two taps, no dark patterns. Failed mandate → 5-day grace with retry, then read-only mode (data preserved, never deleted).
* Promo-code system for club launches: e.g., founding-member codes granting a 90-day trial + locked pricing.

### F11. Privacy Toggle

* Settings switch per Section 5.4: "Share my prospect details with my upline" — OFF by default. Activity numbers always flow upward regardless.

### F12. Admin Panel (Real V internal, web-only)

* Users, teams, clubs/cohorts, subscription status, trial conversion, churn, promo codes, broadcast announcement to all users. Simple tables — this is internal tooling, not a product.

## 7. PREMIUM ADD-ON — PRO PORTFOLIO (paid extra)

Everything in the basic portfolio, plus:

* Transformation gallery: before/after photo pairs with captions, displayed as swipeable cards.
* Impact counter: "47 people transformed" — auto-counts published transformations.
* Testimonial videos: embedded client video testimonials.
* Achievements section: awards, recognitions, milestones with dates.
* 3 premium themes + custom link name (e.g., `growline.in/coachvignesh`).
* Printable QR poster of their portfolio for club walls and events.

Pricing: launch experiment between ₹999/year add-on and ₹1,999 one-time — decide after the pilot cohort. Upsell moment: automatically offered after a coach sends their 10th wellness report (they have momentum and see the value of looking professional).

Build note: architect the basic portfolio (F9) so Pro is a feature-flag upgrade, not a rebuild.

## 8. PHASE 2 — build ONLY after 200 paying users

* Social feed with video posts (internal community).
* Shake-party / event manager: create event, WhatsApp invite blast, RSVP list, post-event follow-up queue.
* Poster & graphics library, auto-branded with the coach's photo and number.
* Team leaderboards (weekly, monthly) with opt-out.
* Kannada / Hindi / Marathi UI localization.
* Club-owner module — bridge to Real V's club management system (cross-sell funnel).
* Advanced team analytics + PDF export for uplines (desktop-focused).

## 9. DESIGN SYSTEM

Colors:

* Primary: Deep Navy `#14213D` (headers, nav, primary surfaces)
* Accent / CTA: Gold `#FCA311` (buttons, progress bars, achievements, streaks)
* Background: White `#FFFFFF`; Cards/surfaces: `#F5F6FA`
* Success: Green `#2E7D32` — used ONLY for positive stats and confirmations, never as a brand color
* Error/alert: `#D32F2F`
* Rationale: navy = trust (money is being auto-debited), gold = achievement (this audience's culture runs on pins, medals, and recognition). Deliberately avoids green — the signature color of major wellness MLM brands and of Real V's own existing branding.

Typography: Inter or Plus Jakarta Sans. Body minimum 16px. Numbers displayed large and bold — numbers are the emotional content of this app.

Components: minimum 48px tap targets, bottom navigation (Home / Prospects / Log / Team / Threads), skeleton loaders, empty states that teach ("No prospects yet — tap + after your next walk").

Tone of copy: respectful, energetic, simple English (Phase 2 adds languages). Celebrate: confetti on target hit, badge on streak milestones.

## 10. TECH STACK (recommendation — dev may swap with written reason)

* Frontend: Next.js (React) responsive PWA + Capacitor wrapper → Android AAB for Play Store. One codebase serves phone, desktop browser, and the public QR forms.
* Backend: Supabase (Postgres + Auth + Storage + Row Level Security) — RLS enforces the privacy toggle at the database level, not just the UI.
* Payments: Razorpay Subscriptions (UPI Autopay mandates, webhooks for charge events).
* Notifications: FCM push + local scheduled reminders (follow-ups, day-53/58 trial alerts).
* Report generation: server-side image rendering (satori or node-canvas) → PNG + PDF stored in Supabase Storage.
* QR: dynamic per-coach QR encoding their public capture URL.
* Hosting: Vercel + Supabase. Target infra cost under ₹5,000/month until 1,000 users.

See DECISIONS.md for any documented deviations from this stack during development.

## 11. DATA MODEL (starting point — extend as needed)

```
users(id, phone, name, photo_url, city, upline_id→users, referral_code,
      plan[trial|monthly|annual|readonly], trial_ends_at, share_prospects bool, created_at)
prospects(id, coach_id→users, name, phone, age, gender, height_cm, weight_kg,
      stage[spoken|interested|invited|attended|member], next_followup_at,
      source[qr|manual], notes, created_at)
reports(id, prospect_id, metrics_json, image_url, pdf_url, sent_at)
daily_logs(id, user_id, log_date, servings, memberships, sessions, invites,
      followups_done, note)  -- unique(user_id, log_date)
targets(id, coach_id, set_by→users, month, target_points, progress_points,
      status[active|achieved|missed])
proofs(id, target_id, media_url, status[pending|approved|rejected], comment)
threads(id, sender_id, scope[direct|all], body, media_url, created_at)
thread_receipts(thread_id, user_id, seen_at, acked_at)
subscriptions(user_id, razorpay_customer_id, razorpay_sub_id, plan, status,
      next_charge_at)
portfolios(user_id, slug, story, is_pro bool, theme, transformations_json,
      testimonials_json, achievements_json)
```

Team tree = `users.upline_id` self-reference. Cap tree rendering at 3 levels deep per screen; deeper levels load on tap.

## 12. WHAT "DONE" LOOKS LIKE (MVP acceptance test)

A coach can: sign up with a referral code on a ₹10,000 Android phone on 4G → capture a prospect via QR in under 30 seconds → send a wellness report on WhatsApp in 2 taps → log today's work in under 30 seconds → see their line's logs update live → receive and acknowledge a thread from their upline → open the same account in a laptop browser and see a comfortable desktop layout → and on day 61, the ₹999 mandate charges automatically with no support ticket.

If any step in that sentence fails, the MVP is not done.

## 13. SUCCESS METRICS (instrument from day 1)

* North star: month-2 paid retention — this number decides the company's future.
* Daily-log completion rate (weekly active loggers ÷ active users).
* Prospects captured per coach per week.
* Report → WhatsApp send rate.
* Trial → paid conversion %, and annual vs monthly mix.
* Thread acknowledgment rate (team engagement health).

## 14. BUILD ORDER — send these phases ONE AT A TIME

After each phase: run it, verify against Section 12 behaviors, fix, THEN send the next phase. Do not refactor completed phases without asking.

1. Phase 1: Project setup, auth (phone OTP), user profiles, referral codes, team tree screen.
2. Phase 2: Prospect capture — manual form + public QR form + offline queue.
3. Phase 3: Wellness report engine + WhatsApp share flow.
4. Phase 4: Pipeline stages + follow-up reminders + notifications.
5. Phase 5: Daily log + streaks + upline team view roll-ups.
6. Phase 6: Targets + proof/validation flow.
7. Phase 7: Threads + re-broadcast + receipts.
8. Phase 8: Portfolio basic + Pro add-on behind feature flag.
9. Phase 9: Razorpay trial/mandate lifecycle + promo codes + admin panel.
10. Phase 10: Polish — onboarding tour, empty states, low-end device testing, Play Store build & listing (brand-neutral screenshots).

Session rules while building: one phase per session; name the files being touched; state what NOT to modify; every new screen must pass the 30-second rule; re-read Section 5 (hard rules) before every phase.
