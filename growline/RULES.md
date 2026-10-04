# The non-negotiables

One page. Read it before every build session — that is what v2 §11's session rules
ask for, and this exists so it is one file instead of four.

Nothing here is a preference. Each line is either a legal requirement, a privacy
commitment, or a rule that a previous session already broke and fixed.

---

## Legal — these carry real consequences

| # | Rule | Source |
|---|---|---|
| L1 | **No company names, logos, product names or trademarks** of any direct-selling or nutrition company. Anywhere: UI, code, comments, commits, store listing, screenshots. | v1 §5.1 |
| L2 | **No medical claims.** Never cholesterol, blood pressure, muscle mass, sugar, or disease risk. Permitted only: BMI + category, body fat % (Deurenberg), BMR, healthy weight range, water, calorie guidance. | v1 §5.2 |
| L3 | **No clinical category word ever describes a person.** "Below / In / Just above / Above the general range" — never "Obese", "Overweight", "Underweight", "Normal". | D13 · Drugs & Magic Remedies Act 1954 s.3 |
| L4 | **No income promises.** Not in UI, notifications, marketing, or celebration copy. Targets are points — no ₹, no conversion, no projection. | v1 §5.3 · D30 |
| L5 | **Every report carries the disclaimer**, plus the second ASCI line. | v1 §5.2 · D13 |
| L6 | **No reports for under-18s.** Refuse; do not degrade. Verifiable parental consent cannot come from a roadside conversation. | D15 · DPDP Rules 2025 r.10 |
| L7 | **No card or bank credentials stored.** Ever. Razorpay holds all of it. | v1 §5.7 |
| L8 | **Level names: no defaults, no placeholders, no suggestion list.** The only way a rank name appears is a coach typing their own. | v1 §5.1 · D29 |

## Privacy

| # | Rule | Source |
|---|---|---|
| P1 | **`shareProspects` defaults OFF.** Prospect names and phones never reach the upline unless the downline turns it on. Activity *counts* always flow up. | v1 §5.4 |
| P2 | **Enforced in Security Rules, not app code.** A malicious client must not be able to read what the UI hides. This has a mandatory test. | v2 §3, §5.7 |
| P3 | **Report links are bearer credentials.** ~130 bits, 90-day expiry, `noindex`, no referrer, first name only, never the phone. | D17 |
| P4 | **Proof photos are re-encoded** to strip EXIF — a proof must not disclose where a coach lives. | D33 |
| P5 | **Health data purges after 180 days** of prospect inactivity. Contact info survives; height/weight/derived do not. | v2 §5.3 |
| P6 | **Mode A capture requires a consent tick** before save. | v2 §5.2 |

## Product shape

| # | Rule | Source |
|---|---|---|
| S1 | **30-second rule.** Every daily action, one-handed, standing on a road. If a screen fails it, redesign it. | v1 §4.1 |
| S2 | **Max 6 input fields per screen.** Split longer flows. | v1 §5.6 |
| S3 | **No group chat.** Threads are one-way broadcasts with acknowledgments. | v1 §5.5 |
| S4 | **WhatsApp via `wa.me` only.** No paid Business API in v1. | v1 §4.2 |
| S5 | **Offline-first** for prospect capture *and* daily logs. | v1 §4.3 · D28 |
| S6 | **Simple words.** "My Team", "Today's Work", "New Person". Never "CRM", "pipeline analytics", "engagement metrics". | v1 §4.6 |
| S7 | **No Phase 2 features early.** If it maps to v1 §8, park it. **One authorised exception (D74):** F13 leaderboards, F14 qualifications, F20 duplication and the quick wins ship. Everything else in §8 — social feed, event manager, poster library, club-owner module, advanced analytics + PDF — stays parked. The exception is not the rule. | v1 §5.8 · D74 |

## Design (v2.2 onward)

| # | Rule | Source |
|---|---|---|
| G1 | **Trust Zones stay calm.** Payment, mandate, cancel, consent, privacy: flat surfaces, no glow, no animation, no celebration. A bank, not a game. | v2 §4 |
| G2 | **Banned mechanics:** slot machines, scratch cards, fake scarcity, purchasable rewards. Game feel, not a casino. | v2 §4 |
| G3 | **90% rule.** One accent per screen. Colour is an event, not wallpaper. | v2 §4 |
| G4 | **No `backdrop-filter` blur.** Too heavy for a ₹10K Android. | v2 §4 |
| G5 | **Motion budget:** micro 150–250ms, celebrations <1.5s and skippable, respect `prefers-reduced-motion`, never block input. | v2 §4 |
| G6 | **Every mechanic maps to a behaviour** we need repeated. Decoration without behaviour is banned. | v2 §4 |

## Engineering

| # | Rule | Source |
|---|---|---|
| E1 | **Never `new Date()` for a day boundary.** IST is UTC+5:30; go through `day.ts`. This has already broken roll-ups once. | D24 · D26 |
| E2 | **Never import `./db` into anything a `"use client"` file touches** — it pulls the SQLite driver into the browser bundle and the build dies on `Can't resolve 'fs'`. | D25 |
| E3 | **Reports are immutable.** New inputs mint a new report; never rewrite one a prospect may have opened. | D11 · D20 |
| E4 | **Read `node_modules/next/dist/docs/` before writing Next code.** This is Next 16 — `middleware.ts` is `proxy.ts`, and `cookies()`/`headers()`/`params`/`searchParams` are all async. | AGENTS.md · D4 |
| E5 | **One session per §11 item.** Name the files. Never refactor completed work without asking. | v2 §11 |
| E6 | **Write the decision down.** Anything that deviates from spec goes in `DECISIONS.md` with its reasoning — that record is why this file could be written at all. | v1 §10 |
| E7 | **Push after every change, however small** — after each discrete change, not once at the end of a session. Never batch a session's work into one commit. This includes pushing before asking a question. | `HANDOFF.md` §6 |

---

## Before you open a PR or call a session done

- [ ] Grep for company names, rank names, ₹ in target code, income wording (L1, L4, L8)
- [ ] Any new screen timed against the 30-second rule (S1) and under 6 fields (S2)
- [ ] Any new day/date logic goes through `day.ts` (E1)
- [ ] Any new deviation recorded in `DECISIONS.md` (E6)
- [ ] Trust Zone screens carry no celebration (G1)
