# Staging execution record — 2026-10-02

**STAGING STATUS: BLOCKED. PRODUCTION RELEASE READY: NO.** Isolated staging provisioning is authorized. Production access/mutation, protected-branch pushes and production deployment remain prohibited.

## Verified staging inventory

| Item | Club | GrowLine |
|---|---|---|
| Project ID | club-growline-club-staging | club-growline-staging |
| Project number | 451754781740 | 452669241471 |
| Registered web app | 1:451754781740:web:93d6b32d0d5888df76f589 | 1:452669241471:web:99c771053716a055fee74a |
| Public browser configuration | Collected from Firebase and installed | Collected from Firebase and installed |
| Application origin | https://club-growline-club-staging.web.app | Unavailable; App Hosting backend not created |
| Billing | billingEnabled:false | billingEnabled:false |
| Default Firestore database | Created; native Standard, us-central1 | Created; native Standard, us-central1 |
| Storage bucket | Not provisioned | Not provisioned |
| Auth initialization | HTTP 400 FAILED_PRECONDITION | HTTP 400 FAILED_PRECONDITION |

Firebase CLI authenticated access and project discovery succeeded. Both projects are ACTIVE, distinct, explicitly designated staging by the user and excluded from known production aliases. No production service was accessed. The GrowLine default static Firebase Hosting site exists, but is not the application's App Hosting backend and was not substituted for its origin.

Only the two specified projects were used for resource setup. Registered both web apps, enabled Firestore and created empty default databases. No customer data, Auth users, member grants, rules/index deployments, Storage deployment, Functions deployment, App Hosting deployment or web deployment occurred. No billing account was attached, runtime IAM broadened or secret value created/exposed. Auth initialization was attempted once per project and failed its service precondition; provider setup remains unresolved, not verified.

## Local configuration and verification

Both ignored staging/targets.local.json manifests now contain the actual project IDs and actual Club origin. GrowLine origin/backend remain blank rather than fabricated. Installed public SDK configuration in Club reviewed/installed browser profiles and GrowLine server profile. Installed the ignored Club functions/.env.club-growline-club-staging from its reviewed profile. Synchronized the tracked GrowLine App Hosting override with actual public configuration and staging-scoped Club endpoints. Those endpoint strings are deployment destinations, not currently reachable deployed APIs.

INTEGRATION_HANDOFF_ENABLED=false, INTEGRATION_ACTIVITY_ENABLED=false, INTEGRATION_SSO_ENABLED=false and GrowLine GROWLINE_JOBS_ENABLED=false remain in effect. Browser SSO is disabled. No invented secret key ID, consent text/version, privacy approval or retention approval was supplied.

Fixed a genuine Club preflight infrastructure defect: existsSync was used without import. Added real subprocess regression coverage for installed Club profiles/base Functions fallback rejection and GrowLine backend mismatch. Validation was not weakened. **Club staging guards: 22/22 passed. GrowLine staging guards: 22/22 passed.** These are local configuration tests, not hosted product acceptance. Previous product/security/SSO results remain preserved in their verification records.

Actual disabled preflight results, exit 1 in both repositories:

- Club: ISOLATED_HTTPS_growlineOrigin_REQUIRED.
- GrowLine: ISOLATED_HTTPS_growlineOrigin_REQUIRED; MISSING_NEXT_PUBLIC_SITE_URL; MISSING_GROWLINE_CLUB_SERVICE_KEY_ID; GROWLINE_STAGING_BACKEND_REQUIRED.

Deployment remains stopped until both preflights exit 0. The uninitialized Storage/Auth and missing runtime secret/signing setup are additional live-service blockers; an offline preflight alone cannot verify those.

## External blockers and exact next human action

1. Attach an approved billing account / enable Blaze on **club-growline-club-staging** and **club-growline-staging**, through their Firebase/Cloud billing consoles. Billing APIs confirmed billingEnabled:false on both. Do not attach production resources or supply billing credentials in chat. Cloud Functions, Cloud Storage and App Hosting require billing-enabled setup; no paid deployment was attempted.
2. Supply approved GROWLINE_CLUB_CONSENT_TEXT, GROWLINE_CLUB_CONSENT_VERSION, PRIVACY_NOTICE_VERSION and approved privacy/retention decisions. Existing 180-day health inactivity and 30-day voice-note defaults are implementation values, not legal approval. No purge or fabricated consent is permitted.
3. Provide accountable release/rollback operators and staging OTP provider/test-number inputs if not obtainable through approved project configuration. Controlled users and ownership/member grants will be created only within these staging projects; no production ownership is inferred from contact equality.

After billing is enabled, resume the existing authorized staging runbook: initialize Auth/providers, Storage and the GrowLine App Hosting backend with environment staging; obtain the actual origin/backend ID; generate staging-only keys directly into Secret Manager; install narrow runtime access/signing grants; synchronize reviewed profiles and App Hosting bindings. Required secret names: Club CLUB_GROWLINE_SERVICE_KEYS, CLUB_LINK_CODE_PEPPER, FEDERATION_SERVICE_KEY; GrowLine GROWLINE_CLUB_SERVICE_KEY, FEDERATION_SERVICE_KEY. CRON_SECRET is conditional on approved staging jobs. Record only key IDs/secret-version references, never values.

Then run in each repository:

~~~powershell
node staging/verify.mjs disabled
~~~

No further ordinary staging deployment approval is needed: the user's staging authorization persists. Never weaken validation to obtain a pass.

## Deployment and acceptance — not yet executed

After both disabled preflights pass: staging Firestore rules/indexes → Storage rules → Club Functions/API → GrowLine App Hosting/server → Club web → GrowLine web → Auth/providers/controlled platform-admin, owner, member, coach and station setup → disabled smoke → staging-only integration activation → Club code issue/redemption → Add-to-Club/new and existing canonical members → duplicate/replay/concurrency/lost-response reconciliation → owner activity → one QR → authorized staging SSO both directions → logout/unlink/revocation/epoch/audience/replay denials → OTP where provider permits → synthetic jobs/retention dry-run → outage/reconciliation → rollback rehearsal → hosted security/regression acceptance.

**Hosted Add-to-Club, owner activity, QR, SSO, OTP, station workflows, jobs/retention, reconciliation, rollback and security/regression acceptance: NOT RUN.** No staging pass or deployment version is claimed. Offline local product completion is separate evidence.

## Rollback plan

Complete pending SSO revocations while retaining required key/origin/delivery configuration. Disable new handoffs, activity and SSO on both servers; pause link issuance/redemption and schedules/jobs. Verify disabled responses and independent app use. Preserve canonical members, mappings, successful operations, consent, audits and checkpoints. Restore recorded known-good server/web artifacts with reviewed disabled configuration; App Hosting restores its environment with artifacts. Advance session/pair epochs through authenticated mechanisms and retry pending revocation delivery. Recheck station/workspace/financial/PIN/Storage/privacy denials and controlled reconciliation. Never delete successful data or restore anonymous/PIN authorization. A deployed rollback artifact and measured rehearsal do not exist yet.

## Production checklist — DO NOT EXECUTE

1. Complete all launch-critical hosted staging acceptance above and resolve every failure/blocker, including OTP/provider decisions and rollback rehearsal.
2. Record immutable source commits, CI results, deployed artifacts/versions, rules/index hashes, secret-version references and sanitized acceptance evidence.
3. Independently verify production projects/domains/backend, production-specific secrets, deployer/runtime IAM/signing, Auth/provider/canonical grants, legal/consent/retention approval, historical credential assessment/rotation, backups, monitoring and release/rollback ownership. Never reuse staging credentials in production.
4. Obtain explicit production deployment/activation approval naming exact targets, versions and activation scope.
5. Only under that future approval, use the documented deployment order with integration/activity/SSO/jobs initially disabled. Verify smoke and grants, activate capabilities separately, monitor agreed thresholds and execute the rehearsed rollback if required.

Repositories and Firebase projects remain independent. Preserve all existing verified commits. Generated functions/lib output, logs, temporary configs, ignored local profiles and inventory are excluded from commits.
