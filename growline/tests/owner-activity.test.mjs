import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { loadSource } from './support/load-typescript.mjs';

const { validateClubActivityRequest, verifyClubActivityAssertion, summarizeApprovedLogs, activeApprovedRelationship } = await loadSource(new URL('../src/lib/integration/activity-contract.ts', import.meta.url));
const { getClubCoachActivity, setClubActivitySharing } = await loadSource(new URL('../src/lib/integration/club-activity.ts', import.meta.url));
const config = { audience: 'urn:growline:local-owner-test', clubProject: 'demo-club-owner-activity', growlineProject: 'demo-growline-owner-activity', keyId: 'local-test-key', secret: 'synthetic-owner-activity-test-key-over-32-characters' };
const coach = { linkId: 'link-one', workspaceId: 'workspace-one', growlineAuthUid: 'coach-one' };
const request = { schemaVersion: 1, clubId: 'club-one', from: '2026-10-01', to: '2026-10-01', coaches: [coach] };
const link = { ...coach, clubId: request.clubId, clubProject: config.clubProject, growlineProject: config.growlineProject, status: 'active', verificationMethod: 'dual_authenticated_consent', activitySharingEnabled: true, activityDisplayName: 'Approved synthetic coach' };

function sign(body = request, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'club-service', aud: config.audience, ...config, secret: undefined, keyId: undefined, kid: config.keyId, clubAuthUid: 'verified-owner', iat: 100, exp: 160, requestHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...overrides })).toString('base64url');
  return 'Bearer ' + `${header}.${claims}.${createHmac('sha256', config.secret).update(`${header}.${claims}`).digest('base64url')}`;
}

test('signed owner activity validates exact projects, audience, actor, expiry and request hash', () => {
  assert.equal(verifyClubActivityAssertion(sign(), request, config, 120).clubAuthUid, 'verified-owner');
  for (const overrides of [{ iss: 'growline-service' }, { aud: 'wrong' }, { clubProject: 'wrong' }, { growlineProject: 'wrong' }, { clubAuthUid: '' }, { exp: 120 }, { iat: 121 }, { requestHash: 'wrong' }, { kid: 'wrong' }]) {
    assert.throws(() => verifyClubActivityAssertion(sign(request, overrides), request, config, 120), /UNAUTHORIZED_CLUB_SERVICE/);
  }
  assert.throws(() => verifyClubActivityAssertion(null, request, config, 120), /UNAUTHORIZED_CLUB_SERVICE/);
  assert.throws(() => verifyClubActivityAssertion(sign().slice(0, -2) + 'xx', request, config, 120), /UNAUTHORIZED_CLUB_SERVICE/);
});

test('request boundary denies prospect selectors, private fields, invalid dates and oversized rosters', () => {
  assert.deepEqual(validateClubActivityRequest(request, '2026-10-01'), request);
  for (const invalid of [{ ...request, phone: 'forbidden' }, { ...request, from: '2026-02-30' }, { ...request, to: '2026-10-02' }, { ...request, from: '2026-08-30' }, { ...request, coaches: [coach, coach] }, { ...request, coaches: Array.from({ length: 26 }, (_, n) => ({ ...coach, linkId: `link-${n}` })) }]) {
    assert.throws(() => validateClubActivityRequest(invalid, '2026-10-01'), /INVALID_ACTIVITY_REQUEST/);
  }
});

test('aggregate projection ignores legacy, wrong-workspace and wrong-coach rows and never emits source PII', () => {
  const row = { userId: coach.growlineAuthUid, workspaceId: coach.workspaceId, dayKey: '2026-10-01', memberships: 2, notes: 'private', name: 'private prospect', bodyFat: 20 };
  assert.deepEqual(summarizeApprovedLogs([row, { ...row, workspaceId: 'other' }, { ...row, workspaceId: undefined }, { ...row, userId: 'other' }, { ...row, dayKey: '2026-09-30' }], coach.growlineAuthUid, coach.workspaceId, request.from, request.to), { logs: 1, membersConverted: 2 });
  assert.equal(activeApprovedRelationship(link, { workspaceId: coach.workspaceId }, coach, request.clubId, config.clubProject, config.growlineProject), true);
  for (const invalid of [{ ...link, status: 'revoked' }, { ...link, activitySharingEnabled: false }, { ...link, clubId: 'other' }, { ...link, growlineProject: 'other' }, { ...link, workspaceId: 'other' }]) {
    assert.equal(activeApprovedRelationship(invalid, { workspaceId: coach.workspaceId }, coach, request.clubId, config.clubProject, config.growlineProject), false);
  }
});

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local Firestore emulator required');
const app = initializeApp({ projectId: config.growlineProject }, 'growline-owner-tests');
const db = getFirestore(app);
after(() => deleteApp(app));
process.env.CLUB_FIREBASE_PROJECT_ID = config.clubProject;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = config.growlineProject;

test('real aggregate query counts only opted-in scoped data, including India day boundaries', async () => {
  await db.doc('users/coach-one').set({ workspaceId: coach.workspaceId, name: 'Approved synthetic coach' });
  await db.doc('integrationLinks/link-one').set(link);
  await db.doc('dailyLogs/coach-one__2026-10-01').set({ userId: coach.growlineAuthUid, workspaceId: coach.workspaceId, dayKey: request.from, memberships: 2, notes: 'private note', phone: 'private contact' });
  const batch = db.batch();
  for (const [id, workspaceId, at] of [['in-window', coach.workspaceId, '2026-09-30T18:31:00Z'], ['before-midnight', coach.workspaceId, '2026-09-30T18:29:00Z'], ['next-day', coach.workspaceId, '2026-10-01T18:30:00Z'], ['wrong-workspace', 'other', '2026-10-01T12:00:00Z']]) {
    batch.set(db.doc(`prospects/${id}`), { coachId: coach.growlineAuthUid, workspaceId, createdAt: Timestamp.fromDate(new Date(at)), name: 'Never transfer this name', phone: 'Never transfer this phone', health: { weight: 70 } });
  }
  await batch.commit();
  assert.deepEqual(await getClubCoachActivity(db, request, config.clubProject, config.growlineProject), [{ linkId: coach.linkId, displayName: link.activityDisplayName, logs: 1, peopleMet: 1, membersConverted: 2 }]);
  await db.doc('integrationLinks/link-one').update({ activitySharingEnabled: false });
  assert.deepEqual(await getClubCoachActivity(db, request, config.clubProject, config.growlineProject), []);
  await db.doc('integrationLinks/link-one').update({ activitySharingEnabled: true, status: 'revoked' });
  assert.deepEqual(await getClubCoachActivity(db, request, config.clubProject, config.growlineProject), []);
  await assert.rejects(getClubCoachActivity(db, { ...request, clubId: 'wrong-club' }, config.clubProject, config.growlineProject), /CLUB_RELATIONSHIP_SCOPE_MISMATCH/);
});

test('activity consent requires owner coach identity and workspace, audits opt-in/out, never accepts profile inputs', async () => {
  const auditBefore = (await db.collection('integrationActivityConsentAudit').get()).size;
  await db.doc('integrationLinks/link-one').set({ ...link, activitySharingEnabled: false });
  await assert.rejects(setClubActivitySharing(db, 'another-coach', coach.linkId, true), /ACTIVITY_LINK_NOT_FOUND/);
  assert.equal((await setClubActivitySharing(db, coach.growlineAuthUid, coach.linkId, true)).approvedDisplayName, link.activityDisplayName);
  assert.equal((await setClubActivitySharing(db, coach.growlineAuthUid, coach.linkId, false)).activitySharingEnabled, false);
  assert.equal((await db.doc('integrationLinks/link-one').get()).get('activityDisplayName'), null);
  assert.equal((await db.collection('integrationActivityConsentAudit').get()).size, auditBefore + 2);
  await db.doc('users/coach-one').update({ workspaceId: 'other-workspace' });
  await assert.rejects(setClubActivitySharing(db, coach.growlineAuthUid, coach.linkId, true), /ACTIVITY_LINK_UNAVAILABLE/);
});
