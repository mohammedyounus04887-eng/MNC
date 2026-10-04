# Integration invariants

These are testable requirements for the later cross-app implementation.

- A GrowLine UID is never used as a Club member document ID without an explicit mapping.
- Equal email, phone, display name, or referral code never proves identity.
- A handoff cannot proceed without an active dual-authenticated identity link and explicit consent.
- A Club code cannot be reused after its use limit, expiry, or revocation.
- The same `(integrationName, idempotencyKey)` and request hash returns the original result.
- The same key with a different normalized request hash is rejected.
- Handoff retry never creates a second member, wallet balance, payment, plan, or transaction.
- Member provisioning does not create money or credits unless an existing, separately authorized Club operation does so.
- Owner activity is aggregate and club-scoped; prospect notes, health data, phone, and report tokens do not cross the boundary.
- Reconciliation is read-only by default and cannot silently repair identity or financial records.
- SSO is deferred until these invariants pass in both staging projects.
