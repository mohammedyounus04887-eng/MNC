/**
 * Full-screen drill-in: one customer's meal photos for the coach.
 *
 * Layout:
 *   - Sticky header: back arrow + customer name + meal count
 *   - Date-grouped list (newest day first)
 *   - Each day = a row of three slot cells (Breakfast / Lunch / Dinner)
 *   - Each cell shows the photo, status badge, upload time, and a
 *     comment box (BtcMealCommentBox)
 *
 * The coach can ONLY view + comment. The approve/reject buttons that
 * appear on BtcMealReviewGrid (for the coordinator) are intentionally
 * NOT present here.
 */

import { useMemo, useState } from "react";
import { tsToDate, useCustomerMeals } from "@/hooks/useBtcChallenges";
import type { BtcChallengeMeal, BtcChallengeParticipant } from "@/types/firestore";
import BtcMealCommentBox from "./BtcMealCommentBox";

const FONT = "'Nunito', sans-serif";

const SLOTS: Array<{ id: "breakfast" | "lunch" | "dinner"; label: string; icon: string }> = [
    { id: "breakfast", label: "Breakfast", icon: "🥣" },
    { id: "lunch",     label: "Lunch",     icon: "🍱" },
    { id: "dinner",    label: "Dinner",    icon: "🌙" },
];

interface Props {
    clubId: string;
    challengeId: string;
    customer: BtcChallengeParticipant;
    coach: { id: string; name: string };
    onBack: () => void;
}

export default function BtcCoachCustomerMeals({ clubId, challengeId, customer, coach, onBack }: Props) {
    const { meals, loading } = useCustomerMeals(clubId, challengeId, customer.memberId);

    // Group meals by date. We iterate `meals` (already sorted newest-day-first
    // in the hook) so insertion order of date keys is preserved.
    const byDate = useMemo(() => {
        const out: Record<string, Record<string, BtcChallengeMeal>> = {};
        const datesInOrder: string[] = [];
        for (const m of meals) {
            if (!out[m.date]) { out[m.date] = {}; datesInOrder.push(m.date); }
            out[m.date][m.slot] = m;
        }
        return { dates: datesInOrder, byDateSlot: out };
    }, [meals]);

    return (
        <div style={{ position: "fixed", inset: 0, background: "#f8fafc", fontFamily: FONT, zIndex: 200, overflowY: "auto" }}>
            {/* Sticky header */}
            <div style={{
                position: "sticky", top: 0, zIndex: 5,
                background: "white", borderBottom: "1px solid #e2e8f0",
                padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
            }}>
                <button
                    onClick={onBack}
                    style={{
                        background: "transparent", border: "none",
                        fontSize: 14, fontWeight: 800, color: "#475569",
                        cursor: "pointer", fontFamily: FONT, padding: "6px 10px",
                    }}
                >← Back</button>
                {customer.memberPhoto
                    ? <img src={customer.memberPhoto} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                    : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#1e40af" }}>
                        {customer.memberName[0]}
                    </div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{customer.memberName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                        {meals.length} meal{meals.length === 1 ? "" : "s"} uploaded
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 600, margin: "0 auto", padding: 12 }}>
                {loading && (
                    <div style={emptyBox}>Loading meal photos…</div>
                )}
                {!loading && meals.length === 0 && (
                    <div style={emptyBox}>
                        {customer.memberName} hasn't uploaded any meal photos yet.
                    </div>
                )}

                {!loading && byDate.dates.map(date => (
                    <div key={date} style={dateCard}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
                            {formatDate(date)}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                            {SLOTS.map(s => {
                                const meal = byDate.byDateSlot[date][s.id];
                                return (
                                    <SlotCell
                                        key={s.id}
                                        slot={s}
                                        meal={meal}
                                        clubId={clubId}
                                        challengeId={challengeId}
                                        coach={coach}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── one slot cell (Breakfast/Lunch/Dinner per date) ─────────────────
function SlotCell({ slot, meal, clubId, challengeId, coach }: {
    slot: { id: "breakfast" | "lunch" | "dinner"; label: string; icon: string };
    meal: BtcChallengeMeal | undefined;
    clubId: string;
    challengeId: string;
    coach: { id: string; name: string };
}) {
    const [showComment, setShowComment] = useState(false);

    if (!meal) {
        return (
            <div style={{ ...slotCell, opacity: 0.5, border: "1.5px dashed #cbd5e1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 96 }}>
                <div style={{ fontSize: 20, marginBottom: 2 }}>{slot.icon}</div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "#475569" }}>{slot.label}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>not uploaded</div>
            </div>
        );
    }

    const statusColor =
        meal.status === "approved" ? "#16a34a"
        : meal.status === "rejected" ? "#dc2626"
        : "#d97706";
    const uploadedDt = tsToDate(meal.uploadedAt as any);
    // "late" flag: uploaded on a later date than the meal's actual date
    const isLate = uploadedDt && uploadedDt.toISOString().slice(0, 10) > meal.date;

    return (
        <div style={{ ...slotCell, border: `1.5px solid ${statusColor}` }}>
            <div style={{ position: "relative", marginBottom: 6 }}>
                {meal.photoUrl
                    ? <img
                        src={meal.photoUrl}
                        alt={`${slot.label} on ${meal.date}`}
                        loading="lazy"
                        style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, display: "block" }}
                    />
                    : <div style={{ width: "100%", height: 120, background: "#f1f5f9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 10, fontWeight: 700 }}>
                        Photo archived
                    </div>
                }
                <div style={{
                    position: "absolute", top: 4, left: 4,
                    fontSize: 9, fontWeight: 900,
                    padding: "2px 6px", borderRadius: 100,
                    background: statusColor, color: "white",
                    letterSpacing: 0.5,
                }}>
                    {meal.status.toUpperCase()}
                </div>
                <div style={{
                    position: "absolute", top: 4, right: 4,
                    fontSize: 14,
                    background: "rgba(255,255,255,0.85)", borderRadius: 100,
                    padding: "2px 6px",
                }}>
                    {slot.icon}
                </div>
                {isLate && (
                    <div style={{
                        position: "absolute", bottom: 4, left: 4,
                        fontSize: 9, fontWeight: 900,
                        padding: "2px 6px", borderRadius: 100,
                        background: "#fee2e2", color: "#b91c1c",
                    }}>
                        LATE
                    </div>
                )}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a" }}>{slot.label}</span>
                <span style={{ fontSize: 8.5, color: "#94a3b8", fontWeight: 700 }}>
                    {uploadedDt ? uploadedDt.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
            </div>
            {meal.status === "rejected" && meal.rejectionReason && (
                <div style={{ marginTop: 3, padding: 5, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontSize: 9.5, color: "#7f1d1d", fontWeight: 700 }}>
                    Rejected: <span style={{ fontWeight: 600 }}>{meal.rejectionReason}</span>
                </div>
            )}

            {/* Notes are collapsed by default — keeps the grid compact for fast
                photo review and avoids opening a Firestore listener per cell. */}
            <button
                onClick={() => setShowComment(s => !s)}
                style={{ marginTop: 6, width: "100%", padding: "4px 6px", border: "1px solid #e2e8f0", background: showComment ? "#eff6ff" : "white", color: "#1e40af", borderRadius: 7, fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
            >
                {showComment ? "Hide notes ▲" : "💬 Notes ▾"}
            </button>
            {showComment && (
                <BtcMealCommentBox
                    clubId={clubId}
                    challengeId={challengeId}
                    mealId={meal.id}
                    coach={coach}
                />
            )}
        </div>
    );
}

function formatDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } catch { return ymd; }
}

// ─── styles ─────────────────────────────────────────────────────────
const dateCard: React.CSSProperties = { background: "white", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" };
const slotCell: React.CSSProperties = { background: "#f8fafc", borderRadius: 10, padding: 10 };
const emptyBox: React.CSSProperties = { background: "white", borderRadius: 14, padding: 40, textAlign: "center", color: "#94a3b8", fontWeight: 700 };
