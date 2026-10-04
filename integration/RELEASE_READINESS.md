# Local integration release readiness

## Ownership and runtime boundary

GrowLine owns coach/workspace membership, prospect and pipeline data, consent capture, and handoff initiation. Club owns operational Club members, Club authorization, and all attendance, plans, wallet, credits, payments, inventory, and financial records. The applications remain independent Firebase projects. Browsers call only their own application; GrowLine never writes Club member documents.

The Club Functions package exports a server-only handoff endpoint, one-time Club-code issuance/redemption, and link revocation. GrowLine exposes authenticated link enrollment, revocation, handoff initiation, and reconciliation-status routes. These endpoints are feature-gated; `INTEGRATION_HANDOFF_ENABLED` must remain false outside local tests until staging approval and environment configuration are complete.

For an existing Firebase backend owner, the local release design assigns the Club project authority over Club-code invitations, Club-side integration enablement, identity-link destination mapping, canonical member resolution, and handoff idempotency/reconciliation. GrowLine keeps its own source authorization and initiation record. Both sides refer to one versioned `linkId`; the Club record controls whether the destination mapping is active. This avoids a third Firebase project and preserves each product's domain ownership. The design requires dual-authenticated proof before either side marks a link active.

## Server assertion configuration

The local verifier uses short-lived HS256 server assertions with a key ID, issuer, destination audience, issued/expiry times, and normalized request hash. Club accepts active key IDs from server-only configuration so old and new keys can overlap during rotation. The assertion signature authenticates the service; Club still performs destination, link, consent, and operation authorization separately.

Required server-only configuration names (values are environment-specific and must not be committed):

- `CLUB_INTEGRATION_AUDIENCE`
- `CLUB_GROWLINE_SERVICE_KEYS` — key-ID-to-secret map; provision through the hosting secret manager and rotate with overlapping key IDs.
- `CLUB_LINK_CODE_PEPPER` — Club-side HMAC pepper used to persist only a one-time invitation code hash.
- `GROWLINE_PROJECT_ID` — expected source Firebase project on Club Functions.
- `CLUB_FIREBASE_PROJECT_ID` — expected destination Firebase project on GrowLine.
- `GROWLINE_CLUB_REDEEM_URL` and `GROWLINE_CLUB_REVOKE_URL` — Club Functions endpoints used by GrowLine.
- `GROWLINE_CLUB_DESTINATION_URL`
- `GROWLINE_CLUB_DESTINATION_AUDIENCE`
- `GROWLINE_CLUB_SERVICE_KEY_ID`
- `GROWLINE_CLUB_SERVICE_KEY`
- `GROWLINE_CLUB_CONSENT_TEXT` and `GROWLINE_CLUB_CONSENT_VERSION` — approved legal text and its version; both must be supplied together.
- `CLUB_INTEGRATION_AUDIENCE` — expected destination audience on Club Functions.
- `INTEGRATION_HANDOFF_ENABLED` — remains false until every activation gate passes.

No production value is supplied here. Do not place these variables in `VITE_*`, `NEXT_PUBLIC_*`, browser configuration, source control, or URL query parameters.

## Contract gap before member creation

The v2 minimum member field decision is approved and implemented locally: display name, phone with provenance, optional email with provenance, consent timestamp/version, coach attribution, source prospect reference, destination Club, and protocol metadata. Private notes, wellness/health/body-composition data, unrelated pipeline history, and all financial/plan state are excluded. Phone/email match only when marked verified; unresolved ambiguity goes to manual review. New members are created by Club transactionally without wallet/credit/plan/payment/transaction state.

The legal consent copy/version remains a production gate. The local flow reads `GROWLINE_CLUB_CONSENT_TEXT` and `GROWLINE_CLUB_CONSENT_VERSION`; no legal text is invented or embedded. Production transfer must remain disabled until the wording and version are supplied and approved.

The v2 flow uses durable source and destination operation records (`PENDING`, `SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `MANUAL_REVIEW_REQUIRED`) for reconciliation. A timeout leaves the source operation pending; retrying the same idempotency key replays the exact stored request and resolves the Club result. A Club-side per-person mapping keyed by source project, workspace, and GrowLine member ID ensures multiple operations for the same source person converge on one Club member. A timeout after a Club commit therefore cannot create a second member.

The local cross-repository server-flow scenario passed against Firestore Emulator: minimum v2 member create, signed assertion validation, simulated response loss after Club commit, retry/reconciliation, same-key replay, one canonical member, one source mapping, and no wallet document. Club rules/station tests passed 134 cases; the handoff-state suite passed 6 cases; boundary tests passed 3 cases; the reception/kitchen/TV workflow harness passed 5 cases. The GrowLine full unit command remains blocked at `tsx` startup by Node `uv_os_get_passwd returned ENOMEM`; it is not counted as passed.

## Staging checklist

1. Obtain isolated staging Firebase project IDs for both applications and confirm their owners.
2. Configure staging Auth providers and App Check; do not reuse production project IDs.
3. Configure the service assertion audience and two overlapping staging keys in each server's secret manager.
4. Keep `INTEGRATION_HANDOFF_ENABLED=false` until the Club Firestore and Storage security suite and station workflow suite pass against staging-equivalent rules.
5. Deploy only to staging after human approval; verify both project identities and audience rejection with test accounts.
6. Run contract, auth, link, code, matching, idempotency, concurrency, timeout/reconciliation, privacy, and Club regression suites.
7. Reconcile test handoffs, revoke the test code/link, then confirm no wallet/payment/credit records were created.
8. Record exact source commits, rules hashes, Functions versions, test evidence, and rollback owner.

Status: **AWAITING STAGING ACCESS**. No staging credentials or project IDs were detected or used by this local implementation.

## Operational monitoring and rollback

Alert on invalid assertions, wrong audiences, request-hash conflicts, repeated retryable failures, operations pending beyond the agreed service window, and any duplicate destination-member mapping. Logs must contain operation ID, request hash, status, actor, attempt, and safe reason code only; never log profile PII, secrets, bearer assertions, or prospect data.

Rollback follows [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md): disable the feature flag, stop new code redemption, retain operation history and Club membership, reconcile pending operations, then restore the last staging-approved Functions/rules versions after station workflows are verified. Production rollback requires an accountable operator and approved backups.

## Human-owned release values

- Staging and production Firebase project IDs and project owners.
- Secret-manager ownership, key issuance/rotation window, and incident contact.
- Approved v2 member profile fields and verification/provenance rules.
- Consent language and retention/legal review for sharing member identity across services.
- Production deployment and rollback approvals.
- Any legal entity, address, privacy contact, or payment-provider credentials required by GrowLine.
