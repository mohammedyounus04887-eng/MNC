# Club ↔ GrowLine local integration contracts

These contracts describe the local implementation. Cross-app traffic remains feature-gated and must stay disabled outside local verification until staging configuration and approvals are complete.

## Identity link

The Club-owned `clubs/{clubId}/integrationLinks/{linkId}` and GrowLine `integrationLinks/{linkId}` records contain `schemaVersion`, `clubId`, both Firebase project IDs, `workspaceId`, both authenticated UIDs, `verificationMethod`, `status`, verification timestamps, and audit events. An owner/admin issues a one-use Club code; the signed-in GrowLine coach redeems it in their authenticated session. Matching phone, email, name, or raw UID alone is insufficient. Revocation is audited and does not delete either source identity.

## Club code

Club codes are short-lived, single-purpose enrollment invitations. Store only a hash, `clubId`, issuer, role scope, expiry, maximum uses, current uses, and revocation state. The raw code is shown once and never placed in a URL with personal data. Redemption is an authenticated server operation and atomically consumes one use.

## Add-to-Club handoff (v2)

The request payload is versioned and minimal:

```json
{
  "schemaVersion": 2,
  "handoffId": "ulid",
  "idempotencyKey": "client-generated-unique-key",
  "growlineMemberId": "member-id",
  "workspaceId": "workspace-id",
  "clubId": "club-id",
  "destinationClubId": "club-id",
  "linkId": "verified-link-id",
  "displayName": "member profile name",
  "phone": "+919876543210",
  "phoneVerification": { "status": "unverified", "method": "growline_prospect_entry", "verifiedAt": null },
  "email": null,
  "emailVerification": null,
  "sourceCoachId": "authenticated-coach-id",
  "sourceGrowLineProspectId": "internal-prospect-id",
  "consentTimestamp": "timestamp",
  "consentVersion": "approved-version"
}
```

Only the approved display name, phone plus verification provenance, optional email plus provenance, consent timestamp/version, coach attribution, source prospect reference, destination Club, and protocol metadata cross the boundary. Unverified contact equality never matches an existing member. Private prospect notes, wellness/health/body-composition information, unrelated pipeline history, credentials, and all financial/member-plan state are forbidden. Club resolves a unique verified contact match or transactionally creates a minimal active member without wallet/credit/plan/financial state. Ambiguous evidence requires manual review.

Consent is required before submitting Add to Club. GrowLine serves the final legal copy/version from `GROWLINE_CLUB_CONSENT_TEXT` and `GROWLINE_CLUB_CONSENT_VERSION`; no legal wording is embedded here. Production stays disabled until legal copy/version are supplied and approved. A Club owner/admin issues a single-use 15-minute code; an authenticated GrowLine coach redeems it. The Club records the issuer and redeemer as dual-authenticated proof. The code grants no Club role.

The Club server validates the service assertion, source project, destination project/audience, active coach/workspace link, consent, request hash, Club status, and destination membership policy. It returns durable statuses and never accepts credentials or unrestricted personal-data blobs.

## Idempotency and retries

Each handoff uses `(integrationName, idempotencyKey)` as a unique key. The first accepted request stores the normalized request hash and result. Replays with the same hash return the original result; a key reused with a different hash is rejected. Retries use bounded exponential backoff and a dead-letter status after the retry budget. No retry creates a second Club member, wallet, payment, or identity link.

## Reconciliation

A periodic read-only reconciliation compares source IDs, link status, handoff status, and destination membership IDs. It reports missing, duplicated, mismatched, and stale records with an operator action. It never silently repairs identities or financial records; repairs require an authorized, audited command with a new idempotency key.

## Privacy boundary

GrowLine coach activity is aggregated for an authorized Club owner. Prospect notes, health data, and unrelated workspace records remain in GrowLine. Club membership access does not grant GrowLine workspace access, and a GrowLine link does not grant cross-club access.
