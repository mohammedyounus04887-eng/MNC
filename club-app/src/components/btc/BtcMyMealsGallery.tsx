/**
 * Member's own meal-photo gallery — date-grouped (newest first), three slots
 * per day (Breakfast / Lunch / Dinner). Member-friendly status labels only
 * (never the raw "pending"), NO coach comments.
 *
 * Two render modes:
 *   - inline (default usage in BtcMemberView): a normal card shown directly
 *     below the upload section, always visible.
 *   - overlay: full-screen with a back button (kept for any modal usage).
 *
 * Uses the member's already-loaded meals — no extra Firestore reads.
 */

import { useMemo } from "react";
import type { BtcChallengeMeal } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";

const SLOTS: Array<{ id: "breakfast" | "lunch" | "dinner"; label: string; icon: string }> = [
    { id: "breakfast", label: "Breakfast", icon: "🥣" },
    { id: "lunch", label: "Lunch", icon: "🍱" },
    { id: "dinner", label: "Dinner", icon: "🌙" },
];

const STATUS_LABEL: Record<string, string> = { pending: "Uploaded ✓", approved: "Approved ✓", rejected: "Rejected" };

export default function BtcMyMealsGallery({ meals, onClose, inline }: {
    meals: BtcChallengeMeal[];
    onClose?: () => void;
    inline?: boolean;
}) {
    const { dates, byDate } = useMemo(() => {
        const map: Record<string, Record<string, BtcChallengeMeal>> = {};
        const order: string[] = [];
        const sorted = [...meals].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest day first
        for (const m of sorted) {
            if (!map[m.date]) { map[m.date] = {}; order.push(m.date); }
            map[m.date][m.slot] = m;
        }
        return { dates: order, byDate: map };
    }, [meals]);

    const uploadedCount = meals.length;
    const dayCardBg = inline ? "#f8fafc" : "white";

    const body = (
        <>
            {dates.length === 0 && (
                <div style={{ background: dayCardBg, borderRadius: 12, padding: inline ? 20 : 40, textAlign: "center", color: "#94a3b8", fontWeight: 700, fontSize: 12 }}>
                    No meal photos uploaded yet. Use the Breakfast / Lunch / Dinner buttons above to add today's meals.
                </div>
            )}
            {dates.map(date => (
                <div key={date} style={{ background: dayCardBg, borderRadius: 12, padding: 12, marginBottom: 10, border: inline ? "1px solid #eef2f7" : "none", boxShadow: inline ? "none" : "0 1px 4px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>{formatDate(date)}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {SLOTS.map(s => {
                            const meal = byDate[date][s.id];
                            if (!meal) {
                                return (
                                    <div key={s.id} style={{ ...cell, opacity: 0.55, border: "1.5px dashed #cbd5e1" }}>
                                        <div style={{ fontSize: 26, textAlign: "center" }}>{s.icon}</div>
                                        <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", textAlign: "center" }}>{s.label}</div>
                                        <div style={{ fontSize: 9, color: "#94a3b8", textAlign: "center", marginTop: 2 }}>not uploaded</div>
                                    </div>
                                );
                            }
                            const rejected = meal.status === "rejected";
                            const color = rejected ? "#dc2626" : "#16a34a";
                            return (
                                <div key={s.id} style={{ ...cell, border: `1.5px solid ${color}`, background: "white" }}>
                                    {meal.photoUrl
                                        ? <img src={meal.photoUrl} alt={`${s.label} ${meal.date}`} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
                                        : <div style={{ width: "100%", aspectRatio: "1", background: "#f1f5f9", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>Archived</div>}
                                    <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{s.icon} {s.label}</div>
                                    <div style={{ fontSize: 10, fontWeight: 800, color, marginTop: 2 }}>{STATUS_LABEL[meal.status] || meal.status}</div>
                                    {rejected && meal.rejectionReason && (
                                        <div style={{ fontSize: 9, color: "#7f1d1d", marginTop: 3, lineHeight: 1.3 }}>{meal.rejectionReason} — please re-upload</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </>
    );

    if (inline) {
        return (
            <div style={{ background: "white", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.04)", fontFamily: FONT }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>📅 My Uploaded Photos ({uploadedCount})</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 12 }}>Everything you've submitted this challenge — breakfast, lunch &amp; dinner per day.</div>
                {body}
            </div>
        );
    }

    return (
        <div style={{ position: "fixed", inset: 0, background: "#f8fafc", fontFamily: FONT, zIndex: 200, overflowY: "auto" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 5, background: "white", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 14, fontWeight: 800, color: "#475569", cursor: "pointer", fontFamily: FONT, padding: "6px 10px" }}>← Back</button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>📅 My Meal Photos</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{uploadedCount} photo{uploadedCount === 1 ? "" : "s"} uploaded</div>
                </div>
            </div>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>{body}</div>
        </div>
    );
}

function formatDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    } catch { return ymd; }
}

const cell: React.CSSProperties = { background: "#f8fafc", borderRadius: 10, padding: 8 };
