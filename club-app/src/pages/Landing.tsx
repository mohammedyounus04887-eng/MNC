import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useClubContext } from "@/lib/clubDetection";
import { useMemberAuth } from "@/hooks/member/useMemberAuth";
import ComingSoonPage from "@/components/ComingSoonPage";
import ClubNetworkErrorScreen from "@/components/ClubNetworkErrorScreen";

const IS_LANDING_APK = import.meta.env.VITE_APP_MODE === "landing";

function NavHub({ clubName }: { clubName: string }) {
    const navigate = useNavigate();
    const buttons = [
        { label: "🖥️ Reception", path: "/reception", color: "#1a3a2a" },
        { label: "👤 Member Login", path: "/member/login", color: "#1e40af" },
        { label: "⚙️ Admin", path: "/login", color: "#7c3aed" },
        { label: "🍽️ Kitchen", path: "/kitchen", color: "#b45309" },
        { label: "📺 TV", path: "/tv", color: "#0f766e" },
        { label: "🏆 BTC", path: "/btc", color: "#d97706" },
        { label: "🏅 Loyalty", path: "/loyalty-program", color: "#b45309" },
    ];
    return (
        <div style={{ minHeight: "100vh", background: "#f0faf4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🏋️</div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1a3a2a", marginBottom: 4 }}>{clubName}</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 36 }}>Select a section to continue</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%", maxWidth: 360 }}>
                {buttons.map(btn => (
                    <button
                        key={btn.path}
                        onClick={() => navigate(btn.path)}
                        style={{
                            padding: "28px 16px", borderRadius: 16, border: "none",
                            background: btn.color, color: "white",
                            fontSize: 16, fontWeight: 700, cursor: "pointer",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        }}
                    >{btn.label}</button>
                ))}
            </div>
        </div>
    );
}

export default function Landing() {
    const { club, loading: clubLoading, errorKind, retry } = useClubContext();
    const { member, loading: authLoading } = useMemberAuth();
    const navigate = useNavigate();

    // If member is already logged in, go straight to dashboard
    useEffect(() => {
        if (!authLoading && member) {
            navigate("/member/dashboard", { replace: true });
        }
    }, [member, authLoading, navigate]);

    // Listen for navigation requests posted from inside the landing page iframe.
    useEffect(() => {
        function handler(e: MessageEvent) {
            if (e.data?.type === "MNC_NAVIGATE" && typeof e.data.path === "string") {
                window.location.href = e.data.path;
            }
        }
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    if (clubLoading || authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
            </div>
        );
    }

    // Already logged in — redirect handled in useEffect above, render nothing meanwhile
    if (member) return null;

    if (!club) {
        // Two distinct cases:
        //  - errorKind === "network": Firestore couldn't be reached. Offer a
        //    Retry button + a "hard reset" that clears caches and reloads.
        //  - errorKind === "no_club": Firestore replied successfully, just no
        //    club matches this domain. The dead-end "Club Not Found" message
        //    is correct here.
        if (errorKind === "network") {
            return <ClubNetworkErrorScreen onRetry={retry} />;
        }
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center px-6">
                    <h1 className="text-2xl font-bold text-gray-800">Club Not Found</h1>
                    <p className="text-gray-500 mt-2">No club is registered for this domain.</p>
                </div>
            </div>
        );
    }

    if (IS_LANDING_APK) {
        return <NavHub clubName={club.name} />;
    }

    if (!club.landingPageUrl) {
        return <ComingSoonPage club={club} />;
    }

    return (
        <div style={{ position: "relative", width: "100%", height: "100vh" }}>
            <iframe
                src={club.landingPageUrl}
                style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                title={club.name}
            />
            {/* Member Login overlay button — always visible over the landing page */}
            <button
                onClick={() => navigate("/member/login")}
                style={{
                    position: "fixed",
                    bottom: 28,
                    right: 20,
                    zIndex: 9999,
                    background: "linear-gradient(135deg,#2d9653,#1a6e3a)",
                    color: "white",
                    border: "none",
                    borderRadius: 50,
                    padding: "14px 22px",
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(45,150,83,0.5)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "Nunito, sans-serif",
                    letterSpacing: 0.2,
                }}
            >
                <span style={{ fontSize: 18 }}>👤</span> Member Login
            </button>
        </div>
    );
}
