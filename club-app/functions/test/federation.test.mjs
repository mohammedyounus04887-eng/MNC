import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { issueFederationAssertion, consumeFederationAssertion, federationDigest } from '../lib/federationContract.js';
import { clubFederationReplayStore } from '../lib/federationReplay.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local Firestore emulator required');
const app = initializeApp({projectId:'demo-club-federation-tests'},'federation-tests');
const db = getFirestore(app);
after(()=>deleteApp(app));
const state='s'.repeat(48), verifier='v'.repeat(64);
const config={enabled:true,issuer:'growline',audience:'club',clubProject:'demo-club-federation-tests',growlineProject:'demo-growline-federation-tests',keyId:'test-key',secret:'synthetic-federation-key-more-than-32-characters'};

async function fixture() {
  const now=Math.floor(Date.now()/1000);
  const pair={schemaVersion:1,pairId:randomUUID(),linkId:randomUUID(),status:'active',clubProject:config.clubProject,growlineProject:config.growlineProject,clubId:'club-a',workspaceId:'workspace-a',clubMemberAuthUid:'member-uid',growlineAuthUid:'coach-uid',epoch:1,verificationMethod:'dual_authenticated_accounts'};
  const accounts={club:{uid:pair.clubMemberAuthUid,project:pair.clubProject,scopeId:pair.clubId,role:'member',enabled:true,anonymous:false,station:false,authenticatedAt:now-1,validAfter:0},growline:{uid:pair.growlineAuthUid,project:pair.growlineProject,scopeId:pair.workspaceId,role:'coach',enabled:true,anonymous:false,station:false,authenticatedAt:now-1,validAfter:0}};
  await db.doc(`integrationFederationPairs/${pair.pairId}`).set(pair);
  await db.doc(`clubs/club-a/integrationLinks/${pair.linkId}`).set({status:'active',clubId:pair.clubId,workspaceId:pair.workspaceId,growlineAuthUid:pair.growlineAuthUid,growlineProject:pair.growlineProject});
  await db.doc('clubs/club-a/authorizations/member-uid').set({uid:'member-uid',clubId:'club-a',role:'member',station:false,enabled:true});
  await db.doc('clubs/club-a/members/member-uid').set({clubId:'club-a',status:'active'});
  return {pair,accounts,token:issueFederationAssertion(config,pair,accounts,true,federationDigest(state),federationDigest(verifier),now),config,activeLink:true,state,verifier,replayStore:clubFederationReplayStore(db)};
}
test('atomic Firestore consumption permits one login assertion under concurrency and rejects replay',async()=>{
  const input=await fixture();
  const results=await Promise.allSettled(Array.from({length:12},()=>consumeFederationAssertion(input)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await assert.rejects(consumeFederationAssertion(input),/FEDERATION_ALREADY_CONSUMED/);
});
test('revocation or logout epoch after signature validation is rechecked inside the transaction',async()=>{
  for(const changed of [{status:'revoked'},{epoch:2}]) {
    const input=await fixture(); await db.doc(`integrationFederationPairs/${input.pair.pairId}`).update(changed);
    await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
  }
});
test('current destination grant cannot change to owner/admin/station or disabled before consume',async()=>{
  for(const changed of [{role:'owner'},{role:'admin'},{station:true},{enabled:false},{clubId:'wrong-club'}]) {
    const input=await fixture(); await db.doc('clubs/club-a/authorizations/member-uid').update(changed);
    await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
  }
});
test('current Club link revocation/wrong workspace and inactive member deny without a receipt',async()=>{
  for(const changed of [{status:'revoked'},{workspaceId:'wrong-workspace'}]) {
    const input=await fixture(); await db.doc(`clubs/club-a/integrationLinks/${input.pair.linkId}`).update(changed);
    await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
  }
  const input=await fixture(); await db.doc('clubs/club-a/members/member-uid').update({status:'inactive'});
  await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
});
