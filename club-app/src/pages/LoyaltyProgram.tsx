/**
 * /loyalty-program — the club's loyalty slide, on the TV, behind a PIN.
 *
 * Two views, one page: the board that explains the programme, and the
 * leaderboard behind the button on it. They are the same screen because the
 * TV in the club is the same TV either way — a member reads the rules, then
 * somebody presses the button to show them where they stand.
 *
 * It opens on the **TV PIN** rather than one of its own. That was a deliberate
 * choice: it is the same television, and one more PIN for the club to keep
 * track of is one more PIN to lose. Because the TV PIN's length is the club's
 * to set, the gate takes a PIN of any length instead of drawing a fixed row of
 * boxes that would reject a correct four-digit one.
 */

import { useState } from "react";
import { usePinAccess } from "@/hooks/usePinAccess";
import PinGate from "@/components/PinGate";
import ClubNetworkErrorScreen from "@/components/ClubNetworkErrorScreen";
import { useClubContext } from "@/lib/clubDetection";
import LoyaltyBoard from "@/components/loyalty/LoyaltyBoard";
import LoyaltyLeaderboard from "@/components/loyalty/LoyaltyLeaderboard";

type View = "board" | "leaderboard";

export default function LoyaltyProgramPage() {
    const { club, loading: clubLoading, errorKind, retry } = useClubContext();
    const { isVerified, isLoading, clubId, clubName, clubLogo, verify } = usePinAccess("tv");
    const [view, setView] = useState<View>("board");

    if (isLoading || clubLoading) {
        return (
            <div style={screen}>
                <div style={spinner} />
                <style>{"@keyframes loyalty-spin { to { transform: rotate(360deg); } }"}</style>
            </div>
        );
    }

    if (!club) {
        // A dropped connection and a domain with no club look identical on
        // screen unless they are told apart — one is worth a Retry button, the
        // other is a dead end.
        if (errorKind === "network") return <ClubNetworkErrorScreen onRetry={retry} />;
        return (
            <div style={screen}>
                <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Club Not Found</h1>
                <p style={{ opacity: 0.7, marginTop: 10, maxWidth: 420 }}>
                    The Loyalty Program board opens from your club's own web address.
                </p>
            </div>
        );
    }

    if (!isVerified) {
        return (
            <PinGate
                type="tv"
                title="Loyalty Program"
                icon="🏆"
                buttonLabel="Open Loyalty Board"
                variableLength
                clubName={clubName}
                clubLogo={clubLogo}
                pinLength={6}
                isLoading={false}
                onVerify={verify}
            />
        );
    }

    if (view === "leaderboard") {
        return (
            <LoyaltyLeaderboard
                clubId={clubId}
                clubName={clubName}
                onBack={() => setView("board")}
            />
        );
    }

    return (
        <LoyaltyBoard
            clubName={clubName}
            clubLogo={clubLogo}
            onViewLeaderboard={() => setView("leaderboard")}
        />
    );
}

const screen: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "linear-gradient(135deg, #0a1f14, #1a3a2a)",
    color: "#fff",
    fontFamily: "Nunito, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 40,
};

const spinner: React.CSSProperties = {
    width: 48,
    height: 48,
    border: "4px solid rgba(255,255,255,0.2)",
    borderTopColor: "#86efac",
    borderRadius: "50%",
    animation: "loyalty-spin 0.8s linear infinite",
};
