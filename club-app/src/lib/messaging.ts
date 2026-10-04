// Web push (FCM) client. Wraps permission, token registration, foreground
// message handling, and Firestore sync of the device token onto the user doc.

import { getMessaging, getToken, onMessage, deleteToken, isSupported } from "firebase/messaging";
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from "firebase/firestore";
import { db, useFirebaseEmulators } from "./firebase";
import app from "./firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let messagingInstance: ReturnType<typeof getMessaging> | null = null;
let supportChecked = false;
let supported = false;

async function ensureSupported(): Promise<boolean> {
    if (useFirebaseEmulators) return false;
    if (supportChecked) return supported;
    supportChecked = true;
    try {
        supported = await isSupported();
    } catch {
        supported = false;
    }
    return supported;
}

function getMessagingInstance() {
    if (messagingInstance) return messagingInstance;
    messagingInstance = getMessaging(app);
    return messagingInstance;
}

/**
 * Capability check — call before showing the notification toggle.
 * Returns false on iOS web before iOS 16.4 (no Push API), in private mode,
 * if the browser blocks Notification API, or if VAPID isn't configured.
 */
export async function isPushSupported(): Promise<boolean> {
    if (useFirebaseEmulators) return false;
    if (typeof window === "undefined") return false;
    if (!("Notification" in window)) return false;
    if (!("serviceWorker" in navigator)) return false;
    if (!VAPID_KEY) return false;
    return await ensureSupported();
}

/**
 * Request permission and register the device token. Stores the token under
 * `User.fcmTokens` (de-duplicated) and sets `notificationsEnabled = true`.
 *
 * Throws on permission denial or if VAPID is missing.
 */
export async function enablePushForMember(args: {
    clubId: string;
    memberId: string;
}): Promise<{ token: string }> {
    if (useFirebaseEmulators) throw new Error("Push notifications are disabled in the local emulator demo.");
    if (!VAPID_KEY) {
        throw new Error(
            "Push notifications aren't configured for this build. Ask the admin to set VITE_FIREBASE_VAPID_KEY.",
        );
    }
    if (!(await ensureSupported())) {
        throw new Error("Push notifications aren't supported on this device.");
    }

    // Register the dedicated FCM service worker. It must live at the root —
    // we put it at public/firebase-messaging-sw.js so it loads from /firebase-messaging-sw.js.
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
        scope: "/",
    });

    // Permission prompt — must be triggered from a user gesture (button click).
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        throw new Error(
            permission === "denied"
                ? "Notifications blocked. Enable them in browser settings to receive alerts."
                : "Notifications permission was dismissed.",
        );
    }

    const token = await getToken(getMessagingInstance(), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: reg,
    });
    if (!token) throw new Error("Failed to get notification token. Try again.");

    // Persist token on the member doc (de-duped via arrayUnion).
    await updateDoc(doc(db, `clubs/${args.clubId}/members`, args.memberId), {
        fcmTokens: arrayUnion(token),
        notificationsEnabled: true,
    });

    return { token };
}

/**
 * Disable push for this device — removes the current token from Firestore
 * and asks Firebase to revoke it. Other devices the user has logged in on
 * will keep getting notifications.
 */
export async function disablePushForMember(args: {
    clubId: string;
    memberId: string;
}): Promise<void> {
    if (!(await ensureSupported())) return;
    let currentToken: string | null = null;
    try {
        currentToken = await getToken(getMessagingInstance(), { vapidKey: VAPID_KEY });
    } catch {
        // If we can't resolve a token, just clear the flag.
    }

    if (currentToken) {
        try {
            await updateDoc(doc(db, `clubs/${args.clubId}/members`, args.memberId), {
                fcmTokens: arrayRemove(currentToken),
            });
        } catch (e) {
            console.warn("[messaging] failed removing token from member doc", e);
        }
        try {
            await deleteToken(getMessagingInstance());
        } catch (e) {
            console.warn("[messaging] deleteToken failed", e);
        }
    }

    // If no other devices are registered, also flip the user's flag off.
    try {
        const snap = await getDoc(doc(db, `clubs/${args.clubId}/members`, args.memberId));
        const tokens: string[] = snap.exists() ? (snap.data().fcmTokens ?? []) : [];
        if (tokens.length === 0) {
            await updateDoc(doc(db, `clubs/${args.clubId}/members`, args.memberId), {
                notificationsEnabled: false,
            });
        }
    } catch (e) {
        console.warn("[messaging] flag reset failed", e);
    }
}

/**
 * If the user previously enabled notifications and the current device hasn't
 * registered a token yet (e.g. they re-installed the PWA, cleared cookies, or
 * logged in on a new device), get a fresh token and store it. Idempotent —
 * safe to call on every login.
 */
export async function syncPushTokenSilently(args: {
    clubId: string;
    memberId: string;
    notificationsEnabled: boolean;
}): Promise<void> {
    if (!args.notificationsEnabled) return;
    if (!(await isPushSupported())) return;
    if (Notification.permission !== "granted") return;

    try {
        const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
        const token = await getToken(getMessagingInstance(), {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: reg,
        });
        if (!token) return;
        await updateDoc(doc(db, `clubs/${args.clubId}/members`, args.memberId), {
            fcmTokens: arrayUnion(token),
        });
    } catch (e) {
        console.warn("[messaging] silent sync failed", e);
    }
}

/**
 * Subscribe to foreground messages — fires when a push arrives while the app
 * is open. Returns an unsubscribe function. Callers typically render a toast.
 */
export function subscribeToForegroundMessages(
    handler: (payload: {
        title: string;
        body: string;
        url?: string;
        data?: Record<string, string>;
    }) => void,
): () => void {
    if (useFirebaseEmulators) return () => {};
    let unsub: (() => void) | null = null;
    isSupported().then((s) => {
        if (!s) return;
        unsub = onMessage(getMessagingInstance(), (payload) => {
            handler({
                title: payload.notification?.title || payload.data?.title || "Magic Nutrition Club",
                body: payload.notification?.body || payload.data?.body || "",
                url: payload.data?.url,
                data: payload.data as Record<string, string> | undefined,
            });
        });
    });
    return () => {
        if (unsub) unsub();
    };
}
