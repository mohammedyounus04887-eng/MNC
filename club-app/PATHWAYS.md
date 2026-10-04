# Pathways — every module in the app, and how many times each is built

Generated 2026-07-30 by scanning all 419 source files for Firestore **writes**,
then grouping them by what they actually do.

**How to read the "pipes" column.** A pathway is one job — "add credits", "order
a shake". A *door* is a screen that can start it. A *pipe* is a piece of code
that writes it. Doors are fine; the club needs many. **Pipes above 1 are the
problem** — that is the same job written more than once, and the copies drift.

Counts are files that write the relevant collection or field. They are evidence,
not opinion: `pipes: 19` means nineteen different files can change a member's
shake credits.

---

## The surfaces (where the doors live)

| Surface | Route | Pages | Notes |
|---|---|---|---|
| Reception | `/reception` | 1 file, 20 internal screens | 8,811 lines, 156 state variables — the desk |
| Reception (rebuilt) | `/queue` `/checkin` `/renew` `/sell` `/guest` | 7 | built, currently bypassed by `FORCE_CLASSIC` |
| Member app | `/member/*` | 18 | members do use this |
| Admin | `/admin/*` | 40 | 24 menu items |
| Kitchen | `/kitchen` | 1 | 1,618 lines |
| TV | `/tv` | 1 | 1,721 lines |
| Super Admin | `/superadmin/*` | 14 | platform, not the club |
| Public | `/join` `/leave-review` `/card` | 3 | |
| Standalone | `/btc` `/btc-winners` `/inventory` `/staff/*` | 5 | |

**105 pages total.**

---

## A · Identity and presence — the club's daily core

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 1 | **Identify a person** (face match, QR card, name search, PIN) | Reception, Kitchen, Admin scan, member card | **18 files carry face code** | Face matching was dropped by decision but the code is still everywhere |
| 2 | **Mark attendance / check in** | Reception, member app, Admin scan, TV, Magician | **13** | `lib/attendance.ts` is the agreed pipe; Reception and others still bypass it |
| 3 | **Volunteer sign-in / sign-out** | Reception, Admin, Magician | **2 registers** | `volunteerAttendance` *and* `attendance` docs with `type:"volunteer"` — neither is complete |

## B · Shakes

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 4 | **Pre-order a shake** (member phone → queue) | Member app (2 home screens) | **4** | `lib/pendingCheckin.ts` is the agreed pipe |
| 5 | **Create a shake order** | Reception, member app, kitchen, guest, Magician, reports edit | **13** | the single most duplicated job in the app |
| 6 | **Serve a shake** | Kitchen, Admin serve station | 2 | |
| 7 | **Today's special / menu** | Admin menu, Reception, Magician, schedule | **7 + 6** | two collections, `todaysSpecial` and `menu`, both live |

## C · Money

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 8 | **Take a payment** | Reception, guest, products, plans, Magician, reports edit | **11** | `lib/recordPayment.ts` is the agreed pipe |
| 9 | **Add shake credits** | Reception, plan sale, admin member edit, super admin, bulk import, Join, Magician, kitchen, purchase requests | **19** | the one you named — worst in the app |
| 10 | **Wallet balance** | member app, admin wallet, Reception, cascade | **8** | being retired; balances spend down |
| 11 | **Sell / renew a plan** | Reception, admin, member app | **4** | `lib/sellPlan.ts` + `lib/membership.ts` agreed; two expiry field names still exist |
| 12 | **Sell a product** | Reception, admin, guest, Magician | **7** | `lib/sellProduct.ts` agreed |
| 13 | **Expenses** | Admin reports | 2 | |
| 14 | **Edit / delete a past record** | Reports, Today's Report | 2 | `lib/cascadeService.ts` + `lib/reportEdits.ts` |

## D · Stock

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 15 | **Inventory** | Admin, Reception, kitchen, kiosk | **6 parallel systems** | `useInventory`, `useInventoryV2`, `useInventoryManagement`, `useKitchenInventory`, `useUnifiedInventory`, `useSimpleInventory` — all six are imported somewhere |
| 16 | **Stock movement log** | everywhere stock moves | **8** | |
| 17 | **Kitchen stock / recipes / requests / returns / handover** | Kitchen | ~5 collections | largely unused? needs your answer |
| 18 | **Purchase & upgrade requests** | Reception, super admin | 2 | |

## E · People

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 19 | **The member record itself** | everywhere | **39 files write `members`** | every pathway ends up here |
| 20 | **Register a member** | Join page, admin, Reception, enquiry convert | **4** | Join creates the doc *at* the auth uid, admin uses a random id — the split behind the order-history bug |
| 21 | **Edit a member** | admin Members, MemberDetailModal, MemberForm | **3 forms** | a field added to one does not appear in the others |
| 22 | **Enquiry → member** | admin Enquiries (single + bulk) | **2, and they disagree** | opposite `isActiveMember` flags |
| 23 | **Couple accounts** | Reception, admin | 2 | |
| 24 | **Virtual members / virtual numbers** | Reception, admin | 2 | |
| 25 | **Club network / downline / referrals** | admin, member app, super admin | ~4 | |

## F · Guests

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 26 | **Guest entry** | Reception, guest page, Magician, gift cards | **6** | |
| 27 | **First-day free shake** | Reception | 1 | 2-shake limit is beatable |

## G · Reporting

| # | Pathway | Doors | Pipes | State |
|---|---|---|---|---|
| 28 | **Today's report** | Admin, Reception drawer | 2 | |
| 29 | **Reports day / month / year** | Admin | 1 | 3,293 lines |
| 30 | **Attendance register** | Admin | 1 | 1,015 lines |
| 31 | **Audit log / data check** | Admin | 1 | read-only |
| 32 | **Receipts & printing** | Reception, kitchen, admin | 1 | 1,682 lines |

## H · Engagement — candidates to switch off

| # | Pathway | Doors | State |
|---|---|---|---|
| 33 | **BTC challenge** | `/btc`, admin, member app | 1,206-line hook + 1,028-line page + winners screen |
| 34 | **Awards / leaderboard** | admin, member app | |
| 35 | **Announcements** | admin, member app | |
| 36 | **Reviews / feedback** | public, admin, member app | |
| 37 | **Progress / weigh-ins** | member app, admin | |
| 38 | **Preferred shake** | member app, Reception | displayed, never auto-ordered |
| 39 | **Voice assistant (Magician)** | overlay | parked by decision, but **still writes to ~10 collections** |

## I · Platform (super admin — not the club)

| # | Pathway | State |
|---|---|---|
| 40 | Clubs, billing, global menu, app versions, PIN privacy, bulk import | 14 pages |

---

## The count

**≈40 pathways. About 12 of them are the club's actual day.**

The 12: identify · check in · pre-order · order · serve · take payment · add
credits · sell a plan · sell a product · guest entry · stock · the day's numbers.

Everything else is either periodic (reports, member admin), platform (super
admin), or a feature added on request that may never have been used.

## The five worst duplicates, in order

1. **Add credits — 19 pipes.** Nothing guarantees a credit change is recorded,
   reversible, or paired with money.
2. **Create an order — 13 pipes.**
3. **Attendance — 13 pipes**, on top of two incompatible record shapes.
4. **Take a payment — 11 pipes**, `recordPayment` agreed but not enforced.
5. **Inventory — 6 whole systems.**

## What fixing one looks like

Take credits. One pipe — `lib/credits.ts` — that is the only code allowed to
change `shakeCredits`, always writing what changed, why, who did it and the
matching money record. Then the other 18 call it. Reception keeps its button,
the admin keeps its field, the plan sale keeps working — same doors, one pipe.
After that "the credits are wrong" has exactly one place to look.
