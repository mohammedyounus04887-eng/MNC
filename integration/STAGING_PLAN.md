# Isolated Club / GrowLine staging verification

**STAGING READY: NO — AWAITING STAGING BILLING AND REMAINING SERVICE/LEGAL INPUTS.** Isolated staging work is authorized by the master request; production mutation remains prohibited. See STAGING_EXECUTION_STATUS.md for the current discovery and blockers. No staging/production deployment, live Auth assignment, customer-data use or migration was performed. Repositories and Firebase projects remain independent. Preserve all verified ancestors, including Club ae44fac18f4098b5ee64978487969264dbe72a43 and GrowLine 9bf6fc816b9d9156acc60c451410a9c4eca91178.

## Prepared locally

Both repositories have staging-only Firebase configuration, actual staging project IDs in ignored target manifests, ignored local profile paths, offline preflight and 22 guard tests each. Club Hosting rebuilds in Vite staging mode rather than deploying a stale dist. The messaging worker now obtains public configuration from the active build profile and stays inert when configuration is incomplete or emulators are used. The legacy client platform-admin bootstrap was removed; owner/admin UI authorization now uses the verified UID grant, not owner email/PIN/synthetic IDs.

GrowLine has an explicit apphosting.staging.yaml override and requires backend Environment name staging. Its core staging Firebase configuration omits scheduled Functions. Integration handoff, activity, SSO and background jobs are disabled by default; individual coach payments remain disabled. Legal/consent publication awaits approved information. No project IDs, credentials, Auth UIDs or legal details were invented.

Preflight rejects known production/development aliases, demo IDs, identical app projects, mismatched public/server IDs, wrong CLI project, unsafe origins/endpoints, emulator/debug settings and ambient flag overrides. It compares installed Club profiles and GrowLine App Hosting variables/secret references with the reviewed profiles. It refuses SSO activation in ordinary phases; the separate sso-verification phase requires an explicit approval reference and dedicated peer/secret configuration. It does not contact Firebase or prove IAM, live index readiness, authorized domains or provider setup. Never use a legacy deploy script/default alias to bypass it.

The historical client credential file was removed without printing its contents. The security owner must assess exposure in Git history and rotate affected real credentials through the approved operational process; no production rotation was attempted.

## Required human inputs

- Two isolated Firebase project IDs: Club staging and GrowLine staging; both distinct from all existing production/development targets and each other. Confirm project numbers/environment tags, owners, billing, registered web apps, locations/buckets, deployer IAM and runtime principals.
- Club HTTPS origin; GrowLine HTTPS origin, App Hosting backend ID/region with Environment name staging; explicit approval of any staging domain/provider changes.
- Staging-only secret-manager credentials and signing key ID; never reuse production keys.
- Approved Club handoff consent text/version, QR capture/privacy consent review, legal contacts and retention policy.
- Actual controlled staging platform-admin, owner/admin, member, coach and negative-test Auth UIDs; verified account-control/ownership references; sanitized Club/workspace fixtures and provider test phone numbers.
- Explicit staging deployment/activation approval, monitoring and rollback operators.
- SSO pairing policy and separate controlled member/coach Auth accounts if SSO is to be included. See SSO_CONTRACT.md: local sign-on is implemented and tested; hosted activation remains disabled and requires the separate approved gate.

## Environment and secret inventory — names only

| Surface | Names |
|---|---|
| Club public browser configuration | VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID |
| Club server non-secrets | INTEGRATION_HANDOFF_ENABLED, CLUB_INTEGRATION_AUDIENCE, GROWLINE_PROJECT_ID, INTEGRATION_ACTIVITY_ENABLED, GROWLINE_ACTIVITY_URL, GROWLINE_INTEGRATION_AUDIENCE, CLUB_GROWLINE_SERVICE_KEY_ID, INTEGRATION_SSO_ENABLED |
| Club server secrets | CLUB_GROWLINE_SERVICE_KEYS, CLUB_LINK_CODE_PEPPER |
| GrowLine browser/build configuration | NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_APP_ID, NEXT_PUBLIC_SITE_URL, DATABASE_URL (Prisma build tooling only) |
| GrowLine core server non-secrets | INTEGRATION_HANDOFF_ENABLED, CLUB_FIREBASE_PROJECT_ID, GROWLINE_CLUB_DESTINATION_URL, GROWLINE_CLUB_REDEEM_URL, GROWLINE_CLUB_REVOKE_URL, GROWLINE_CLUB_DESTINATION_AUDIENCE, GROWLINE_CLUB_SERVICE_KEY_ID, GROWLINE_CLUB_CONSENT_TEXT, GROWLINE_CLUB_CONSENT_VERSION, INTEGRATION_ACTIVITY_ENABLED, GROWLINE_INTEGRATION_AUDIENCE, CLUB_WEB_ORIGIN, INTEGRATION_SSO_ENABLED |
| GrowLine core server secret | GROWLINE_CLUB_SERVICE_KEY |
| Privacy publication | PRIVACY_ENTITY_NAME, PRIVACY_GRIEVANCE_OFFICER, PRIVACY_GRIEVANCE_EMAIL, PRIVACY_POSTAL_ADDRESS, PRIVACY_NOTICE_APPROVED, PRIVACY_NOTICE_VERSION |
| Conditional App Check | NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY, NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER |
| Conditional administrator UI | ADMIN_UIDS (verified staging UIDs only) |
| Conditional web push | NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_SUBJECT; secret VAPID_PRIVATE_KEY; Club VITE_FIREBASE_VAPID_KEY |
| Conditional scheduled jobs | GROWLINE_JOBS_ENABLED, SITE_URL; secret CRON_SECRET on Functions and Next server |
| Offline deployment guard | STAGING_VERIFICATION_PHASE |

GCLOUD_PROJECT / GCP_PROJECT are platform-managed identities and must match the reviewed target. Prefer attached service-account ADC. FIREBASE_SERVICE_ACCOUNT and GOOGLE_APPLICATION_CREDENTIALS are alternative server-only credentials for separately reviewed local staging access, never browser configuration or committed files.

Payment names remain unset: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_MONTHLY, RAZORPAY_PLAN_ANNUAL. They are not required for free individual coaches.

Real staging must have no emulator/debug values: FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST, NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST, NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN. VITE_USE_FIREBASE_EMULATORS remains false; DEMO_MODE remains false. Hosted staging uses normal NODE_ENV=production, not staging. Public Firebase API keys identify registered apps; service keys, peppers and private credentials remain server-only.

Other optional Club build names are VITE_FUNCTIONS_URL, VITE_DEV_CLUB_ID, VITE_CAPACITOR_CLUB_ID, VITE_CAPACITOR_CLUB_DOMAIN, VITE_APP_MODE, VITE_ENABLE_ANALYTICS, VITE_ENABLE_MLM. Use only if the relevant existing dedicated build requires them. BUILD_SHA, COMMIT_SHA, SHORT_SHA and BUILT_AT may be generated build metadata. SESSION_SECRET from the old example is not used by current Firebase sessions.

## Verified Auth UID assignment procedure

1. Create controlled, non-anonymous provider-backed accounts in the isolated staging Auth projects. Configure the necessary providers/test numbers and authorized domains. Firebase Auth configuration is a console/API operation, not a Firestore rules file.
2. A trusted project operator with independently reviewed staging credentials bootstraps superAdmins/{actualStagingPlatformAdminUid} with enabled:true. Never use a browser seed, ordinary owner, email or PIN to establish platform administration.
3. Independently verify the intended owner/admin controls the target account and may administer the staging Club. Record a real verification reference. Use sanitized Club fixtures with explicit status:active; do not copy production PINs or financial records.
4. Signed in as the verified non-anonymous platform admin, call assignVerifiedClubAdministrator in us-central1 with clubId, uid, role (owner/admin) and verificationReference (8–256 characters). It validates the target Auth user and records claims, clubs/{clubId}/authorizations/{uid} and authorizationAudit.
5. Capture auditId, refresh ID token or sign in again, and verify enabled matching UID/Club/role/station:false grant. Exercise owner/admin UI, wrong Club and ordinary-owner platform-operation denial. Legacy synthetic ownerUserId is not inferred as the authenticated owner.
6. Use StationAccess/enrollStation to enroll reception, kitchen and TV separately. Each gets a non-anonymous scoped station identity. Verify workflows and revocation. PINs are private unlock data, never database authorization.
7. Do not assign fake production users or fabricate member Auth identities from canonical handoff records. SSO pairing, if approved, is a separate dual-account verification process.

## Rules and indexes

Deploy each repo's firestore.rules, firestore.indexes.json and storage.rules only to its own staging project. Club rules cover station/member/owner/platform separation, protected PIN/financial state and browser-denied integration records. GrowLine Storage remains denied; server-only integration/federation collections remain browser-denied. Workspace-scoped boards/qualifications require live matching workspace membership; legacy unscoped cache rows are denied/excluded rather than automatically backfilled.

New GrowLine composite indexes are prospects(coachId, workspaceId, createdAt) and integrationLinks(growlineAuthUid, workspaceId, status). Deploy all checked-in indexes and wait until ready. Emulator queries do not prove live composite-index readiness. Review legacy data scope before any separately approved backfill. Owner activity is bounded to 25 coaches/31 days per page and Add-to-Club retries to eight attempts. Job scans fail closed above 10,000 results; assess staging volumes.

## Exact future deployment order — DO NOT EXECUTE WITHOUT APPROVAL

Populate ignored staging/targets.local.json and reviewed profile files in both repos from supplied staging facts. Manifest names: environment, appHostingEnvironment, clubProjectId, growlineProjectId, clubOrigin, growlineOrigin, growlineBackendId. Install Club browser profile as .env.staging.local and Functions profile as functions/.env.<actual Club staging project ID>; do not permit a base .env fallback. Bind secret-manager values separately. Populate GrowLine staging backendId and apphosting.staging.yaml from its reviewed profile.

In each repo's own terminal, read its reviewed manifest:

```powershell
$stageTargets = Get-Content staging/targets.local.json -Raw | ConvertFrom-Json
$clubStageProjectId = $stageTargets.clubProjectId
$growlineStageProjectId = $stageTargets.growlineProjectId
$growlineStageBackendId = $stageTargets.growlineBackendId
node staging/verify.mjs disabled
```

1. Confirm project identities/IAM/providers/domains and preflight in BOTH repos, flags false.
2. Deploy Club staging rules/indexes/Storage from club-app:

```powershell
npx --no-install firebase deploy --config firebase.staging.json --project $clubStageProjectId --only firestore:rules,firestore:indexes,storage
```

3. Deploy GrowLine staging rules/indexes/Storage from growline and wait for indexes:

```powershell
npx --no-install firebase deploy --config firebase.staging.json --project $growlineStageProjectId --only firestore:rules,firestore:indexes,storage
```

4. Build/deploy ONLY Club integration/authorization Functions; exclude unrelated production schedules:

```powershell
npm --prefix functions run build
npx --no-install firebase deploy --config firebase.staging.json --project $clubStageProjectId --only functions:assignVerifiedClubAdministrator,functions:enrollStation,functions:issueGrowlineClubCode,functions:redeemGrowlineClubCode,functions:revokeGrowlineClubLink,functions:growlineHandoff,functions:getGrowlineOwnerActivity,functions:listGrowlineClubLinks,functions:revokeGrowlineOwnerLinkOrCode
```

5. Deploy GrowLine staging server/web and Club staging web from their respective repos:

```powershell
# growline: backend Environment name must be staging
npx --no-install firebase deploy --config firebase.staging.json --project $growlineStageProjectId --only "apphosting:$growlineStageBackendId"
# club-app: hosting predeploy rebuilds with the reviewed staging profile
npx --no-install firebase deploy --config firebase.staging.json --project $clubStageProjectId --only hosting
```

6. Enroll verified staging owners/admins/coaches/stations and sanitized test users. Verify disabled handoff/redemption and unavailable activity produce no new mapping/member/financial writes. Verify Auth, station operations and correct public/worker project configuration.
7. Begin approved staging verification: set handoff flag true in BOTH staging server profiles, supply approved consent configuration, set STAGING_VERIFICATION_PHASE=verification, run BOTH preflights, then redeploy only affected endpoints/server. Issue/redeem a one-time code and run full E2E.
8. Enable activity separately only after peer origin/audience/key configuration and explicit coach opt-in. Keep SSO/jobs disabled. Verify owner aggregates and QR capture.
9. Run rollback drill. Scheduled jobs require the separate JOBS_RUNBOOK approval/dry-run process. SSO requires the separate SSO_CONTRACT activation gates and actual staging Auth; do not enable it from this plan.

No blanket firebase deploy, default alias, legacy production deploy script, production apphosting.yaml-only rollout or automatic production Git-triggered rollout is authorized.

## Staging acceptance cases

| Case | Required result |
|---|---|
| Code/link lifecycle | Scoped verified owner issues bundled GL1 code; 15-minute expiry, rotation, single use, replay, revoke and denied wrong role/Club; redemption stores both actor UIDs/projects and audit |
| New Member | Approved consent + current Member stage + active Club link -> canonical member, durable mapping/operation; no wallet/payment/plan/positive credits/health/notes transfer |
| Existing member | Trusted verified identity or prior mapping resolves one member; unverified entered contact never establishes existing identity; ambiguous match -> MANUAL_REVIEW_REQUIRED |
| Double/concurrent submit | Same key/request replays; changed payload conflicts; parallel same-person operations converge without duplicate member |
| Lost response | Drop reply after destination commit; reconcile exact stored key/request; source succeeds and one canonical member remains |
| Revocation | New operations denied; successful historical result/member/mapping preserved; authenticated status remains readable. Club-side revocation is destination-authoritative; source UI may remain stale until source unlink/refresh |
| Authorization | Anonymous, wrong coach/workspace/Club/project/audience/hash/key, expired or revoked session denied without side effects |
| Privacy | Notes/health/financial/unknown fields rejected; raw integration/federation/PIN state inaccessible to clients; no prospect PII in owner response |
| Owner activity | Explicit name/count opt-in, linked Club, India date boundary, 7/30-day controls, pagination/loading/empty/error/denied states; revoked/disabled/moved coach removed; reported member count clearly labeled |
| QR/walk-in | One GrowLine coach QR preserves coach/workspace and explicit capture consent; health stays GrowLine and QR creates no Club member; Club walk-in needs no GrowLine account |
| Existing Club | Reception check-in/orders/renewal/sales/receipts/guest/wallet; kitchen queue/serve/stock; TV display; member credits/profile/attendance; owner reports/inventory/plans and platform separation |
| Existing GrowLine | Email login, referral/workspace, manual/offline capture if executable, report/privacy, pipeline/follow-ups, notes/logs/team/targets/threads/boards/recognition/pages/admin and sharing-off baseline |
| Retention/jobs | Dry-run, exact thresholds, current workspace, partial batches/retries, no unrelated deletion, unknown push-delivery review |
| OTP | Approved staging provider/test-number/domain/App Check configuration; UI success/errors and email fallback. AWAITING STAGING AUTH CONFIG until actual execution |
| Rollback | Both flags false; preserve IDs/history; restore safe artifacts/config; station/workspace/privacy denied cases remain correct; controlled pending replay recovery |

Local evidence is documented in MASTER_VERIFICATION.md and is not a live staging result. Hosted CI, real SMS, IAM, live indexes, actual browser SSO and production readiness remain unverified.

## Production approval gate

Require critical CI tests green, full staging E2E/rollback, station operations, owner privacy, QR, provider/Auth and indexes, approved consent/legal/retention text, verified production project ownership/UID assignments, approved secret-manager setup, reviewed rules/jobs/legacy data, monitoring/rollback owners and backups. If SSO is included, finish and verify its login/logout/epoch behavior first. Record immutable app/Functions/rules artifacts and explicit human production release approval. No production deployment or irreversible migration is authorized.

See ROLLBACK_PLAN.md, JOBS_RUNBOOK.md, SSO_CONTRACT.md and MASTER_VERIFICATION.md. App Hosting [environment overrides](https://firebase.google.com/docs/app-hosting/multiple-environments) require the backend Environment name; [local deployment](https://firebase.google.com/docs/app-hosting/alt-deploy) uses the explicit backend; [rollback](https://firebase.google.com/docs/app-hosting/rollouts) restores the selected artifact's environment too.

## SSO local completion addendum

The approved fresh dual-account policy is now implemented locally. See SSO_CONTRACT.md / SSO_VERIFICATION.md for broker, pairing, logout/session epochs, dedicated secret names, additional indexes/TTL, separate sso-verification preflight and exact future acceptance steps. All checked-in hosted flags remain false. Earlier verification rows remain historical evidence and are not silently relabeled as rerun.
