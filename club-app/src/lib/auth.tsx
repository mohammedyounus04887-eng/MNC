import {
    createContext,
    useContext,
    useState,
    useEffect,
    ReactNode,
} from "react";
import { invalidateClubCache, detectClub } from "@/lib/clubDetection";
import {
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    onIdTokenChanged,
    User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { User, UserRole } from "@/types/firestore";
import { verifiedClubRole, profileDefaults } from "./authorizationProfile";

// ─── Types ──────────────────────────────────────────────────────────────

interface AuthContextType {
    firebaseUser: FirebaseUser | null;
    userProfile: User | null;
    role: UserRole | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<User>;
    signOut: () => Promise<void>;
    /** Force re-fetch the user profile from Firestore (busts cache). */
    refreshProfile: () => Promise<void>;
}

// ─── Verified profile lookup ────────────────────────────────────────────

// Wrap any promise with a timeout so a hanging Firestore read doesn't
// freeze the entire auth flow. Returns null if the timeout fires.
// IMPORTANT: clear the timer when `p` wins the race — otherwise the
// setTimeout still runs to completion and prints a misleading
// "timed out after Xms" warning even when the fetch resolved in ms.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            console.warn(`[AUTH] ${label} timed out after ${ms}ms`);
            resolve(null);
        }, ms);
    });
    return Promise.race([p, timeoutPromise]).then((value) => {
        if (timer !== undefined) clearTimeout(timer);
        return value;
    });
}

async function fetchUserProfile(uid: string, _email?: string | null): Promise<User | null> {
    const current = auth.currentUser;
    if (!current || current.uid !== uid || current.isAnonymous) return null;
    const token = await current.getIdTokenResult();
    // A member federation session never becomes a platform session, including after a later promotion.
    const platform = token.claims.federationPairId ? null : await getDoc(doc(db, 'superAdmins', uid)).catch(() => null);
    if (platform?.exists() && platform.data().enabled !== false) {
        const data: Partial<User> = platform.data();
        return { ...profileDefaults(uid, '', 'superAdmin'), ...data, id: uid, role: 'superAdmin' };
    }
    const club = await detectClub().catch(() => null);
    if (!club) return null;
    const authorization = await getDoc(doc(db, `clubs/${club.id}/authorizations`, uid)).catch(() => null);
    const grant = authorization?.exists() ? authorization.data() : null;
    const role = verifiedClubRole(uid, club.id, token.claims, grant);
    if (role === 'owner' || role === 'admin') {
        const owner = await getDoc(doc(db, `clubs/${club.id}/owner/profile`));
        const data: Partial<User> = owner.exists() ? owner.data() : {};
        return { ...profileDefaults(uid, club.id, 'clubOwner'), ...data, id: uid, clubId: club.id, role: 'clubOwner' };
    }
    if (role !== 'member') return null;
    const member = await getDoc(doc(db, `clubs/${club.id}/members`, uid));
    if (!member.exists()) return null;
    const data: Partial<User> = member.data();
    return { ...profileDefaults(uid, club.id, 'member'), ...data, id: uid, clubId: club.id, role: 'member' };
}
// ─── Auth functions ─────────────────────────────────────────────────────

export async function signIn(
    email: string,
    password: string
): Promise<User> {
    try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const profile = await fetchUserProfile(credential.user.uid, credential.user.email);

        if (!profile) {
            throw new Error(
                "User account exists in Auth but has no Firestore profile. Contact your administrator."
            );
        }

        return profile;
    } catch (error: unknown) {
        const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
        if (
            code === "auth/user-not-found" ||
            code === "auth/wrong-password" ||
            code === "auth/invalid-credential"
        ) {
            throw new Error("Invalid email or password.");
        }
        if (code === "auth/too-many-requests") {
            throw new Error("Too many failed attempts. Please try again later.");
        }
        throw error;
    }
}

export async function signOutUser(): Promise<void> {
    try {
        const token = await auth.currentUser?.getIdTokenResult();
        let propagationError: unknown = null;
        if (import.meta.env.VITE_INTEGRATION_SSO_ENABLED === 'true' || token?.claims.federationPairId) {
            const { propagateClubLogout } = await import('./federationClient');
            try { await propagateClubLogout(); } catch (error) { propagationError = error; }
        }
        await firebaseSignOut(auth);
        if (propagationError) throw propagationError;
    } catch (error) {
        console.error("Error signing out:", error);
        throw error;
    }
}

export function getCurrentUserRole(): UserRole | null {
    // Synchronous getter — role is kept in AuthContext state.
    // Use useAuth() hook in components instead.
    return null;
}

// ─── Role-based dashboard paths ─────────────────────────────────────────

export function getDashboardPath(role: UserRole): string {
    switch (role) {
        case "superAdmin":
            return "/superadmin/dashboard";
        case "clubOwner":
            return "/owner/dashboard";
        case "staff":
            return "/staff/dashboard";
        case "member":
            return "/member/dashboard";
        case "kitchenDisplay":
            return "/kitchen";
        default:
            return "/";
    }
}

// ─── Context ────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType>({
    firebaseUser: null,
    userProfile: null,
    role: null,
    loading: true,
    signIn: async () => {
        throw new Error("AuthProvider not initialised");
    },
    signOut: async () => {
        throw new Error("AuthProvider not initialised");
    },
    refreshProfile: async () => { },
});

// ─── React hook ─────────────────────────────────────────────────────────

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (ctx === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return ctx;
}

// ─── Provider ───────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [userProfile, setUserProfile] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const unsubscribe = onIdTokenChanged(auth, async (fbUser) => {
            setFirebaseUser(fbUser);
            setUserProfile(null);
            setRole(null);
            setLoading(true);
            const apply = (profile: User | null) => {
                if (!active || (auth.currentUser?.uid ?? null) !== (fbUser?.uid ?? null)) return;
                setUserProfile(profile);
                setRole(profile?.role ?? null);
                setLoading(false);
            };
            if (!fbUser) { apply(null); return; }
            const pending = fetchUserProfile(fbUser.uid).catch(() => null);
            // A slow valid result may arrive later; stale/logged-out results are ignored.
            void pending.then(apply);
            apply(await withTimeout(pending, 10000, 'verified profile'));
        });
        return () => { active = false; unsubscribe(); };
    }, []);
    const handleSignIn = async (email: string, password: string): Promise<User> => {
        const profile = await signIn(email, password);
        setUserProfile(profile);
        setRole(profile.role);
        return profile;
    };

    const handleSignOut = async () => {
        await signOutUser();
        invalidateClubCache();
        setUserProfile(null);
        setRole(null);
    };

    const handleRefreshProfile = async () => {
        if (!firebaseUser) return;
        const profile = await fetchUserProfile(firebaseUser.uid).catch(() => null);
        if (auth.currentUser?.uid !== firebaseUser.uid) return;
        setUserProfile(profile);
        setRole(profile?.role ?? null);
    };
    return (
        <AuthContext.Provider
            value={{
                firebaseUser,
                userProfile,
                role,
                loading,
                signIn: handleSignIn,
                signOut: handleSignOut,
                refreshProfile: handleRefreshProfile,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export { AuthContext };
