import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireClubAdministrator, activityWindow, projectApprovedActivity, activeCoachPage, ownerLinkPage, revokeOwnerCodeOrLink } from '../lib/growlineOwnerIntegration.js';
import { issueClubLinkCode } from '../lib/clubLinking.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local Firestore emulator required');
const app = initializeApp({ projectId: 'demo-club-owner-activity' }, 'owner-activity-tests');
const db = getFirestore(app);
after(() => deleteApp(app));
const actor = { uid: 'owner', token: { clubId: 'club-one', role: 'owner', station: false, firebase: { sign_in_provider: 'password' } } };

test('only correct-club, correct-role, nonanonymous verified administrators can request owner activity', async () => {
  await db.doc('clubs/club-one/authorizations/owner').set({ uid: 'owner', clubId: 'club-one', role: 'owner', enabled: true });
  assert.equal((await requireClubAdministrator(db, actor, 'club-one')).uid, 'owner');
  for (const invalid of [undefined, { ...actor, uid: 'missing' }, { ...actor, token: { ...actor.token, role: 'member' } },
    { ...actor, token: { ...actor.token, clubId: 'club-two' } }, { ...actor, token: { ...actor.token, station: true } },
    { ...actor, token: { ...actor.token, firebase: { sign_in_provider: 'anonymous' } } }]) {
    await assert.rejects(requireClubAdministrator(db, invalid, 'club-one'), /CLUB_ADMIN_REQUIRED/);
  }
  await assert.rejects(requireClubAdministrator(db, actor, 'club-two'), /CLUB_ADMIN_REQUIRED/);
  await db.doc('clubs/club-one/authorizations/owner').update({ enabled: false });
  await assert.rejects(requireClubAdministrator(db, actor, 'club-one'), /CLUB_ADMIN_REQUIRED/);
});

test('activity periods reject impossible dates, future dates, inversions and more than 31 days', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.deepEqual(activityWindow('2026-09-01', '2026-10-01', now), { from: '2026-09-01', to: '2026-10-01' });
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-10-01', '2026-10-02'], ['2026-10-01', '2026-09-30'], ['2026-08-31', '2026-10-01']]) {
    assert.throws(() => activityWindow(from, to, now), /INVALID_ACTIVITY_WINDOW/);
  }
});

test('owner response strictly excludes prospect/private/health/financial fields and unexpected links', () => {
  const row = { linkId: 'link-one', displayName: 'Approved coach', logs: 2, peopleMet: 3, membersConverted: 1 };
  const expected = new Set(['link-one']);
  assert.deepEqual(projectApprovedActivity({ schemaVersion: 1, coaches: [row] }, expected), [{ displayName: 'Approved coach', logs: 2, peopleMet: 3, membersConverted: 1 }]);
  for (const name of ['prospectName', 'phone', 'email', 'notes', 'reports', 'health', 'bodyComposition', 'wallet', 'payment']) {
    assert.throws(() => projectApprovedActivity({ schemaVersion: 1, coaches: [{ ...row, [name]: 'forbidden' }] }, expected), /INVALID_ACTIVITY_RESPONSE/);
  }
  for (const coaches of [[{ ...row, linkId: 'other-club-link' }], [row, row], [{ ...row, logs: -1 }], [{ ...row, logs: 1.5 }]]) {
    assert.throws(() => projectApprovedActivity({ schemaVersion: 1, coaches }, expected), /INVALID_ACTIVITY_RESPONSE/);
  }
});

test('owner roster is bounded and only active correctly scoped relationships are sent to GrowLine', async () => {
  const batch = db.batch();
  for (let index = 0; index < 27; index++) {
    const linkId = `link-${String(index).padStart(2, '0')}`;
    batch.set(db.doc(`clubs/roster-club/integrationLinks/${linkId}`), { linkId, clubId: 'roster-club', growlineProject: 'demo-growline-local', workspaceId: 'workspace', growlineAuthUid: `coach-${index}`, status: 'active', verificationMethod: 'dual_authenticated_consent' });
  }
  batch.set(db.doc('clubs/roster-club/integrationLinks/revoked'), { clubId: 'roster-club', status: 'revoked' });
  await batch.commit();
  const first = await activeCoachPage(db, 'roster-club', 'demo-growline-local');
  assert.equal(first.coaches.length, 25);
  assert.equal(typeof first.nextCursor, 'string');
  const second = await activeCoachPage(db, 'roster-club', 'demo-growline-local', first.nextCursor);
  assert.equal(second.coaches.length, 2);
  assert.equal(second.nextCursor, null);
  assert.equal((await activeCoachPage(db, 'roster-club', 'wrong-project')).coaches.length, 0);
  const all = await ownerLinkPage(db, 'roster-club');
  assert.equal(all.links.length, 25);
  assert.equal(Object.keys(all.links[0]).sort().join(','), 'linkId,linkedAt,status');
});

test('owner revocation is audited, replay-safe and preserves successful members and handoff history', async () => {
  const auditBefore = (await db.collection('clubs/revoke-club/authorizationAudit').get()).size;
  await db.doc('clubs/revoke-club/authorizations/owner').set({ uid: 'owner', clubId: 'revoke-club', role: 'owner', enabled: true });
  await db.doc('clubs/revoke-club/integrationLinks/link-one').set({ clubId: 'revoke-club', status: 'active' });
  await db.doc('clubs/revoke-club/members/canonical-member').set({ name: 'Synthetic member' });
  await db.doc('integrationHandoffs/succeeded-owner-test').set({ status: 'SUCCEEDED', canonicalClubMemberId: 'canonical-member' });
  await assert.rejects(revokeOwnerCodeOrLink(db, 'revoke-club', 'member', 'owner', 'link', 'link-one'), /CLUB_ADMIN_REQUIRED/);
  assert.equal((await revokeOwnerCodeOrLink(db, 'revoke-club', 'owner', 'owner', 'link', 'link-one')).replay, false);
  assert.equal((await revokeOwnerCodeOrLink(db, 'revoke-club', 'owner', 'owner', 'link', 'link-one')).replay, true);
  assert.equal((await db.doc('clubs/revoke-club/members/canonical-member').get()).exists, true);
  assert.equal((await db.doc('integrationHandoffs/succeeded-owner-test').get()).get('status'), 'SUCCEEDED');
  assert.equal((await db.collection('clubs/revoke-club/authorizationAudit').get()).size, auditBefore + 1);
  await assert.rejects(revokeOwnerCodeOrLink(db, 'other-club', 'owner', 'owner', 'link', 'link-one'), /CLUB_ADMIN_REQUIRED/);
});

test('issuing a replacement owner code atomically revokes outstanding codes and records rotation', async () => {
  const clubId = `rotation-${randomUUID()}`;
  const pepper = 'synthetic-test-only-code-pepper-at-least-32-characters';
  await db.doc(`clubs/${clubId}`).set({ status: 'active' });
  await db.doc(`clubs/${clubId}/authorizations/owner`).set({ uid: 'owner', clubId, role: 'owner', enabled: true });
  const first = await issueClubLinkCode(db, clubId, 'owner', pepper);
  const second = await issueClubLinkCode(db, clubId, 'owner', pepper, Date.now(), false, true);
  assert.notEqual(first.code, second.code);
  assert.equal((await db.doc(`clubs/${clubId}/integrationCodes/${first.codeId}`).get()).get('status'), 'revoked');
  assert.equal((await db.doc(`clubs/${clubId}/integrationCodes/${second.codeId}`).get()).get('status'), 'active');
  const issued = await db.collection(`clubs/${clubId}/authorizationAudit`).where('codeId', '==', second.codeId).get();
  assert.equal(issued.size, 1);
  assert.equal(issued.docs[0].get('rotatedCodes'), 1);
  assert.equal(issued.docs[0].get('actorUid'), 'owner');
});
