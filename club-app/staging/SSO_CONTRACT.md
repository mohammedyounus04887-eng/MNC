# Local SSO implementation and isolated staging acceptance

**SSO LOCAL STATUS: COMPLETE. Hosted SSO remains disabled.** This implements the approved dual-account pairing policy. It does not create Auth accounts, grant administration, deploy anything or change production. Club and GrowLine remain separate repositories, Auth issuers and databases.

## Implemented flow

1. A GrowLine coach signs in freshly through its own existing provider, chooses an active verified Club relationship and explicitly confirms pairing. The server verifies the actual UID/workspace/link; no email/phone matching occurs.
2. Club requires fresh provider authentication (within five minutes), an existing active canonical member record keyed by the same Auth UID, an enabled member grant with verifiedBy and verificationReference, and member-only Auth claims. Owner/admin/platform/station accounts are denied. An operational handoff member ID or the link's code-issuer UID is never an Auth identity.
3. Club presents the actual GrowLine UID and a limited Auth account label for review, then requires explicit confirmation bound to both exact UIDs and scopes. Both stores commit a durable audited pair with fresh authentication timestamps and consent version dual-account-pairing-v1. One live pair reservation per local UID prevents conflicting mappings. Re-pairing after delivered unlink retains each account's current session epoch and cutoff. Prepared pairs cannot sign in. Lost activation acknowledgement can be repaired; interrupted pairing can be cancelled even after transient proposal cleanup.
4. A destination browser creates a five-minute request with random state and S256 PKCE challenge, bound to the selected Club when Club is the destination. The source popup uses its own independently verified, non-revoked Firebase session (at most 14 days since authentication); pairing alone requires fresh provider sign-in. It issues an exact-purpose, 30-second assertion containing issuer/audience/projects/UIDs/Club/workspace/pair/link/epoch and random exchange ID.
5. The source sends only that one-time assertion through postMessage to the exact configured destination origin. The destination validates exact source origin AND popup window AND request ID. No Firebase ID/custom token, password or verifier is shared across browser origins or placed in URLs. The destination consumes state/request/replay in one Firestore transaction, checks live independent accounts/grants/links and both pair epochs again, and mints its OWN existing UID's Firebase custom token. GrowLine then verifies its own ID token before its own HttpOnly cookie.
6. Club member roles remain member-only, including platform-operation and client-profile denials after a later promotion. GrowLine's existing workspace authorization remains local. No wallet, credits, plan, private notes, health or operational data is copied.

The Club endpoint is federation (us-central1). GrowLine exposes POST /api/integration/federation. Both apps expose /federation. Server RPC uses a DEDICATED credential, signed purpose/issuer/audience/project/request/body, 30-second expiry, atomic replay and signed response correlation. HTTPS is required; the only exception is explicit demo-* test projects on 127.0.0.1. Redirects are rejected; peer requests time out after ten seconds. Browser endpoints require the exact local web origin and strict operation payload fields.

## Logout, unlink and outages

Logout atomically advances local pair/session epochs and the auth_time cutoff, records an audit and durable outbox, and revokes that project's refresh tokens. Peer delivery repeats the same mutation ID, advances its own session epoch and revokes its own refresh tokens. Source acknowledgement is saved only after delivery. A failed source Auth revocation is also retried before peer acknowledgement. A missing/deleted Auth account is already unable to authenticate; permission/network errors remain pending.

Future exchanges fail closed while either pair is suspended/pending, mismatched or revoked. Old assertions, previously minted-but-not-redeemed custom tokens and old Firebase sessions fail the epoch checks. Existing source local sessions do not bypass logout through token refresh. After a completed logout, a new independent provider sign-in may use the retained active pairing. Unlink permanently revokes the pairing, retains canonical member/identity history/audit, and forbids new SSO. A new pairing is blocked until the previous unlink has been delivered.

GrowLine's existing logout path delivers durable federation invalidation; stale signed cookies may retry EXISTING outbox work only, never create a new logout against another account. Club's enabled SSO/member-federation logout invokes its own broker and signs out locally even when delivery remains pending. The UI exposes fresh-sign-in delivery retry and does not claim global logout on a failed acknowledgement. Pending outbox work needs operational monitoring/retry; no new schedule was activated.

Club link revocation invokes an SSO-specific hook in the existing verified transaction: revoke the pair/epoch, audit and enqueue peer delivery. It does not change ordinary link/handoff history or canonical members. Storage evaluates pair-local epoch/cutoff plus the independent member grant, respecting Firebase's two-document lookup limit. Firestore and server sessions also check current relationship/workspace/grants. Do not edit link documents directly as a substitute for the verified revocation mechanism.

## Durable and transient records

Server-only collections: integrationFederationPairs, integrationFederationIdentities, integrationFederationPairingIntents, integrationFederationSessions, integrationFederationAudit, integrationFederationOutbox, integrationFederationInvalidations, integrationFederationExchanges, integrationFederationProposals, integrationFederationRequests, integrationFederationRpc. Browser reads/writes are denied for all eleven.

Pairs, minimal pairing intents, mutation receipts, audits and member records remain durable. Transient proposal labels and requests have expireAt timestamps; RPC replay receipts have a one-day expireAt. Checked-in Firestore fieldOverrides prepare TTL only for those three transient collections. Logical expiry is enforced immediately; TTL deletion is asynchronous and not required to deny expired input. No production TTL policy or deletion was activated. Required composite indexes: outbox(uid, acknowledged) in both projects; pairs(clubId, linkId, status, prepared) in Club. Existing scoped integrationLinks index is reused.

## Final local gates and commands

The final result/counts are recorded in SSO_VERIFICATION.md. No previous owner/QR/handoff/jobs baseline is relabeled as rerun. New broker tests use real Auth/Firestore SDKs in independent demo namespaces and actual loopback signed HTTP; password verification, Firebase custom-token sign-in and GrowLine session cookies are exercised. The emulator's owner header selects only the isolated synthetic test namespace; incorrect passwords remain denied. It is never a product authentication shortcut.

From club-app, with BOTH repos/dependencies and the existing local emulators available:

~~~powershell
npm --prefix functions run build
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8180'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9198'
$env:METADATA_SERVER_DETECTION='none'
node --import ../growline/scripts/test-typescript.mjs --test --test-concurrency=1 functions/test/federationService.test.mjs
node --test --test-concurrency=1 security/federation-session.test.mjs
npm run typecheck
~~~

Storage cross-service emulator lookups use its configured demo-club-security project. This test uses UUID-prefixed synthetic paths there and NEVER clears the interactive project. All broker fixtures use separate demo-club-sso-local/demo-growline-sso-local namespaces. Existing ports: Club Firestore 8180/Auth 9198/Storage 9299; GrowLine Firestore 8081. Do not start conflicting default-port emulators or use real credentials for these tests.

From growline:

~~~powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8081'
node --test tests/federation-session-rules.test.mjs
node --import ./scripts/test-typescript.mjs --test tests/federation-contract.test.ts tests/public-routes.test.ts tests/rules-posture.test.ts
npm run typecheck
node --test staging/verify.test.mjs
~~~

## Remaining human inputs — names only

- Two actual isolated staging project IDs, both HTTPS web origins, GrowLine backend ID, runtime IAM principals and explicit SSO staging approval reference.
- Existing controlled coach/member Auth UIDs and provider-backed accounts; the member's canonical document/grant must already be independently verified. If canonical ID differs from Auth UID, obtain separately approved member onboarding/binding first; this implementation refuses to guess or rename historical records. Owner/admin assignment is NOT a substitute for a member grant.
- Dedicated staging Secret Manager value named FEDERATION_SERVICE_KEY in BOTH projects, with matching FEDERATION_SERVICE_KEY_ID. Do not reuse handoff/activity keys. No secret values have been invented or printed.
- Server configuration names: FEDERATION_CLUB_ORIGIN, FEDERATION_GROWLINE_ORIGIN, FEDERATION_PEER_URL, INTEGRATION_SSO_ENABLED, STAGING_SSO_APPROVAL_REFERENCE; Club browser VITE_INTEGRATION_SSO_ENABLED. Existing project-ID settings must match the respective reviewed manifest.
- Runtime permission to sign its OWN Firebase custom tokens (reviewed service-account signBlob/token-creator IAM); no cross-project Admin credentials. Firebase providers, authorized domains and controlled phone test numbers.
- Reviewed pairing/privacy/audit retention text and accountable monitoring/rollback operator.

## Exact staging verification — NOT AUTHORIZED TO EXECUTE NOW

1. Supply/verify manifests and profiles using PLAN.md. Keep INTEGRATION_HANDOFF_ENABLED=false, INTEGRATION_SSO_ENABLED=false, VITE_INTEGRATION_SSO_ENABLED=false, jobs/activity off. Run node staging/verify.mjs disabled in BOTH repos. Obtain explicit staging deployment AND SSO verification approval before continuing.
2. Provision the dedicated staging secret in each project's Secret Manager through the approved operator process; bind Club federation Function and GrowLine App Hosting runtime. Add the GrowLine YAML block variable: FEDERATION_SERVICE_KEY, secret: FEDERATION_SERVICE_KEY, availability: RUNTIME ONLY. Never place a literal secret in YAML/browser/profile/Git. Supply the reviewed peer URLs: Club -> GrowLine origin + /api/integration/federation; GrowLine -> https://us-central1-<Club staging project ID>.cloudfunctions.net/federation.
3. Deploy the SSO rules/indexes/TTL definitions first to EACH OWN staging project; wait for indexes and verify Storage cross-service IAM. Deploy the new Club federation endpoint AND updated existing issue/revocation authorization endpoints/core Functions that include the SSO link-revocation hook. Deploy GrowLine server and both web artifacts with flags FALSE using the exact explicit-project commands in PLAN.md. Do not enable SSO against old rules or old revocation code.
4. Create controlled provider test accounts only in staging through the approved operator process. Supply the existing verified canonical member grant (role member, station false, uid/clubId, verifiedBy, verificationReference), matching active member document and active Club; normal coach/workspace. Verify email/phone provider sign-in first. Issue/redeem a verified integration relationship using separately approved core verification if necessary, then disable handoff again for isolated SSO tests. Never pair the code issuer as the member.
5. Check disabled SSO returns no assertion/custom token/pair. Record the explicit approval in STAGING_SSO_APPROVAL_REFERENCE, install reviewed server origins/key IDs, set server SSO true in BOTH staging profiles and Club VITE_INTEGRATION_SSO_ENABLED=true only for this approved gate. Run node staging/verify.mjs sso-verification in BOTH repos. This phase keeps handoff disabled, rejects ordinary activation phases, wrong peers, missing approval, browser/server mismatch, public secrets and literal signing keys. No preflight proves live IAM or grants.
6. In each repo terminal read its reviewed manifest as in PLAN.md, then deploy explicitly:

~~~powershell
# club-app, AFTER rules/indexes and operator approval
npx --no-install firebase deploy --config firebase.staging.json --project $clubStageProjectId --only functions:federation,functions:revokeGrowlineClubLink,functions:revokeGrowlineOwnerLinkOrCode
npx --no-install firebase deploy --config firebase.staging.json --project $clubStageProjectId --only hosting
# growline, Environment name staging and reviewed secret binding
npx --no-install firebase deploy --config firebase.staging.json --project $growlineStageProjectId --only "apphosting:$growlineStageBackendId"
~~~

7. Open GrowLine /federation. Freshly authenticate the controlled coach, check status, select the active Club relationship and explicitly confirm. In Club /federation freshly authenticate the EXISTING member, review the exact source UID/limited label and Club, then confirm. Verify both audited durable pairs and independent roles. Repeat without confirmation/fresh proof, with wrong Club, owner/admin/station, unverified/missing grant, conflicting UID and disabled coach: all must deny.
8. Start at each destination /federation with its own session signed out; use the source popup to sign in through the pairing. Verify exact destination UID, normal permitted screens and independent role boundaries in both directions. Test wrong origin/popup/audience/project, expired assertion/request, PKCE/state mismatch, double submit/replay and interrupted response. Lost SSO replies require a new request, not handoff-style replay of a login token.
9. Logout from EACH app's normal logout control. Verify both Auth refresh revocations, pair/session epochs and denial of captured old tokens/cookies/assertions. Sign in freshly to one app; verify the retained pairing allows a new exchange. Simulate peer outage: require visible pending delivery, durable outbox, local old-session denial and no future exchange; restore peer and explicitly retry. Test interrupted pairing/activation and cancellation; no duplicate/live conflicting pair.
10. Unlink with explicit confirmation. Verify both pairs revoked, old/current/new exchanges denied, and canonical member, business link/handoff history and federation audit retained. Re-pair only after delivered unlink and fresh dual authentication/confirmation.
11. Run browser/mobile OTP/provider and affected station/member regressions. Perform rollback: complete pending revocations, disable new SSO on BOTH servers, retain origin/key configuration and delivery capability, invalidate/revoke affected pair/session epochs through the authenticated mechanism, preserve audits/member records. Disable browser entry after delivery; do not delete shared history, clear databases or restore anonymous/PIN authorization. Record results and obtain separate production approval; none is given here.

Firebase references: [custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [session revocation](https://firebase.google.com/docs/auth/admin/manage-sessions), [Storage rule lookup limit](https://firebase.google.com/docs/storage/security/rules-conditions). These are configuration guidance, not a claim that hosted IAM/Auth/SSO has been verified.
