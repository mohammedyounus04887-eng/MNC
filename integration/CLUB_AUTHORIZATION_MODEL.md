# Club authorization model

Status: design baseline for local emulator work. Production rules are not changed by this document.

Club access must be based on a Firebase Auth principal, a club association, and a role. A client PIN is a station unlock mechanism only; it is not an authorization credential and must never be sufficient to read or write Firestore or Storage.

## Principal and role records

The existing `users/{uid}` record remains the user identity. A future station authorization record should be stored under a club-scoped path such as `clubs/{clubId}/authorizations/{uid}` with a constrained role set: `owner`, `admin`, `reception`, `kitchen`, `tv`, or `member`. The record must contain the authorized club ID, role, active status, and audit timestamps. Platform administrators remain a separate global allowlist and are not implied by a club role.

Rules should require both `request.auth != null` and a matching active authorization record for the target club. Member access should additionally require the caller's UID/member identity to match the target member record. Cross-club access must fail even when the caller has a valid role in another club.

## Station sessions

Anonymous Auth is retained only as a compatibility path while station clients migrate. It cannot satisfy privileged rules. A station must exchange a valid owner-approved station enrollment for a non-anonymous Auth principal before it can access operational data. Existing PIN documents are migrated to a private security location and are never directly readable by station clients; PIN verification should be performed by a callable/server endpoint that issues or validates the station session.

## Capability matrix

| Role | Reads | Writes |
|---|---|---|
| owner | Own club operations and permitted reports | Club operations, plans, inventory, wallet approvals and staff management |
| admin | Assigned club operations | Assigned administrative operations; no platform configuration |
| reception | Members, attendance, orders and payment workflow needed at reception | Check-ins, orders and approved payment workflows; no rules/PIN/platform writes |
| kitchen | Kitchen queue and assigned stock views | Kitchen status and controlled stock requests |
| tv | Public display data for its assigned club | None |
| member | Own profile, own attendance/order/wallet views | Own permitted requests and submissions; no balances, payments or other members |
| platform admin | Explicitly global platform documents | Platform and club provisioning only through separately tested operations |

Public landing pages and public submissions are separate contracts. Public access must expose only intentionally public fields and must not inherit club management permissions.

## Migration and test gate

The rules change is backward-incompatible for anonymous station clients. Before enforcement, implement a backward-compatible station enrollment path, seed emulator authorization records for every role, and add allow/deny rules tests for wrong-club, wrong-role, PIN-document, wallet, payment, member-mutation and Storage access. Do not deploy until those tests pass and a staged client migration is available.
