# Rebuild notes — read this first

Last updated: 2026-07-30 · everything below is **live in production**, except
the one section explicitly marked otherwise.

---

## Loyalty Program — BUILT 2026-08-30, **not deployed yet**

The club's loyalty slide is now a screen: `/loyalty-program`, behind the **TV
PIN** (the same television, and one more PIN is one more PIN to lose). The board
lists the eleven earning rules and the three gift tiers; a button on it opens the
leaderboard, ranked This Month / All Time, with the workings behind every total.

- **Nothing stores a points total.** `lib/loyaltyPoints.ts` recalculates from the
  club's own records every time. A stored total would be a sixth copy of the
  truth, and copies drifting apart is the whole reason this rebuild exists — a
  corrected attendance corrects the leaderboard with nothing to reconcile.
- **Five rules count themselves** (attendance, 100% attendance, couples, guests
  brought in, plan renewals, BTC weigh-ins). **Six are hand-awarded** from
  Admin → Loyalty into `clubs/{clubId}/loyaltyAwards`, soft-deleted on removal.
- `lib/loyaltyProgram.ts` is the slide. Change a point value there and the wall,
  the leaderboard and the admin screen all change together.
- **100% Attendance is only awarded on months that have finished**, and only when
  the range covers the whole month — mid-month a member is on course for it, not
  entitled to it, and a number that can go down is worse than one that arrives
  late.
- **Known gap: "ON Time" is not enforced on UMS Renewal.** Nothing on a payment
  document says whether it was taken before the plan expired, so a late renewal
  still scores its ten. The admin screen has a negative *manual adjustment* for
  taking those back. Recording the expiry-at-renewal in `lib/sellPlan.ts` would
  close it properly — deliberately not done here, because that is a money path.
- **No Firestore rules or indexes were changed.** `loyaltyAwards` is covered by
  the existing `clubs/{clubId}/{subcollection}` catch-all, and the queries reuse
  the deployed `attendance` collection-group index.
- **Still to do before this is live:** deploy the build, and add the footer
  button to each club's *published* landing page. `public/landing-template.html`
  has it, but the live page is the copy in Storage — re-publish it, or paste the
  button into Super Admin → Club Detail → Landing Page.

---

## Where we got to on 2026-07-30 — pick up here

The owner is walking the app **flow by flow**, deciding what stays. See
**[PATHWAYS.md](./PATHWAYS.md)** for the module map (≈40 pathways, ~12 are the
club's actual day, with a measured count of how many times each is built).

**Settled today:** members *do* use the phone app, so nothing there is cut.
The check-in flow is agreed as: tap a face → a burst over that tile and the
member's name read aloud → **no welcome screen, no next-person screen**. Tap
down a queue of arrivals and hear each name in turn.

**Shipped today** (all deployed and live):

| | |
|---|---|
| Check-in | Burst over the tile instead of navigating; name spoken aloud; the "welcome, but still in the queue" bug fixed at its cause |
| Renewal | Its own block on the reception home, in rose. Member list sorted by who is most overdue → plan picker with search → payment → accountant |
| Credits | Sold **once** — the guard is inside `completePlanPurchase`, so all callers are covered. Plans can now be marked "no shake credits" |
| Order history | Was empty for most members; it was keyed on the auth uid instead of the member document id. `lib/memberKey.ts` is the one answer now |
| Guest deletion | Actually reverses the order, stock and money. Two rival deleters collapsed into `deleteGuestCascade` |
| Voice | `lib/speak.ts` ranks Indian-female-English first; Reception → Settings has a per-tablet override |

**Next in the queue** (owner to choose): walk the **queue** flow (phone order →
arrival) or the **kitchen** flow (token → prepare → serve), the same way.

**Known and deliberately left:** `totalVisits` means two different things — the
TV welcome reads it as lifetime visits, but nothing increments it on a visit
(Add Shake Credits and ManualEntryModal set it to the plan's credit count), so
that TV number is wrong. Scanning a QR card opens the profile rather than
checking in, which is now inconsistent with the rest of this flow.

This file lives in the repo on purpose, so it travels to whatever machine you
work from. Read it before changing anything.

---

## 0. Current direction — CLASSIC FLOW (2026-07-28)

**The club runs the original screens.** `FORCE_CLASSIC = true` in
`src/lib/appVersion.ts` forces every surface to "old" regardless of the club
document or any device override, so a stale setting cannot put a rebuilt screen
in front of staff mid-service. The rebuilt screens stay in the build and are
reachable by their own URLs (`/queue`, `/checkin`, `/renew`, `/sell`, `/guest`)
for testing. Set the flag to `false` to re-enable the switch.

**Defects fixed in the classic flow since then:**

| Symptom | Cause |
|---|---|
| Multiple entries when a face is tapped | `runBypassedCheckIn` had no guard; the screen confirms instantly and writes in the background, so the first tap looked like nothing happened. Now guarded per member for 4s. |
| Renewal charged twice | `completeWithAccountant`'s guard reset in the same tick because the writes are fired not awaited. Credits are absolute so the member looked fine — only the report showed it. Guard now releases when the write settles. |
| Reception slows then hangs | Live listener held every member's full doc including a 128-number face descriptor; each check-in re-delivered all ~200. Face data stripped from state, `hasFace` flag used for the badges, descriptor fetched per verification. |
| Screen jumping back on its own | 28 `setTimeout` and no `clearTimeout`. Navigation timers now tracked and cleared. |
| Staff losing credits at month roll | Auto-credit wrote `25` absolutely. Now tops up to 25, never reduces. |
| Face never matches for some members | Enrolment stored the AVERAGE of 3 captures — the mean of three poses can resemble none of them. All three are now stored and matching takes the closest; old averaged records still work. |
| Today's Report vs Reports differ by a stray amount | Today's Report counted soft-deleted payments. Now filtered. |
| "Shakes Served" ahead of reality | Reports counted pending orders as served. Now served only, with pending shown separately. |
| "Products ₹2,700" next to "0 units sold" | Reception cart wrote only the money — no `productSales`, no stock movement. Both now written in the same batch. |
| Says welcome, shows the summary, member **stays in the queue** | `completePendingCheckin` did an unguarded `batch.update` on `todaysSpecial`. A batch update against a **deleted** document rejects the WHOLE batch — so no credit came off, no kitchen order was made and the queue card was never marked done, while the screen had already moved on because the writes run in the background. Trigger: the midnight reset clearing a special someone had pre-ordered, or the menu being edited during service. Each special is now checked with `getDoc` first, matching `lib/checkinOrder.ts`. |
| A failed check-in looked identical to a good one | Both write paths swallowed the error — the background one into a bare `console.error`, the face one into an empty `catch {}` that left the receptionist on the camera screen. Both now clear the duplicate-tap guard and show a red "Not saved — tap again" burst. A pre-order rejected for no credits says so too, instead of showing a welcome. |
| Welcome/summary screen after every check-in | Replaced with a pop-and-fade burst over the member's own tile (`checkInBurst`). The grid never leaves, so twenty arrivals are twenty taps — no dismissing a screen between each. The token appears on the burst when the server allocates it. |

**Still open in the classic flow** — re-verified against the code 2026-07-30,
two earlier entries here were wrong and are corrected:

- ~~Member order history empty~~ **FIXED 2026-07-30.** It was never a missing
  index — the `orders` collection-group index is declared **and deployed**. The
  member app was keying on `firebaseUser.uid` while everything is recorded
  against the member **document id**. Those match only for members who signed
  themselves up (`Join.tsx` creates the doc *at* the uid); members the club
  created (`hooks/owner/useMembers.ts:88` uses `addDoc`) got a random id, so
  every uid-keyed query matched nothing. `src/lib/memberKey.ts` →
  `useMyMemberId()` is now the one answer to "which member is logged in", used
  by `useOrders`, `MemberOrdersPage`, `TodaysMenuPage` (which was also
  *writing* orders under the uid) and `useMembership` (whose renewal writes
  threw "No document to update" for those same members).
- **Two volunteer registers, not four shapes.** Reception and `VolunteersPage`
  agree — `volunteerAttendance` with `loginTime`/`logoutTime`/`totalMinutes`.
  But a *second* record exists: `attendance` docs with `type: "volunteer"`,
  written by `hooks/useAttendance.ts` and the parked Magician, and read by
  `VolunteerGrid`, `useReports` and four places in `useAttendance`. Reception
  sign-ins are invisible to those readers and vice versa.
- ~~Guest deletion leaves the order, stock and money~~ **FIXED 2026-07-30.**
  There were *two* guest deleters that disagreed: `useDeleteGuestEntry` (Today's
  Report) hard-deleted the entry, its payment and its inventory logs, leaving no
  audit trail; `deleteGuestCascade` (Reports) soft-deleted the entry alone and
  left the kitchen order, the stock and the revenue standing. `deleteGuestCascade`
  is now the single pipe and reverses all of it — orders cancelled, limited
  specials and menu/inventory stock returned with a reversal log, payment
  soft-deleted, entry soft-deleted, audit written. It handles the legacy
  single-item entry shape (`orderId` / `itemType`) that the old hook knew about.
  Also: **nothing filtered `deleted` on guest entries**, so the soft-delete was
  invisible — the guest stayed in the list and the counts. Filtered now in both
  `useGuestEntries` readers and the Reports range query.
- **First-Day two-shake limit is beatable.** `blocked` reads client state filled
  while the phone was typed, so two tablets both see zero. Worse, `firstDay:
  true` is a *second* write after the entry is created — if it fails the entry
  never counts at all. It also counts soft-deleted entries, so a deleted mistake
  blocks a genuine person.
- **Enquiry conversion sets opposite flags.** One at a time (`Enquiries.tsx:78`)
  writes `isActiveMember: false` + the chosen `memberType`; select-many
  (`:313`) writes `isActiveMember: true` + `memberType: "permanent"`.

## 1. Why the rebuild exists

The app grew for three months by verbal change requests from several people at
once, with no written scope. The result was not bad logic — it was the **same
job done five different ways**, with the copies drifting apart. That is what
produced every "it works here but not there" complaint:

- The club manager reported the app disagreeing with the paper attendance
  register. **He was right, and the causes were real code defects** (below).
- Renewing a plan worked at one screen and left the member showing "Expired" at
  another.
- One shake sometimes took two credits.
- Cash was collected and reports showed ₹0.

A full read-only audit was done first (388 files, ~102k lines). The rule adopted
from it:

> **Any number of doors, exactly one pipe.**
> Several screens may start an action. Exactly one piece of code may write it.

---

## 2. Decisions already locked — do not re-litigate without asking

| Decision | Detail |
|---|---|
| **Credits only, no wallet** | Existing balances spend down to zero; no new top-ups. The Wallet tab is deliberately still in the member menu so people can spend what they already have — removing it would hide their own money. |
| **Face recognition removed** | Kept photos, dropped matching. It caused a 6.8 MB download on every cold start, leaked cameras and timers, and some members could never be matched. The Android APKs never had camera permission at all. |
| **Voice assistant (Magician) parked** | Code kept, not promoted. |
| **Accountant approval removed** | It was never used and the face check behind it had been dead code for months. |
| **QR card is the identity** | Permanent per-member card. Encodes `MNC:<memberDocId>` — the **document id**, not the human `memberId`, because the human one is editable in the admin form and would break every printed card. |
| **Two scans** | Entry: mark present. Serving: hand over. The serving scan records *who served whom, when* — that ends the "I did / you didn't" argument and protects staff as much as it checks them. |
| **Credit deducted at serving, not ordering** | So an uncollected order costs the member nothing. |
| **Theme** | Dark: near-black ground, cream text, teal accent, brass detail, serif headings. Green-and-orange was explicitly rejected. |

---

## 3. How to work on this safely

### Typecheck — the important gotcha

```bash
npm run typecheck     # tsc -p tsconfig.app.json --noEmit
```

**Never use bare `tsc --noEmit`.** The root tsconfig has `files: []` with project
references, so it checks *nothing* and reports success. `vite build` does not
typecheck either, so a bad build ships happily.

**Baseline is 46 errors.** They are pre-existing, benign type-shape looseness
(interfaces missing fields the Firestore docs actually carry). If your number is
46 you added none; if it is higher, you did.

### The version switch — nothing is one-way

Every rebuilt screen ships **switched off**. Four surfaces — kitchen, member,
reception, admin — each Old/New.

- **Club-side:** `Admin → App Version` (`/admin/app-version`). Also has a
  *this-device-only* override, so one tablet can trial the new screens while the
  rest of the club carries on.
- **Super Admin:** `/superadmin/app-versions` — every club, remotely.
- Both write `appVersions.<surface>` on the club doc, so they can never disagree.
- Reading the club doc fails → stays on **old**. It fails safe.
- `/reception?classic=1` always forces the old reception screen regardless.

### The PWA cache will fool you

The app caches itself. After deploying, a device keeps running the old code
until forced. **Hard refresh (Ctrl+Shift+R), or close every tab and reopen.**
More than one "nothing changed" report has been this.

### Deploy

```bash
npm run build && npx firebase deploy --only hosting
```

Only hosting has been deployed. **Cloud Functions have never been redeployed** —
see §6.

---

## 4. The shared pipes — use these, do not write new ones

| Pipe | File | What it guarantees |
|---|---|---|
| `recordPayment` / `addPaymentToBatch` | `src/lib/recordPayment.ts` | Every rupee gets a payments doc. Lowercase method (readers compare lowercase — a capitalised `"Cash"` scored **zero revenue**), `cashAmount`+`upiAmount` always written and always summing to the total, `creditsAdded` recorded so a deletion can reverse the credits it granted, and a **local** date. |
| `markMemberAttendance` / `removeMemberAttendance` | `src/lib/attendance.ts` | One record per member per day keyed by the local date, `lastVisit` + `lastVisitAt` always written with it. Idempotent — a second scan refreshes rather than failing. |
| `todayLocal()` | `src/lib/clubDay.ts` | **Never use `toISOString().slice(0,10)` for a club day.** IST is UTC+5:30, so that files everything before 05:30 under yesterday while the reports query the local date. |
| `sellPlan` | `src/lib/sellPlan.ts` | Money + credits + expiry + member record in one batch, credits read live from Firestore. |
| `sellProduct` | `src/lib/sellProduct.ts` | Money + sale record + stock, together. |
| `acceptPendingCheckin` | `src/lib/pendingCheckin.ts` | Credits + kitchen order + token + stock in one batch. |
| `membershipUpdate` | `src/lib/membership.ts` | Writes **both** expiry field names — see §5. |
| `useCardScanner` / `parseCardCode` | `src/lib/qrScan.ts` | Hardware QR readers type the code and press Enter. 2.5 s repeat guard, because they double-fire when a card lingers in the beam. |
| `resolvePreferredShake` | `src/lib/preferredShake.ts` | Member's usual shake per weekday from ~100 days of orders, club favourite as fallback. |
| `useMyMemberId` | `src/lib/memberKey.ts` | Which member is logged in — the **document id**, which is what every record is keyed by. Never use `firebaseUser.uid` as a member id: it only equals the doc id for self-signed-up members. |
| `deleteGuestCascade` | `src/lib/cascadeService.ts` | Deleting a guest also cancels its orders, returns its stock and removes its money. Both delete buttons go through it. |
| Theme | `src/styles/theme.ts` + `.dark` in `src/index.css` | One palette in two syntaxes — hand-styled screens and Tailwind ones cannot drift. |

---

## 5. Landmines still in the codebase

- **Two expiry field names.** `membershipEndDate` and `membershipEnd` both exist
  and different screens read different ones. Every writer now writes **both**.
  Do not "tidy" one away without changing every reader.
- **Reception owns its own copies.** `src/pages/Reception.tsx` is ~8,100 lines
  with ~140 pieces of state and its own check-in/volunteer/couple logic. When
  changing behaviour, grep for *all* copies and edit the one Reception actually
  runs.
- **Volunteers: one collection, four incompatible shapes.** Not yet fixed. The
  voice assistant's volunteer sign-in is invisible to every owner screen.
- **Three member-edit forms.** `owner/Members.tsx` (the one the admin shell
  actually uses), `MemberDetailModal`, `MemberForm`. Fields added to one do not
  appear in the others.
- **Dead files** that look alive: `owner/ReportsPage.tsx`, `ReceptionDisplay.tsx`,
  `member/OrdersPage.tsx`, `member/OrderModal.tsx`. Editing them does nothing.
- **`pages/Volunteers.tsx` renders mock data** and is routed at
  `/staff/attendance`.
- **Old reception has ~1,014 hardcoded colours.** It is being replaced flow by
  flow, so do not retint it — that is throwaway work on the screen the club
  cannot afford broken.

---

## 6. Not done — the honest list

1. **Database rules.** `orders` is world-readable, `landingPages` is
   world-writable, and `canManageClub()` still means "is signed in" — every
   screen writes as an anonymous user, so this cannot be fixed with rules alone;
   it needs **Firebase App Check**. A rules deploy can take the club offline
   mid-service, so do it with someone watching a tablet. Rules roll back in
   seconds.
   **PINs are already handled** — moved to `clubs/{id}/security/pins`, which is
   behind auth. If any club still shows red in Super Admin → App Versions, click
   **Make PINs private**.
2. **Cloud Functions have never been redeployed.** `functions/src/index.ts`
   documents that `resetMemberPassword` — no auth check, resets any account to a
   fixed password — was removed from the code in April but **stays live in
   Firebase until `firebase deploy --only functions` runs**. Push notifications
   and the BTC scheduled jobs are in the code and have therefore never run
   either. Needs the Blaze plan.
3. **Reception:** Today's Report is the 6th page, not rebuilt (the existing one
   works). Virtual members, gift cards and audit entries still live only on the
   old screen.
4. **Volunteers** consolidation.
5. **Preferred shake is displayed, not auto-ordered.** Auto-ordering belongs
   with the rebuilt queue where the credit comes off at serving.

---

## 7. What exists now

**New routes** (no switch needed — these work directly):

```
/queue              orders waiting → Accept / Reject
/checkin            scan or search → mark present
/renew              member → plan → cash/UPI → collect
/sell               item → qty → payment (money + sale + stock together)
/guest              mobile first, live eligibility → complimentary or paid
/admin/today        five numbers + what needs doing
/admin/scan         Scan Station — mark present by card
/admin/serve        Serve Station — hand over by card, records who served
/admin/member-cards print the QR cards (A4 sheet or PVC, with/without photo)
/admin/app-version  the Old/New switch
/superadmin/app-versions   every club's switches + Make PINs private
```

**Fixed at the source:** register mismatch · the 2-credits bug · renewals ·
four silent revenue paths · products vs stock · the guest eligibility race.

---

## 8. If you are an AI assistant picking this up

- Read this file and `git log` before proposing anything.
- Run `npm run typecheck` (not bare `tsc`) and compare against **46**.
- Prefer extending a pipe in §4 over writing a new writer. The whole point of
  this work is that there is exactly one of each.
- Ship new screens behind the version switch, off by default.
- Do not deploy Firestore rules or Cloud Functions without the owner present.
