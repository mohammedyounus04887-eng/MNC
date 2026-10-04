import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  operationDocumentId,
  normalizedRequestHash,
  resolveClubMember,
  validateDestinationRequest,
  verifyServerAssertion,
} from '../functions/lib/integrationHandoff.js';

const secret = 'local-test-key-only';
const config = { audience: 'club-local', activeKeys: new Map([['key-1', secret]]), maxTokenAgeSeconds: 120 };
const now = 1_800_000_000;
const request = {
  schemaVersion: 2,
  handoffId: 'h_1',
  idempotencyKey: 'operation_1',
  growlineMemberId: 'gl_member_1',
  workspaceId: 'workspace_1',
  clubId: 'club_1',
  destinationClubId: 'club_1',
  linkId: 'link_1',
  displayName: 'Test member',
  phone: '+919876543210',
  phoneVerification: { status: 'unverified', method: 'growline_prospect', verifiedAt: null },
  email: null,
  emailVerification: null,
  sourceCoachId: 'growline-auth-1',
  sourceGrowLineProspectId: 'prospect_1',
  consentTimestamp: '2026-09-30T12:00:00.000Z',
  consentVersion: 'local-test-v1',
};

function token(claims, signingKey = secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ growlineAuthUid: 'growline-auth-1', growlineProject: 'growline-local', clubProject: 'club-local-project', ...claims, requestHash: claims.requestHash ?? normalizedRequestHash(request) })).toString('base64url');
  const signature = createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

test('destination auth verifies caller, audience, expiry and supports key rotation', () => {
  const assertion = token({ iss: 'growline-service', aud: 'club-local', kid: 'key-1', iat: now - 1, exp: now + 30 });
  const verified = verifyServerAssertion(assertion, { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(validateDestinationRequest(verified.caller, request, 'club-local').ok, true);
  assert.equal(verifyServerAssertion(null, { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now).ok, false);
  assert.deepEqual(verifyServerAssertion(token({ iss: 'growline-service', aud: 'club-local', kid: 'key-1', iat: now - 1, exp: now + 30 }, 'wrong-key'), { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now), { ok: false, code: 'INVALID_SIGNATURE' });
  assert.deepEqual(verifyServerAssertion(token({ iss: 'growline-service', aud: 'other', kid: 'key-1', iat: now - 1, exp: now + 30 }), { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now), { ok: false, code: 'WRONG_AUDIENCE' });
  assert.deepEqual(verifyServerAssertion(token({ iss: 'growline-service', aud: 'club-local', growlineProject: 'other-project', kid: 'key-1', iat: now - 1, exp: now + 30 }), { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now), { ok: false, code: 'WRONG_PROJECT' });
  assert.deepEqual(verifyServerAssertion(token({ iss: 'growline-service', aud: 'club-local', kid: 'retired-key', iat: now - 1, exp: now + 30 }), { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now), { ok: false, code: 'UNKNOWN_KEY' });
  const rotated = { ...config, activeKeys: new Map([['key-1', secret], ['key-2', 'second-local-key']]) };
  assert.equal(verifyServerAssertion(token({ iss: 'growline-service', aud: 'club-local', kid: 'key-2', iat: now - 1, exp: now + 30 }, 'second-local-key'), { ...rotated, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now).ok, true);
});

test('destination schema rejects unsupported, excessive and wrong-club resolution', () => {
  const valid = verifyServerAssertion(token({ iss: 'growline-service', aud: 'club-local', kid: 'key-1', iat: now - 1, exp: now + 30 }), { ...config, growlineProject: 'growline-local', clubProject: 'club-local-project' }, now);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, notes: 'private' }, 'club-local'), { ok: false, code: 'UNCONTRACTED_FIELDS' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, wellnessNotes: 'private' }, 'club-local'), { ok: false, code: 'UNCONTRACTED_FIELDS' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, bodyComposition: { weightKg: 80 } }, 'club-local'), { ok: false, code: 'UNCONTRACTED_FIELDS' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, schemaVersion: 3 }, 'club-local'), { ok: false, code: 'UNSUPPORTED_VERSION' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, displayName: 'Changed after signing' }, 'club-local'), { ok: false, code: 'REQUEST_HASH_MISMATCH' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, destinationClubId: 'club_2' }, 'club-local'), { ok: false, code: 'DESTINATION_CLUB_MISMATCH' });
  assert.deepEqual(validateDestinationRequest(valid.caller, { ...request, sourceCoachId: 'attacker' }, 'club-local'), { ok: false, code: 'SOURCE_COACH_MISMATCH' });
  assert.deepEqual(resolveClubMember('club_1', [{ clubId: 'club_2', memberId: 'm2', verified: true, active: true }]), { outcome: 'NO_ACCEPTABLE_MATCH' });
  assert.deepEqual(resolveClubMember('club_1', [
    { clubId: 'club_1', memberId: 'm1', verified: true, active: true },
    { clubId: 'club_1', memberId: 'm2', verified: true, active: true },
  ]), { outcome: 'MANUAL_REVIEW_REQUIRED', reason: 'ambiguous_members' });
});

test('operation identity is deterministic, opaque and scoped to this integration', () => {
  assert.equal(operationDocumentId('same-key'), operationDocumentId('same-key'));
  assert.notEqual(operationDocumentId('same-key'), operationDocumentId('other-key'));
  assert.match(operationDocumentId('same-key'), /^[a-f0-9]{64}$/);
});
