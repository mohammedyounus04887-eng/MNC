import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scopedJobPeople, requireCompleteJobScan, JOB_SCAN_LIMIT } from '../src/modules/shared-new/job-scope.ts';
import { podiumDocId } from '../src/modules/leaderboards/snapshots.ts';
import { MIN_PARTICIPANTS } from '../src/modules/leaderboards/ranking.ts';
import { callScheduledRoute } from '../functions/src/scheduledHttp.ts';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw new Error('Loopback emulators required');
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-growline-job-readiness';
process.env.METADATA_SERVER_DETECTION = 'none';
const { db, app } = await import('../src/lib/firebase-admin.ts');
const { deleteApp } = await import('firebase-admin/app');
const { Timestamp } = await import('firebase-admin/firestore');
const { purgeExpiredNotes } = await import('../src/modules/voice-log/queries.ts');
const { computeAllBoards } = await import('../src/modules/leaderboards/compute.ts');
const { createProspect } = await import('../src/lib/prospects.ts');
const { getQualificationFor } = await import('../src/modules/qualifications/queries.ts');
const { summaryDocId, progressDocId } = await import('../src/modules/qualifications/ids.ts');
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp: initializeHealth, deleteApp: deleteHealth } = functionsRequire('firebase-admin/app');
const { getFirestore: healthFirestore, Timestamp: HealthTimestamp } = functionsRequire('firebase-admin/firestore');
const { purgeHealthRetention } = functionsRequire('../functions/lib/healthRetention.js');
const healthApp = initializeHealth({ projectId: 'demo-growline-health-readiness' }, 'health-readiness');
const healthDb = healthFirestore(healthApp);
const now = new Date('2026-10-01T12:00:00Z');
const old = HealthTimestamp.fromMillis(now.getTime() - 181*86400000);
before(async () => {
  await healthDb.doc('users/coach').set({workspaceId:'ws-a'});
  await healthDb.doc('users/disabled').set({workspaceId:'ws-a',disabled:true});
  for(const [id,data] of Object.entries({stale:{lastActivityAt:old}, boundary:{lastActivityAt:HealthTimestamp.fromMillis(now.getTime()-180*86400000)}, active:{lastActivityAt:HealthTimestamp.fromDate(now)}, legacy:{lastActivityAt:null}, wrong:{lastActivityAt:old,workspaceId:'ws-other'}, disabled:{lastActivityAt:old,coachId:'disabled'}})) {
    await healthDb.doc('prospects/'+id).set({coachId:'coach',workspaceId:'ws-a',heightCm:170,weightKg:70,age:25,gender:'male',notes:'must preserve',phone:'synthetic',...data});
    await healthDb.doc('reports/'+id).set({prospectId:id,coachId:data.coachId??'coach',workspaceId:data.workspaceId??'ws-a',private:'report'});
  }
});
after(async () => { await deleteApp(app); await deleteHealth(healthApp); });

test('scheduler is disabled by default and enforces HTTPS, credentials and no redirect', async () => {
  let calls=0;
  const request=async (_url,options) => {calls++;assert.equal(options.redirect,'error');return Response.json({ok:true});};
  assert.equal(await callScheduledRoute('synthetic','/api/test',{},request),null);
  assert.equal(calls,0);
  const env={GROWLINE_JOBS_ENABLED:'true',SITE_URL:'https://staging.example.test',CRON_SECRET:'synthetic-job-secret-32-characters-long'};
  assert.deepEqual(await callScheduledRoute('synthetic','/api/test',env,request),{ok:true});
  for(const values of [{SITE_URL:'http://remote.example.test'},{SITE_URL:'https://user:password@staging.example.test'},{CRON_SECRET:'short'}]) await assert.rejects(callScheduledRoute('synthetic','/api/test',{...env,...values},request),/INVALID_JOB_CONFIGURATION/);
});

test('job tree excludes unknown workspaces and cross-workspace ancestors; scan overflow fails instead of truncating', () => {
  const rows=[{id:'a',workspaceId:'one',uplineId:null,uplinePath:[]},{id:'b',workspaceId:'two',uplineId:'a',uplinePath:['a']},{id:'legacy',workspaceId:'',uplineId:'a',uplinePath:['a']}];
  assert.deepEqual(scopedJobPeople(rows),[rows[0],{...rows[1],uplineId:null,uplinePath:[]}]);
  assert.doesNotThrow(()=>requireCompleteJobScan({size:JOB_SCAN_LIMIT}));
  assert.throws(()=>requireCompleteJobScan({size:JOB_SCAN_LIMIT+1}),/JOB_SCAN_BUDGET_EXCEEDED/);
  const board={metric:'peopleMet',window:'monthly',periodKey:'2026-10',scopeType:'club',scopeKey:'same-city'};
  assert.notEqual(podiumDocId({...board,workspaceId:'one'}),podiumDocId({...board,workspaceId:'two'}));
});

test('180-day health purge dry run preserves data, real run removes only scoped stale health, replay is safe', async () => {
  await healthDb.doc('jobState/healthRetention').delete();
  const dry=await purgeHealthRetention(healthDb,now,{dryRun:true});
  assert.equal(dry.purged,2);assert.equal(dry.reportsDeleted,2);
  assert.equal((await healthDb.doc('reports/stale').get()).exists,true);
  assert.equal((await healthDb.doc('jobState/healthRetention').get()).exists,false);
  const result=await purgeHealthRetention(healthDb,now);assert.equal(result.purged,2);
  assert.equal((await healthDb.doc('reports/stale').get()).exists,false);
  assert.equal((await healthDb.doc('prospects/stale').get()).get('heightCm'),null);
  assert.equal((await healthDb.doc('prospects/stale').get()).get('notes'),'must preserve');
  for(const id of ['active','legacy','wrong','disabled']) assert.equal((await healthDb.doc('prospects/'+id).get()).get('weightKg'),70);
  assert.equal((await purgeHealthRetention(healthDb,now)).purged,0);
});

test('voice purge rechecks age, counted state and current workspace, including dry run', async () => {
  await db.doc('users/voice-coach').set({workspaceId:'voice-ws'});
  for(const [id,extra] of Object.entries({old:{}, counted:{status:'counted'}, replaced:{createdAt:Timestamp.fromDate(now)}, wrong:{workspaceId:'other'}, legacy:{workspaceId:null}})) await db.doc('voiceLogs/'+id).set({userId:'voice-coach',workspaceId:'voice-ws',status:'uncounted',dayKey:'2026-08-01',createdAt:Timestamp.fromDate(new Date('2026-08-01')),audioBase64:'synthetic-audio',...extra});
  assert.equal((await purgeExpiredNotes('2026-10-01',400,true)).wouldDelete,1);
  assert.equal((await db.doc('voiceLogs/old').get()).exists,true);
  assert.equal((await purgeExpiredNotes('2026-10-01')).deleted,1);
  for(const id of ['counted','replaced','wrong','legacy']) assert.equal((await db.doc('voiceLogs/'+id).get()).exists,true);
  assert.equal((await purgeExpiredNotes('2026-10-01')).deleted,0);
});

test('new capture is workspace-attributed, concurrent same payload replays and conflicting payload fails', async () => {
  await db.doc('users/capture-coach').set({name:'Synthetic coach',workspaceId:'capture-ws'});
  await db.doc('workspaces/capture-ws').set({ownerId:'capture-coach'});
  await db.doc('prospects/capture-coach__capture-test').delete();
  const input={coachId:'capture-coach',clientId:'capture-test',name:'Synthetic person',phone:'+919000000009',source:'qr',consentGiven:true};
  const saved=await Promise.all([createProspect(input),createProspect(input)]);
  assert.equal(saved.filter(r=>!r.duplicate).length,1);
  assert.equal(saved[0].prospect.id,saved[1].prospect.id);
  const data=(await db.doc('prospects/'+saved[0].prospect.id).get()).data();
  assert.equal(data.workspaceId,'capture-ws');assert.equal(data.acquisition.kind,'coach_qr');assert.equal(data.consentSource,'prospect_self_capture');assert.equal(data.consentVersion,'capture-confirmation-v1');
  await assert.rejects(createProspect({...input,name:'Different person'}),/CAPTURE_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(createProspect({...input,source:'manual'}),/CAPTURE_IDEMPOTENCY_CONFLICT/);
});

test('board compute partitions same city/level workspaces and excludes wrong-workspace log/prospect data', async () => {
  const batch=db.batch();
  for(const ws of ['board-a','board-b']) for(let i=0;i<MIN_PARTICIPANTS;i++) {
    const uid=ws+'-'+i;
    batch.set(db.doc('users/'+uid),{name:uid,workspaceId:ws,uplineId:null,uplinePath:[],city:'Same city',levelName:'Same level'});
    batch.set(db.doc('prospects/'+uid),{coachId:uid,workspaceId:ws,createdAt:Timestamp.fromDate(now),private:'never expose'});
  }
  batch.set(db.doc('prospects/wrong-stamp'),{coachId:'board-a-0',workspaceId:'board-b',createdAt:Timestamp.fromDate(now)});
  await batch.commit();
  await computeAllBoards(now);
  const id={metric:'peopleMet',window:'monthly',periodKey:'2026-10',scopeType:'club',scopeKey:'same city'};
  for(const ws of ['board-a','board-b']) {
    const data=(await db.doc('leaderboardSnapshots/'+podiumDocId({...id,workspaceId:ws})).get()).data();
    assert.equal(data.workspaceId,ws);assert.equal(data.entries.length,3);
    assert.ok(data.entries.every(row=>row.userId.startsWith(ws+'-')&&row.value===1));
    assert.ok(!JSON.stringify(data).includes('never expose'));
  }
});

test('fresh qualification cache cannot disclose a moved or disabled coach before the next rebuild', async () => {
  const id='current-audience-privacy';
  await db.doc('qualifications/'+id).set({workspaceId:'qual-ws',creatorId:'qual-owner',creatorName:'Synthetic owner',title:'Synthetic qualification',criteria:[{type:'newMembers',target:1}],audience:'all',fromKey:'2026-10-01',deadlineKey:'2026-10-30',timeZone:'Asia/Kolkata',closesAt:Timestamp.fromDate(new Date('2026-10-31')),createdAt:Timestamp.fromDate(now)});
  await db.doc('qualificationProgress/'+summaryDocId(id)).set({kind:'summary',evaluatedAt:Timestamp.fromDate(now),audienceSize:3,qualifiedCount:3,oneStepCount:0});
  for(const [uid,extra] of [['current',{}],['moved',{workspaceId:'other-ws'}],['disabled',{disabled:true}]]) {
    await db.doc('users/qual-'+uid).set({workspaceId:'qual-ws',uplineId:'qual-owner',uplinePath:['qual-owner'],...extra});
    await db.doc('qualificationProgress/'+progressDocId(id,'qual-'+uid)).set({kind:'progress',qualificationId:id,workspaceId:'qual-ws',userId:'qual-'+uid,userName:'Synthetic '+uid,values:{newMembers:1},baseline:{},unchecked:{},qualified:true,qualifiedAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now)});
  }
  const view=await getQualificationFor(id,{id:'qual-owner',workspaceId:'qual-ws',name:'Synthetic owner',uplineId:null,uplinePath:[]},now);
  assert.equal(view.qualifiedCount,1);assert.equal(view.audienceSize,1);
  assert.deepEqual(view.qualified.map(row=>row.userId),['qual-current']);
  assert.ok(!JSON.stringify(view).includes('Synthetic moved'));assert.ok(!JSON.stringify(view).includes('Synthetic disabled'));
});
