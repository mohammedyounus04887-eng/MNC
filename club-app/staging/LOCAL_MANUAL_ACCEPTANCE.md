# Local full product acceptance — 2026-10-02

The apps and emulators are running on loopback only. No staging/production access or billing setup was performed during this acceptance run. Use **127.0.0.1**, not localhost. A READY demo means services/fixtures are available for manual acceptance; it is not a claim that every browser action has passed.

## Logins and isolation

All invented local accounts use **LocalDemo-Only-2026!**. These credentials belong only to demo-club-security / demo-growline-local.

| Surface | URL | Local login |
|---|---|---|
| Reception | http://127.0.0.1:5173/checkin | Enroll with owner@local.example.test |
| Kitchen | http://127.0.0.1:5173/kitchen | Enroll with owner@local.example.test |
| TV | http://127.0.0.1:5173/tv?clubId=dev_club | Enroll with owner@local.example.test |
| Owner | http://127.0.0.1:5173/login | owner@local.example.test |
| Member | http://127.0.0.1:5173/member/login | member@local.example.test |
| Platform admin | http://127.0.0.1:5173/superadmin/login | platform@local.example.test |
| GrowLine primary coach | http://127.0.0.1:3000/login | coach@local.example.test |
| GrowLine verification coach | http://127.0.0.1:3000/login | verifycoach@local.example.test |
| Fresh Club pairing member | http://127.0.0.1:5173/member/login | pairmember@local.example.test |

Use separate browser profiles for Club owner, member, reception, kitchen and TV. Firebase Auth storage is shared by tabs on the same origin; station enrollment replaces that profile's owner session with a station identity. An ordinary incognito session may share storage with other incognito windows. Dedicated browser profiles are preferable. Enroll each station through its UI; it creates a separate principal, not a shared password/PIN role account.

Club: dev_club / Local Demo Club. Primary workspace: demo_workspace; verification workspace: demo_verify_workspace. Primary coach starts unlinked for your fresh enrollment flow. Verification coach has an active Club link and a paired normal Club member; it has already completed a separate HTTP handoff. The fresh pairing member is unpaired.

## 1. Reception

1. Open /checkin in its dedicated profile, enter the owner's credentials and click **Enroll this device**. You should see the Club's check-in screen.
2. Search **Demo Normal Member**, select the member and check in. Expect today's attendance and a success message; repeat should report/reuse today's attendance rather than create another day record.
3. Open /queue for pending orders, /guest for **Guest & First Day**. Enter an invented name and phone (for example Demo Walk-in, 9999008001), choose Demo Vanilla Shake and the free guest path where offered. This is a Club-only walk-in; GrowLine is not required.
4. Open /reception?classic=1 to inspect the existing reception screen and member status/plan/credits. Normal member was explicitly seeded with Demo 10 Visits and 10 credits, separate from handoff-created members.
5. /renew and /sell expose renewal/product-sale forms; use synthetic data only. Reception must not gain owner-only financial writes. A permission error must not be treated as successful payment or renewal. Legacy composite payment flows may be unavailable under station privileges; perform owner-authorized financial actions through the owner profile instead. Do not weaken rules.
6. A station opening /owner or /superadmin must not gain owner/platform access. Wallet authorization denial is a required negative case; printable receipts require a supported authorized completion and local printer/browser support.

## 2. Kitchen and TV

1. Open /kitchen in another profile; enroll with owner credentials. Pending/preparing demo tokens **901 / 902** should be available for today's synthetic orders.
2. Select a pending order, use the available prepare action, then serve. Expect pending → preparing → served and queue changes. Keep TV open in a separate enrolled TV profile to watch display updates.
3. Inspect Demo Vanilla Shake and Demo Snack as today's menu. Stock changes may be tested only where the assigned kitchen role supports them.
4. Kitchen must not access owner payments/admin operations. TV should show Club-specific public display data and have no operational write controls or privileged writes. Celebration/history views may be empty until appropriate synthetic activity exists.

## 3. Owner / admin

1. Sign in at /login; visit /owner/dashboard, /owner/members and Demo Normal Member's profile. Inspect /owner/attendance, /owner/membership-plans, /owner/billing, /owner/billing-reports, /owner/inventory, /owner/announcements and /owner/downline.
2. Open /owner/settings → GrowLine. Click **Issue one-time link code** and copy the complete GL1 bundle immediately. It expires and can be redeemed only once.
3. Review linked coaches/revoked links. Verification coach is an existing separate test relationship. Primary coach appears after you complete redemption below.
4. Dashboard coach activity uses approved aggregate fields only. Verification coach has opted in; synthetic daily-log membership count is 2. Private notes, names/phones of prospects, health and body composition must not appear.
5. Expense/report subareas may have no transactions; inspect existing navigation without assuming seeded financial history or live payment processing.

## 4. GrowLine capture and pipeline

1. Sign in with primary coach. Inspect Home/dashboard, prospects, pipeline, follow-up, notes, daily log, team/targets and Settings. These use synthetic demo_workspace.
2. Open **Demo New Prospect** (spoken); edit a follow-up/note and advance through the available pipeline stages. Expect changes to persist on refresh.
3. **Demo Fresh Member Ready** is already Member for a clean Add-to-Club test. **Demo Revocation Test** is reserved for a new handoff after link revocation.
4. Use invented contacts only. Entered contact equality is not verification and cannot authorize identity matching.

## 5. One QR

1. In coach sharing/public-page controls, inspect the QR for http://127.0.0.1:3000/c/DEMOAA. The exact URL can be opened directly on this computer.
2. Enter a unique invented name/10-digit phone, check consent and submit once. Expect capture confirmation and a new prospect attributed to primary coach/demo_workspace.
3. Refresh GrowLine prospects. Confirm the person exists there, with no automatic Club membership, wallet, payment, plan or credits. QR capture is not a Club login/link code.
4. A physical phone cannot reach this computer through its own 127.0.0.1. LAN/mobile routing is intentionally not configured in this loopback run.

## 6. Add-to-Club and revocation

1. Owner issues a fresh code. Primary coach → Settings → Link Club; paste the full bundle and confirm. Expect an active Local Demo Club relationship.
2. Open Demo Fresh Member Ready. Click **Add to Club**, explicitly accept the displayed synthetic handoff consent, choose the active Club if prompted and submit.
3. Expect successful canonical Club member ID and durable Added-to-Club status. Owner → Members should show this person. Refresh/retry/double submit must retain the canonical member rather than create another one.
4. Inspect the new member: zero/no paid entitlements, no automatically created wallet/payment/plan/credits, and no source notes/health transferred. The normal demo member's seeded wallet/plan is unrelated.
5. After other flows are finished, revoke the primary relationship in Settings/owner integration controls. Attempt Add-to-Club on Demo Revocation Test: expect rejection. Historical successful handoff should remain visible/reconcilable.
6. Verified unique matching and ambiguous matching are server-boundary cases. Demo Verified Existing Member (+919999004001) and two Demo Ambiguous Members (+919999004002) are synthetic verified destination fixtures. The current browser handoff deliberately marks typed contacts unverified; it cannot prove an existing-member identity. Do not pretend that entering a matching phone verifies it. Actual verified-match/manual-review, lost-response and concurrency cases are covered by the handoff-state emulator suite.

## 7. Owner aggregate activity

1. After primary linking, GrowLine Settings → enable the explicit aggregate activity-sharing option. Enter/update a synthetic daily log.
2. Owner dashboard → GrowLine activity → Today/7/30-day window. Expect only opted-in coach display identities, log/prospect/conversion counts and bounded time windows.
3. Disable the coach's sharing and refresh the owner view; that row should disappear. Private prospect details must never be available from this aggregate response.
4. Existing verification coach is opted in and provides an immediate non-empty aggregate demo. Its conversions are self-reported daily-log counts, not independently verified enrollments.

## 8. Local SSO

Fresh manual pairing:

1. Complete primary Club linking first. Sign in as primary coach in GrowLine and **pairmember@local.example.test** in a separate Club member profile.
2. Open http://127.0.0.1:3000/federation. Click **Check paired account**, re-enter the coach password and **Verify this account**. Select the active Club relationship, check explicit pairing consent, then **Continue pairing in Club**.
3. In Club /federation, re-enter the Club member password and **Verify this account**. Click **Review the GrowLine account to pair**. Check the displayed identities/Club carefully, select explicit confirmation and **Confirm pairing with my verified Club member account**.
4. Return to GrowLine /federation → **Check paired account**. Expect Accounts paired. No owner/admin/station privilege is granted.
5. In the destination app's /federation page click **Sign in with my paired account** and allow its popup. In the source popup check pairing status and **Confirm sign-in to the other app**. Destination should establish its own session. Repeat in the opposite direction.
6. Logout, freshly authenticate and retry; the old exchange/session must be invalid. Check explicit consent and **Unlink accounts**, then verify future switch requests fail and historical audit remains.

Immediate switch demo: use verification coach in GrowLine and normal member in Club; those synthetic accounts are already paired through fresh provider auth, identity review and audited confirmation. Keep primary coach/fresh pairing member for the full manual pairing flow. Unlink/revocation is destructive only to that synthetic pairing; perform it last.

## Member, limitations and evidence

Normal member can inspect dashboard, check-in, menu, orders, wallet (explicitly seeded 100 Demo Coins), profile/card, progress, announcements and network/tree where enabled. Progress/network/expenses may be empty; no fake history is invented. MLM is disabled in this demo profile. Physical camera, face-recognition, thermal-printer, mobile QR scans, live SMS/payment/push delivery and hosted jobs are not acceptance passes here. OTP is emulator-only and does not send real SMS; see GrowLine Auth emulator UI for generated verification codes.

Browser-control tooling failed to initialize in this environment. Pages were checked over HTTP; automated service/security checks are distinct from your visual click-through acceptance. Record any failing screen/action instead of assuming that HTTP 200 proves its workflow.

Confirmed this run: Club units 138/138; Club typecheck passed; station workflow rules 6/6; actual reception/kitchen/TV enrollments/custom-token sign-ins; GrowLine native readiness 15/15; focused contract tests 4/4; cross-app SSO 21/21; actual HTTP handoff boundary 27/27; handoff-state emulator tests 6/6. Owner aggregate HTTP succeeded with approved fields only. Public QR capture succeeded with correct coach/workspace attribution and no Club member creation. No original broken tsx runner retry.

## Safe stop

~~~powershell
pwsh -NoProfile -File C:\Projects\Club-GrowLine\integration\local-demo\stop.ps1
~~~

This validates launcher identity/start time and stops only recorded demo process trees. Emulators are in-memory; a restart requires the local seed again. Do not kill arbitrary port owners. Background jobs/push triggers are disabled; staging profiles remain disabled and untouched.
