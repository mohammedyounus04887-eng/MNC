# Master completion verification — 2026-10-01

**Historical verification snapshot.** Core integration and owner/QR/job results below are preserved. The earlier unfinished SSO status is superseded by the local implementation and final gates in SSO_VERIFICATION.md (2026-10-02). Staging/production activation is not approved and lacks required external inputs. No push, deployment, live customer data or irreversible migration occurred.

## Verified gates

| Gate | Result | Evidence / scope |
|---|---|---|
| Club Firestore/Storage/security | PASSED, 138/138 | Correct/wrong club/role, anonymous, station, protected PIN, wallet/payment, Storage/platform separation; browser federation state denied |
| Club station workflow harness | PASSED, 5/5 | Reception, kitchen, TV and scoped operational synthetic workflows |
| Club durable handoff state | PASSED, 6/6 | Claim/concurrency, state transitions, lost response/recovery, successful history |
| Club integration boundary | PASSED, 3/3 | Destination matching/denials, private fields, authenticated provenance |
| Club owner aggregate emulator tests | PASSED, 6/6 | Verified grant, bounded roster/window, private response rejection, scoped audited revocation and atomic code rotation |
| Combined preceding Club run | PASSED, 157/157 | Prior combined snapshot included five owner cases; latest six owner cases also passed separately. Do not add overlapping counts |
| Club federation replay emulator tests | PASSED, 4/4 | Atomic single claimant, revoked/changed pair/role/epoch/link/member; no active login |
| Club unit | PASSED, 138/138, 10 files | Full app unit run, including strict verified UID profile tests |
| Club TypeScript | PASSED | App and Vite/config typechecks |
| Club Functions / production bundling | PASSED | Existing installed toolchain; isolated synthetic build profile |
| Club messaging config | PASSED, 3/3 | Public allowlist, no server values, incomplete/emulator inert state |
| Club staging guard | PASSED, 19/19 | Wrong targets/profiles/origins, disabled flags and activation prerequisites |
| GrowLine full native unit baseline | PASSED, 758/758, 141 suites, zero skipped | Entire tests/**/*.test.ts inventory through Node + installed TypeScript; strict typecheck remains separate |
| GrowLine original tsx unit command | ENVIRONMENT BLOCKED | uv_os_get_passwd returned ENOMEM before loading tests; not repeatedly retried and not labeled passed |
| GrowLine Firestore rules baseline | PASSED, 190 checks across 8 suites | Base 55, boards 28, qualifications 19, duplication 16, session4 26, workspace 16, goals 19, wall 11 |
| GrowLine readiness emulators | PASSED, 15/15 | Jobs/retention/cache scope 7, owner privacy/activity 5, inactive federation replay/browser-denial 3 |
| GrowLine TypeScript / Functions / production build | PASSED | Full app and separate Functions package; build with isolated demo/emulator configuration |
| GrowLine lint | PASSED, zero errors, 5 existing warnings | No newly introduced warnings retained |
| GrowLine staging guard | PASSED, 19/19 | Same target/flag safeguards, independent project profile |
| Current cross-app HTTP/persistence recheck | PASSED, 31/31 | Real Auth/session/server requests; canonical IDs/mappings, 8 parallel replays, conflict/auth/privacy/QR and disabled payment no-write checks |
| Earlier full cross-app destination flow | PASSED, separate 27/27, 32/32 and 31/31 runs | Existing create/match/revocation/historical replay evidence; counts are not additive |
| Actual browser core flow | PASSED | Primary coach Member/Add-to-Club success survives reload; Club member visible; QR explicit consent submitted; opted-in owner aggregate visible |
| Automated full Playwright baseline | ENVIRONMENT BLOCKED / NOT EXECUTED HERE | Retained CI gate; browser/manual HTTP evidence is not a substitute for claiming all automated scenarios passed |
| Mobile viewport verification | ENVIRONMENT BLOCKED | Browser viewport override did not change actual 1280px DOM viewport; responsive classes reviewed, narrow-screen browser result not claimed |
| Hosted CI | AWAITING AUTHORIZED PUSH/CI EXECUTION | Workflows prepared; no remote run claimed |
| Live staging / IAM / indexes / provider OTP | AWAITING STAGING INPUTS | Emulator evidence does not prove deployed indexes or SMS provider configuration |
| Actual SSO login/logout | AWAITING HUMAN POLICY / STAGING AUTH; IMPLEMENTATION INCOMPLETE | Policy and atomic replay adapters only; keep feature flag false |

Raw logs, screenshots, emulator state, generated output and local profiles are not committed. They are kept in the workspace for current verification/demo. The native loader neither mocks OS identity/Auth nor installs or alters dependencies; the original Linux CI unit command remains intact.

## Completed release behavior

- Club remains the operational application and GrowLine the coaching/acquisition application, with independent repositories/databases.
- Owner dashboard receives only explicitly approved coach display name and aggregate daily-log/people-met/reported-new-member counts, with India-day windows, pagination and unavailable/denied/loading/empty states. No prospect PII, notes or health fields are returned. Reported conversions are clearly labeled as coach daily-log metrics.
- One GrowLine coach QR preserves server-owned coach/workspace attribution and consent provenance. QR grants no role or Club membership; Club walk-in remains separate.
- Bundled one-time Club code UX supports expiry/rotation/revocation, linked/revoked relationships and deliberate coach activity opt-in. Codes do not grant administration.
- Add-to-Club requires Member stage for new operations, explicit configured consent and active dual-verified link. Durable same-person mapping and saved operation keys survive retries/refresh; same key with changed intent conflicts. Historical successful state remains reconcilable after link revocation.
- Minimum new Club member provisioning gives no automatic wallet, payment, paid plan, positive credits or financial privilege. Existing-member attachment requires trusted verified evidence or an existing mapping; ambiguous matches require manual review. Unverified entered contact is not identity proof.
- Existing nine GrowLine jobs have scoped authenticated transport, disabled defaults, bounded scans, retry-safe derived state/claims and retention dry-runs. Health and voice purge emulator cases pass. Production schedules/deletions were not activated.
- Privacy publication requires real reviewed legal contacts, notice approval/version; consent metadata is recorded. Real approved wording remains a human/legal gate. Individual coaches stay free and payment routes reject processing while disabled.
- Removed the legacy browser platform-admin bootstrap and hardcoded worker project, and resolved owner UI through verified UID grants. Historical credential exposure requires a security-owner operational review without printing secrets.

## OTP staging readiness

Existing UI retains email/password fallback, phone format/provider/captcha/quota/code-expiry error states and fresh reCAPTCHA initialization after failures. Session establishment uses verified Firebase identity, not submitted email/phone. Actual provider execution is AWAITING STAGING AUTH CONFIG.

Before testing: confirm isolated project/web registration, Phone Auth and email/password providers, authorized exact domains, test phone numbers, reCAPTCHA/App Check configuration, quota/SMS regions/billing owned by an authorized operator. Test valid OTP, wrong/expired code, disabled provider, quota/network failure, new-account profile and email fallback. Do not manipulate production SMS/billing or relabel a matching phone as verified cross-app identity.

## Release-critical limitations

Local tests do not visually exercise every historical Club/GrowLine screen. Existing unit/rules/workflow evidence and retained hosted browser CI cover the baseline; full staged workflow/OTP/mobile/rollback execution remains mandatory. Club's unrelated legacy global lint baseline is not clean and was not represented as a passing gate. No security suppression, compiler weakening or approval bypass was used.

Real index readiness, Auth identities/providers/IAM, approved legal/consent/retention text, historical credential remediation, monitoring/rollback owners, backup recovery and explicit staging then production approval are still required. Legacy unscoped data is excluded rather than automatically rewritten. SSO is not a release claim until its remaining implementation and real Auth gates pass.

## Exact safe local commands

From club-app:

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit
npm test
npm --prefix functions run build
node --test scripts/messaging-config.test.mjs staging/verify.test.mjs
npm run test:security
npm run test:workflow-harness
npm run test:handoff-state
node --test security/integration-boundary.test.mjs
# For owner/federation tests, use the explicitly isolated Firestore emulator:
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8180'
$env:METADATA_SERVER_DETECTION='none'
node --test --test-concurrency=1 functions/test/ownerActivity.test.mjs functions/test/federation.test.mjs
```

Do not start a second default-port emulator over the running demo. The npm emulator wrappers are intended for a fresh, isolated test lifetime. Current local tests used the already running loopback emulators with separate test project namespaces; security/station tests use demo-club-security-tests, never the interactive demo namespace.

From growline:

```powershell
npm run typecheck
npm run lint
npm --prefix functions run build
npm run test:unit:native
node --test staging/verify.test.mjs
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8081'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:METADATA_SERVER_DETECTION='none'
npm run test:readiness
# Native runner for existing rules scripts; no tsx OS workaround:
node --import ./scripts/test-typescript.mjs e2e/rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/leaderboards-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/qualifications-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/duplication-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/session4-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/workspace-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/goals-rules.test.ts
node --import ./scripts/test-typescript.mjs e2e/wall-rules.test.ts
```

Use the workspace's guarded integration/local-demo/check-app.mjs for synthetic builds; do not substitute a production profile. Exact future staging commands, required inputs, UID assignment and production checklist are in PLAN.md (repo copy) / STAGING_PLAN.md (workspace copy). See JOBS_RUNBOOK.md, SSO_CONTRACT.md and ROLLBACK_PLAN.md for separate activation/rollback gates.
