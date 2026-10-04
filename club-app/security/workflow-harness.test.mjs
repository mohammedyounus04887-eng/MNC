import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const projectId = 'demo-club-workflows';
let environment;
const auth = {
  owner: { uid: 'workflow-owner', clubId: 'club-a', role: 'owner' },
  reception: { uid: 'workflow-reception', clubId: 'club-a', role: 'reception', station: true },
  kitchen: { uid: 'workflow-kitchen', clubId: 'club-a', role: 'kitchen', station: true },
  tv: { uid: 'workflow-tv', clubId: 'club-a', role: 'tv', station: true },
  member: { uid: 'workflow-member', clubId: 'club-a', role: 'member' },
  wrongClub: { uid: 'workflow-wrong-club', clubId: 'club-b', role: 'owner' },
  wrongRole: { uid: 'workflow-wrong-role', clubId: 'club-a', role: 'member' },
};
function context(identity) {
  const { uid, ...claims } = identity;
  return environment.authenticatedContext(uid, claims);
}
function doc(identity, path) { return context(identity).firestore().doc(path); }

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  await environment.withSecurityRulesDisabled(async (admin) => {
    for (const identity of Object.values(auth)) {
      if (identity.clubId) await admin.firestore().doc(`clubs/${identity.clubId}/authorizations/${identity.uid}`).set({ ...identity, enabled: true });
    }
    await admin.firestore().doc('clubs/club-a/members/member-a').set({ name: 'Synthetic Member', clubId: 'club-a' });
    await admin.firestore().doc('clubs/club-a/orders/order-a').set({ memberId: 'member-a', status: 'pending', clubId: 'club-a' });
    await admin.firestore().doc('clubs/club-a/inventoryProducts/product-a').set({ name: 'Synthetic Product', stock: 5, clubId: 'club-a' });
  });
});
after(async () => environment?.cleanup());

test('reception workflow: member lookup, check-in, order create, and financial denial', async () => {
  await assertSucceeds(doc(auth.reception, 'clubs/club-a/members/member-a').get());
  await assertSucceeds(doc(auth.reception, 'clubs/club-a/members/member-a/attendance/today').set({ clubId: 'club-a', memberId: 'member-a' }));
  await assertSucceeds(doc(auth.reception, 'clubs/club-a/orders/order-new').set({ clubId: 'club-a', memberId: 'member-a', status: 'pending' }));
  await assertFails(doc(auth.kitchen, 'clubs/club-a/members/member-a/wallet/data').set({ balance: 999999 }));
  await assertFails(doc(auth.reception, 'clubs/club-b/members/member-a').get());
});

test('kitchen workflow: queue/status and assigned inventory, with payment denial', async () => {
  await assertSucceeds(doc(auth.kitchen, 'clubs/club-a/orders/order-a').get());
  await assertSucceeds(doc(auth.kitchen, 'clubs/club-a/orders/order-a').update({ status: 'preparing' }));
  await assertSucceeds(doc(auth.kitchen, 'clubs/club-a/inventoryProducts/product-a').update({ stock: 4 }));
  await assertFails(doc(auth.kitchen, 'clubs/club-a/payments/payment-a').set({ amount: 100 }));
  await assertFails(doc(auth.kitchen, 'clubs/club-b/orders/order-a').get());
});

test('TV workflow: intended display reads and no operational writes', async () => {
  await assertSucceeds(doc(auth.tv, 'clubs/club-a/orders/order-a').get());
  await assertFails(doc(auth.tv, 'clubs/club-a/orders/order-a').update({ status: 'served' }));
  await assertFails(doc(auth.tv, 'clubs/club-a/members/member-a').get());
  await assertFails(doc(auth.tv, 'clubs/club-b/orders/order-a').get());
});

test('wrong role and revocation deny access after a session refresh', async () => {
  await assertFails(doc(auth.wrongRole, 'clubs/club-a/orders/order-a').get());
  await environment.withSecurityRulesDisabled(async (admin) => {
    await admin.firestore().doc('clubs/club-a/authorizations/workflow-reception').update({ enabled: false });
  });
  await assertFails(doc(auth.reception, 'clubs/club-a/orders/order-a').get());
});

test('logout/restart starts without an authorized context', async () => {
  await assertFails(environment.unauthenticatedContext().firestore().doc('clubs/club-a/orders/order-a').get());
  await assertFails(doc(auth.wrongClub, 'clubs/club-a/orders/order-a').get());
});

test('member login resolves its UID document without authorizing email-based identity lookup', async () => {
  await environment.withSecurityRulesDisabled(async (admin) => {
    await admin.firestore().doc('clubs/club-a/members/workflow-member').set({ clubId: 'club-a', name: 'Own canonical member', email: 'synthetic@example.test' });
    await admin.firestore().doc('clubs/club-a/members/another-member').set({ clubId: 'club-a', name: 'Other canonical member', email: 'synthetic@example.test' });
  });
  await assertSucceeds(doc(auth.member, 'clubs/club-a/members/workflow-member').get());
  await assertFails(doc(auth.member, 'clubs/club-a/members/another-member').get());
  await assertFails(context(auth.member).firestore().collection('clubs/club-a/members').where('email', '==', 'synthetic@example.test').get());
});
