import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderMessagingConfig } from './messaging-config.mjs';

const env = {
  VITE_FIREBASE_API_KEY: 'synthetic-public-registration',
  VITE_FIREBASE_AUTH_DOMAIN: 'isolated-club-stage.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'isolated-club-stage',
  VITE_FIREBASE_STORAGE_BUCKET: 'isolated-club-stage.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: 'synthetic-app',
};

test('worker configuration uses only the selected public app registration', () => {
  const context = { self: {} };
  const output = renderMessagingConfig({ ...env, CLUB_LINK_CODE_PEPPER: 'never-emit', VITE_OTHER_SECRET: 'never-emit' });
  vm.runInNewContext(output, context);
  assert.equal(context.self.__CLUB_FIREBASE_CONFIG__.projectId, env.VITE_FIREBASE_PROJECT_ID);
  assert.equal(Object.keys(context.self.__CLUB_FIREBASE_CONFIG__).length, 6);
  assert.equal(output.includes('never-emit'), false);
  assert.equal(output.includes('magic-nutrition-club'), false);
});

test('missing registration or emulator mode leaves the messaging worker inert', () => {
  for (const config of [{}, { ...env, VITE_FIREBASE_APP_ID: '' }, { ...env, VITE_USE_FIREBASE_EMULATORS: 'true' }]) {
    const context = { self: {} };
    vm.runInNewContext(renderMessagingConfig(config), context);
    assert.equal(context.self.__CLUB_FIREBASE_CONFIG__, null);
  }
});

test('client startup cannot provision platform administrators', () => {
  const startup = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.equal(startup.includes('seedSuperAdmin'), false);
  assert.equal(startup.includes('createUserWithEmailAndPassword'), false);
});
