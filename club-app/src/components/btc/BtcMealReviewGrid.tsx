/**
 * Volunteer/owner end-of-challenge meal review.
 *
 * Renders every uploaded meal for the challenge in a per-participant grid,
 * grouped by date and slot (Breakfast / Lunch / Dinner). Click ✓ to
 * approve, ✗ to reject (reason required). Pending shown in amber.
 *
 * Photos for both approved and rejected meals are kept until the challenge
 * is archived, then wiped in one sweep by cleanupChallengeMealPhotos.
 */

import { useMemo, useState } from "react";
import { reviewBtcMeal, useBtcChallengeMeals, useBtcChallengeParticipants } from "@/hooks/useBtcChallenges";
import type { BtcChallengeMeal } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";
const SLOTS: Array<{ id: "breakfast" | "lunch" | "dinner"; label: string; icon: string }> = [
    { id: "breakfast", label: "Breakfast", icon: "🥣" },
    { id: "lunch", label: "Lunch", icon: "🍱" },
    { id: "dinner", label: "Dinner", icon: "🌙" },
];

export default function BtcMealReviewGrid({
    clubId, challengeId, reviewerName,
}: {
    clubId: string;
    challengeId: string;
    reviewerName: string;
}) {
    const { meals, loading } = useBtcChallengeMeals(clubId, challengeId);
    const { participants } = useBtcChallengeParticipants(clubId, challengeId);
    const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
    const [memberFilter, setMemberFilter] = useState<string>("all");

    // Group by member -> date -> slot
    const grouped = useMemo(() => {
        const byMember: Record<string, Record<string, Record<string, BtcChallengeMeal>>> = {};
        for (const m of meals) {
            if (filter !== "all" && m.status !== filter) continue;
            if (memberFilter !== "all" && m.memberId !== memberFilter) continue;
            (byMember[m.memberId] ||= {});
            (byMember[m.memberId][m.date] ||= {});
            byMember[m.memberId][m.date][m.slot] = m;
        }
        return byMember;
    }, [meals, filter, memberFilter]);

    const counts = useMemo(() => {
        const c = { all: meals.length, pending: 0, approved: 0, rejected: 0 };
        for (const m of meals) c[m.status] = (c[m.status] || 0) + 1;
        return c;
    }, [meals]);

    if (loading) return <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading meals…</div>;

    return (
        <div style={{ fontFamily: FONT }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                {(["pending", "all", "approved", "rejected"] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        style={{
                            padding: "6px 12px",
                            background: filter === f ? "#0f172a" : "white",
                            color: filter === f ? "white" : "#475569",
                            border: "1px solid #e2e8f0",
                            borderRadius: 100,
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: "pointer",
                            textTransform: "capitalize",
                            fontFamily: FONT,
                        }}
                    >
                        {f} <span style={{ marginLeft: 4, opacity: 0.7 }}>({counts[f] || 0})</span>
                    </button>
                ))}
                <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)} style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontFamily: FONT, fontSize: 12, fontWeight: 700 }}>
                    <option value="all">All participants</option>
                    {participants.map(p => <option key={p.memberId} value={p.memberId}>{p.memberName}</option>)}
                </select>
            </div>

            {Object.keys(grouped).length === 0 && (
                <div style={{ padding: 40, textAlign: "center", background: "white", borderRadius: 12, color: "#94a3b8", fontWeight: 700 }}>
                    No meals match this filter.
                </div>
            )}

            {Object.entries(grouped).map(([memberId, byDate]) => {
                const p = participants.find(x => x.memberId === memberId);
                return (
                    <div key={memberId} style={{ background: "white", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>
                            {p?.memberName || memberId} <span style={{ color: "#94a3b8", fontWeight: 700 }}>· {p?.memberPhone || ""}</span>
                        </div>
                        {Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, slots]) => (
                            <div key={date} style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 6 }}>{formatDate(date)}</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                                    {SLOTS.map(s => (
                                        <MealCell
                                            key={s.id}
                                            slot={s}
                                            meal={slots[s.id] || null}
                                            onApprove={async (m) => reviewBtcMeal(clubId, challengeId, m.id, "approved", reviewerName)}
                                            onReject={async (m, reason) => reviewBtcMeal(clubId, challengeId, m.id, "rejected", reviewerName, reason)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function MealCell({
    slot, meal, onApprove, onReject,
}: {
    slot: { id: string; label: string; icon: string };
    meal: BtcChallengeMeal | null;
    onApprove: (m: BtcChallengeMeal) => void | Promise<void>;
    onReject: (m: BtcChallengeMeal, reason: string) => void | Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState("");

    if (!meal) {
        return (
            <div style={{ aspectRatio: "1", borderRadius: 10, background: "#f8fafc", border: "1.5px dashed #cbd5e1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontWeight: 700, fontSize: 11 }}>
                <div style={{ fontSize: 22, opacity: 0.5 }}>{slot.icon}</div>
                <div style={{ marginTop: 4 }}>{slot.label}</div>
                <div style={{ marginTop: 2, fontSize: 10 }}>not uploaded</div>
            </div>
        );
    }

    const statusColor = meal.status === "approved" ? "#16a34a" : meal.status === "rejected" ? "#dc2626" : "#d97706";
    const uploaded = formatUploadedAt((meal as any).uploadedAt);
    // If the photo was actually uploaded on a later calendar day than the
    // meal date, flag it — the coordinator usually wants to spot retroactive
    // uploads at a glance.
    const lateUpload = uploaded && uploaded.ymd > meal.date;

    return (
        <div style={{ borderRadius: 10, overflow: "hidden", border: `2px solid ${statusColor}` }}>
            <div style={{ position: "relative", aspectRatio: "1", background: "#f1f5f9" }}>
                {meal.photoUrl && <img src={meal.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                <div style={{ position: "absolute", top: 4, left: 4, fontSize: 10, fontWeight: 800, color: "white", background: statusColor, padding: "2px 8px", borderRadius: 100, textTransform: "uppercase" }}>
                    {meal.status}
                </div>
                <div style={{ position: "absolute", top: 4, right: 4, fontSize: 16 }}>{slot.icon}</div>
                {uploaded && (
                    <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0,
                        background: lateUpload ? "rgba(220,38,38,0.92)" : "rgba(15,23,42,0.78)",
                        color: "white",
                        padding: "3px 6px",
                        fontSize: 10,
                        fontWeight: 800,
                        fontFamily: FONT,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        lineHeight: 1.2,
                    }}>
                        <span>{uploaded.dateLabel}</span>
                        <span>{uploaded.timeLabel}{lateUpload ? " · LATE" : ""}</span>
                    </div>
                )}
            </div>
            <div style={{ padding: 6, background: "white" }}>
                {!rejecting && (
                    <div style={{ display: "flex", gap: 4 }}>
                        <button
                            disabled={busy || meal.status === "approved"}
                            onClick={async () => { setBusy(true); await onApprove(meal); setBusy(false); }}
                            style={{ flex: 1, padding: 6, background: meal.status === "approved" ? "#dcfce7" : "#16a34a", color: meal.status === "approved" ? "#15803d" : "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: meal.status === "approved" ? "default" : "pointer", fontFamily: FONT }}
                        >✓</button>
                        <button
                            disabled={busy || meal.status === "rejected"}
                            onClick={() => setRejecting(true)}
                            style={{ flex: 1, padding: 6, background: meal.status === "rejected" ? "#fee2e2" : "white", color: meal.status === "rejected" ? "#b91c1c" : "#dc2626", border: "1px solid #fecaca", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: meal.status === "rejected" ? "default" : "pointer", fontFamily: FONT }}
                        >✗</button>
                    </div>
                )}
                {rejecting && (
                    <div>
                        <input
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Reason for rejection (required)"
                            autoFocus
                            style={{ width: "100%", padding: 4, fontSize: 10, border: `1px solid ${reason.trim() ? "#e2e8f0" : "#fecaca"}`, borderRadius: 4, marginBottom: 4, boxSizing: "border-box", fontFamily: FONT }}
                        />
                        <div style={{ display: "flex", gap: 4 }}>
                            <button
                                disabled={busy || !reason.trim()}
                                onClick={async () => {
                                    const trimmed = reason.trim();
                                    if (!trimmed) return;
                                    setBusy(true);
                                    try { await onReject(meal, trimmed); }
                                    finally { setBusy(false); setRejecting(false); setReason(""); }
                                }}
                                style={{
                                    flex: 1, padding: 4,
                                    background: reason.trim() ? "#dc2626" : "#fca5a5",
                                    color: "white",
                                    border: "none", borderRadius: 4, fontSize: 10, fontWeight: 800,
                                    cursor: reason.trim() && !busy ? "pointer" : "not-allowed",
                                    fontFamily: FONT,
                                }}
                            >Confirm</button>
                            <button
                                onClick={() => { setRejecting(false); setReason(""); }}
                                style={{ flex: 1, padding: 4, background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                            >Cancel</button>
                        </div>
                    </div>
                )}
                {meal.status === "rejected" && meal.rejectionReason && (
                    <div style={{ marginTop: 4, fontSize: 9, color: "#b91c1c", fontStyle: "italic" }}>{meal.rejectionReason}</div>
                )}
            </div>
        </div>
    );
}

function formatDate(ymd: string): string {
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    } catch { return ymd; }
}

/**
 * Read the meal's `uploadedAt` Firestore Timestamp and produce date+time
 * labels for the cell overlay, plus a YYYY-MM-DD string the parent uses to
 * detect retroactive uploads (i.e. uploaded after the meal date).
 *
 * Returns null when the field is missing (legacy meals from before the
 * timestamp was stored).
 */
function formatUploadedAt(uploadedAt: any): { dateLabel: string; timeLabel: string; ymd: string } | null {
    if (!uploadedAt) return null;
    let dt: Date | null = null;
    if (typeof uploadedAt.toDate === "function") dt = uploadedAt.toDate();
    else if (uploadedAt instanceof Date) dt = uploadedAt;
    else if (typeof uploadedAt === "number") dt = new Date(uploadedAt);
    else if (typeof uploadedAt === "string") { const x = new Date(uploadedAt); if (!isNaN(x.getTime())) dt = x; }
    if (!dt) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return {
        dateLabel: dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        timeLabel: dt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }),
        ymd: `${y}-${m}-${d}`,
    };
}
