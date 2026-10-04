import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc as sdkDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ref as sdkRef, uploadBytes } from 'firebase/storage';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { invalidateFederationLink } from '../functions/lib/federationLinkRevocation.js';
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getFirestore } = requireFunctions('firebase-admin/firestore');

for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[name] ?? '')) throw new Error('LOCAL_CLUB_EMULATORS_REQUIRED');
}
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]);
const storagePort = Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[1]);
// Storage cross-service lookups use the configured emulator project. Never clear this interactive namespace.
const projectId = 'demo-club-security';
let clubId, memberUid, pairId, linkId;
const path = value => value.replace('club-a', clubId).replace(/\/member(?=\/|$)/g, '/' + memberUid).replace(/\/pair(?=\/|$)/g, '/' + pairId).replace(/\/link(?=\/|$)/g, '/' + linkId);
const doc = (db, value) => sdkDoc(db, path(value));
const ref = (storage, value) => sdkRef(storage, path(value));
const env = await initializeTestEnvironment({ projectId,
  firestore: { host: '127.0.0.1', port: firestorePort, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { host: '127.0.0.1', port: storagePort, rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
});
const adminApp = initializeApp({ projectId }, 'sso-session-rules');
const adminDb = getFirestore(adminApp);
after(async () => { await env.cleanup(); await deleteApp(adminApp); });
const authTime = Math.floor(Date.now()/1000);
let claims = { aud: projectId, auth_time: authTime, clubId: 'unset-before-fixture', role: 'member', station: false, federationPairId: 'unset-before-fixture', federationEpoch: 1, federationSessionEpoch: 0, firebase: { sign_in_provider: 'custom' } };
async function fixture() {
  const suffix = randomUUID(); clubId = 'sso-club-' + suffix; memberUid = 'sso-member-' + suffix; pairId = 'sso-pair-' + suffix; linkId = 'sso-link-' + suffix;
  claims = { ...claims, clubId, federationPairId: pairId };
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'clubs/club-a'), { status: 'active' });
    await setDoc(doc(db, 'clubs/club-a/members/member'), { clubId, status: 'active' });
    await setDoc(doc(db, 'clubs/club-a/authorizations/member'), { uid: memberUid, clubId, role: 'member', station: false, enabled: true });
    await setDoc(doc(db, 'clubs/club-a/integrationLinks/link'), { status: 'active' });
    await setDoc(doc(db, 'integrationFederationPairs/pair'), { status: 'active', prepared: false, epoch: 1, localSessionEpoch: 0, validAfter: 0, clubMemberAuthUid: memberUid, clubProject: projectId, clubId, linkId });
  });
}
const member = () => env.authenticatedContext(memberUid, claims);
async function mutate(path, data) { await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), data)); }
async function deniedEverywhere(context = member()) {
  await assertFails(getDoc(doc(context.firestore(), 'clubs/club-a/members/member')));
  await assertFails(uploadBytes(ref(context.storage(), 'clubs/club-a/members/member/sso-test.txt'), new Uint8Array([1])));
}
test('active scoped federation session permits ordinary member Firestore and Storage only', async () => {
  await fixture(); const context = member();
  await assertSucceeds(getDoc(doc(context.firestore(), 'clubs/club-a/members/member')));
  await assertSucceeds(uploadBytes(ref(context.storage(), 'clubs/club-a/members/member/sso-test.txt'), new Uint8Array([1])));
  await assertFails(setDoc(doc(context.firestore(), 'clubs/club-a/wallets/member'), { balance: 100 }));
});
test('pair epoch, revocation, prepared and pending peer invalidation immediately deny Firestore/Storage', async () => {
  for (const changed of [{ epoch: 2 }, { status: 'revoked' }, { prepared: true }, { pendingInvalidation: true }]) { await fixture(); await mutate('integrationFederationPairs/pair', changed); await deniedEverywhere(); }
});
test('session epoch and logout auth_time cutoff deny both federated and earlier ordinary sessions', async () => {
  await fixture();
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'integrationFederationSessions/member'), { epoch: 1, validAfter: authTime }));
  await mutate('integrationFederationPairs/pair', { localSessionEpoch: 1, validAfter: authTime });
  await deniedEverywhere();
  await deniedEverywhere(env.authenticatedContext(memberUid, { auth_time: authTime, role: 'member', clubId, firebase: { sign_in_provider: 'password' } }));
  const fresh = env.authenticatedContext(memberUid, { ...claims, auth_time: authTime + 1, federationSessionEpoch: 1 });
  await assertSucceeds(getDoc(doc(fresh.firestore(), 'clubs/club-a/members/member')));
});
test('wrong Club/project/UID and owner/admin/station claim escalation fail closed', async () => {
  await fixture();
  for (const changed of [{ clubId: 'club-b' }, { aud: 'wrong-project' }, { role: 'owner' }, { role: 'admin' }, { role: 'reception', station: true }]) await deniedEverywhere(env.authenticatedContext(memberUid, { ...claims, ...changed }));
  await deniedEverywhere(env.authenticatedContext('unpaired', claims));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'superAdmins/member'), { enabled: true }));
  await assertFails(setDoc(doc(member().firestore(), 'globalMenu/forged'), { forged: true }));
  await assertFails(uploadBytes(ref(member().storage(), 'globalMenu/images/forged.txt'), new Uint8Array([1])));
});
test('atomic relationship revocation denies existing sessions and all SSO state/audit/outbox remains browser-private', async () => {
  await fixture();
  await adminDb.runTransaction(async tx => {
    await invalidateFederationLink(tx, adminDb, clubId, linkId, 'verified-owner');
    tx.update(adminDb.doc(path('clubs/club-a/integrationLinks/link')), { status: 'revoked' });
  });
  await deniedEverywhere();
  const collections = ['integrationFederationPairs','integrationFederationSessions','integrationFederationAudit','integrationFederationOutbox','integrationFederationIdentities','integrationFederationRequests','integrationFederationProposals','integrationFederationRpc','integrationFederationInvalidations','integrationFederationExchanges','integrationFederationPairingIntents'];
  for (const collection of collections) {
    for (const context of [env.unauthenticatedContext(), env.authenticatedContext('owner', { clubId: 'club-a', role: 'owner' }), member()]) {
      await assertFails(getDoc(doc(context.firestore(), `${collection}/private`)));
      await assertFails(setDoc(doc(context.firestore(), `${collection}/private`), { forged: true }));
    }
  }
  assert.equal(collections.length, 11);
});
