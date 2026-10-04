/**
 * Reception home — rebuilt.
 *
 * Six things, all on the first screen. Nothing important hidden behind a
 * settings drawer, because everything here is done dozens of times a day.
 *
 * The old reception screen is still one tap away and unchanged — the rebuilt
 * pages don't replace it, they sit alongside it until every flow has been
 * moved across.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";


import { useClubContext } from "@/lib/clubDetection";
import { todayLocal } from "@/lib/clubDay";

const TILES = [
    { to: "/queue", icon: "🥤", label: "Queue", sub: "Orders waiting" },
    { to: "/checkin", icon: "✓", label: "Check In", sub: "Mark present" },
    { to: "/renew", icon: "↻", label: "Renew Plan", sub: "Collect & extend" },
    { to: "/sell", icon: "🛍", label: "Sell Product", sub: "Take payment" },
    { to: "/guest", icon: "☀", label: "Guest & First Day", sub: "Walk-ins" },
    { to: "/admin/today", icon: "📋", label: "Today's Report", sub: "Money & numbers" },
];

export default function ReceptionHomeNew() {
    const navigate = useNavigate();
    const { club } = useClubContext();

    // StationAccess authenticates and authorizes this route before mounting.

    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "22px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", opacity: .75 }}>{club?.name}</div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 4 }}>Reception</div>
                <div style={{ fontSize: 13, opacity: .75, marginTop: 2 }}>
                    {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
                </div>
            </div>

            <div style={{ padding: 18, maxWidth: 780, margin: "0 auto" }}>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                    {TILES.map(t => (
                        <button
                            key={t.to}
                            onClick={() => navigate(t.to)}
                            style={{
                                background: "#151d1b", border: "1px solid #25302d", borderRadius: 18,
                                padding: "26px 16px", cursor: "pointer", fontFamily: "inherit",
                                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                                boxShadow: "0 1px 2px rgba(20,30,25,.04), 0 12px 26px -20px rgba(20,30,25,.5)",
                            }}
                        >
                            <span style={{ fontSize: 34 }}>{t.icon}</span>
                            <span style={{ fontSize: 17, fontWeight: 900 }}>{t.label}</span>
                            <span style={{ fontSize: 12.5, color: "#6f7e79" }}>{t.sub}</span>
                        </button>
                    ))}
                </div>

                <div style={{ marginTop: 22, textAlign: "center" }}>
                    <button
                        onClick={() => navigate("/reception?classic=1")}
                        style={{
                            background: "transparent", border: "1.5px solid #25302d", borderRadius: 12,
                            padding: "12px 22px", fontSize: 14, fontWeight: 800, color: "#a2b0ab",
                            cursor: "pointer", fontFamily: "inherit",
                        }}
                    >
                        Open the old reception screen
                    </button>
                    <div style={{ fontSize: 12, color: "#6f7e79", marginTop: 8 }}>
                        Everything not rebuilt yet — virtual members, gift cards, audit entries — still lives there.
                    </div>
                </div>

                <div style={{ textAlign: "center", fontSize: 11.5, color: "#6f7e79", marginTop: 22 }}>
                    {todayLocal()}
                </div>
            </div>
        </div>
    );
}
