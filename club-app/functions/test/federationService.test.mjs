import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FederationService, requireFederationSession } from '../lib/federationService.js';
import { federationDigest } from '../lib/federationContract.js';
import { revokeOwnerCodeOrLink } from '../lib/growlineOwnerIntegration.js';
import { FederationService as GrowlineFederationService } from '../../../growline/src/lib/integration/federation-service.ts';

// Actual SDKs, two independent namespaces/databases, loopback HTTP, Auth and Firestore only.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180' ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('ISOLATED_LOCAL_EMULATORS_REQUIRED');
const requireGrow = createRequire(new URL('../../../growline/package.json', import.meta.url));
const growApps = requireGrow('firebase-admin/app'), growAuth = requireGrow('firebase-admin/auth'), growFirestore = requireGrow('firebase-admin/firestore');
const clubProject = 'demo-club-sso-local', growlineProject = 'demo-growline-sso-local';
const clubApp = initializeApp({ projectId: clubProject }, 'club-sso-service-tests');
const growApp = growApps.initializeApp({ projectId: growlineProject }, 'growline-sso-service-tests');
const clubDb = getFirestore(clubApp), growDb = growFirestore.getFirestore(growApp);
clubDb.settings({ host: '127.0.0.1:8180', ssl: false }); growDb.settings({ host: '127.0.0.1:8081', ssl: false });
const clubAuth = getAuth(clubApp), coachAuth = growAuth.getAuth(growApp);
const secret = 'synthetic-local-sso-test-only-dedicated-key-2026';
const password = 'Synthetic-SSO-Only-2026!';
let clubService, coachService, dropInvalidation = false, dropPrepare = false;
async function server(app) {
  const listener = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const service = app === 'club' ? clubService : coachService;
      const raw = JSON.parse(Buffer.concat(chunks).toString());
      if (dropInvalidation && typeof raw.body === 'string' && JSON.parse(raw.body).operation === 'invalidate') throw new Error('simulated-network-loss');
      if (dropPrepare && typeof raw.body === 'string' && JSON.parse(raw.body).operation === 'prepare') throw new Error('simulated-prepare-loss');
      const result = await service.handle(raw, req.headers.origin, req.headers.authorization?.replace(/^Bearer /, ''));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'FEDERATION_DENIED' })); }
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  return { listener, origin: `http://127.0.0.1:${listener.address().port}` };
}
const clubServer = await server('club'), growServer = await server('growline');
const config = { enabled: true, clubProject, growlineProject, clubOrigin: clubServer.origin, growlineOrigin: growServer.origin, keyId: 'local-sso-test', secret, local: true };
clubService = new FederationService(clubDb, clubAuth, { ...config, app: 'club', peerUrl: growServer.origin });
coachService = new GrowlineFederationService(growDb, coachAuth, { ...config, app: 'growline', peerUrl: clubServer.origin });
after(async () => { await Promise.all([new Promise(resolve => clubServer.listener.close(resolve)), new Promise(resolve => growServer.listener.close(resolve))]); await deleteApp(clubApp); await growApps.deleteApp(growApp); });

async function authPost(action, payload, project) {
  const response = await fetch(`http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:${action}?key=synthetic-only`, {
    // The emulator's admin header selects an isolated test namespace; password/custom-token verification still runs.
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ ...payload, targetProjectId: project }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `Synthetic Auth ${action} failed: ${result.error?.message ?? 'unknown'}`);
  return result;
}
async function signIn(project, email) {
  const token = (await authPost('signInWithPassword', { email, password, returnSecureToken: true }, project)).idToken;
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aud, project);
  return token;
}
async function call(app, operation, payload = {}, token) {
  const origin = app === 'club' ? clubServer.origin : growServer.origin;
  const response = await fetch(origin, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ operation, payload }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function fixture(pair = true) {
  const suffix = randomUUID(), clubId = `club-${suffix}`, workspaceId = `workspace-${suffix}`, linkId = `link-${suffix}`;
  const memberUid = `member-${suffix}`, coachUid = `coach-${suffix}`;
  const memberEmail = `member-${suffix}@example.test`, coachEmail = `coach-${suffix}@example.test`;
  await clubAuth.createUser({ uid: memberUid, email: memberEmail, password, emailVerified: true });
  await coachAuth.createUser({ uid: coachUid, email: coachEmail, password, emailVerified: true });
  await clubAuth.setCustomUserClaims(memberUid, { clubId, role: 'member', station: false });
  await clubDb.doc(`clubs/${clubId}`).set({ status: 'active' });
  await clubDb.doc(`clubs/${clubId}/authorizations/${memberUid}`).set({ uid: memberUid, clubId, role: 'member', station: false, enabled: true, verifiedBy: 'verified-test-platform-admin', verificationReference: 'controlled-staging-style-test' });
  await clubDb.doc(`clubs/${clubId}/members/${memberUid}`).set({ clubId, status: 'active', name: 'Synthetic SSO Member' });
  await growDb.doc(`users/${coachUid}`).set({ workspaceId, disabled: false, name: 'Synthetic SSO Coach' });
  await growDb.doc(`workspaces/${workspaceId}`).set({ name: 'Synthetic SSO workspace' });
  const link = { status: 'active', clubId, workspaceId, growlineAuthUid: coachUid, clubProject, growlineProject, verificationMethod: 'dual_authenticated_consent' };
  await clubDb.doc(`clubs/${clubId}/integrationLinks/${linkId}`).set(link); await growDb.doc(`integrationLinks/${linkId}`).set(link);
  // Firebase revocation precision is seconds. Do not forge auth_time or mock verification.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const memberToken = await signIn(clubProject, memberEmail), coachToken = await signIn(growlineProject, coachEmail);
  const f = { clubId, workspaceId, linkId, memberUid, coachUid, memberEmail, coachEmail, memberToken, coachToken };
  if (pair) {
    const proposal = await call('growline', 'propose', { linkId, confirm: true }, coachToken);
    const review = await call('club', 'reviewProposal', { proposalId: proposal.proposalId }, memberToken);
    assert.equal(review.sourceUid, coachUid); assert.equal(review.destinationUid, memberUid);
    const confirmed = await call('club', 'confirm', { proposalId: proposal.proposalId, confirm: true, confirmationDigest: review.confirmationDigest }, memberToken);
    assert.equal(confirmed.paired, true); f.pairId = confirmed.pairId;
  }
  return f;
}
async function exchange(f, audience = 'club') {
  const state = 's'.repeat(64), verifier = 'v'.repeat(64);
  const request = await call(audience, 'begin', { stateHash: federationDigest(state), codeChallenge: federationDigest(verifier), ...(audience === 'club' ? { clubId: f.clubId } : {}) });
  const source = audience === 'club' ? 'growline' : 'club', token = source === 'club' ? f.memberToken : f.coachToken;
  const issued = await call(source, 'issue', { pairId: f.pairId, requestId: request.requestId }, token);
  return { requestId: request.requestId, assertion: issued.assertion, state, verifier };
}

test('fresh dual confirmation creates an audited durable pair without new users or elevated roles; both exchanges establish actual Firebase identities', async () => {
  const f = await fixture();
  assert.equal((await call('club', 'status', {}, f.memberToken)).paired, true);
  assert.equal((await call('growline', 'status', {}, f.coachToken)).paired, true);
  for (const app of ['club', 'growline']) {
    const result = await call(app, 'finish', await exchange(f, app));
    assert.equal(result.uid, app === 'club' ? f.memberUid : f.coachUid);
    const signed = await authPost('signInWithCustomToken', { token: result.customToken, returnSecureToken: true }, app === 'club' ? clubProject : growlineProject);
    const auth = app === 'club' ? clubAuth : coachAuth, db = app === 'club' ? clubDb : growDb;
    const decoded = await auth.verifyIdToken(signed.idToken, true);
    await requireFederationSession(db, decoded);
    assert.equal(decoded.federationPairId, f.pairId); assert.equal(decoded.federationEpoch, 1);
    if (app === 'club') { assert.equal(decoded.role, 'member'); assert.equal(decoded.station, false); }
    assert.notEqual(decoded.role, 'owner'); assert.notEqual(decoded.role, 'admin');
    if (app === 'growline') {
      const cookie = await coachAuth.createSessionCookie(signed.idToken, { expiresIn: 3600000 });
      await requireFederationSession(growDb, await coachAuth.verifySessionCookie(cookie, true));
    }
    // A paired local SSO session can switch back without another password or raw token reuse.
    const destination = app === 'club' ? 'growline' : 'club';
    const follow = await call(destination, 'begin', { stateHash: federationDigest('s'.repeat(64)), codeChallenge: federationDigest('v'.repeat(64)), ...(destination === 'club' ? { clubId: f.clubId } : {}) });
    const reverse = await call(app, 'issue', { pairId: f.pairId, requestId: follow.requestId }, signed.idToken);
    assert.equal((await call(destination, 'finish', { requestId: follow.requestId, assertion: reverse.assertion, state: 's'.repeat(64), verifier: 'v'.repeat(64) })).uid, destination === 'club' ? f.memberUid : f.coachUid);
    assert.ok((await db.collection('integrationFederationAudit').where('pairId', '==', f.pairId).get()).size >= 3);
  }
});
test('explicit confirmation on both accounts is required; equality of contact never establishes a pair', async () => {
  const f = await fixture(false);
  await assert.rejects(call('growline', 'propose', { linkId: f.linkId, confirm: false }, f.coachToken));
  const p = await call('growline', 'propose', { linkId: f.linkId, confirm: true }, f.coachToken);
  await assert.rejects(call('club', 'confirm', { proposalId: p.proposalId, confirm: false }, f.memberToken));
  assert.equal((await call('club', 'status', {}, f.memberToken)).paired, false);
});
test('unpaired UID and wrong Club grant deny', async () => {
  const f = await fixture();
  const other = await fixture(false);
  const challenge = await call('club', 'begin', { clubId: f.clubId, stateHash: federationDigest('s'.repeat(64)), codeChallenge: federationDigest('v'.repeat(64)) });
  await assert.rejects(call('growline', 'issue', { pairId: f.pairId, requestId: challenge.requestId }, other.coachToken));
  await clubDb.doc(`clubs/${f.clubId}/authorizations/${f.memberUid}`).update({ clubId: 'wrong-club' });
  await assert.rejects(exchange(f));
});
test('missing independently verified canonical member grant denies pairing', async () => {
  const f = await fixture(false);
  await clubDb.doc(`clubs/${f.clubId}/authorizations/${f.memberUid}`).update({ verificationReference: '' });
  const p = await call('growline', 'propose', { linkId: f.linkId, confirm: true }, f.coachToken);
  await assert.rejects(call('club', 'confirm', { proposalId: p.proposalId, confirm: true }, f.memberToken));
});
test('wrong audience/destination, wrong state and wrong PKCE deny without consuming a valid request', async () => {
  const f = await fixture(), request = await exchange(f);
  await assert.rejects(call('growline', 'finish', request));
  await assert.rejects(call('club', 'finish', { ...request, state: 't'.repeat(64) }));
  await assert.rejects(call('club', 'finish', { ...request, verifier: 'w'.repeat(64) }));
  assert.equal((await call('club', 'finish', request)).uid, f.memberUid);
});
test('expired signed assertion is denied', async () => {
  const f = await fixture(), request = await exchange(f), parts = request.assertion.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  claims.iat = Math.floor(Date.now()/1000)-31; claims.exp = claims.iat+30; claims.authenticatedAt = claims.iat;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'), content = `${parts[0]}.${payload}`;
  await assert.rejects(call('club', 'finish', { ...request, assertion: `${content}.${createHmac('sha256', secret).update(content).digest('base64url')}` }));
});
test('parallel destination requests consume exactly once and lost login response is not replayable', async () => {
  const f = await fixture(), request = await exchange(f);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => call('club', 'finish', request)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(call('club', 'finish', request));
});
test('revoked federation and revoked integration relationship block exchange', async () => {
  const f = await fixture(), request = await exchange(f);
  await clubDb.doc(`integrationFederationPairs/${f.pairId}`).update({ status: 'revoked' });
  await assert.rejects(call('club', 'finish', request));
  const other = await fixture(); await growDb.doc(`integrationLinks/${other.linkId}`).update({ status: 'revoked' });
  await assert.rejects(exchange(other));
});
test('disabled Auth user or disabled profile denies on either side', async () => {
  const f = await fixture(), request = await exchange(f);
  await clubAuth.updateUser(f.memberUid, { disabled: true }); await assert.rejects(call('club', 'finish', request));
  const other = await fixture(); await growDb.doc(`users/${other.coachUid}`).update({ disabled: true }); await assert.rejects(exchange(other));
});
test('owner/admin/station claims and changed grants cannot be minted or smuggled into an exchange', async () => {
  const f = await fixture(), request = await exchange(f);
  await assert.rejects(call('club', 'finish', { ...request, role: 'owner' }));
  await clubDb.doc(`clubs/${f.clubId}/authorizations/${f.memberUid}`).update({ role: 'owner' });
  await assert.rejects(call('club', 'finish', request));
  const other = await fixture(); await clubAuth.setCustomUserClaims(other.memberUid, { clubId: other.clubId, role: 'reception', station: true });
  await assert.rejects(exchange(other));
});
test('logout advances both session epochs, rejects previously issued assertion and existing Firebase session, but preserves pair history', async () => {
  const f = await fixture(), oldRequest = await exchange(f);
  const signedResult = await call('club', 'finish', await exchange(f));
  const session = await authPost('signInWithCustomToken', { token: signedResult.customToken, returnSecureToken: true }, clubProject);
  const decoded = await clubAuth.verifyIdToken(session.idToken, true);
  const logout = await call('growline', 'logout', {}, f.coachToken);
  assert.equal(logout.propagated, true);
  await assert.rejects(exchange(f));
  await assert.rejects(call('club', 'finish', oldRequest));
  await assert.rejects(requireFederationSession(clubDb, decoded));
  for (const db of [clubDb, growDb]) { const pair = await db.doc(`integrationFederationPairs/${f.pairId}`).get(); assert.equal(pair.get('status'), 'active'); assert.ok(pair.get('epoch') > 1); }
});
test('unlink preserves audited pair and exchange history but prevents all new SSO', async () => {
  const f = await fixture(), request = await exchange(f);
  const result = await call('club', 'unlink', {}, f.memberToken); assert.equal(result.propagated, true);
  await assert.rejects(call('club', 'finish', request));
  for (const db of [clubDb, growDb]) { assert.equal((await db.doc(`integrationFederationPairs/${f.pairId}`).get()).get('status'), 'revoked'); assert.ok((await db.collection('integrationFederationAudit').where('pairId', '==', f.pairId).get()).size > 1); }
  assert.equal((await clubDb.doc(`clubs/${f.clubId}/members/${f.memberUid}`).get()).exists, true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  f.memberToken = await signIn(clubProject, f.memberEmail); f.coachToken = await signIn(growlineProject, f.coachEmail);
  const proposal = await call('growline', 'propose', { linkId: f.linkId, confirm: true }, f.coachToken);
  const review = await call('club', 'reviewProposal', { proposalId: proposal.proposalId }, f.memberToken);
  f.pairId = (await call('club', 'confirm', { proposalId: proposal.proposalId, confirm: true, confirmationDigest: review.confirmationDigest }, f.memberToken)).pairId;
  for (const [db,uid] of [[clubDb,f.memberUid],[growDb,f.coachUid]]) {
    const pair = await db.doc(`integrationFederationPairs/${f.pairId}`).get(), session = await db.doc(`integrationFederationSessions/${uid}`).get();
    assert.equal(pair.get('localSessionEpoch'), session.get('epoch')); assert.equal(pair.get('validAfter'), session.get('validAfter'));
  }
  assert.equal((await call('club', 'finish', await exchange(f))).uid, f.memberUid);
});
test('lost peer logout delivery is durable, denies future exchange, and retries idempotently after fresh login', async () => {
  const f = await fixture(), request = await exchange(f);
  dropInvalidation = true;
  const result = await call('growline', 'logout', {}, f.coachToken); assert.equal(result.propagated, false);
  await assert.rejects(call('club', 'finish', request));
  assert.equal((await growDb.doc(`integrationFederationPairs/${f.pairId}`).get()).get('pendingInvalidation'), true);
  dropInvalidation = false;
  await new Promise(resolve => setTimeout(resolve, 1100));
  f.coachToken = await signIn(growlineProject, f.coachEmail);
  assert.equal((await call('growline', 'retryLogout', {}, f.coachToken)).propagated, true);
  assert.equal((await call('growline', 'retryLogout', {}, f.coachToken)).propagated, true);
  const pending = await growDb.collection('integrationFederationOutbox').where('pairId', '==', f.pairId).get(); assert.ok(pending.docs.every(d => d.get('acknowledged') === true));
});
test('wrong browser origin, unsigned/tampered peer request and disabled feature all deny', async () => {
  const response = await fetch(clubServer.origin, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://wrong.example.test' }, body: JSON.stringify({ operation: 'begin', payload: {} }) });
  assert.equal(response.status, 403);
  await assert.rejects(clubService.rpc({ body: '{}', signature: 'forged' }));
  const disabled = new FederationService(clubDb, clubAuth, { ...clubService.config, enabled: false });
  await assert.rejects(disabled.client('begin', {}), /FEDERATION_DISABLED/);
});
test('a freshly logged-in source may use the retained pair after logout; stale session epochs never recover', async () => {
  const f = await fixture();
  const issued = await call('club', 'finish', await exchange(f));
  assert.equal((await call('growline', 'logout', {}, f.coachToken)).propagated, true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const oldMint = await authPost('signInWithCustomToken', { token: issued.customToken, returnSecureToken: true }, clubProject);
  await assert.rejects(requireFederationSession(clubDb, await clubAuth.verifyIdToken(oldMint.idToken, true)));
  f.coachToken = await signIn(growlineProject, f.coachEmail);
  assert.equal((await call('club', 'finish', await exchange(f))).uid, f.memberUid);
});
test('existing owner link revocation atomically invalidates local SSO, retains member and prepares peer delivery', async () => {
  const f = await fixture(), request = await exchange(f);
  const ownerUid = 'verified-owner';
  await clubDb.doc(`clubs/${f.clubId}/authorizations/${ownerUid}`).set({ uid: ownerUid, clubId: f.clubId, role: 'owner', station: false, enabled: true });
  assert.equal((await revokeOwnerCodeOrLink(clubDb, f.clubId, ownerUid, 'owner', 'link', f.linkId)).status, 'revoked');
  await assert.rejects(call('club', 'finish', request));
  const pair = await clubDb.doc(`integrationFederationPairs/${f.pairId}`).get(); assert.equal(pair.get('status'), 'revoked'); assert.equal(pair.get('pendingInvalidation'), true);
  assert.equal((await clubDb.doc(`clubs/${f.clubId}/members/${f.memberUid}`).get()).exists, true);
  assert.equal((await call('club', 'retryLogout', {}, f.memberToken)).propagated, true);
  assert.equal((await growDb.doc(`integrationFederationPairs/${f.pairId}`).get()).get('status'), 'revoked');
});
test('password verification is real in the isolated Auth namespace', async () => {
  const f = await fixture(false);
  const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-only', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ targetProjectId: clubProject, email: f.memberEmail, password: 'incorrect-synthetic-password', returnSecureToken: true }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, 'INVALID_PASSWORD');
});
test('raw Firebase credentials cannot authenticate to the opposite project', async () => {
  const f = await fixture();
  await assert.rejects(call('club', 'status', {}, f.coachToken));
  await assert.rejects(call('growline', 'status', {}, f.memberToken));
});
test('signed RPC purpose/audience/project are checked and an authenticated peer request is consumed once', async () => {
  const f = await fixture(false);
  const challenge = await call('club', 'begin', { clubId: f.clubId, stateHash: federationDigest('s'.repeat(64)), codeChallenge: federationDigest('v'.repeat(64)) });
  const now = Math.floor(Date.now()/1000);
  const base = { purpose: 'federation-rpc-v1', issuer: 'growline', audience: 'club', keyId: config.keyId, clubProject, growlineProject, requestId: randomUUID(), correlation: null, iat: now, exp: now+30, operation: 'challenge', payload: { requestId: challenge.requestId } };
  const sign = claims => { const body = JSON.stringify(claims); return { body, signature: createHmac('sha256',secret).update(body).digest('base64url') }; };
  for (const change of [{ purpose: 'handoff' }, { audience: 'growline' }, { clubProject: 'wrong-club-project' }, { exp: now-1, iat: now-31 }]) await assert.rejects(clubService.rpc(sign({ ...base, ...change })));
  const accepted = await clubService.rpc(sign(base)); assert.equal(JSON.parse(accepted.body).correlation, base.requestId);
  await assert.rejects(clubService.rpc(sign(base)));
});
test('interrupted pairing can be explicitly cancelled without stranding an identity reservation', async () => {
  const f = await fixture(false);
  const proposal = await call('growline', 'propose', { linkId: f.linkId, confirm: true }, f.coachToken);
  const review = await call('club', 'reviewProposal', { proposalId: proposal.proposalId }, f.memberToken);
  dropPrepare = true;
  try { await assert.rejects(call('club', 'confirm', { proposalId: proposal.proposalId, confirm: true, confirmationDigest: review.confirmationDigest }, f.memberToken)); }
  finally { dropPrepare = false; }
  assert.equal((await call('club', 'status', {}, f.memberToken)).paired, false);
  await growDb.doc(`integrationFederationProposals/${proposal.proposalId}`).delete(); // Simulate transient TTL cleanup.
  assert.equal((await call('club', 'unlink', {}, f.memberToken)).propagated, true);
  assert.equal((await growDb.doc(`integrationFederationPairingIntents/${proposal.proposalId}`).get()).get('cancelled'), true);
  assert.equal((await clubDb.doc(`integrationFederationPairs/${proposal.proposalId}`).get()).get('status'), 'revoked');
});

test('destination Club cannot exchange a pairing for another Club', async () => {
  const f = await fixture(), other = await fixture(false);
  const request = await call('club', 'begin', { clubId: other.clubId, stateHash: federationDigest('s'.repeat(64)), codeChallenge: federationDigest('v'.repeat(64)) });
  await assert.rejects(call('growline', 'issue', { pairId: f.pairId, requestId: request.requestId }, f.coachToken));
  await assert.rejects(call('club', 'begin', { stateHash: federationDigest('s'.repeat(64)), codeChallenge: federationDigest('v'.repeat(64)) }));
});
