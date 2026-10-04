# GROWLINE — BUILD PROMPT v2 (Migration + Redesign + Phases 7–10)

🤖 MODEL: Opus for the migration plan and design-system session, Sonnet for feature building, Haiku for boilerplate.
💡 WHY: v2 contains two architecture-level jobs (Firebase migration, Design System 2.0) that deserve deep planning, then feature phases that build on them.

**How to use this document:** Start a FRESH session. Paste the v1 master doc (Sections 1–13 + 15–16) AND this v2 document together. Where they conflict, **v2 wins**. Then send the v2 build sessions (Section 11) one at a time, verifying each before the next.

---

## 1. WHERE WE ARE (context for the AI)

Phases 1–6 of the v1 plan are COMPLETE and working: auth (custom phone-OTP + JWT), profiles, referral codes, 3-level team tree, prospect capture (manual + public QR form with offline queue), wellness report engine (PNG/PDF + public tokenized page + erasure control), two-tap WhatsApp send, 5-stage pipeline with follow-up reminders, Web Push morning notifications, daily log with streaks and upline roll-ups, targets with proof validation. 6 of 8 v1 acceptance steps pass; the two failures are simply unbuilt phases (Threads, payments).

Current stack (to be REPLACED in v2): Next.js 16 + Tailwind 4 frontend (KEEP), Prisma + SQLite database (REPLACE), custom JWT auth (REPLACE), photos as data URLs (REPLACE), Web Push/VAPID (REPLACE), light theme only (REPLACE).

Known debt from the Phase 1–6 review, all addressed in this document: privacy toggle has no Settings UI; Mode A capture records no consent; no retention limit on prospect health data; privacy notice not itemized or translated; report-card fonts fetched from Google at render time with no bold weight; no automated tests; QR submissions don't push in realtime.

---

## 2. PRIORITY ORDER (do NOT reorder)

1. **v2.1 — Firebase migration** (everything else builds on it)
2. **v2.2 — Design System 2.0** (theme layer + reskin of existing screens)
3. **v2.3 — Compliance & debt fixes**
4. **v2.4 — Phase 7: Threads**
5. **v2.5 — Phase 8: Portfolio + Pro**
6. **v2.6 — Phase 9 REVISED: Freemium tiers** (the v1 60-day-trial/mandate-at-signup model is DEAD — see Section 8)
7. **v2.7 — Phase 10: Polish, Android build, Play Store, tests**

Rationale: migrating after building more features multiplies migration cost; reskinning before new features means new features are born in the new design system, never built twice.

---

## 3. FIREBASE MIGRATION SPEC (v2.1)

Target: full Firebase stack. Keep the Next.js app; replace the data/auth/storage/push layers.

- **Auth:** Firebase Authentication with Phone provider replaces custom OTP + JWT. Delete the custom OTP tables/flows after migration. Session via Firebase ID tokens. Migrate existing users by phone number (they re-verify once on next login — acceptable at pilot scale).
- **Database:** Cloud Firestore replaces Prisma/SQLite. Collections mirror the v1 Section 11 model: `users`, `prospects`, `reports`, `dailyLogs`, `targets`, `proofs`, `threads`, `threadReceipts`, `subscriptions`, `portfolios`. Firestore has no joins, so denormalize deliberately:
  - `users`: store `uplineId`, `uplinePath` (ordered array of all ancestor IDs — enables "entire line" queries with a single `array-contains`), `downlineCount`, `directDownlineCount`, `thisMonthActivity` summary map.
  - Counters (team roll-ups, thread ack counts) maintained by Cloud Functions on write, not client-side aggregation.
- **Security Rules (non-negotiable):** the privacy toggle (`users.shareProspects`) is enforced IN RULES, not just app code: an upline can read a downline's `prospects` documents only if that downline's `shareProspects == true`; activity counts and daily logs are always readable up the `uplinePath`. Write rules so a malicious client cannot read what the UI hides. This closes the v1 Section 10 requirement (RLS-equivalent) that the SQLite build could not meet.
- **Storage:** Firebase Storage for profile photos, proof photos AND videos (video proofs are now unblocked), transformation images. Client-side compression before upload (max 1280px, ~80% JPEG), server thumbnails via a resize Cloud Function. Reason: Storage DOWNLOAD egress is the dominant Firebase cost at scale — every gallery view must serve thumbnails, never originals.
- **Push:** FCM replaces Web Push/VAPID entirely — one push system for web now and the Capacitor Android app in v2.7. Morning follow-up reminders move to a Cloud Scheduler function (hourly, per-user local-morning logic preserved from Phase 4).
- **Realtime:** QR form submissions and daily-log roll-ups switch to Firestore listeners — new prospects appear instantly, no refresh (closes a v1 debt item for free).
- **Hosting:** Firebase App Hosting for the Next.js app (one console, one bill). If a blocker appears, Vercel front + Firebase backend is the approved fallback — state the reason in writing.
- **Migration mechanics:** write a one-shot migration script (SQLite → Firestore), run against a copy, verify counts per collection, then cut over. **Parity gate:** after migration, ALL SIX completed phases must pass their original acceptance behaviors before v2.2 begins. Nothing new gets built on an unverified migration.

---

## 4. DESIGN SYSTEM 2.0 — "DARK ACHIEVER" (v2.2)

### Philosophy
The v1 design was clean but ordinary. Growline's users are hustlers chasing income targets — the app must FEEL like winning. Design direction: **dark-first, bold, celebration-heavy, dopamine-mapped** — closer to a modern Indian fintech (CRED-style reward moments, big money numbers) than to a minimal SaaS tool. But every game mechanic must map to a business behavior we need repeated; decoration without behavior is banned ("pointsification" clutter kills products).

### Themes
- **Dark theme is the DEFAULT.** Light theme kept as an option (refined v1 navy/gold), switchable in Settings, respects system preference on first run.
- Dark palette tokens:
  - Background `#0B1020` (near-black navy) · Surface `#131B33` · Elevated card `#1B2547`
  - **Primary: Champagne Gold (metallic, not flat)** — vertical gradient: highlight `#FFE08A` → core `#FFC53D` → depth `#8A5A0A`, plus a 1px top inner highlight line for shine. Buttons, progress, streaks, Leader crest. Text on gold is always deep brown `#412402`.
  - **Money/Success: Green Diamond (translucent gem, not flat fill)** — chip background `rgba(18,183,106,0.14)`, border `rgba(18,183,106,0.45)`, top inner highlight `rgba(255,255,255,0.15)`, value text `#3DDC97`. Used ONLY for money, gains, and target crossings.
  - **Pink Diamond (rare delight)** — translucent chip `rgba(244,114,182,0.14)`, border `rgba(244,114,182,0.45)`, text `#F9A8D4`. Reserved for milestone surprises and limited badges only — never routine UI.
  - **Platinum** — cool metallic gradient `#E8EBF0 → #C3CAD6 → #8E97A8` for Elite-tier surfaces and rare premium chrome; flat `#8E97A8` for secondary strokes and inactive metalwork.
  - **Tier metals ladder:** Starter = Silver · Leader = Gold · Elite = Platinum. Tier badges, pricing cards, and profile crests follow this metal language (mirrors the pin-level status culture this audience lives in).
  - **Jewel restraint rule:** gems and metals are ACCENTS on the near-black base — the 90% rule still governs every screen. Metallic gradients stay subtle 2–3 stop verticals with hairline highlights; no chrome rainbows. Glassy chips use alpha fills + hairline borders, NEVER `backdrop-filter` blur (too heavy for ₹10K Androids).
  - Heat/Alert `#FF4D5E` · Info `#5B8DEF`
  - Text primary `#F4F6FF` · secondary `#9AA6C9`
  - Glow treatment (premium = restraint): soft outer glow ONLY on the active streak flame and the target ring during celebration moments. Primary CTAs get NeoPOP-style layered depth instead of glow (see Premium Craft below). Never glow on body text; never two glows touching.
- Contrast rule: all text meets WCAG AA on its actual background. Neon-on-neon text is banned.

### Typography
- Pairing (CRED-style): a serif display face (e.g., Fraunces) for large headings + Inter/Plus Jakarta Sans for body and UI. **Numbers are the heroes:** money, volume points, streaks, and counts render in an XXL numeric display style (40–64px, bold, tabular figures) with count-up animation on load. Body 16px minimum.

### Premium Craft (what makes CRED and Kotak 811 feel expensive — apply all five)
1. **Restraint = luxury.** Any single screen is ~90% dark surfaces + white text, with ONE accent color doing the talking. Premium apps are nearly monochrome; color is an event, not wallpaper.
2. **Tactile NeoPOP buttons.** Primary CTAs use CRED's open-sourced NeoPOP style — rigid corners, layered plate shadow, physical press-down animation. The React library (github.com/CRED-CLUB/neopop-web) is open source and matches our stack; use it or replicate its button physics.
3. **Serif + sans pairing.** Serif display headings over sans body — the cheapest single move that separates the app from every template on the Play Store.
4. **Soft-3D objects for hero moments.** Onboarding, empty states, badges, and milestone cards use rendered 3D-style objects (trophy, flame, growing tree) — Kotak 811's approachability trick and CRED's isometric object language. Everyday UI icons stay crisp line icons.
5. **The exclusivity register.** Copy and visuals treat membership as a club: "Founding Member" crest, Leader tier badge on the profile, the Weekly Recap framed as a member report. CRED's core psychology is status; this audience runs on recognition — same lever.

Underlying principle (aesthetic-usability effect): people perceive attractive interfaces as easier to use and more trustworthy — the premium look is not decoration, it is conversion.

### Jewel Asset Pack (rendered 3D assets — the richness CSS cannot fake)
The ornate jewel look (metal plaques, 3D diamonds, shining medals) is achieved with PRE-RENDERED image assets, not CSS. CSS builds the cards, buttons, rings, and glass chips; images deliver the jewellery. Required pack, committed to `/assets/jewels/`:

1. **Tier plaques ×3** — engraved rectangular metal plates: STARTER (silver), LEADER (champagne gold), ELITE (platinum). Used on the pricing screen and tier ladder.
2. **Tier medals ×3** — round versions of the same metals, for profile crests and small badges.
3. **Pink Diamond milestone crest** — ornate shield/plaque with a 3D pink diamond; 2–3 variants for major milestones (first member, 50 prospects, first downline team).
4. **Green diamond gem icon** — small cut-gem mark used inside money chips and gain badges.
5. **3D gold streak flame** — the streak hero object at 3 sizes.
6. **Gold trophy** — target-achieved celebration object.
7. **Growing golden tree** — team-growth object for empty states and the team screen.
8. **Blank badge frame** — gold frame for future badges without new renders.

Asset specs: transparent WebP (PNG fallback), @1x and @2x, consistent key light from top-left, rendered against dark so there is NO white fringing, each file under 80KB after compression. Production workflow: AI image generation → background removal → compression → commit. In-app numbers always show ₹ and VP (never $) and stay brand-neutral.

### The Dopamine Map (each mechanic → the behavior it drives)
1. **Streak flame → daily logging.** Animated flame on the log screen and home header; grows subtly at 7/30/100 days. **Streak Shield:** one auto grace-day per month so a single miss doesn't kill motivation — streak forgiveness is the 2026 baseline (Duolingo's freeze redesign cut at-risk churn ~21%). Losing a streak must never feel like punishment from the app; the shield absorbs it once.
2. **Glowing target ring → monthly target progress.** The ring deliberately shows the REMAINING arc (incomplete progress creates the tension that drives completion — Zeigarnik effect). Crossing 25/50/75/100% fires an instant celebration: confetti burst + haptic + count-up. Never delayed — the feedback must be instantaneous to land.
3. **"Today's Mission" card → session direction.** First thing on app open: a personalized 3-item quest generated from their data — e.g., "🔥 Log today to keep your 12-day streak · 📞 6 follow-ups waiting · 🎯 ₹-equivalent: 400 VP to cross 75%." One tap on any item deep-links to the action. This is the recommendation engine of v2 — the app always tells the user the next money-making move.
4. **Pipeline swipe → follow-up completion.** Stage moves get a satisfying snap animation + micro-burst on reaching "Member." Overdue follow-ups pulse gently (urgency without alarm).
5. **Thread acknowledgments → team responsiveness.** Sender watches the ack counter tick up live; downline sees a ripple confirm on tap. Social proof, live.
6. **Weekly Recap card → the brag loop.** Every Sunday evening: an auto-generated shareable card ("Your week: 43 people met · 9 invited · 2 new members · streak 21 🔥") with one-tap share to WhatsApp Status. The user's pride becomes Growline's marketing.
7. **Milestone surprises → long-term retention.** Unannounced badge moments (first prospect, first member, 50 prospects, first downline). Surprise beats schedule — anticipation is where dopamine peaks. **Banned:** slot machines, scratch cards, fake scarcity, purchasable rewards. This is a business tool with game feel, not a casino.

### Trust Zones (where the party stops)
Payment, mandate, cancel-subscription, consent, and privacy screens use the CALM register: flat surfaces, no glow, no animation, plain language, blue-leaning accents. Money-handling screens must feel like a bank, not a game — celebration around earnings, never around charging the user.

### Motion & performance budget
- Micro-interactions 150–250ms; celebrations under 1.5s and skippable by tap.
- Respect `prefers-reduced-motion` (swap animations for static state changes).
- Lottie files under 100KB each; confetti via lightweight canvas; 60fps on a ₹10K Android — test there, not on a flagship.
- No blocking animations: the user can always act mid-celebration.

### Reskin scope in v2.2
Apply the system to ALL existing screens (home, capture, pipeline, report, log, team, targets, settings) + build the theme switcher + ship "Today's Mission" v1 + Weekly Recap v1. New phases (7–10) are then built dark-native. The Jewel Asset Pack is integrated in this phase: tier plaques on pricing, medals on profiles, the 3D flame on the log screen, gems inside money chips.

---

## 5. COMPLIANCE & DEBT FIXES (v2.3)

1. **F11 Privacy toggle UI:** Settings switch "Share my prospect details with my upline" writing `users.shareProspects` (default OFF), enforced by the Security Rules from Section 3. Copy explains exactly what the upline can and cannot see.
2. **Mode A consent:** manual capture requires the coach to tick "This person knows I am saving their details and agrees" before save; the generated report page carries the itemized privacy notice link and the existing erasure control, so the prospect always has a self-serve exit.
3. **Retention limit:** prospect health fields (height, weight, derived metrics) auto-purge after 180 days of prospect inactivity (no stage change, no report view). Cloud Scheduler job; purge logged; contact info survives, health data does not. The 180-day window is a config constant.
4. **Privacy notice:** itemized (what is collected, why, how long, rights, grievance contact) in English + Kannada + Hindi, linked from the QR form, Mode A flow, report pages, and Settings.
5. **Fonts:** commit Noto Sans, Noto Sans Kannada, and Noto Sans Devanagari (regular + bold) as TTFs in the repo; report renderer uses them. No network font fetches at render time. Non-Latin names must render bold and correct on every card.
6. **Prod config:** `NEXT_PUBLIC_SITE_URL` documented and required; link previews verified in production.
7. **Automated tests (minimum bar, runs in CI):** unit — wellness calculations, streak/grace-day logic, tier gates, uplinePath queries; integration — capture → report → WhatsApp link; Security Rules tests — upline CANNOT read prospects when toggle is off (this test is mandatory); e2e — one Playwright happy path from signup to report send.

---

## 6. PHASE 7 — THREADS (v2.4)

Spec unchanged from v1 F8, now built dark-native on Firebase:
- Upline composes text/media message → scope toggle "direct line" or "entire line" (uses `uplinePath` array-contains).
- Delivery: Firestore listener + FCM push. Downline taps ✅ acknowledge (ripple confirm); sender sees live seen/ack counters tick up.
- Re-broadcast: any coach forwards a received thread to THEIR line — one tap, attribution line "via <original sender>".
- One-way by design; no replies, no group chat. Thread list groups by sender; unread state prominent.

---

## 7. PHASE 8 — PORTFOLIO + PRO (v2.5)

Per v1 Section 7 (Pro is bundled with the Leader tier):
- Basic (free): public page `<site>/<username>` — photo, name, city, story, WhatsApp button, join button. Dark, premium, fast.
- Pro (Leader): transformation gallery (before/after pairs as swipeable cards), auto "X people transformed" counter, testimonial video embeds, achievements section, 3 themes, custom slug, printable QR poster.
- All gallery media served as thumbnails/compressed renditions (Section 3 cost rule). Feature-flagged: `portfolio.isPro` flips with tier.

---

## 8. PHASE 9 REVISED — FREEMIUM TIERS & PAYMENTS (v2.6)

**The v1 payment model (60-day trial + autopay mandate at signup) is CANCELLED. Delete any remnants.** Build v1 Section F10 as updated:

- **STARTER — free forever.** All individual features, unlimited prospects, watermarked reports ("Made with Growline" — small, tasteful, on free-tier report cards and basic portfolio). No payment step at signup. No trial timer anywhere.
- **LEADER — ₹999/month or ₹9,999/year** (UI favors annual). Unlocks: set targets, send threads, validate proofs, team analytics dashboard, Pro portfolio, watermark removed.
- **ELITE — ₹2,499/month:** visible on the pricing screen as "coming soon"; not functional.
- **Trigger:** when a user's 2nd direct downline joins via referral code → auto-offer a 30-day free Leader trial (celebration moment: "Your team is growing — Leader tools unlocked for 30 days 🎉"). Razorpay UPI-autopay mandate is collected ONLY at paid conversion.
- Downgrade on cancel/failure → Starter: team features freeze, individual features and all data continue. Never lock a user out of their own business.
- Promo codes for club launches (extended Leader trial + locked founding price). Admin panel: tier dashboard, conversion funnel (Starter → 2-downline-qualified → trial → paid), churn, promo management, broadcast.
- Payment/mandate/cancel screens follow the Trust Zone register (Section 4) — calm, no gamification.

---

## 9. PHASE 10 — POLISH, ANDROID, STORE (v2.7)

- Onboarding tour in the new design (3 screens max: capture · log · grow), skippable.
- Empty states that teach, in the Dark Achiever voice.
- Low-end device pass: test on a ₹8–12K Android profile, 3G throttling; fix jank before shipping.
- Capacitor Android build with FCM, adaptive icons, splash in dark theme.
- Play Store listing: name "Growline: Coach Business App", brand-neutral copy and screenshots (dark theme), privacy policy URL, Data Safety form covering health-adjacent fields, consent and erasure flows.
- Release: internal testing track → pilot club via closed track link → production only after pilot pass bar.

---

## 10. ACCEPTANCE TEST v2 (the one-sentence run)

A coach on a ₹10K Android signs up with a referral code and zero payment steps → sees the dark theme and a Today's Mission card → captures a prospect via QR in under 30 seconds and watches it appear in realtime → sends the wellness report (Kannada name rendered bold and correct) to WhatsApp in two taps → logs today's work in under 30 seconds and the streak flame reacts → their upline sees the roll-up but CANNOT open prospect details while the toggle is off → receives and acknowledges a thread, sender's counter ticks live → their 2nd downline joins and the 30-day Leader trial offer fires → they upgrade on a calm payment screen and the mandate charges cleanly after the trial → and the same account renders a proper desktop layout in a laptop browser, in light theme if chosen.

Any clause failing = v2 not done.

---

## 11. BUILD SESSIONS — send ONE at a time

1. **v2.1a** Firebase project setup + Auth migration + Firestore schema + migration script + parity gate on Phases 1–2 behaviors.
2. **v2.1b** Storage + FCM + Cloud Functions (counters, morning reminders, realtime QR) + Security Rules + rules tests + parity gate on Phases 3–6 behaviors.
3. **v2.2a** Design tokens, theme system (dark default + light), reskin: home, log, targets + streak flame + target ring + celebrations.
4. **v2.2b** Reskin: capture, pipeline, report, team, settings + Today's Mission card + Weekly Recap card.
5. **v2.3** Compliance & debt fixes (Section 5) + CI test suite.
6. **v2.4** Threads.
7. **v2.5** Portfolio + Pro.
8. **v2.6** Tiers + Razorpay + admin.
9. **v2.7** Polish + Android + Play Store prep.

**Session rules:** one session per item; name files to touch; never refactor completed work without asking; every screen passes the 30-second rule and the motion budget; re-read v1 Section 5 hard rules + v2 Trust Zones before every session; after each session run the CI suite and the relevant acceptance clauses.
