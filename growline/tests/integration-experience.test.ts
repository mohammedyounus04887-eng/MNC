import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clubNavigationUrl, parseClubEnrollment, mayStartHandoff, handoffMessage, MAX_HANDOFF_ATTEMPTS } from '../src/lib/integration/experience';

test('bundled Club codes use one input while valid older codes remain supported', () => {
  const code='synthetic-one-time-code-32chars';
  const bundle='GL1.'+Buffer.from(JSON.stringify({clubId:'club-one',code})).toString('base64url');
  assert.deepEqual(parseClubEnrollment(bundle),{clubId:'club-one',code});
  assert.deepEqual(parseClubEnrollment(code,'club-one'),{clubId:'club-one',code});
  for(const input of ['GL1.bad-json','GL1.'+Buffer.from(JSON.stringify({clubId:'club/other',code})).toString('base64url'),'GL1.'+Buffer.from(JSON.stringify({clubId:'club-one',code,role:'owner'})).toString('base64url')]) assert.equal(parseClubEnrollment(input),null);
});

test('only Member can initiate; existing operations can still be reconciled after a stage change', () => {
  for(const stage of ['spoken','interested','invited','attended']) assert.equal(mayStartHandoff(stage),false);
  assert.equal(mayStartHandoff('member'),true);
  assert.equal(mayStartHandoff('spoken','SUCCEEDED'),true);
  assert.equal(mayStartHandoff('spoken','PENDING'),true);
  assert.equal(MAX_HANDOFF_ATTEMPTS,8);
});

test('cross-app navigation never includes tokens, codes, paths or credentials', () => {
  assert.equal(clubNavigationUrl('https://club.staging.example.test'),'https://club.staging.example.test/login');
  assert.equal(clubNavigationUrl('http://127.0.0.1:5173'),'http://127.0.0.1:5173/login');
  for(const value of ['http://remote.example.test','javascript:alert(1)','https://user:password@club.example.test','https://club.example.test?token=private','https://club.example.test/owner','https://club.example.test#code']) assert.equal(clubNavigationUrl(value),null);
});

test('handoff states explain review, retry and completion without disclosing private matching evidence', () => {
  assert.match(handoffMessage('MANUAL_REVIEW_REQUIRED'),/administrator.*review/);
  assert.match(handoffMessage('PENDING'),/Retry safely/);
  assert.match(handoffMessage('SUCCEEDED'),/Added to Club/);
  assert.match(handoffMessage(undefined,'MEMBER_STAGE_REQUIRED'),/Move this person to Member/);
  assert.doesNotMatch(handoffMessage(undefined,'private-phone-match-evidence'),/private-phone/);
});
