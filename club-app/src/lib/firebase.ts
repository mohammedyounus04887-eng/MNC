import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from "firebase/auth";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    getFirestore,
    type Firestore,
    connectFirestoreEmulator,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

export const useFirebaseEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(useFirebaseEmulators ? {
    apiKey: 'demo-only-api-key', authDomain: 'localhost', projectId: 'demo-club-security',
    storageBucket: 'demo-club-security.appspot.com', appId: 'demo-club-security',
} : firebaseConfig);

export const auth = getAuth(app);
if (useFirebaseEmulators) connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });

// Ensure member stays logged in after app close / browser refresh
// Only logs out when they explicitly click Sign Out
setPersistence(auth, browserLocalPersistence)
    .catch((error) => {
        console.error('Auth persistence error:', error);
    });

// Firestore with IndexedDB persistent cache so every re-open of a modal /
// page renders previously-fetched data INSTANTLY from the local cache, then
// streams in any server-side changes. Multi-tab safe.
//
// Falls back to in-memory cache if IndexedDB is unavailable (Safari private
// mode, locked-down browsers, etc.) — the app still works, just without the
// instant-restore behaviour.
let _db: Firestore;
try {
    _db = initializeFirestore(app, {
        // Drop `undefined` field values instead of throwing "Unsupported field
        // value: undefined". A single undefined field (e.g. a virtual member
        // with no phone) previously aborted the whole write — and, in a batch,
        // every renewal in that chunk — surfacing as a save error even though
        // some data had already landed.
        ignoreUndefinedProperties: true,
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
        }),
    });
} catch (e) {
    console.warn('[firebase] persistent cache unavailable, falling back to memory cache', e);
    _db = getFirestore(app);
}
export const db = _db;
export const storage = getStorage(app);
if (useFirebaseEmulators) {
    connectFirestoreEmulator(db, '127.0.0.1', 8180);
    connectStorageEmulator(storage, '127.0.0.1', 9299);
    connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5002);
}
export default app;
