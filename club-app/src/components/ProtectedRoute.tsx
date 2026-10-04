import { ReactNode, useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, getDashboardPath } from "@/lib/auth";
import { isSuperAdminDomain } from "@/lib/clubDetection";
import { useFirebaseEmulators } from "@/lib/firebase";
import type { UserRole } from "@/types/firestore";

// ─── Loading spinner ────────────────────────────────────────────────────

function LoadingScreen() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-muted-foreground text-sm">Loading…</p>
            </div>
        </div>
    );
}

// The login path depends on which domain we're on:
// - Superadmin domain → /superadmin/login  (email + password)
// - Club domain       → /login             (PIN gate — but protected routes
//                                           are only used on the superadmin
//                                           domain so this path rarely fires)
const LOGIN_PATH = !useFirebaseEmulators && isSuperAdminDomain() ? "/superadmin/login" : "/login";

// ─── ProtectedRoute ─────────────────────────────────────────────────────
// Wraps any route that requires Firebase Auth.
// If not logged in → redirects to the appropriate login page.
// If logged in but wrong role → redirects to role's correct dashboard.
// Safety net: if role doesn't resolve within 5s → redirect to login.

interface ProtectedRouteProps {
    children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { firebaseUser, role, loading, refreshProfile } = useAuth();
    const location = useLocation();
    const [timedOut, setTimedOut] = useState(false);
    const [retryAttempted, setRetryAttempted] = useState(false);

    // 12-second safety net — gives slow networks a fair shot before we give up.
    // Step 3 of fetchUserProfile scans members across all clubs sequentially on
    // a fresh deep-link load, which can exceed 5s on slow mobile networks.
    useEffect(() => {
        if (role) {
            setTimedOut(false);
            return;
        }
        const timer = setTimeout(() => {
            if (!role) setTimedOut(true);
        }, 12000);
        return () => clearTimeout(timer);
    }, [role]);

    // One-shot auto-retry: if we time out but Firebase Auth says the user IS
    // logged in, the profile lookup probably hit a slow query, not a missing
    // profile. Bust the cache and try once more before showing the error.
    useEffect(() => {
        if (timedOut && firebaseUser && !role && !retryAttempted) {
            console.log('[AUTH] timed out — auto-retrying profile fetch once');
            setRetryAttempted(true);
            refreshProfile().finally(() => {
                // Re-arm the timeout for the retry attempt
                setTimedOut(false);
                setTimeout(() => {
                    setTimedOut(true);
                }, 10000);
            });
        }
    }, [timedOut, firebaseUser, role, retryAttempted, refreshProfile]);

    if (loading && !timedOut) {
        return <LoadingScreen />;
    }

    // Not authenticated at all → go to login.
    if (!firebaseUser) {
        const redirectTo = location.pathname.startsWith("/member") ? "/member/login" : LOGIN_PATH;
        return <Navigate to={redirectTo} state={{ from: location }} replace />;
    }

    // Retry the verified lookup once; cached presentation data grants no access.
    if (timedOut && !role) {
        // No cache, retry hasn't fired yet → keep loading; retry useEffect will fire.
        if (!retryAttempted) {
            return <LoadingScreen />;
        }
        // No cache, retry also failed → show error (NOT a redirect; that loops).
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4 text-center p-6 max-w-sm">
                    <p className="text-lg font-semibold text-red-600">Unable to load your profile</p>
                    <p className="text-sm text-muted-foreground">
                        Your login succeeded but we couldn't find your user profile.
                        Check the browser console for [AUTH] logs.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-primary text-white rounded-lg text-sm"
                        >
                            Retry
                        </button>
                        <button
                            onClick={async () => {
                                // Clear everything and force re-login. Often fixes
                                // stale Firebase Auth state on iOS Safari.
                                try {
                                    const { auth } = await import("@/lib/firebase");
                                    await auth.signOut();
                                } catch {}
                                localStorage.removeItem("mnc_user_profile_v2");
                                window.location.href = location.pathname.startsWith("/member") ? "/member/login" : LOGIN_PATH;
                            }}
                            className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg text-sm"
                        >
                            Sign out & retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Role still loading (within timeout window, or retrying)
    if (!role) {
        return <LoadingScreen />;
    }

    return <>{children}</>;
}

// ─── RoleRoute ──────────────────────────────────────────────────────────
// Only renders children if the user's role is in the allowed list.
// Otherwise redirects them to their correct dashboard.

interface RoleRouteProps {
    roles: UserRole[];
    children: ReactNode;
}

export function RoleRoute({ roles, children }: RoleRouteProps) {
    const { role, loading } = useAuth();

    if (loading) {
        return <LoadingScreen />;
    }

    if (!role || !roles.includes(role)) {
        const dashboardPath = role ? getDashboardPath(role) : LOGIN_PATH;
        return <Navigate to={dashboardPath} replace />;
    }

    return <>{children}</>;
}

