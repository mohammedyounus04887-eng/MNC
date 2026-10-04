import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { issueFederationAssertion, consumeFederationAssertion, federationDigest } from '../src/lib/integration/federation-contract.ts';
import { growlineFederationReplayStore } from '../src/lib/integration/federation-replay.ts';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local Firestore emulator required');
const app=initializeApp({projectId:'demo-growline-federation-tests'},'federation-tests');
const db=getFirestore(app);
after(()=>deleteApp(app));
const state='s'.repeat(48), verifier='v'.repeat(64);
const config={enabled:true,issuer:'club',audience:'growline',clubProject:'demo-club-federation-tests',growlineProject:'demo-growline-federation-tests',keyId:'test-key',secret:'synthetic-federation-key-more-than-32-characters'};
async function fixture() {
  const now=Math.floor(Date.now()/1000);
  const pair={schemaVersion:1,pairId:randomUUID(),linkId:randomUUID(),status:'active',clubProject:config.clubProject,growlineProject:config.growlineProject,clubId:'club-a',workspaceId:'workspace-a',clubMemberAuthUid:'member-uid',growlineAuthUid:'coach-uid',epoch:1,verificationMethod:'dual_authenticated_accounts'};
  const accounts={club:{uid:pair.clubMemberAuthUid,project:pair.clubProject,scopeId:pair.clubId,role:'member',enabled:true,anonymous:false,station:false,authenticatedAt:now-1,validAfter:0},growline:{uid:pair.growlineAuthUid,project:pair.growlineProject,scopeId:pair.workspaceId,role:'coach',enabled:true,anonymous:false,station:false,authenticatedAt:now-1,validAfter:0}};
  await db.doc(`integrationFederationPairs/${pair.pairId}`).set(pair);
  await db.doc(`integrationLinks/${pair.linkId}`).set({status:'active',clubId:pair.clubId,workspaceId:pair.workspaceId,growlineAuthUid:pair.growlineAuthUid,growlineProject:pair.growlineProject,clubProject:pair.clubProject,verificationMethod:'dual_authenticated_consent'});
  await db.doc('users/coach-uid').set({workspaceId:'workspace-a',disabled:false});
  await db.doc('workspaces/workspace-a').set({name:'Synthetic federation workspace'});
  return {pair,accounts,token:issueFederationAssertion(config,pair,accounts,true,federationDigest(state),federationDigest(verifier),now),config,activeLink:true,state,verifier,replayStore:growlineFederationReplayStore(db)};
}
test('GrowLine destination consumes an explicitly paired Club member exchange once under concurrency',async()=>{
  const input=await fixture();
  const results=await Promise.allSettled(Array.from({length:12},()=>consumeFederationAssertion(input)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await assert.rejects(consumeFederationAssertion(input),/FEDERATION_ALREADY_CONSUMED/);
});
test('revocation/epoch/workspace/account changes are rechecked by GrowLine transaction',async()=>{
  for (const changed of [{status:'revoked'},{epoch:2}]) {
    const input=await fixture(); await db.doc(`integrationFederationPairs/${input.pair.pairId}`).update(changed);
    await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
  }
  for (const changed of [{disabled:true},{workspaceId:'wrong-workspace'}]) {
    const input=await fixture(); await db.doc('users/coach-uid').update(changed);
    await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
  }
  const input=await fixture(); await db.doc(`integrationLinks/${input.pair.linkId}`).update({status:'revoked'});
  await assert.rejects(consumeFederationAssertion(input),/FEDERATION_DENIED/);
});

test('federation pairs and exchange receipts are denied to every browser identity',async()=>{
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const rules=await initializeTestEnvironment({projectId:'demo-growline-federation-rules-tests',firestore:{host,port:Number(port),rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
  try {
    await rules.withSecurityRulesDisabled(async(context)=>{
      for(const path of ['integrationFederationPairs/pair','integrationFederationExchanges/exchange']) await setDoc(doc(context.firestore(),path),{private:'server-only-synthetic'});
    });
    for (const context of [rules.unauthenticatedContext(),rules.authenticatedContext('coach',{firebase:{sign_in_provider:'password'}}),rules.authenticatedContext('workspace-owner',{role:'owner'}),rules.authenticatedContext('platform-admin',{admin:true})]) {
      for (const path of ['integrationFederationPairs/pair','integrationFederationExchanges/exchange']) {
        await assertFails(getDoc(doc(context.firestore(),path)));
        await assertFails(setDoc(doc(context.firestore(),path),{forged:true}));
      }
    }
  } finally { await rules.cleanup(); }
});
