import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';

for (const variable of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[variable] ?? '')) throw new Error(`${variable} must use loopback`);
}
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-club-security-tests' });
const { enrollStation } = require('../functions/lib/stationAuth.js');
const { assignVerifiedClubAdministrator } = require('../functions/lib/authorization.js');
const db = admin.firestore();
const owner = { uid: 'enrollment-owner', token: { clubId: 'club-enroll', role: 'owner', firebase: { sign_in_provider: 'password' } } };
let client;
before(async () => {
  await db.doc('clubs/club-enroll/authorizations/enrollment-owner').set({ enabled: true, clubId: 'club-enroll', role: 'owner' });
  client = initializeApp({ apiKey: 'demo-only-api-key', projectId: 'demo-club-security-tests' }, 'enrollment-test');
  connectAuthEmulator(getAuth(client), `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
});
after(async () => { if (client) await deleteApp(client); await admin.app().delete(); });

// Exercise the deployed callable handler with actual emulator-backed Admin SDK
// operations. These are handler integration tests, not HTTP transport tests.
test('enrollment rejects an unauthenticated request', async () => {
  await assert.rejects(enrollStation.run({ data: { clubId: 'club-enroll', role: 'reception' } }), { code: 'unauthenticated' });
});
for (const [name, actor] of [
  ['anonymous', { ...owner, token: { ...owner.token, firebase: { sign_in_provider: 'anonymous' } } }],
  ['wrong club', { ...owner, token: { ...owner.token, clubId: 'other-club' } }],
  ['wrong role', { ...owner, token: { ...owner.token, role: 'member' } }],
  ['claim without grant', { ...owner, uid: 'unprovisioned-owner' }],
  ['platform claim without allowlist', { uid: 'fake-platform', token: { platformAdmin: true, firebase: { sign_in_provider: 'password' } } }],
]) {
  test(`enrollment rejects ${name}`, async () => {
    await assert.rejects(enrollStation.run({ auth: actor, data: { clubId: 'club-enroll', role: 'reception' } }), { code: 'permission-denied' });
  });
}
for (const role of ['reception', 'kitchen', 'tv']) {
  test(`owner enrolls a unique ${role} principal that can authenticate`, async () => {
    const first = await enrollStation.run({ auth: owner, data: { clubId: 'club-enroll', role } });
    const second = await enrollStation.run({ auth: owner, data: { clubId: 'club-enroll', role } });
    assert.notEqual(first.uid, second.uid);
    const credentials = await signInWithCustomToken(getAuth(client), first.token);
    const identity = await credentials.user.getIdTokenResult();
    assert.equal(credentials.user.isAnonymous, false);
    assert.equal(identity.claims.clubId, 'club-enroll');
    assert.equal(identity.claims.role, role);
    const grant = (await db.doc(`clubs/club-enroll/authorizations/${first.uid}`).get()).data();
    assert.equal(grant.enabled, true);
    assert.equal(grant.role, role);
  });
}
test('revoked owner cannot enroll a station with stale claims', async () => {
  await db.doc('clubs/club-enroll/authorizations/enrollment-owner').update({ enabled: false });
  await assert.rejects(enrollStation.run({ auth: owner, data: { clubId: 'club-enroll', role: 'tv' } }), { code: 'permission-denied' });
});

test('ordinary owner cannot assign administrator privileges', async () => {
  await assert.rejects(assignVerifiedClubAdministrator.run({ auth: owner, data: {
    clubId: 'club-enroll', uid: 'target-human', role: 'owner', verificationReference: 'review-fixture-001',
  } }), { code: 'permission-denied' });
});
test('platform admin assigns a verified human UID and records an audit entry', async () => {
  const uid = `target-human-${randomUUID()}`;
  const platform = { uid: 'assignment-platform', token: { firebase: { sign_in_provider: 'password' } } };
  await db.doc('superAdmins/assignment-platform').set({ enabled: true });
  await db.doc('clubs/club-enroll').set({ name: 'Fixture Club', ownerUserId: 'owner_club-enroll' });
  await admin.auth().createUser({ uid, email: `${uid}@example.invalid`, password: 'emulator-fixture-only-password', emailVerified: true });
  const result = await assignVerifiedClubAdministrator.run({ auth: platform, data: {
    clubId: 'club-enroll', uid, role: 'owner', verificationReference: 'review-fixture-001',
  } });
  assert.equal(result.role, 'owner');
  assert.equal((await db.doc(`clubs/club-enroll/authorizationAudit/${result.auditId}`).get()).data().actorUid, platform.uid);
  assert.equal((await admin.auth().getUser(uid)).customClaims.role, 'owner');
  assert.equal((await db.doc('clubs/club-enroll').get()).data().ownerUserId, 'owner_club-enroll');
});
test('assignment requires verification provenance', async () => {
  await assert.rejects(assignVerifiedClubAdministrator.run({ auth: owner, data: { clubId: 'club-enroll', uid: 'target-human', role: 'owner' } }), { code: 'invalid-argument' });
});
