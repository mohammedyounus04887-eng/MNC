/**
 * Auth-aware retry wrapper for Firestore writes.
 *
 * The admin/owner side of this app uses Firebase email/password auth. Token
 * refresh is automatic but can fail under three real conditions:
 *   1. Long idle (>1 hour) on a flaky mobile network → refresh request
 *      times out, write fires with a stale token, Firestore returns
 *      "permission-denied".
 *   2. The browser tab woke from sleep — SDK token cache may be stale.
 *   3. The service worker intercepted the auth-refresh request.
 *
 * `withAuthRefresh()` wraps any write/batch and on permission-denied does:
 *   - forces `currentUser.getIdToken(true)` (forces token refresh)
 *   - retries the operation once
 *   - on still-failing, throws a friendlier error the UI can show as a
 *     "your session expired — please sign in again" message.
 *
 * Use this for any write the owner can hit from a long-lived screen
 * (member edit, couple linking, BTC enrolment, plan edits, etc.).
 */

import { auth } from "@/lib/firebase";

const PERMISSION_DENIED_PATTERNS = [
    /permission[\s-]?denied/i,
    /insufficient permissions/i,
    /missing or insufficient permissions/i,
];

function isPermissionError(err: any): boolean {
    if (!err) return false;
    if (err.code === "permission-denied") return true;
    const msg = String(err.message || err);
    return PERMISSION_DENIED_PATTERNS.some(p => p.test(msg));
}

export class SessionExpiredError extends Error {
    constructor(public cause?: any) {
        super("Your session has expired. Please sign out and sign in again.");
        this.name = "SessionExpiredError";
    }
}

/**
 * Run a Firestore operation with automatic token refresh + 1 retry on
 * permission-denied. Throws SessionExpiredError if refresh + retry both
 * fail so the calling UI can show a sensible message instead of swallowing
 * the error silently.
 */
export async function withAuthRefresh<T>(op: () => Promise<T>): Promise<T> {
    try {
        return await op();
    } catch (err: any) {
        if (!isPermissionError(err)) throw err;

        // Permission denied — most often a stale token. Try to refresh and
        // retry exactly once.
        try {
            const user = auth.currentUser;
            if (!user) {
                throw new SessionExpiredError(err);
            }
            await user.getIdToken(/* forceRefresh */ true);
        } catch (refreshErr) {
            console.error("[withAuthRefresh] token refresh failed", refreshErr);
            throw new SessionExpiredError(err);
        }

        try {
            return await op();
        } catch (retryErr: any) {
            if (isPermissionError(retryErr)) {
                throw new SessionExpiredError(retryErr);
            }
            throw retryErr;
        }
    }
}

/**
 * UI-friendly error string for any thrown error from a write — used in
 * alert / toast messages. Recognizes SessionExpiredError specifically.
 */
export function describeFirestoreError(err: any): string {
    if (err instanceof SessionExpiredError) return err.message;
    if (isPermissionError(err)) {
        return "You don't have permission for this change. Try signing out and signing back in.";
    }
    if (err?.code === "unavailable" || /offline|unavailable|network/i.test(err?.message || "")) {
        return "Couldn't reach the server. Check your connection and try again.";
    }
    return err?.message || "Something went wrong. Please try again.";
}
