// PIN-based access is designed for convenience, not high security.
// PINs are stored in Firestore and compared client-side.
// After PIN verification, we sign in anonymously so Firestore rules
// that require `request.auth != null` (isSignedIn) are satisfied.

import { useState, useEffect } from "react";
import { doc, getDocFromServer, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";

type PinType = "kitchen" | "admin" | "reception" | "tv" | "btc";

function getStorageKey(clubId: string, type: PinType): string {
    return `mnc_${type}_pin_${clubId}`;
}

function getFieldName(type: PinType): string {
    if (type === "kitchen") return "kitchenPin";
    if (type === "admin") return "adminPin";
    if (type === "tv") return "tvPin";
    if (type === "btc") return "btcPin";
    return "receptionPin";
}

/**
 * Where PINs are read from.
 *
 * They used to live on the club document, which has to stay publicly readable
 * because the app resolves which club it is from the domain before anybody
 * signs in. That meant every PIN — admin, kitchen, reception, TV, BTC — could
 * be read by anyone who knew the club id, without logging in.
 *
 * They now live at clubs/{id}/security/pins, which requires a session. The club
 * document stays public for the name and logo the boot screen needs.
 *
 * During the changeover this reads the secure copy first and falls back to the
 * old field, copying it across when it does — so nothing breaks while devices
 * are still updating, and the club migrates itself as each surface is used.
 */
async function fetchClubPin(clubId: string, type: PinType): Promise<string | null> {
    const field = getFieldName(type);

    // A session is needed to read the secure copy, and every caller wants one
    // anyway for the writes that follow.
    await ensureAuth();

    try {
        const secure = await getDocFromServer(doc(db, "clubs", clubId, "security", "pins"));
        const val = secure.exists() ? secure.data()?.[field] : null;
        if (val != null && val !== "") return String(val).trim();
    } catch {
        // Not migrated yet, or offline — fall through to the club document.
    }

    const snap = await getDocFromServer(doc(db, "clubs", clubId));
    if (!snap.exists()) return null;
    const raw = snap.data()?.[field];
    if (raw == null || raw === "") return null;
    const pin = String(raw).trim();

    // Move it somewhere private. Best effort: a failure here only means the
    // next visit tries again.
    void setDoc(
        doc(db, "clubs", clubId, "security", "pins"),
        { [field]: pin, migratedAt: new Date().toISOString() },
        { merge: true },
    ).catch(() => {});

    return pin;
}

/** Ensure there's a Firebase Auth session so Firestore writes succeed. */
async function ensureAuth(): Promise<void> {
    if (auth.currentUser) return;
    try {
        await signInAnonymously(auth);
    } catch (e) {
        console.error("[usePinAccess] anonymous sign-in failed:", e);
    }
}

interface PinAccessResult {
    isVerified: boolean;
    isLoading: boolean;
    clubId: string | null;
    clubName: string;
    clubLogo: string;
    verify: (pin: string) => Promise<boolean>;
    logout: () => void;
}

export function usePinAccess(type: PinType): PinAccessResult {
    const { club, loading: clubLoading } = useClubContext();
    const clubId = club?.id ?? null;

    const [isVerified, setIsVerified] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Background verification — revoke access if PIN is stale
    // IMPORTANT: We must await ensureAuth() BEFORE setting isVerified=true,
    // otherwise Firestore onSnapshot listeners fire before auth is ready
    // and get permission-denied errors.
    useEffect(() => {
        if (clubLoading) return;
        if (!clubId) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        const key = getStorageKey(clubId, type);
        const storedPin = localStorage.getItem(key);

        if (!storedPin) {
            setIsVerified(false);
            setIsLoading(false);
            return;
        }

        // Ensure Firebase Auth session exists FIRST, then verify PIN
        ensureAuth()
            .then(() => fetchClubPin(clubId, type))
            .then((currentPin) => {
                if (cancelled) return;
                if (!currentPin || storedPin.trim() !== currentPin) {
                    localStorage.removeItem(key);
                    setIsVerified(false);
                } else {
                    // Stored PIN is still valid AND auth is ready — grant access
                    setIsVerified(true);
                }
            })
            .catch(() => {
                // Network error — try granting access if we have auth
                if (!cancelled && auth.currentUser) {
                    setIsVerified(true);
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clubId, clubLoading, type]);

    // Synchronize logout across multiple instances of the hook
    useEffect(() => {
        const handleLogout = () => setIsVerified(false);
        window.addEventListener(`mnc-pin-logout-${type}`, handleLogout);
        return () => window.removeEventListener(`mnc-pin-logout-${type}`, handleLogout);
    }, [type]);

    async function verify(pin: string): Promise<boolean> {
        if (!clubId) return false;
        const currentPin = await fetchClubPin(clubId, type);
        if (!currentPin) return false;
        if (pin.trim() === currentPin) {
            localStorage.setItem(getStorageKey(clubId, type), pin.trim());
            // Sign in anonymously so all Firestore writes have auth context
            await ensureAuth();
            setIsVerified(true);
            return true;
        }
        return false;
    }

    function logout() {
        if (clubId) {
            localStorage.removeItem(getStorageKey(clubId, type));
        }
        setIsVerified(false);
        window.dispatchEvent(new Event(`mnc-pin-logout-${type}`));
    }

    return {
        isVerified,
        isLoading: isLoading || clubLoading,
        clubId,
        clubName: club?.name ?? "",
        clubLogo: club?.logo ?? "",
        verify,
        logout,
    };
}
