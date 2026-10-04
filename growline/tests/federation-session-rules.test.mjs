import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8081') throw new Error('LOCAL_GROWLINE_EMULATOR_REQUIRED');
const projectId = 'demo-growline-sso-rules';
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8081, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
after(() => env.cleanup());
const authTime = Math.floor(Date.now()/1000);
const claims = { aud: projectId, auth_time: authTime, federationPairId: 'pair', federationEpoch: 1, federationSessionEpoch: 0, firebase: { sign_in_provider: 'custom' } };
async function fixture() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/coach'), { workspaceId: 'workspace-a', disabled: false, uplinePath: [] });
    await setDoc(doc(db, 'prospects/person'), { coachId: 'coach', workspaceId: 'workspace-a' });
    await setDoc(doc(db, 'integrationLinks/link'), { status: 'active' });
    await setDoc(doc(db, 'integrationFederationPairs/pair'), { status: 'active', prepared: false, epoch: 1, growlineAuthUid: 'coach', growlineProject: projectId, workspaceId: 'workspace-a', linkId: 'link' });
  });
}
const context = (changed = {}) => env.authenticatedContext('coach', { ...claims, ...changed });
const read = ctx => getDoc(doc(ctx.firestore(), 'prospects/person'));
async function mutate(path, data) { await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), path), data)); }
test('active ordinary coach federation session preserves own prospect read and no client writes', async () => {
  await fixture(); await assertSucceeds(read(context())); await assertFails(setDoc(doc(context().firestore(), 'prospects/person'), { forged: true }));
});
test('revoked pair, advanced epoch, prepared/pending state and wrong destination deny', async () => {
  for (const changed of [{ status: 'revoked' }, { epoch: 2 }, { prepared: true }, { pendingInvalidation: true }, { growlineProject: 'wrong-project' }, { growlineAuthUid: 'unpaired' }]) { await fixture(); await mutate('integrationFederationPairs/pair', changed); await assertFails(read(context())); }
});
test('logout invalidates federated and ordinary old tokens; fresh local auth remains independently authorized', async () => {
  await fixture(); await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'integrationFederationSessions/coach'), { epoch: 1, validAfter: authTime }));
  await assertFails(read(context())); await assertFails(read(env.authenticatedContext('coach', { auth_time: authTime, firebase: { sign_in_provider: 'password' } })));
  await assertSucceeds(read(context({ auth_time: authTime + 1, federationSessionEpoch: 1 })));
});
test('revoked link, disabled or moved coach deny established federation session', async () => {
  for (const [path, changed] of [['integrationLinks/link', { status: 'revoked' }], ['users/coach', { disabled: true }], ['users/coach', { workspaceId: 'wrong-workspace' }]]) { await fixture(); await mutate(path, changed); await assertFails(read(context())); }
});
test('every pairing/session/audit/exchange/outbox collection is private to all browser identities', async () => {
  await fixture();
  for (const collection of ['integrationFederationPairs','integrationFederationSessions','integrationFederationAudit','integrationFederationOutbox','integrationFederationIdentities','integrationFederationRequests','integrationFederationProposals','integrationFederationRpc','integrationFederationInvalidations','integrationFederationExchanges','integrationFederationPairingIntents']) {
    for (const ctx of [env.unauthenticatedContext(), context(), env.authenticatedContext('admin', { admin: true })]) {
      await assertFails(getDoc(doc(ctx.firestore(), `${collection}/private`))); await assertFails(setDoc(doc(ctx.firestore(), `${collection}/private`), { forged: true }));
    }
  }
});
