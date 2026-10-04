import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { claimHandoff, readHandoff, transitionHandoff } from '../lib/handoffState.js';
import { normalizedRequestHash, operationDocumentId, processHandoff, verifyServerAssertion } from '../lib/integrationHandoff.js';
import { issueClubLinkCode, redeemClubLinkCode, revokeClubGrowlineLink } from '../lib/clubLinking.js';

const app = initializeApp({ projectId: 'demo-club-handoff' }, `handoff-${Date.now()}`);
const db = getFirestore(app);
const base = {
  schemaVersion: 2,
  handoffId: 'handoff_01',
  idempotencyKey: 'same-logical-operation',
  growlineMemberId: 'source_member_01',
  workspaceId: 'workspace_01',
  clubId: 'club_01',
  destinationClubId: 'club_01',
  linkId: 'link_01',
  displayName: 'Synthetic member',
  phone: '+919876543210',
  phoneVerification: { status: 'verified', method: 'firebase_phone_auth', verifiedAt: '2026-09-30T00:00:00.000Z' },
  email: null,
  emailVerification: null,
  sourceCoachId: 'growline-auth-1',
  sourceGrowLineProspectId: 'prospect_01',
  consentTimestamp: '2026-09-30T12:00:00.000Z',
  consentVersion: 'local-test-v1',
};
const localSecret = 'integration-test-secret-with-more-than-32-characters';

function verifiedCaller(request, audience = 'club-local') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'growline-service', aud: audience, kid: 'test-key', iat: 1_800_000_000,
    exp: 1_800_000_060, requestHash: normalizedRequestHash(request), growlineAuthUid: 'growline-auth-1', growlineProject: 'growline-local', clubProject: 'club-local-project',
  })).toString('base64url');
  const signature = createHmac('sha256', localSecret).update(`${header}.${payload}`).digest('base64url');
  const result = verifyServerAssertion(`Bearer ${header}.${payload}.${signature}`, {
    audience, growlineProject: 'growline-local', clubProject: 'club-local-project', activeKeys: new Map([['test-key', localSecret]]), maxTokenAgeSeconds: 120,
  }, 1_800_000_001);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('test assertion did not verify');
  return result.caller;
}

after(async () => {
  await db.collection('integrationHandoffs').doc(operationDocumentId(base.idempotencyKey)).delete().catch(() => undefined);
  await deleteApp(app);
});

async function claim(request) {
  const hash = normalizedRequestHash(request);
  return db.runTransaction((tx) => claimHandoff(db, tx, request, hash));
}

test('concurrent identical claims converge; a reused key with a different payload conflicts', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => claim(base)));
  assert.equal(results.filter((result) => result.kind === 'CLAIMED').length, 1);
  assert.equal(results.filter((result) => result.kind === 'REPLAY').length, 7);
  assert.equal((await claim({ ...base, growlineMemberId: 'different-member' })).kind, 'IDEMPOTENCY_CONFLICT');
  const saved = await readHandoff(db, base.idempotencyKey);
  assert.equal(saved?.status, 'PENDING');
  assert.equal(saved?.source.growlineMemberId, base.growlineMemberId);
});

test('timeout remains pending and reconciliation discovers the canonical result', async () => {
  const unknownOutcome = await readHandoff(db, base.idempotencyKey);
  assert.equal(unknownOutcome?.status, 'PENDING');
  assert.equal(unknownOutcome?.canonicalClubMemberId, null);

  await transitionHandoff(db, operationDocumentId(base.idempotencyKey), 'SUCCEEDED', 'club_member_01', 'club-service', 'member_resolved');
  const reconciled = await readHandoff(db, base.idempotencyKey);
  assert.equal(reconciled?.status, 'SUCCEEDED');
  assert.equal(reconciled?.canonicalClubMemberId, 'club_member_01');
  assert.equal(reconciled?.history.length, 2);
  await assert.rejects(
    transitionHandoff(db, operationDocumentId(base.idempotencyKey), 'PENDING', null, 'retry-worker', 'retry'),
    /INVALID_HANDOFF_TRANSITION/,
  );
});

test('destination handoff resolves linked member idempotently without financial state', async () => {
  const request = { ...base, idempotencyKey: 'destination-operation' };
  const clubId = request.clubId;
  const linkId = request.linkId;
  const memberId = 'canonical_member_01';
  const operationId = operationDocumentId(request.idempotencyKey);
  const club = db.doc(`clubs/${clubId}`);
  const integration = db.doc(`clubs/${clubId}/integrationConfig/growline`);
  const link = db.doc(`clubs/${clubId}/integrationLinks/${linkId}`);
  const member = db.doc(`clubs/${clubId}/members/${memberId}`);
  const receipt = db.doc(`clubs/${clubId}/members/${memberId}/integrationReceipts/${operationId}`);
  await club.set({ status: 'active' });
  await integration.set({ enabled: true, schemaVersion: 1 });
  await link.set({ schemaVersion: 1, status: 'active', verificationMethod: 'dual_authenticated_consent', verifiedAt: '2026-09-30T00:00:00.000Z', linkId, workspaceId: request.workspaceId, growlineProject: 'growline-local', clubProject: 'club-local-project', growlineMemberId: request.growlineMemberId, growlineAuthUid: 'growline-auth-1', clubMemberId: memberId });
  await member.set({ id: memberId, clubId, role: 'member', name: 'Synthetic member', phone: '+919876543210', phoneVerification: base.phoneVerification });

  assert.equal((await claim(request)).kind, 'CLAIMED');
  const first = await processHandoff(db, verifiedCaller(request), request, 'club-local');
  assert.deepEqual(first, { status: 'SUCCEEDED', outcome: 'MATCHED', operationId, canonicalClubMemberId: memberId });
  const replay = await processHandoff(db, verifiedCaller(request), request, 'club-local');
  assert.deepEqual(replay, { status: 'SUCCEEDED', outcome: 'already_exists', operationId, canonicalClubMemberId: memberId });

  const changed = { ...request, growlineMemberId: 'different-source-member' };
  assert.deepEqual(await processHandoff(db, verifiedCaller(changed), changed, 'club-local'), { status: 'REJECTED', code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await receipt.get()).exists, true);
  assert.equal((await member.collection('wallet').doc('data').get()).exists, false);
  assert.equal((await db.doc(`clubs/${clubId}/payments/handoff-${operationId}`).get()).exists, false);

  const concurrent = { ...request, handoffId: 'handoff_concurrent', idempotencyKey: 'destination-concurrent-operation' };
  const concurrentId = operationDocumentId(concurrent.idempotencyKey);
  const concurrentResults = await Promise.all([
    processHandoff(db, verifiedCaller(concurrent), concurrent, 'club-local'),
    processHandoff(db, verifiedCaller(concurrent), concurrent, 'club-local'),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.status).sort(), ['SUCCEEDED', 'SUCCEEDED']);
  assert.equal(concurrentResults[0].canonicalClubMemberId, concurrentResults[1].canonicalClubMemberId);
  assert.equal((await db.collection(`clubs/${clubId}/members`).get()).size, 1);
  assert.equal((await db.collection(`clubs/${clubId}/members/${memberId}/integrationReceipts`).get()).size, 2);

  await link.update({ status: 'revoked' });
  const historicalReplay = await processHandoff(db, verifiedCaller(request), request, 'club-local');
  assert.deepEqual(historicalReplay, { status: 'SUCCEEDED', outcome: 'already_exists', operationId, canonicalClubMemberId: memberId });

  await Promise.all([club, integration, link, member, receipt, db.collection('integrationHandoffs').doc(operationId), db.collection('integrationHandoffs').doc(concurrentId), db.doc(`clubs/${clubId}/members/${memberId}/integrationReceipts/${concurrentId}`)].map((ref) => ref.delete().catch(() => undefined)));
});

test('v2 creates one minimal Club member for unverified prospect contact and never creates financial state', async () => {
  const request = {
    ...base,
    handoffId: 'handoff_create',
    idempotencyKey: 'destination-create-operation',
    growlineMemberId: 'source_member_unverified_create',
    sourceGrowLineProspectId: 'prospect_unverified_create',
    linkId: 'link_create',
    phone: '+919999000001',
    phoneVerification: { status: 'unverified', method: 'growline_prospect', verifiedAt: null },
  };
  const operationId = operationDocumentId(request.idempotencyKey);
  const clubRef = db.doc(`clubs/${request.clubId}`);
  const configRef = db.doc(`clubs/${request.clubId}/integrationConfig/growline`);
  const link = db.doc(`clubs/${request.clubId}/integrationLinks/${request.linkId}`);
  const legacyUnverifiedMember = db.doc(`clubs/${request.clubId}/members/legacy_unverified_contact`);
  await clubRef.set({ status: 'active' });
  await configRef.set({ enabled: true, schemaVersion: 1 });
  await legacyUnverifiedMember.set({ id: legacyUnverifiedMember.id, clubId: request.clubId, role: 'member', status: 'active', name: 'Existing unverified contact', phone: request.phone, phoneVerification: { status: 'unverified', method: 'legacy_import', verifiedAt: null } });
  await link.set({ schemaVersion: 1, status: 'active', verificationMethod: 'dual_authenticated_consent', verifiedAt: '2026-09-30T00:00:00.000Z', linkId: request.linkId, workspaceId: request.workspaceId, growlineProject: 'growline-local', clubProject: 'club-local-project', growlineMemberId: request.growlineMemberId, growlineAuthUid: 'growline-auth-1' });

  const first = await processHandoff(db, verifiedCaller(request), request, 'club-local');
  assert.equal(first.status, 'SUCCEEDED');
  if (first.status !== 'SUCCEEDED') throw new Error('expected successful create');
  const memberRef = db.doc(`clubs/${request.clubId}/members/${first.canonicalClubMemberId}`);
  const member = (await memberRef.get()).data();
  assert.equal(member?.name, request.displayName);
  assert.equal(member?.phone, request.phone);
  assert.deepEqual(member?.phoneVerification, request.phoneVerification);
  assert.equal(member?.source?.coachId, request.sourceCoachId);
  assert.equal(member?.source?.prospectId, request.sourceGrowLineProspectId);
  assert.equal(member?.walletBalance, undefined);
  assert.equal((await memberRef.collection('wallet').doc('data').get()).exists, false);
  assert.equal((await memberRef.collection('transactions').get()).empty, true);
  assert.equal((await processHandoff(db, verifiedCaller(request), request, 'club-local')).status, 'SUCCEEDED');
  assert.notEqual(first.canonicalClubMemberId, legacyUnverifiedMember.id);
  assert.equal((await db.collection(`clubs/${request.clubId}/members`).where('phone', '==', request.phone).get()).size, 2);

  await Promise.all([clubRef.delete(), configRef.delete(), link.delete(), legacyUnverifiedMember.delete(), memberRef.collection('integrationReceipts').doc(operationId).delete(), memberRef.delete(), db.doc(`clubs/${request.clubId}/integrationMembers/${createHash('sha256').update(`growline-local:${request.workspaceId}:${request.growlineMemberId}`).digest('hex')}`).delete(), db.collection('integrationHandoffs').doc(operationId).delete()]);
});

test('destination denies wrong Club, unauthorized coach, revoked link, and routes ambiguous verified matches to review', async () => {
  const request = { ...base, handoffId: 'handoff-authorization', idempotencyKey: 'destination-authorization', growlineMemberId: 'source_member_authorization', sourceGrowLineProspectId: 'prospect_authorization', linkId: 'link_authorization' };
  const clubRef = db.doc(`clubs/${request.clubId}`);
  const configRef = db.doc(`clubs/${request.clubId}/integrationConfig/growline`);
  const linkRef = db.doc(`clubs/${request.clubId}/integrationLinks/${request.linkId}`);
  await clubRef.set({ status: 'active' });
  await configRef.set({ enabled: true, schemaVersion: 1 });
  await linkRef.set({ schemaVersion: 1, status: 'active', verificationMethod: 'dual_authenticated_consent', verifiedAt: '2026-09-30T00:00:00.000Z', linkId: request.linkId, workspaceId: request.workspaceId, growlineProject: 'growline-local', clubProject: 'club-local-project', growlineAuthUid: 'growline-auth-1' });

  assert.deepEqual(await processHandoff(db, verifiedCaller({ ...request, destinationClubId: 'other_club' }), { ...request, destinationClubId: 'other_club' }, 'club-local'), { status: 'REJECTED', code: 'DESTINATION_CLUB_MISMATCH' });
  assert.deepEqual(await processHandoff(db, verifiedCaller({ ...request, sourceCoachId: 'attacker' }), { ...request, sourceCoachId: 'attacker' }, 'club-local'), { status: 'REJECTED', code: 'SOURCE_COACH_MISMATCH' });

  const revoked = { ...request, handoffId: 'handoff-revoked', idempotencyKey: 'destination-revoked' };
  await linkRef.update({ status: 'revoked' });
  assert.deepEqual(await processHandoff(db, verifiedCaller(revoked), revoked, 'club-local'), { status: 'REJECTED', code: 'ACTIVE_IDENTITY_LINK_REQUIRED' });
  await linkRef.update({ status: 'active' });

  const ambiguous = { ...request, handoffId: 'handoff-ambiguous', idempotencyKey: 'destination-ambiguous', growlineMemberId: 'source_member_ambiguous', sourceGrowLineProspectId: 'prospect_ambiguous', phoneVerification: { status: 'verified', method: 'sms_otp', verifiedAt: '2026-09-30T00:00:00.000Z' } };
  const first = db.doc(`clubs/${request.clubId}/members/matched-one`);
  const second = db.doc(`clubs/${request.clubId}/members/matched-two`);
  await first.set({ id: first.id, clubId: request.clubId, role: 'member', phone: ambiguous.phone, phoneVerification: ambiguous.phoneVerification });
  await second.set({ id: second.id, clubId: request.clubId, role: 'member', phone: ambiguous.phone, phoneVerification: ambiguous.phoneVerification });
  const result = await processHandoff(db, verifiedCaller(ambiguous), ambiguous, 'club-local');
  assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED');
  if (result.status !== 'MANUAL_REVIEW_REQUIRED') throw new Error('ambiguous verified match must require manual review');
  assert.equal(result.reasonCode, 'conflicting_verified_contact_evidence');
  await Promise.all([clubRef.delete(), configRef.delete(), linkRef.delete(), first.delete(), second.delete(), db.collection('integrationHandoffs').doc(operationDocumentId(ambiguous.idempotencyKey)).delete()]);
});

test('Club owner issues a one-use code; GrowLine-authenticated redemption creates an audited dual-consent link idempotently', async () => {
  const clubId = 'club_linking';
  const ownerUid = 'club-owner-auth';
  const clubRef = db.doc(`clubs/${clubId}`);
  const ownerRef = db.doc(`clubs/${clubId}/authorizations/${ownerUid}`);
  await clubRef.set({ status: 'active' });
  await ownerRef.set({ clubId, enabled: true, role: 'owner' });
  const issued = await issueClubLinkCode(db, clubId, ownerUid, localSecret, 1_800_000_000_000);
  const record = await db.doc(`clubs/${clubId}/integrationCodes/${issued.codeId}`).get();
  assert.equal(record.data()?.codeHash === issued.code, false);
  const redemption = { clubId, code: issued.code, workspaceId: 'workspace_link', idempotencyKey: 'redemption-operation', growlineAuthUid: 'growline-auth-link', growlineProject: 'growline-local' };
  const linked = await redeemClubLinkCode(db, redemption, localSecret, 'club-local-project', 1_800_000_030_000);
  assert.equal(linked.status, 'active');
  assert.equal(linked.replay, false);
  assert.equal(linked.clubAuthUid, ownerUid);
  const replay = await redeemClubLinkCode(db, redemption, localSecret, 'club-local-project', 1_800_000_030_000);
  assert.equal(replay.linkId, linked.linkId);
  assert.equal(replay.replay, true);
  assert.equal(replay.clubAuthUid, ownerUid);
  const link = (await db.doc(`clubs/${clubId}/integrationLinks/${linked.linkId}`).get()).data();
  assert.equal(link?.verificationMethod, 'dual_authenticated_consent');
  assert.equal(link?.clubAuthUid, ownerUid);
  assert.equal(link?.growlineAuthUid, redemption.growlineAuthUid);
  assert.equal(link?.auditEvents.length, 2);
  assert.equal((await db.doc(`clubs/${clubId}/integrationCodes/${issued.codeId}`).get()).data()?.usedCount, 1);
  const revocation = { clubId, linkId: linked.linkId, workspaceId: redemption.workspaceId, idempotencyKey: 'unlink-operation', growlineAuthUid: redemption.growlineAuthUid, growlineProject: redemption.growlineProject };
  const revoked = await revokeClubGrowlineLink(db, revocation, { growlineAuthUid: redemption.growlineAuthUid, growlineProject: redemption.growlineProject }, 1_800_000_031_000);
  assert.equal(revoked.status, 'revoked');
  assert.equal((await db.doc(`clubs/${clubId}/integrationLinks/${linked.linkId}`).get()).data()?.status, 'revoked');
  assert.equal((await revokeClubGrowlineLink(db, revocation, { growlineAuthUid: redemption.growlineAuthUid, growlineProject: redemption.growlineProject }, 1_800_000_032_000)).replay, true);
  await assert.rejects(revokeClubGrowlineLink(db, revocation, { growlineAuthUid: 'other-auth', growlineProject: redemption.growlineProject }), /INVALID_LINK_REVOCATION/);
  await assert.rejects(redeemClubLinkCode(db, { ...redemption, idempotencyKey: 'different-redemption' }, localSecret, 'club-local-project', 1_800_000_030_000), /IDENTITY_LINK_CONFLICT/);
  await assert.rejects(issueClubLinkCode(db, clubId, 'not-an-owner', localSecret, 1_800_000_000_000), /CLUB_ADMIN_REQUIRED/);
  await Promise.all([clubRef.delete(), ownerRef.delete(), db.doc(`clubs/${clubId}/integrationConfig/growline`).delete(), db.doc(`clubs/${clubId}/integrationCodes/${issued.codeId}`).delete(), db.doc(`clubs/${clubId}/integrationLinks/${linked.linkId}`).delete()]);
});
