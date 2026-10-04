# v2.1a — Firebase migration, part 1

**Status: foundation built and verified against the emulators. Approved on "continue".**

Done: §7 steps 1–4, plus the count check from step 7. Decisions 1–3 are implemented
and recorded as D34–D38 in [DECISIONS.md](./DECISIONS.md).
Not yet done: §7 steps 5–6 — the Auth swap in `session.ts` and porting the 18
`lib/db` call sites. Until those land, the app still runs entirely on Prisma; the
migration writes to Firestore but nothing reads from it.

Scope per [BUILD_PROMPT_V2.md](./BUILD_PROMPT_V2.md) §11.1: Firebase project setup,
Auth migration, Firestore schema, migration script, parity gate on Phases 1–2.

Everything below is grounded in the code as it stands at `c634208`, not in the spec
alone. Where the spec and the code disagree, that is called out rather than smoothed
over.

---

## 1. What this session does NOT touch

Frozen. Not refactored, not reformatted, not "improved while I'm in there":

- All wellness maths — `wellness.ts`, `report-copy.ts`, `report-card.tsx`,
  `report-render.ts`. D12–D18 are law and their reasoning is legal, not stylistic.
- Report token semantics — `report-token.ts`, `report.ts`. D11, D17, D20.
- Day/timezone helpers — `day.ts`, `dates.ts`. D24, D26.
- Streak logic — `daily-log.ts`. D27.
- Any UI/visual change. That is v2.2. Screens keep their current look through the
  whole migration so a parity failure is unambiguously a data bug.

Deleted only at the very end, after cutover verifies: `otp.ts`, the `OtpCode` model,
`/api/auth/request-otp`, `/api/auth/verify-otp`.

---

## 2. The migration surface, measured

`grep -rl "lib/db" src` → **18 files**. That is the whole data-access blast radius:

| Area | Files |
|---|---|
| Auth | `verify-otp`, `complete-signup`, `me`, `session.ts` |
| Prospects | `prospects/route`, `[id]`, `[id]/pipeline`, `[id]/report` |
| Public | `c/[code]`, `join/[code]`, `public/capture/[code]`, `public/report/[token]/remove` |
| Reports | `reports/[token]/sent` |
| Push | `push/subscribe`, `push/unsubscribe`, `notifications/daily` |
| Pages | `(app)/page`, `prospects/page`, `prospects/[id]/page` |

`db.ts` is 15 lines and every query goes through it. The swap point is genuinely
contained, as D1 promised it would be.

---

## 3. Decision 1 — user document IDs (the expensive one)

**The problem.** Every table keys off the user's `cuid` — `coachId`, `userId`,
`setById`, `requestedById`. Firebase Auth normally mints its own `uid` at first
sign-in. Since migrated users re-verify on next login (v2 §3), that uid does not
exist at migration time. So either we re-key every foreign key later, or rules
must translate `authUid → userId` on every single read.

**Recommendation: pre-create the Auth users with `uid` set to the existing `cuid`.**

The Admin SDK's `importUsers()` accepts a `uid` and a `phoneNumber` per record. Run
it during migration, keyed by phone. Then:

- `users/{docId}` where `docId == request.auth.uid == the old cuid`
- Every existing foreign key stays valid, unchanged, forever
- Security Rules become pure `request.auth.uid == ...` comparisons — **zero lookups**
- Users still re-verify by SMS exactly as v2 §3 says; they just land on the same id

The alternative (a `authLinks/{uid} → userId` mapping collection) costs a `get()`
inside *every* rule evaluation on *every* collection. That is a permanent tax on
reads and a permanent source of rule bugs, paid to avoid one script.

**This is the decision I most want confirmed before code is written.** Doc IDs are
the one thing that cannot be changed cheaply afterwards.

---

## 4. Decision 2 — the privacy rule

v2 §3: an upline may read a downline's prospects only if `shareProspects == true`.
`shareProspects` lives on the **user** doc; the rule guards the **prospect** doc.

With Decision 1 in place, one `get()` fetches both fields the rule needs:

```
match /prospects/{id} {
  allow read: if request.auth.uid == resource.data.coachId
           || (get(/databases/$(database)/documents/users/$(resource.data.coachId)).data.shareProspects == true
               && request.auth.uid in get(/databases/$(database)/documents/users/$(resource.data.coachId)).data.uplinePath);
}
```

**Constraint this imposes on the app:** an upline listing prospects must filter on
exactly one `coachId`. Then every document in the result shares one coach, the
`get()` resolves to a single cached lookup, and the per-request lookup cap is never
approached. An upline cannot query prospects across their whole line in one go —
which v2 never asks for, and which privacy argues against anyway.

**Rejected:** copying `shareProspects` onto every prospect doc. Faster and cheaper,
but revocation becomes eventually consistent — flipping the toggle off starts a fan
-out, and until it finishes the stale value still grants access. This control exists
to satisfy DPDP. It does not get an "it'll catch up in a few seconds" window.

The mandatory test from v2 §5.7 (upline CANNOT read when toggle is off) is written
in **v2.1b** against the emulator, alongside the rules themselves.

---

## 5. Decision 3 — a real sequencing conflict in §11

**§11 puts the team tree's parity gate in v2.1a, but the machinery it needs in v2.1b.**

The team tree is v1 Phase 1 (F1), so §11.1 must prove it works. But `buildTeamTree()`
in `team.ts` leans on **four `groupBy` aggregations** to produce `logsThisMonth`,
`loggedToday`, `targetPct` and `directCount`. Firestore has no `groupBy`. v2 §3's
answer is Cloud-Function counters — which §11 schedules for **v2.1b**.

So as written, v2.1a is asked to pass a gate using a mechanism it is not allowed to
build yet.

**Recommendation: denormalize `uplinePath` onto `dailyLogs` and `targets` at write
time, and use Firestore's `count()` aggregation.** No Cloud Functions needed:

- "logs in my line this month" → one `array-contains` query + `count()`
- `loggedToday` → same shape, narrower date range
- `directCount` → `directDownlineCount` on the user doc, written in the same
  transaction as the signup that creates the downline

This gets Phase 1 parity inside v2.1a honestly, and it is not throwaway work — v2.1b's
counters then become a *speed* optimisation for the home screen, not a prerequisite.

`isInDownline()` also gets much better: today it walks up the tree with **one query
per hop, up to 100 hops**. With `uplinePath` it becomes a single array membership
check, in memory.

**Known limitation to write into `DECISIONS.md`:** a log's `uplinePath` is frozen at
write time, so if a coach is later moved in the tree, historical logs keep the old
path. Tree moves are rare at pilot scale and there is no UI for them today. Accepted,
and recorded rather than discovered.

---

## 6. The Firestore schema

Collections per v2 §3. Denormalised fields are marked **[D]** with the reason.

**`users/{uid}`** — id is the Auth uid (Decision 1)
```
phone, name, photoUrl, city, referralCode, levelName
uplineId
uplinePath        [D] ordered ancestor ids — "entire line" in one array-contains
directDownlineCount, downlineCount   [D] Firestore cannot count children
thisMonthActivity {logs, targetPct}  [D] home screen; maintained in v2.1b
shareProspects    (default false — the privacy toggle)
plan, createdAt
```

**`prospects/{id}`** — unchanged fields, plus `coachUplinePath` **[D]**
`(coachId, clientId)` uniqueness (D6, the offline-queue idempotency key) has no
Firestore equivalent, so it moves into the **document id**: `{coachId}__{clientId}`
for queued captures, auto-id for QR self-fills. A replayed sync then hits the same
doc and updates instead of inserting — same guarantee, enforced by the primary key.

**`reports/{id}`** — D20's `unique(prospectId, inputsHash)` gets the same treatment:
doc id becomes `{prospectId}__{inputsHash}`. This is load-bearing — it is what stops
two concurrent renders minting two live 90-day bearer tokens to one person's health
data. `token` stays a separate indexed field for public lookup.

**`dailyLogs/{userId}__{YYYY-MM-DD}`** — the composite id *is* D26's
`unique(userId, logDate)`. Add `uplinePath` **[D]** (Decision 3).

**`targets/{coachId}__{YYYY-MM}`** — same trick for `unique(coachId, month)`.
Add `uplinePath` **[D]**.

**`proofs/{id}`** — unchanged. `mediaUrl` stays a data URL until v2.1b moves it to
Storage; video stays blocked until then (D33).

**`fcmTokens/{token}`** — replaces `push_subscriptions` in v2.1b. Out of scope here.

**Dropped:** `otp_codes` (Firebase Auth owns this now).

**The pattern:** every `@@unique` in the Prisma schema becomes a **deterministic
document id**. Firestore has no unique constraints, and each of those four
constraints is load-bearing for a correctness property someone already reasoned
about (D6, D20, D26, and the target-per-month rule). Doc ids are the only mechanism
Firestore offers that is as strong.

---

## 7. Order of operations

1. `firebase-tools` + emulator config (`firebase.json`, `.firebaserc`) — **no real
   project needed**
2. `src/lib/firebase.ts` (client) and `src/lib/firebase-admin.ts` (server), both
   emulator-aware
3. Schema + converters in `src/lib/collections.ts` — one typed accessor per
   collection, so the 18 call sites change shape once and only once
4. Migration script `scripts/migrate-to-firestore.ts`: SQLite → `importUsers()` →
   Firestore, computing `uplinePath` in a single pass. **Per-collection counts
   printed and asserted**, per v2 §3
5. Auth swap: `session.ts` → Firebase ID tokens; `proxy.ts` cookie check preserved
   (D2's route-protection shape does not change)
6. Port the 18 files, in dependency order: `session` → `me` → auth routes → public
   routes → prospects → pages
7. Parity gate (§8 below)
8. Only then delete the OTP tables and routes

Steps 1–7 all run against the **emulator**. Java and Node 22 are already in the
container; `firebase-tools` installs from npm. A real Firebase project is needed
only for cutover, so the console blockers in `HANDOFF.md` do **not** block this
session — they block finishing it.

---

## 8. Parity gate — Phases 1–2

From v1 §12 and §14. Each one verified against the emulator, and none of them is
"it compiles":

- [x] Signup with a referral code places the user under that upline — **e2e**,
      verified down to `uplinePath` and the upline's counter incrementing
- [x] Referral code generated for every user — e2e
- [x] Team tree renders 3 levels with this month's activity per node — assertions
- [x] `noindex` still set on public capture pages — e2e
- [x] A replayed sync does not duplicate (D6) — assertion on the composite doc id
- [x] Row counts match per collection, migration script output asserted
- [x] An existing migrated coach can log in — e2e, and `shareProspects` stays
      false through a real signup

Still open, and each needs something this container does not have:

- [ ] Signup with **no** code creates a root coach (trivial to add to the e2e)
- [ ] Mode A capture in under 30 seconds — a stopwatch and a real cheap Android
- [x] Offline capture **queues while offline and syncs on reconnect** — e2e,
      with the signal actually cut mid-capture and no duplicate on drain
- [ ] QR self-fill scanned with a real camera (the URL path itself is covered)

---

## 9. What I need from you

1. **Decision 1** — pre-create Auth uids from existing cuids? (My recommendation:
   yes. It is the difference between clean rules forever and a lookup tax forever.)
2. **Decision 3** — resolve the §11 sequencing conflict by denormalising `uplinePath`
   onto logs and targets, keeping the team tree inside v2.1a's gate? (Recommendation:
   yes. The alternative is moving the team tree's gate to v2.1b, which weakens §11's
   "nothing new gets built on an unverified migration".)
3. Confirm the frozen list in §1 is right — particularly that **no visual change**
   happens during migration.

Decision 2 I am confident about and will proceed with unless you say otherwise.
