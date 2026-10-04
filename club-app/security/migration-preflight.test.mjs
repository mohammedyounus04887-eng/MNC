import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectMigrationInventory } from './migration-preflight.mjs';

const ready = () => ({ clubId: 'club-a', verifiedOwnerAuthUid: 'auth-uid-a', ownerVerificationReference: 'operator-reviewed-record', remainingPublicPinFields: [], stationWorkflowChecks: { reception: 'passed', kitchen: 'passed', tv: 'passed' } });
test('empty inventory never implies readiness', () => assert.equal(inspectMigrationInventory([]).readyForReview, false));
test('verified inventory is ready only for human review, not deployment', () => assert.equal(inspectMigrationInventory([ready()]).readyForReview, true));
test('email and synthetic legacy IDs cannot substitute for verified ownership', () => {
  const club = { ...ready(), verifiedOwnerAuthUid: undefined, ownerUserId: 'owner_club-a', ownerEmail: 'synthetic@example.invalid' };
  assert.ok(inspectMigrationInventory([club]).issues.some(issue => issue.code === 'VERIFIED_OWNER_MAPPING_REQUIRED'));
});
test('legacy public PIN field blocks readiness', () => assert.equal(inspectMigrationInventory([{ ...ready(), remainingPublicPinFields: ['receptionPin'] }]).readyForReview, false));
test('every station workflow is required', () => assert.equal(inspectMigrationInventory([{ ...ready(), stationWorkflowChecks: { reception: 'passed', kitchen: 'passed' } }]).readyForReview, false));
test('duplicate club inventory is rejected', () => assert.equal(inspectMigrationInventory([ready(), ready()]).readyForReview, false));
