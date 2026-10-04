# Phase 1 — Club and GrowLine repository audit

Date: 2026-09-30. Scope: local source, configuration, test inventory, CI, and integration readiness. This is a static audit, not a penetration test or a production certification.

## Outcome

Phase 1 source audit is complete. Proceed to Phase 2 to establish reproducible results before changing behavior. Integration must wait for authorization and consistency fixes. No application code, cloud resources, rules, or deployment configuration were changed by this audit.

Both repositories were clean at inspection:

- Club: `841efb0a61e3cedeec353e5cb8d134ac9351086f`.
- GrowLine: `f1414abb9bd5ae418b1dabfd47611186fe1dbd60`.

Neither root has `node_modules`. Tests, typechecks, lint, builds, emulator checks, and dependency vulnerability scans were not run. Historical green counts in handoff documents are not current baseline evidence. Live rules, deployed functions, credentials, cloud configuration, backups, and monitoring were not inspected. Findings below describe checked-in behavior; deployment exposure remains unverified.

## Architecture inventory

| Area | Club | GrowLine |
|---|---|---|
| Frontend | React 18, Vite 5, TypeScript, React Router; PWA and Capacitor Android modes | Next 16.3, React 19, TypeScript; App Router and PWA |
| Backend | Browser Firestore writers plus Firebase Functions | Next API routes using Firebase Admin SDK plus Functions |
| Authentication | Email/password; anonymous sessions supporting client-side PIN access | Firebase Auth exchanged for 14-day HttpOnly session cookie; revocation checked |
| Tenant | `clubs/{clubId}` document hierarchy | `users.workspaceId`, workspaces, memberships, coach tree |
| Main data | Members, attendance, orders, credits, wallet, payments, inventory, challenges | Coaches, prospects, reports, daily logs, targets, threads, workspaces, subscriptions |
| Identity | Member document ID can differ from Auth UID | User document ID is Auth UID |
| Deployment | Firebase Hosting; default project `magic-nutrition-club`; Functions Node 20 | Firebase App Hosting; default CLI project `growline-dev`, prod alias `grow--line`; Functions Node 22 |
| Tests present | 7 `src/**/*.test.*` files, Vitest | 33 unit test files, 20 Playwright specs, 8 rules suites |
| Other components | Legacy biometric WebSocket bridge; built Android artifacts | Prisma/SQLite seed and migration tooling alongside runtime Firestore |

Sources: package manifests, Firebase configs, `club-app/src/lib/memberKey.ts`, `growline/src/lib/session.ts`, `growline/src/modules/workspaces/model.ts`, and test file inventory. Manifest versions are declarations, not verified installed versions.

## Findings and acceptance criteria

### C1 — Critical: Club has no effective tenant boundary for authenticated clients

Evidence: `club-app/firestore.rules:16` defines `canManageClub(clubId)` as only `isSignedIn()`. Club/member/payment/inventory writes use this or equivalent predicates; the catch-all at line 260 also grants management access. `src/hooks/usePinAccess.ts` creates an anonymous session before reading PINs and compares them in the browser. An anonymous session can therefore bypass the PIN UI and access other clubs directly under these rules. Moving PINs into `security/pins` does not protect them from those sessions, because the catch-all permits reads and writes.

Phase 3: establish server-verifiable club membership and role grants, including narrowly scoped station/device access. Remove overlapping broad grants; validate writable fields. Coordinate migration of existing station clients before enforcing new rules. Acceptance: emulator tests deny anonymous and cross-club reads/writes and deny member changes to balances, roles, PINs, and payment records, while authorized station workflows still succeed.

### C2 — Critical: Club Storage catch-alls override narrower protection

Evidence: `club-app/storage.rules:26` makes all club object paths publicly readable and writable by any authenticated user. The global catch-all at line 31 permits authenticated reads/writes everywhere. Thus the member-specific UID check at line 20 does not restrict access when another matching rule grants it.

Phase 3: separate public assets and private member media; authorize by tenant and identity; constrain content type and size. Acceptance: anonymous private-media reads and cross-member/cross-club reads or writes fail, including nested object paths. Reconcile existing download links separately; changing rules alone is not proof that previously distributed links are invalidated.

### C3 — High: Club permits unauthenticated content and member writes

Evidence: `club-app/firestore.rules:226` permits public read/write of landing-page documents. Member creation at line 72 and several submission collections permit unconditional creates without field validation. Orders and member attendance also have public read grants.

Phase 3: define intentional public fields and submission contracts, move privileged/public submissions through validated and abuse-controlled handlers, and narrow public read models. Acceptance: untrusted callers cannot replace landing content or create privileged member fields; public read tests return only intended data.

### C4 — High: Club plan renewal can lose concurrent credit changes

Evidence: `club-app/src/lib/sellPlan.ts:45` reads the member, calculates an absolute balance, then writes it in a separate batch at lines 56–57 and 99. A batch makes its writes atomic but does not protect that earlier read. Two renewals can record two payments but retain only one credit increase; a check-in between read and commit can be overwritten. Payment and transaction IDs are generated afresh, without an operation-level idempotency key in this writer.

Phase 4: perform balance-dependent changes in a transaction and add a durable operation identifier shared with payment records. Acceptance: concurrent renewals, renewal versus consumption, duplicate submission, and retry after an ambiguous response preserve balances and create exactly one payment per operation.

### G1 — High: GrowLine signup uniqueness checks race with creation

Evidence: `growline/src/app/api/auth/complete-signup/route.ts` checks `getUserById` and `getUserByPhone` before calling `createUser`. In `src/lib/users.ts:234`, the transaction reserves the referral code but writes the user with `tx.set` without transactionally checking the user or claiming the phone. Concurrent requests can pass both preliminary checks. The same UID can be rewritten with another referral/workspace; different UIDs can claim the same phone. Related workspace/membership/counter writes can then disagree with the surviving user row.

Phase 5, or Phase 3 if identity abuse is prioritized: enforce UID creation and normalized phone reservation in the same transaction and define replay behavior. Acceptance: simultaneous requests for the same UID or phone produce one valid identity and consistent related records, without orphan workspaces or double-counted downlines.

### G2 — Integration blocker: a stored phone is not proof of ownership

Evidence: GrowLine signup explicitly accepts a form-supplied, unverified phone when an email token has no phone claim. `verifyAuthToken` accepts an email claim without requiring `email_verified`. Club's `src/lib/auth.tsx` can resolve members by email, and `src/lib/memberKey.ts` documents that member IDs and Auth UIDs differ.

Phase 6–7: record verification provenance and require proof of both identities or an explicit authorized reconciliation process. Never automatically link by equal phone, email, display name, or raw UID across Firebase projects. Acceptance: an account with somebody else's entered contact details cannot claim that person's Club membership.

### C5 — Medium: Club CI reports typecheck failures but still deploys

Evidence: `.github/workflows/deploy-hosting.yml:201–202` runs `npm run typecheck || true`. Repository guidance mentions 46 historical errors; that number was not verified. Tests and the Vite build run, but neither establishes TypeScript correctness for the app.

Phase 2: capture actual diagnostics by file and error code. Phase 4: remove the debt and make typecheck a required gate. Until then, reject new diagnostics against a reviewed baseline rather than ignoring every failure. Use `tsconfig.app.json`; the root `files: []` configuration is not an app check.

### C6 — Medium, conditional: legacy bridge has no client authentication

Evidence: `club-app/bridge/index.js` creates a WebSocket server with a port only, without explicit loopback binding, origin validation, or client authentication, and broadcasts device punch identifiers to all connected clients. Reachability depends on host networking and whether this component is still run.

Phase 4: establish whether the bridge remains supported. Retire it if unused; otherwise restrict binding and authenticate clients. Acceptance: an unauthorized browser/client cannot subscribe to biometric events.

## Positive controls and limitations

- GrowLine verifies session-cookie revocation in `src/lib/session.ts`; `proxy.ts` intentionally performs only a cookie-presence check. Authorization must therefore remain in each API/layout and its query layer.
- GrowLine's Firestore rules deny client writes and its Storage rules deny all access. Sensitive server writes bypass rules, making route-level authorization and tenant checks essential.
- The GrowLine payment webhook verifies the raw-body signature before parsing and delegates event handling to the subscription writer. Replay and ordering tests belong in the measured baseline; static inspection is not proof of payment correctness.
- GrowLine has emulator-target configuration guards, workspace tests, privacy tests, and CI integration scaffolding. These are useful foundations, not current passing results.
- Club centralizes several operations in `src/lib/`; preserve these shared writers while fixing their guarantees rather than adding another path.
- Club tracks multiple `.env` files. Inspected variable names describe public browser Firebase configuration and app modes; their presence alone is not evidence of a private-key leak. Full Git-history secret scanning remains outstanding; values were not copied into this report.

## Deployment questions that remain open

1. Club's `functions/src/index.ts` says an unauthenticated password-reset endpoint was removed from source and requires deployment cleanup. Confirm the deployed function inventory; do not assume deletion from source removed a live endpoint.
2. Verify active Firestore and Storage rulesets for both projects against source, using authorized read-only inventory and controlled accounts. GrowLine handoff notes contain historical uncertainty about deployed rules; those notes do not establish today's state.
3. Confirm scheduled jobs, retention configuration, App Check enforcement, payment configuration, privacy-page configuration, and notification delivery. Do not infer live behavior from old handoff claims.
4. Record hosting revisions, Functions versions, indexes, service-account permissions, backups/restore evidence, and alert ownership before staging. These were outside this local inspection.

## Phase 2 — reproducible baseline plan

Use disposable local/emulator data and explicit non-production project selection. Review seed/reset scripts before executing them. Install from npm lockfiles without updating dependency versions and capture Node/npm versions and the audited commit SHA.

| Component | Checks |
|---|---|
| Club app | `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| Club Functions | In `functions`: `npm ci`, `npm run build` |
| Club bridge | Install/inspect separately if retained; no test script was established in this audit |
| GrowLine app | `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build` |
| GrowLine Functions | In `functions`: `npm ci`, `npm run typecheck`, `npm run build` |
| GrowLine integration | Review `.github/workflows/ci.yml` and integration script; reproduce Auth/Firestore emulator setup, seed/migration/backfill, all 8 rules scripts, and Playwright specs |
| Security baseline | Lockfile vulnerability scan for each package; tracked files and history secret scan; Club rules regression harness |

Store command, environment, exit code, diagnostic/test counts, duration, and log path. Distinguish product failures, missing configuration, tooling failures, and skipped checks. Do not accept old test counts or a zero exit code from a wrapper that suppressed errors.

## Integration constraints for phases 6–10

- Keep Club membership IDs, each project's Auth UIDs, GrowLine coach IDs, prospect IDs, workspace IDs, and club IDs distinct. A workspace is not automatically a club.
- Establish explicit workspace-to-club authorization and a revocable identity mapping. Define who may link/unlink and how existing duplicates are reviewed.
- Club owns operational membership, attendance, credit, and payment facts. GrowLine owns prospect capture, coach activity, and its workspace/tree. Document field ownership before synchronization.
- Add-to-Club should be an authenticated server operation with explicit consent, a minimal payload, schema version, idempotency key, durable status, retries, and reconciliation. Do not put personal data or reusable credentials in redirect URLs.
- Specify events and timestamps, including the business timezone. Club day helpers use the device's local timezone; GrowLine specifies IST. An integration must not silently assume those agree on every device.
- Preserve GrowLine sharing restrictions in any owner dashboard. A linked identity does not grant blanket access to prospects, health data, or another tenant.
- Test cross-tenant rejection, forged identity claims, replay, duplicate handoffs, partial failure, concurrent operations, unlinking, and offline retry before staging.

## Roadmap gates

| Phase | Exit evidence |
|---|---|
| 1 — Audit | This source inventory, findings, and explicit verification gaps |
| 2 — Baseline | Reproducible command logs and triaged failures for both repos |
| 3 — Security | Role/tenant/privacy denial tests pass; deployed endpoint/rules inventory reconciled |
| 4 — Club stability | Critical daily workflows and concurrent money/credit writes pass; CI enforces checks |
| 5 — GrowLine stability | Signup consistency, tenant isolation, offline flows, jobs, and relevant configuration verified |
| 6 — Contract | Versioned schemas, ownership, authorization, idempotency, failure behavior agreed |
| 7 — Identity | Verified, revocable links with collision handling and audit trail |
| 8 — Handoff | Add-to-Club works with retry/replay and recovery guarantees |
| 9 — Dashboard | Authorized, scoped owner views preserve privacy |
| 10 — Integration tests | Positive and adversarial cross-app scenarios pass |
| 11 — Staging | Isolated projects, production-like configuration, migration and rollback rehearsal |
| 12 — SSO | Issuer/audience validation, session lifecycle, logout/revocation, and account-link tests |
| 13 — Production | Reviewed deployment artifacts, backups, migration evidence, and release approval |
| 14 — Monitoring | Alert ownership, health checks, reconciliation, and tested rollback/restore runbook |

The user's roadmap supersedes older repository plans for sequencing. This audit does not implement later phases or establish legal compliance.
