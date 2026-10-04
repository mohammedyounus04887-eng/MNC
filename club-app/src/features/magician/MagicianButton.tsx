import { useState } from "react";
import type { User as Member, Product } from "@/types/firestore";
import MagicianOverlay from "./MagicianOverlay";
import MagicianHelpCard from "./MagicianHelpCard";

interface Props {
    clubId: string;
    receptionistId: string;
    receptionistName: string;
    members: Member[];
    todaysSpecials: Product[];
    onOpenTodayReport: () => void;
    onOpenMemberProfile: (memberId: string) => void;
    onPrintTodayReport: () => void;
}

// ─── MagicianButton ────────────────────────────────────────────────────
// Floating mic button (bottom-right) that opens the Magician overlay.
// Self-contained — Reception just mounts it once with the data it
// already has loaded.

export default function MagicianButton(props: Props) {
    const [open, setOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);

    return (
        <>
            {/* Main mic button */}
            <button
                onClick={() => setOpen(true)}
                title="Magician — voice attendance & shake orders"
                aria-label="Open Magician voice assistant"
                style={{
                    position: "fixed",
                    bottom: 24, right: 24,
                    width: 68, height: 68, borderRadius: 34,
                    border: "none",
                    background: "linear-gradient(135deg,#7c3aed 0%,#06b6d4 100%)",
                    color: "white",
                    fontSize: 28,
                    cursor: "pointer",
                    boxShadow: "0 8px 24px rgba(124,58,237,0.45), 0 0 0 6px rgba(124,58,237,0.12)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 1000,
                    animation: "magicianPulse 2.4s ease-in-out infinite",
                    fontFamily: "Nunito, sans-serif",
                }}
            >
                <span style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}>🪄</span>
                <style>{`
                    @keyframes magicianPulse {
                        0%, 100% { box-shadow: 0 8px 24px rgba(124,58,237,0.45), 0 0 0 6px rgba(124,58,237,0.12); }
                        50%      { box-shadow: 0 8px 32px rgba(124,58,237,0.6),  0 0 0 14px rgba(124,58,237,0); }
                    }
                `}</style>
            </button>

            {/* Help/Guide ❓ button — sits just above the mic */}
            <button
                onClick={() => setHelpOpen(true)}
                title="What can I say to Magician?"
                aria-label="Open Magician command reference"
                style={{
                    position: "fixed",
                    bottom: 104, right: 35,
                    width: 44, height: 44, borderRadius: 22,
                    border: "none",
                    background: "white",
                    color: "#7c3aed",
                    fontSize: 20, fontWeight: 900,
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(15,23,42,0.18), 0 0 0 1px rgba(124,58,237,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 1000,
                    fontFamily: "Nunito, sans-serif",
                    transition: "transform 180ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)"}
                onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"}
            >
                ❔
            </button>

            <MagicianOverlay
                open={open}
                onClose={() => setOpen(false)}
                {...props}
            />
            <MagicianHelpCard open={helpOpen} onClose={() => setHelpOpen(false)} />
        </>
    );
}
