import { useEffect, useState } from "react";

interface Props {
    createdAt: any;        // Firestore Timestamp or anything with toDate()
}

// ─── OrderElapsedTimer ────────────────────────────────────────────────
// Ticks every second to show how long a kitchen order has been sitting.
// Color codes by urgency so kitchen sees stale orders at a glance.
//
//   0–3 min  →  green   (fresh, no stress)
//   3–7 min  →  amber   (heads up)
//   7+ min   →  red     (overdue — something's wrong)

export default function OrderElapsedTimer({ createdAt }: Props) {
    const start = createdAt?.toDate ? createdAt.toDate().getTime() : 0;
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    if (!start) return null;
    const elapsedMs = Math.max(0, now - start);
    const totalSecs = Math.floor(elapsedMs / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    const display = m > 0
        ? `${m}m ${String(s).padStart(2, "0")}s`
        : `${s}s`;

    let color = "rgba(16,185,129,0.95)";   // green
    let bg = "rgba(16,185,129,0.15)";
    let pulse = false;
    if (totalSecs >= 420) {
        color = "#fff"; bg = "#dc2626"; pulse = true;     // red, pulsing
    } else if (totalSecs >= 180) {
        color = "#92400e"; bg = "#fbbf24";                 // amber
    }

    return (
        <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: bg, color,
            fontSize: 12, fontWeight: 800,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: 0.3,
            animation: pulse ? "orderTimerPulse 1.2s ease-in-out infinite" : undefined,
        }}>
            <span style={{ fontSize: 10 }}>⏱</span>
            <span>{display}</span>
            <style>{`
                @keyframes orderTimerPulse {
                    0%, 100% { opacity: 1; }
                    50%      { opacity: 0.65; }
                }
            `}</style>
        </div>
    );
}
