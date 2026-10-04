# Station authorization migration — not approved for deployment

The new local rules and station enrollment handler are not a complete production migration. Do not deploy them while legacy clients depend on anonymous Auth and public PIN fields.

## Owner identity prerequisite

`src/hooks/useSuperAdmin.ts` creates `owner_<clubId>` as a Firestore member ID, without provisioning the corresponding Firebase Auth user. Club conversion also reuses a member document ID. Neither value may be assumed to be a verified Firebase Auth UID. `src/lib/auth.tsx` additionally has an email-match fallback; that is not acceptable evidence for granting server privileges.

A verified owner-to-Auth mapping is required before enabling administrator enrollment. An explicit platform-admin review is the proposed recovery path. Do not auto-link by email, telephone, name, PIN, or a synthetic ID. The operator must verify the owner account and record verification provenance. Existing financial/member document IDs must not be renamed merely to match Auth IDs.

## Ordered rollout prerequisites

1. Confirm the owner verification/assignment process and inventory the affected clubs.
2. Provision revocable club authorization records and claims from approved mappings through an authenticated server operation.
3. Complete the station login/enrollment UI and migrate all reception entry routes, kitchen, TV, and owner/admin screens. A custom token is a credential: never log it, store it in a URL, or distribute it as a PIN.
4. Move legacy PIN values to server-only storage and remove their fields from publicly readable club documents using an explicit reviewed migration. The local rules deny reads of any club document still containing those fields; the current bootstrap client therefore needs a sanitized read model before enforcement.
5. Replace TV full-member reads with a minimal display projection, and preserve the intended kitchen queue/stock and reception payment workflows under their scoped roles.
6. Prove actual client workflows against emulators, including revocation, wrong-club sessions, owner/member entry, PIN unlock semantics, attendance queries, Storage, and financial operations. Handler tests do not substitute for this.
7. Review `inspectMigrationInventory` results and obtain a separate staging/production deployment decision. It is a pure inventory validator, not a credential verifier or a migration executor.

No production data has been inspected or migrated by this work. Preserve the current deployment until the staged client migration and complete security gate pass. Do not roll back to known-permissive rules as a routine recovery action; disable the new feature or restore a separately reviewed safe release.
