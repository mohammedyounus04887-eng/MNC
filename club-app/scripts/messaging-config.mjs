// Only the public Firebase app registration is exposed to the worker.
// Server credentials and all other environment variables are never emitted.
const names = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

export function renderMessagingConfig(env) {
  const config = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, env[name]]));
  const complete = Object.values(config).every((value) => typeof value === 'string' && value.trim());
  const enabled = complete && env.VITE_USE_FIREBASE_EMULATORS !== 'true';
  return `self.__CLUB_FIREBASE_CONFIG__ = ${JSON.stringify(enabled ? config : null)};\n`;
}
