# Final local SSO verification — 2026-10-02

**LOCAL PRODUCT STATUS: COMPLETE for the requested local implementation. Hosted SSO remains DISABLED.** Staging, live IAM/providers, browser/mobile acceptance and production activation are separate external gates. No push, staging/production deployment, live Firebase modification or irreversible migration was performed.

## Final affected gates actually executed

| Gate | Result |
|---|---|
| Cross-project SSO broker / real Auth emulators / HTTP boundary | 21/21 passed |
| Club security baseline (Firestore, Storage, station enrollment, verified admin separation) | 138/138 passed |
| Club station workflow harness | 5/5 passed |
| Club SSO Firestore/Storage session rules | 5/5 passed |
| Club owner/link-revocation regression | 6/6 passed |
| Club unit regression | 138/138 passed across 10 files |
| GrowLine baseline rules | 190/190 passed across 8 suites |
| GrowLine SSO session rules | 5/5 passed |
| GrowLine affected native unit tests | 19/19 passed |
| Staging guard tests | Club 21/21; GrowLine 21/21 passed |
| Club and GrowLine TypeScript | Passed |
| Club Functions TypeScript build | Passed |
| Club and GrowLine web production builds | Passed with guarded local-demo configuration |

The 21 SSO cases include explicit fresh dual-account confirmation, verified canonical member grants, both actual destination Firebase custom-token sign-ins, GrowLine session cookie verification, switching back from an SSO session, unpaired/wrong UID/Club/project/audience/origin/state/PKCE/expired/replayed assertions, disabled accounts, role escalation denial, logout/session epochs, revocation/unlink, durable peer-outage delivery and interrupted pairing cancellation after transient proposal deletion. Re-pairing after delivered unlink retains the current session epoch/cutoff and succeeds. Club destination requests bind the selected Club. No Firebase credentials are accepted across projects. Wrong passwords are actually denied by the Auth emulator.

## Infrastructure diagnosis and final disposition

The initial combined baseline failed setup because its Storage fixtures used a different namespace than the configured emulator. The dedicated rerun demonstrated 136 passing cases and two failed Storage ALLOW cases; matching the CLI project to the unchanged fixture project fixed both (138/138). The package security script now uses demo-club-security-tests. No rule or expected outcome was weakened. The new SSO Storage suite supports explicitly supplied loopback ports while retaining a fixed demo project, so it also runs against the dedicated config.

User-level Firebase CLI config permissions, concurrent update-notifier writes and stopped Auth/Storage processes caused setup-only failures. Final successful runs used existing project-local tooling, normal approved emulator execution, dedicated configs, loopback ports, NO_UPDATE_NOTIFIER=1 and the existing workspace CLI config. No restriction was bypassed and no packages were installed. Synthetic test secrets/passwords are intentionally reusable fixtures; no real key/token/password is included in commits or evidence.

## Preserved earlier results (not re-run or re-labelled)

Core GrowLine → Club local E2E: 31 checks passed. Durable Add-to-Club, new/existing canonical member resolution, per-person identity mapping, retry/reconciliation and no duplicates remain verified. Owner aggregate activity and one-QR consent/handoff were verified in the earlier real local demo; unchanged by this SSO-only scope. Earlier GrowLine native full regression: 758/758 across 141 suites; this final run uses the 19 affected tests, not a new full-suite claim. Refer to MASTER_VERIFICATION.md for those original gates.

Original tsx-based GrowLine runner remains environment-blocked (uv_os_get_passwd ENOMEM); native affected tests execute successfully. Previously blocked Playwright/mobile browser checks were not retried. Hosted SSO, real providers/OTP, live indexes/TTL/IAM and staging credentials were not tested locally and are not marked passed.

## Repeat affected checks

Start only approved isolated demo emulators. Never use production credentials/project aliases. Commands below assume repository terminals.

~~~powershell
# Club: repository's dedicated test configuration; first build Functions
$env:NO_UPDATE_NOTIFIER='1'
$env:XDG_CONFIG_HOME='C:\Projects\Club-GrowLine\integration\local-demo\cli-config'
$env:JAVA_HOME='C:\Program Files\Java\jdk-24'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
npm run test:security
npm run test:workflow-harness
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --config firebase.integration-test.json --project demo-club-security --only firestore,storage "node --test security/federation-session.test.mjs"
npm test
node --test staging/verify.test.mjs
# Cross-repo broker tests: Club Auth9198/Firestore8180 and GrowLine Firestore8081 running
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9198'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8180'
node --import ../growline/scripts/test-typescript.mjs --test --test-concurrency=1 functions/test/federationService.test.mjs
node --test functions/test/ownerActivity.test.mjs
# GrowLine
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8081'
node --test tests/federation-session-rules.test.mjs
node --import ./scripts/test-typescript.mjs --test tests/federation-contract.test.ts tests/public-routes.test.ts tests/rules-posture.test.ts
node --test staging/verify.test.mjs
~~~

Run emulator configs sequentially when they share ports. Cross-project fixtures use isolated demo-club-sso-local and demo-growline-sso-local namespaces. Auth emulator test-only admin routing selects each namespace; real provider passwords/custom tokens are still verified. The SSO rule test uses UUID-prefixed paths and never clears the interactive Club project.

## Required human inputs and exact next action

Supply two isolated staging project IDs, reviewed HTTPS origins/Club scope/GrowLine backend, controlled existing provider-backed coach/member UIDs, independently verified canonical member grant, active verified business link, and approved pairing/retention text. Provide a dedicated Secret Manager FEDERATION_SERVICE_KEY binding in both projects, matching FEDERATION_SERVICE_KEY_ID, own-project token-signing IAM and Firebase provider/authorized-domain/test-number configuration. Provide accountable staging/rollback operators and explicit staging deployment plus SSO verification approval. No secret values should be pasted into this report.

Next action: the operator supplies those inputs, reviews SSO_CONTRACT.md and PLAN.md, and runs node staging/verify.mjs disabled in BOTH repositories. Do not deploy automatically. After explicit approval, follow the exact SSO_CONTRACT.md deployment order and staging cases: rules/indexes/TTL → own servers → web apps (SSO off) → controlled accounts/verified grants/link → disabled checks → separately approved sso-verification preflight → bidirectional browser sign-in/denials/logout/unlink/outage/rollback acceptance. Keep handoff, jobs and unrelated flags disabled for isolated SSO verification.
