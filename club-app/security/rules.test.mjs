import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

// Refuse to run against anything except explicitly started loopback emulators.
for (const variable of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[variable] ?? '')) {
    throw new Error(`${variable} must point to a loopback emulator`);
  }
}
const fixture = JSON.parse(await readFile(new URL('./club-rules-cases.json', import.meta.url), 'utf8'));
fixture.claims.revokedReception = { uid: 'revoked-reception', clubId: 'club-a', role: 'reception', station: true };
fixture.claims.revokedTv = { uid: 'revoked-tv', clubId: 'club-a', role: 'tv', station: true };
// Keep disposable rule fixtures separate from the interactive demo project.
const projectId = 'demo-club-security-tests';
let environment;
const firestoreCases = [...fixture.firestore];
const storageCases = [...fixture.storage];
for (const actor of [null, 'anonymous', 'memberA', 'receptionA', 'kitchenA', 'tvA', 'ownerB']) {
  firestoreCases.push({ name: `${actor ?? 'signed out'} cannot read PIN-bearing club document`, actor, path: 'clubs/legacy-pins', operation: 'read', allow: false });
  firestoreCases.push({ name: `${actor ?? 'signed out'} cannot replace published landing page`, actor, path: 'clubs/club-a/landingPages/current', operation: 'write', allow: false });
}
firestoreCases.push({ name: 'revoked station cannot read products', actor: 'revokedReception', path: 'clubs/club-a/products/p', operation: 'read', allow: false });
storageCases.push({ name: 'revoked TV cannot read display assets', actor: 'revokedTv', path: 'clubs/club-a/tv/screen.json', operation: 'read', allow: false });
for (const actor of ['ownerB', 'anonymous', null]) {
  for (const path of ['clubs/club-a/members/member-a', 'clubs/club-a/orders/order-a', 'clubs/club-a/members/member-a/transactions/t', 'clubs/club-a/announcements/a']) {
    firestoreCases.push({ name: `${actor ?? 'signed out'} cannot read private ${path}`, actor, path, operation: 'read', allow: false });
    firestoreCases.push({ name: `${actor ?? 'signed out'} cannot write private ${path}`, actor, path, operation: 'write', allow: false });
  }
}
for (const actor of ['memberA', 'receptionA', 'kitchenA', 'tvA', 'ownerB', 'anonymous', null]) {
  firestoreCases.push({ name: `${actor ?? 'signed out'} cannot edit platform menu`, actor, path: 'globalMenu/menu-a', operation: 'write', allow: false });
}
for (const actor of [null, 'anonymous', 'memberA', 'receptionA', 'kitchenA', 'tvA', 'ownerB']) {
  for (const path of ['clubs/club-a/security/pins', 'clubs/club-a/authorizations/attacker']) {
    firestoreCases.push({ name: `${actor ?? 'signed out'} cannot change ${path}`, actor, path, operation: 'write', allow: false });
  }
  firestoreCases.push({ name: `${actor ?? 'signed out'} cannot read legacy PIN document`, actor, path: 'clubs/club-a/security/pins', operation: 'read', allow: false });
}
for (const actor of ['receptionA', 'kitchenA', 'tvA', 'memberA', 'ownerB', 'anonymous', null]) {
  storageCases.push({ name: `${actor ?? 'signed out'} cannot replace club landing image`, actor, path: 'clubs/club-a/landing/banner.png', operation: 'write', allow: false });
}
for (const actor of ['kitchenA', 'tvA', 'ownerB', 'anonymous', null]) {
  storageCases.push({ name: `${actor ?? 'signed out'} cannot read private member photo`, actor, path: 'clubs/club-a/members/member-a/photo.jpg', operation: 'read', allow: false });
}
for (const actor of [null, 'anonymous', 'memberA', 'kitchenA', 'tvA', 'ownerB']) {
  for (const path of ['clubs/club-a/members/member-a/wallet/balance', 'clubs/club-a/payments/payment-a']) {
    firestoreCases.push({ name: `${actor ?? 'signed out'} cannot write ${path}`, actor, path, operation: 'write', allow: false });
  }
}
for (const actor of ['anonymous', 'memberA', 'kitchenA', 'tvA', 'ownerB']) {
  firestoreCases.push({ name: `${actor} cannot read protected PIN`, actor, path: 'clubs/club-a/stationSecrets/reception', operation: 'read', allow: false });
}
for (const path of [
  'clubs/club-a/integrationConfig/growline',
  'clubs/club-a/integrationLinks/link-a',
  'clubs/club-a/integrationCodes/code-a',
  'clubs/club-a/integrationMembers/source-a',
  'clubs/club-a/integrationContactClaims/claim-a',
  'clubs/club-a/members/member-a/integrationReceipts/op-a',
  'integrationFederationPairs/pair-a',
  'integrationFederationExchanges/exchange-a',
]) {
  firestoreCases.push({ name: `owner cannot directly read server-only integration data ${path}`, actor: 'ownerA', path, operation: 'read', allow: false });
  firestoreCases.push({ name: `owner cannot directly write server-only integration data ${path}`, actor: 'ownerA', path, operation: 'write', allow: false });
}

function context(actor) {
  if (actor === null) return environment.unauthenticatedContext();
  if (actor === 'anonymous') return environment.authenticatedContext('anonymous-user', {
    firebase: { sign_in_provider: 'anonymous', identities: {} },
  });
  const { uid, ...claims } = fixture.claims[actor];
  return environment.authenticatedContext(uid, claims);
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async (ctx) => {
    for (const claims of Object.values(fixture.claims)) {
      if (claims.clubId) await ctx.firestore().doc(`clubs/${claims.clubId}/authorizations/${claims.uid}`).set({ ...claims, enabled: !claims.uid.startsWith('revoked-') });
    }
    await ctx.firestore().doc('superAdmins/platform-a').set({ enabled: true });
    for (const entry of firestoreCases) {
      if (entry.path !== 'superAdmins/platform-a') await ctx.firestore().doc(entry.path).set({ fixture: true });
    }
    await ctx.firestore().doc('clubs/legacy-pins').set({ receptionPin: 'synthetic-test-only' });
    for (const entry of storageCases) {
      await ctx.storage().ref(entry.path).put(new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' });
    }
  });
});
after(async () => { await environment?.cleanup(); });

for (const entry of firestoreCases) {
  test(`Firestore: ${entry.name}`, async () => {
    const document = context(entry.actor).firestore().doc(entry.path);
    const operation = entry.operation === 'read' ? document.get() : document.set({ fixture: true, attemptedWrite: true });
    await (entry.allow ? assertSucceeds(operation) : assertFails(operation));
  });
}
for (const entry of storageCases) {
  test(`Storage: ${entry.name}`, async () => {
    const object = context(entry.actor).storage().ref(entry.path);
    const operation = entry.operation === 'read' ? object.getMetadata() : object.put(new Uint8Array([4]), { contentType: 'application/octet-stream' });
    await (entry.allow ? assertSucceeds(operation) : assertFails(operation));
  });
}
