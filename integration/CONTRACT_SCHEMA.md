# Version 1 integration schema

The integration boundary remains server-to-server and inactive until both applications have staging credentials and the Club security gate includes real station workflow checks.

## Identity link

```json
{
  "schemaVersion": 1,
  "linkId": "link_01J...",
  "clubProject": "club-firebase-project",
  "clubId": "club-id",
  "growlineProject": "growline-firebase-project",
  "workspaceId": "workspace-id",
  "clubAuthUid": "firebase-auth-uid",
  "growlineAuthUid": "firebase-auth-uid",
  "status": "pending",
  "verification": { "method": "dual_authenticated_consent", "verifiedBy": "operator-or-service", "verifiedAt": "timestamp" },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

`clubProject`, `growlineProject`, and both Auth UIDs are required to prevent accidental equality assumptions across Firebase projects. `status=active` requires proof from both sides. Unlinking changes status to `revoked`; it never deletes source accounts or rewrites historical handoffs.

## Club link invitation

```json
{
  "schemaVersion": 1,
  "codeId": "code_01J...",
  "codeHash": "sha256-with-server-side-pepper",
  "clubId": "club-id",
  "issuedByAuthUid": "owner-auth-uid",
  "purpose": "growline_coach_link",
  "expiresAt": "timestamp",
  "maxUses": 1,
  "usedCount": 0,
  "revokedAt": null,
  "createdAt": "timestamp"
}
```

Only the hash is persisted. Redemption is a transaction that checks expiry, revocation, purpose, and use count, then increments `usedCount`. A Club code is separate from a GrowLine referral code and does not identify a member by itself.

## Handoff state machine

`requested → validating → accepted | already_exists | manual_review_required | rejected → reconciled`

Every transition records actor, timestamp, reason code, request hash, and attempt number. `manual_review_required` is returned for ambiguous identity matches, conflicting active links, or a destination member that cannot be safely matched. A client retry cannot skip validation or create financial records.
