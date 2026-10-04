import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Capacitor } from "@capacitor/core";
import type { Club } from "@/types/firestore";
import ClubNetworkErrorScreen from "@/components/ClubNetworkErrorScreen";

// ─── Types ──────────────────────────────────────────────────────────────

// Distinguishes the two "club is null" cases so the UI can show the right
// thing: genuine "no club registered for this domain" vs. a transient
// network failure (which should offer a retry button, not a dead end).
export type ClubErrorKind = "network" | "no_club" | null;

interface ClubContextType {
    club: Club | null;
    loading: boolean;
    error: string | null;
    errorKind: ClubErrorKind;
    retry: () => void;
}

// ─── Default dev club (used when Firebase isn't configured yet) ──────

const DEFAULT_DEV_CLUB: Club = {
    id: "dev_club",
    name: "Magic Nutrition Club",
    currencyName: "MNC Coins",
    domain: "localhost",
    parentClubId: null,
    treePath: "dev_club",
    theme: "custom",
    primaryColor: "#8B5CF6",
    secondaryColor: "#10B981",
    tertiaryColor: "#F59E0B",
    logo: "",
    heroImage: "",
    tagline: "Your Health, Our Mission",
    landingPageUrl: null,
    landingPageImages: [],
    ownerName: "Dev Owner",
    ownerPhone: "+91 9999999999",
    ownerUserId: "owner_user_1",
    status: "active",
    maintenancePaid: true,
    maintenanceDueDate: null as any,
    kitchenPin: "123456",
    adminPin: "12345678",
    createdAt: null as any,
    createdBy: "superadmin_user_1",
};

// ─── Superadmin domain detection ────────────────────────────────────────

// Domains that belong to the developer/superadmin
// These should never try to load a club
const SUPERADMIN_DOMAINS = [
    "magic-nutrition-club.web.app",
    "magic-nutrition-club.firebaseapp.com",
    "localhost",
    "127.0.0.1",
];

export function isSuperAdminDomain(): boolean {
    // Native Android APK runs on localhost but is NOT a superadmin domain
    if (Capacitor.isNativePlatform()) return false;
    return SUPERADMIN_DOMAINS.includes(window.location.hostname);
}

// ─── Module-level club cache ─────────────────────────────────────────────
// Persists across re-renders and page navigations within the same tab session.

let _cachedClub: Club | null | undefined = undefined; // undefined = not yet fetched

const SESSION_KEY = "mnc_club_v2";

function saveClubToSession(club: Club | null) {
    try {
        if (club) sessionStorage.setItem(SESSION_KEY, JSON.stringify(club));
        else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore quota errors */ }
}

function loadClubFromSession(): Club | null {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? (JSON.parse(raw) as Club) : null;
    } catch {
        return null;
    }
}

// ─── Detection logic ────────────────────────────────────────────────────

export async function detectClub(): Promise<Club | null> {
    // Return module-level cache immediately if already fetched this session
    if (_cachedClub !== undefined) return _cachedClub;

    // Check sessionStorage next — survives page refreshes within same tab
    const sessionClub = loadClubFromSession();
    if (sessionClub) {
        _cachedClub = sessionClub;
        return sessionClub;
    }

    // Native Android APK — retry up to 5 times with delay (Firebase may not be ready on cold start)
    if (Capacitor.isNativePlatform()) {
        const clubId = import.meta.env.VITE_CAPACITOR_CLUB_ID;
        const clubDomain = import.meta.env.VITE_CAPACITOR_CLUB_DOMAIN;
        let lastError: any = null;
        let everyAttemptFailed = true; // if any attempt got a clean "not empty / empty" answer, we know the network is OK

        for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
            let attemptCompletedCleanly = false;

            // Try direct document lookup
            if (clubId) {
                try {
                    const docSnap = await getDoc(doc(db, "clubs", clubId));
                    attemptCompletedCleanly = true;
                    if (docSnap.exists()) {
                        const club = { id: docSnap.id, ...docSnap.data() } as Club;
                        _cachedClub = club;
                        saveClubToSession(club);
                        return club;
                    }
                } catch (e) { lastError = e; }
            }

            // Try domain query from env var
            if (clubDomain) {
                try {
                    const clubsRef = collection(db, "clubs");
                    let snapshot = await getDocs(
                        query(clubsRef, where("domains", "array-contains", clubDomain))
                    );
                    if (snapshot.empty) {
                        snapshot = await getDocs(
                            query(clubsRef, where("domain", "==", clubDomain))
                        );
                    }
                    attemptCompletedCleanly = true;
                    if (!snapshot.empty) {
                        const club = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Club;
                        _cachedClub = club;
                        saveClubToSession(club);
                        return club;
                    }
                } catch (e) { lastError = e; }
            }

            // Fallback: hostname detection for Live Update mode (APK loads from server.url,
            // so env vars aren't baked in but window.location.hostname is the live domain)
            const liveHostname = window.location.hostname;
            if (liveHostname && liveHostname !== "localhost" && liveHostname !== "127.0.0.1") {
                try {
                    const clubsRef = collection(db, "clubs");
                    let snapshot = await getDocs(
                        query(clubsRef, where("domains", "array-contains", liveHostname))
                    );
                    if (snapshot.empty) {
                        snapshot = await getDocs(
                            query(clubsRef, where("domain", "==", liveHostname))
                        );
                    }
                    attemptCompletedCleanly = true;
                    if (!snapshot.empty) {
                        const club = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Club;
                        _cachedClub = club;
                        saveClubToSession(club);
                        return club;
                    }
                } catch (e) { lastError = e; }
            }

            if (attemptCompletedCleanly) everyAttemptFailed = false;
        }

        // If every attempt threw, this is a network failure — surface that
        // to the UI so it can show a retry button instead of "Club Not Found".
        if (everyAttemptFailed && lastError) {
            throw new ClubNetworkError(lastError);
        }

        _cachedClub = null;
        return null;
    }

    const hostname = window.location.hostname;

    // Superadmin/dev domains — skip club detection entirely
    if (isSuperAdminDomain()) {
        // For localhost only — try to load dev club for testing owner/member flows
        if (hostname === "localhost" || hostname === "127.0.0.1") {
            const devClubId = import.meta.env.VITE_DEV_CLUB_ID || "dev_club";
            try {
                const docRef = doc(db, "clubs", devClubId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const club = { id: docSnap.id, ...docSnap.data() } as Club;
                    _cachedClub = club;
                    saveClubToSession(club);
                    return club;
                }
            } catch {
                // fallback to default dev club
            }
            const fallback = { ...DEFAULT_DEV_CLUB, id: devClubId };
            _cachedClub = fallback;
            saveClubToSession(fallback);
            return fallback;
        }

        // For magic-nutrition-club.web.app — no club needed
        _cachedClub = null;
        return null;
    }

    // Production club domains — query Firestore by domain.
    // Retries up to 4 times with exponential backoff to handle Firebase
    // cold-start delays on PWA / spotty mobile networks. Clubs store domains
    // in both `domain` (primary, single) and `domains` (array).
    let lastError: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
        try {
            const clubsRef = collection(db, "clubs");

            // 1. Check the `domains` array (supports multiple domains per club)
            let snapshot = await getDocs(
                query(clubsRef, where("domains", "array-contains", hostname))
            );

            // 2. Fallback: check the legacy single `domain` field
            if (snapshot.empty) {
                snapshot = await getDocs(
                    query(clubsRef, where("domain", "==", hostname))
                );
            }

            if (snapshot.empty) {
                // Query succeeded but no club matched this domain — no point retrying
                _cachedClub = null;
                return null;
            }

            const clubDoc = snapshot.docs[0];
            const club = { id: clubDoc.id, ...clubDoc.data() } as Club;
            _cachedClub = club;
            saveClubToSession(club);
            return club;
        } catch (error) {
            lastError = error;
            console.error(`clubDetection: attempt ${attempt + 1} failed`, error);
            // Do NOT cache null on error — let the next attempt retry.
            // Only cache null when we're certain there's no matching club.
        }
    }

    // All retries exhausted with errors — surface this as a NETWORK problem
    // so the UI offers a retry button instead of the "Club Not Found" dead end.
    throw new ClubNetworkError(lastError);
}

// Marker error so the React layer can tell network failures apart from a
// genuine "no club for this domain" result.
export class ClubNetworkError extends Error {
    constructor(public cause?: any) {
        super("Could not reach the server.");
        this.name = "ClubNetworkError";
    }
}

// Call this when club data is mutated (e.g. PIN regenerated) to force re-fetch
export function invalidateClubCache() {
    _cachedClub = undefined;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

// ─── React hook ─────────────────────────────────────────────────────────

export function useClub() {
    const [club, setClub] = useState<Club | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<ClubErrorKind>(null);
    const [attempt, setAttempt] = useState(0); // bump to force re-run

    useEffect(() => {
        let cancelled = false;

        async function load() {
            console.log("clubDetection: load() started (attempt", attempt, ")");
            try {
                setLoading(true);
                setError(null);
                setErrorKind(null);
                const detected = await detectClub();
                console.log("clubDetection: detectClub resolved:", detected);
                if (!cancelled) {
                    setClub(detected);
                    if (!detected) {
                        setError("Club not found for this domain.");
                        setErrorKind("no_club");
                    }
                }
            } catch (err: any) {
                console.error("clubDetection: detectClub error", err);
                if (!cancelled) {
                    const isNet = err instanceof ClubNetworkError
                        || /network|offline|fetch|timeout|unavailable/i.test(err?.message || "");
                    setError(err?.message || "Failed to reach the server.");
                    setErrorKind(isNet ? "network" : "no_club");
                    setClub(null);
                }
            } finally {
                console.log("clubDetection: setLoading(false)");
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [attempt]);

    // Hard retry — clear ALL caches (module-level + sessionStorage) and
    // re-run detection. Used by the "Retry" button on the network-error UI.
    const retry = () => {
        invalidateClubCache();
        setAttempt(a => a + 1);
    };

    return { club, loading, error, errorKind, retry };
}

// ─── Context / Provider ─────────────────────────────────────────────────

const ClubContext = createContext<ClubContextType>({
    club: null,
    loading: true,
    error: null,
    errorKind: null,
    retry: () => { /* noop default — replaced by provider */ },
});

export function ClubProvider({ children }: { children: ReactNode }) {
    const value = useClub();

    // When the failure is network-level (Firestore unreachable), intercept
    // EVERY route in the app and show the retry screen — not just Landing.
    // This prevents downstream pages from rendering broken empty states
    // (e.g. Reception trying to query `clubs/null/members`).
    return (
        <ClubContext.Provider value={value}>
            {value.errorKind === "network"
                ? <ClubNetworkErrorScreen onRetry={value.retry} />
                : children}
        </ClubContext.Provider>
    );
}

export function useClubContext() {
    const ctx = useContext(ClubContext);
    if (ctx === undefined) {
        throw new Error("useClubContext must be used within a ClubProvider");
    }
    return ctx;
}
