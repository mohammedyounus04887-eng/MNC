/**
 * Simplified BTC participant view — replaces BtcParticipantDashboard.
 *
 * Sections (top to bottom):
 *   1. Header with challenge name + paid status
 *   2. Rules & how-to (collapsible)
 *   3. Weigh-in schedule (dates + times + notes)
 *   4. Today's uploads — 3 buttons: Breakfast / Lunch / Dinner
 *   5. My weight stats — per-session rows showing weight + body fat
 *   6. How scoring works (collapsible)
 *
 * NO leaderboard, NO money breakdown, NO 28-day grid.
 */

import { useMemo, useRef, useState } from "react";
import {
    computeMemberStats, uploadBtcMeal,
    useBtcChallengeMeals, useBtcChallengeWeighIns, ymdLocal,
} from "@/hooks/useBtcChallenges";
import type {
    BtcChallenge, BtcChallengeMeal, BtcChallengeParticipant,
} from "@/types/firestore";
import BtcCoachFolderView from "./BtcCoachFolderView";
import BtcMyMealsGallery from "./BtcMyMealsGallery";

const FONT = "'Nunito', sans-serif";

const SLOTS: Array<{ id: "breakfast" | "lunch" | "dinner"; label: string; icon: string }> = [
    { id: "breakfast", label: "Breakfast", icon: "🥣" },
    { id: "lunch", label: "Lunch", icon: "🍱" },
    { id: "dinner", label: "Dinner", icon: "🌙" },
];

export default function BtcMemberView({
    clubId, challenge, participant, onShowPastWeights,
}: {
    clubId: string;
    challenge: BtcChallenge;
    participant: BtcChallengeParticipant;
    onShowPastWeights?: () => void;
}) {
    const today = ymdLocal(new Date());
    const { weighIns } = useBtcChallengeWeighIns(clubId, challenge.id);
    const { meals } = useBtcChallengeMeals(clubId, challenge.id);
    const myWeighIns = useMemo(() => weighIns.filter(w => w.memberId === participant.memberId), [weighIns, participant.memberId]);
    const myMeals = useMemo(() => meals.filter(m => m.memberId === participant.memberId), [meals, participant.memberId]);
    const stats = useMemo(() => computeMemberStats(participant, myWeighIns), [participant, myWeighIns]);

    const todayMeals = useMemo(() => {
        const out: Record<string, BtcChallengeMeal> = {};
        for (const m of myMeals) {
            if (m.date === today) out[m.slot] = m;
        }
        return out;
    }, [myMeals, today]);

    const [showRules, setShowRules] = useState(false);
    const [showScoring, setShowScoring] = useState(false);

    // Next weigh-in = first scheduled session whose date is >= today, that
    // the participant hasn't already attended.
    const nextWeighIn = useMemo(() => {
        const sessions = (challenge.weighInSessions || []).slice().sort((a, b) => a.index - b.index);
        const attendedIdx = new Set(myWeighIns.map(w => w.sessionIndex));
        return sessions.find(s => s.date >= today && !attendedIdx.has(s.index))
            || sessions.find(s => s.date >= today)   // already attended but date still in future
            || null;
    }, [challenge.weighInSessions, myWeighIns, today]);
    const daysUntilNext = useMemo(() => {
        if (!nextWeighIn) return null;
        try {
            const [y, m, d] = nextWeighIn.date.split("-").map(Number);
            const target = new Date(y, m - 1, d);
            const now = new Date();
            const diffMs = target.setHours(0, 0, 0, 0) - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            return Math.round(diffMs / 86400000);
        } catch { return null; }
    }, [nextWeighIn]);

    const isDisqualified = !!participant.disqualified;

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, paddingBottom: 60 }}>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>

                {/* "See past weights" toggle — takes participant to the
                     regular Weight Log view (chart + full history) without
                     losing access to BTC. Only rendered when the parent
                     passes the callback (it's optional). */}
                {onShowPastWeights && (
                    <button
                        onClick={onShowPastWeights}
                        style={{
                            width: "100%", padding: 12, marginBottom: 12,
                            background: "white", color: "#0f172a",
                            border: "1.5px solid #cbd5e1", borderRadius: 12,
                            fontSize: 13, fontWeight: 800, cursor: "pointer",
                            fontFamily: FONT, display: "flex",
                            alignItems: "center", justifyContent: "center", gap: 8,
                        }}
                    >
                        📈 See your past weights
                    </button>
                )}

                {/* Header */}
                <div style={headerCard}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a7f3d0", textTransform: "uppercase", letterSpacing: 1 }}>BTC Challenge</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "white", marginTop: 2 }}>{challenge.name}</div>
                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={badge}>{participant.participantType === "old" ? "Old participant" : "New participant"}</span>
                        <span style={{ ...badge, background: participant.paid ? "#16a34a" : "#dc2626" }}>
                            {participant.paid ? "✓ Paid" : "Pending payment"}
                        </span>
                        {isDisqualified && <span style={{ ...badge, background: "#dc2626" }}>⚠ Disqualified</span>}
                    </div>
                </div>

                {isDisqualified && participant.disqualifiedReason && (
                    <div style={{ ...card, background: "#fef2f2", border: "1.5px solid #fecaca" }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#b91c1c", marginBottom: 4 }}>
                            You have been disqualified from the leaderboard.
                        </div>
                        <div style={{ fontSize: 12, color: "#7f1d1d" }}>
                            Reason: <b>{participant.disqualifiedReason}</b>
                        </div>
                        <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 6 }}>
                            You can still upload meals and have weigh-ins recorded — your stats are visible but not ranked.
                        </div>
                    </div>
                )}

                {/* Next weigh-in callout */}
                {nextWeighIn && (
                    <div style={{ ...card, background: "linear-gradient(135deg, #fffbeb, #fef3c7)", border: "1.5px solid #fcd34d" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: 1 }}>⏱ Next Weigh-in</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginTop: 4 }}>
                            {formatDate(nextWeighIn.date)} · {nextWeighIn.time || "07:00"}
                        </div>
                        <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, marginTop: 2 }}>
                            {daysUntilNext === 0 ? "Today — don't miss it!"
                                : daysUntilNext === 1 ? "Tomorrow"
                                : daysUntilNext != null && daysUntilNext > 0 ? `In ${daysUntilNext} days`
                                : ""}
                            {nextWeighIn.notes ? ` · ${nextWeighIn.notes}` : ""}
                        </div>
                    </div>
                )}

                {/* Rules collapsible */}
                <Section
                    title="📜 Rules & How to Use"
                    open={showRules}
                    onToggle={() => setShowRules(v => !v)}
                >
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: "#0f172a" }}>
                        <ol style={{ paddingLeft: 18, margin: 0 }}>
                            <li>Upload 3 meal photos every day — <b>Breakfast, Lunch, Dinner</b>.</li>
                            <li>Show up on the scheduled weigh-in dates listed below. Be on time.</li>
                            <li>Your weight is recorded by the volunteer — you cannot self-log during BTC.</li>
                            <li>Photos are reviewed by the volunteer at the end of the challenge.</li>
                            <li>If you miss meals or sessions, your score is affected — talk to your volunteer.</li>
                        </ol>
                        <div style={{ marginTop: 12, padding: 10, background: "#fef3c7", borderRadius: 8, fontSize: 12, color: "#92400e", fontWeight: 700 }}>
                            How to upload a meal: tap the meal button below → take or pick a photo → done. You can replace a photo before it's reviewed.
                        </div>
                    </div>
                </Section>

                {/* Schedule */}
                {challenge.weighInSessions?.length > 0 && (
                    <div style={card}>
                        <div style={cardTitle}>📅 Weigh-in Schedule</div>
                        <div style={{ display: "grid", gap: 6 }}>
                            {challenge.weighInSessions.map(s => (
                                <div key={s.index} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "#f8fafc", borderRadius: 10 }}>
                                    <div style={sessionPill}>S{s.index + 1}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{formatDate(s.date)}</div>
                                        <div style={{ fontSize: 11, color: "#64748b" }}>at {s.time}{s.notes ? ` · ${s.notes}` : ""}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Instructions (if any) */}
                {challenge.instructions && (
                    <div style={card}>
                        <div style={cardTitle}>📢 Notice</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                            {challenge.instructions}
                        </div>
                    </div>
                )}

                {/* Upload buttons */}
                <div style={card}>
                    <div style={cardTitle}>📸 Today's Uploads</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, fontWeight: 700 }}>{formatDate(today)}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {SLOTS.map(s => (
                            <UploadSlotButton
                                key={s.id}
                                clubId={clubId}
                                challengeId={challenge.id}
                                memberId={participant.memberId}
                                memberName={participant.memberName}
                                date={today}
                                slot={s.id}
                                label={s.label}
                                icon={s.icon}
                                existing={todayMeals[s.id]}
                            />
                        ))}
                    </div>
                </div>

                {/* My uploaded photos — always visible, date-wise, right below
                    the upload section (breakfast/lunch/dinner per day). */}
                <BtcMyMealsGallery meals={myMeals} inline />

                {/* My weight stats */}
                <div style={card}>
                    <div style={cardTitle}>⚖️ My Weight Stats</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 12 }}>
                        <StatBox label="Baseline" value={participant.baselineWeight > 0 ? `${participant.baselineWeight} kg` : "—"} color="#0f172a" />
                        <StatBox label="Latest" value={stats.latestWeight != null ? `${stats.latestWeight} kg` : "—"} color="#0f172a" />
                        <StatBox
                            label="From baseline (counted)"
                            value={stats.pctLossFromBaseline != null
                                ? formatDelta(stats.kgLossFromBaseline, stats.pctLossFromBaseline)
                                : "—"}
                            color={(stats.pctLossFromBaseline ?? 0) < 0 ? "#dc2626" : "#16a34a"}
                        />
                        <StatBox
                            label="From Week 1"
                            value={stats.pctLossFromWeek1 != null
                                ? formatDelta(stats.kgLossFromWeek1, stats.pctLossFromWeek1)
                                : "—"}
                            color={(stats.pctLossFromWeek1 ?? 0) < 0 ? "#dc2626" : "#475569"}
                        />
                    </div>

                    {challenge.weighInSessions?.length > 0 && (
                        <div style={{ display: "grid", gap: 6 }}>
                            {challenge.weighInSessions.map(s => {
                                const w = stats.weighInsBySession[s.index];
                                return (
                                    <div key={s.index} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "#f8fafc", borderRadius: 10 }}>
                                        <div style={sessionPill}>S{s.index + 1}</div>
                                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, minWidth: 80 }}>{formatShortDate(s.date)}</div>
                                        <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: w ? "#0f172a" : "#94a3b8" }}>
                                            {w ? `${w.weight} kg` : "not yet"}
                                            {w?.bodyFat != null && <span style={{ marginLeft: 8, color: "#64748b", fontSize: 11, fontWeight: 700 }}>{w.bodyFat}% fat</span>}
                                        </div>
                                        {w?.recordedAtTime && (
                                            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>⏱ {w.recordedAtTime}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Coach-only folder view — only renders if this member has been
                    assigned as a coach to other participants in this challenge.
                    If they're a normal participant only, this returns null and
                    nothing shows up. */}
                <BtcCoachFolderView
                    clubId={clubId}
                    coach={{ id: participant.memberId, name: participant.memberName }}
                />

                {/* Scoring explainer */}
                <Section
                    title="🧮 How Scoring Works"
                    open={showScoring}
                    onToggle={() => setShowScoring(v => !v)}
                >
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: "#0f172a" }}>
                        <p style={{ margin: "0 0 10px 0" }}>
                            Your weight loss is counted from your <b>baseline</b> — not from your Week 1 weight.
                        </p>
                        <p style={{ margin: "0 0 10px 0" }}>
                            <b>If you are a new participant:</b> your Week 1 weight is your baseline.
                        </p>
                        <p style={{ margin: "0 0 10px 0" }}>
                            <b>If you are an old participant:</b> your previous best weight is your baseline. Even if you gained some kg before this BTC, only the loss from your baseline counts.
                        </p>
                        <div style={{ padding: 10, background: "#f1f5f9", borderRadius: 8, fontSize: 12 }}>
                            <b>Example:</b><br />
                            Baseline = 60 kg · Week 1 = 70 kg · Week 5 = 58 kg<br />
                            Counted loss = 60 − 58 = <b>2 kg</b> (not 12 kg).
                        </div>
                        <p style={{ margin: "10px 0 0 0", fontSize: 11, color: "#64748b" }}>
                            The leaderboard you can&apos;t see uses this counted loss to rank everyone fairly.
                        </p>
                    </div>
                </Section>
            </div>
        </div>
    );
}

// ─── Helpers ────────────────────────────────────────────────────────
function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <div style={card}>
            <button onClick={onToggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: FONT }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{title}</div>
                <div style={{ fontSize: 16, color: "#64748b" }}>{open ? "▾" : "▸"}</div>
            </button>
            {open && <div style={{ marginTop: 12 }}>{children}</div>}
        </div>
    );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ padding: 12, background: "#f8fafc", borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
        </div>
    );
}

function UploadSlotButton({
    clubId, challengeId, memberId, memberName, date, slot, label, icon, existing,
}: {
    clubId: string; challengeId: string; memberId: string; memberName: string;
    date: string; slot: "breakfast" | "lunch" | "dinner"; label: string; icon: string;
    existing?: BtcChallengeMeal;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState("");
    // Optimistic local preview: shown immediately on file pick, cleared once
    // the real `existing` doc lands via the snapshot listener.
    const [localPreview, setLocalPreview] = useState<string | null>(null);

    // Clear the local preview as soon as the live document for this slot
    // shows up — that's our confirmation the upload landed in Firestore.
    if (existing?.photoUrl && localPreview) {
        // Defer the URL.revokeObjectURL to next tick so we don't trash the
        // in-flight render. setState during render is intentional here —
        // it's the cheapest way to swap to the canonical URL.
        setTimeout(() => {
            if (localPreview) {
                try { URL.revokeObjectURL(localPreview); } catch { /* ignore */ }
            }
            setLocalPreview(null);
        }, 0);
    }

    const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setErr("");
        // Optimistic UI: flash the cell to "uploading" with a local thumb
        // immediately, while the actual upload + compression happens in the
        // background.
        try { setLocalPreview(URL.createObjectURL(f)); } catch { /* ignore */ }
        setUploading(true);
        try {
            await uploadBtcMeal(clubId, challengeId, { id: memberId, name: memberName }, date, slot, f);
        } catch (er: any) {
            setErr(er?.message || "Upload failed");
            // Roll back optimistic preview on failure
            if (localPreview) { try { URL.revokeObjectURL(localPreview); } catch { /* ignore */ } }
            setLocalPreview(null);
        } finally {
            setUploading(false);
            if (ref.current) ref.current.value = "";
        }
    };

    const status = existing?.status;
    // Member-facing labels — we never show the raw "pending" review state.
    // An uploaded-but-unreviewed photo simply reads as a success ("Uploaded ✓");
    // the coordinator review grid still keys off the underlying status.
    const STATUS_LABEL: Record<string, string> = { pending: "Uploaded ✓", approved: "Approved ✓", rejected: "Rejected" };
    const statusColor = status === "rejected" ? "#dc2626" : status ? "#16a34a" : "#94a3b8"; // pending + approved both read green
    const showImage = existing?.photoUrl || localPreview;
    const borderColor = showImage ? (status === "rejected" ? "#dc2626" : "#16a34a") : "#cbd5e1";
    const bg = showImage ? "white" : "#f8fafc";
    const displayStatus = uploading
        ? "Uploading…"
        : localPreview && !existing
            ? "Uploaded ✓"
            : (status ? (STATUS_LABEL[status] || status) : "Tap to upload");

    return (
        <label
            style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: 12, background: bg, border: `2px solid ${borderColor}`,
                borderRadius: 14, cursor: uploading ? "wait" : "pointer", position: "relative",
                minHeight: 130,
            }}
        >
            <input ref={ref} type="file" accept="image/*" capture="environment" onChange={onPick} disabled={uploading} style={{ display: "none" }} />

            {showImage ? (
                <img
                    src={(existing?.photoUrl || localPreview) as string}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, marginBottom: 8, opacity: uploading ? 0.65 : 1 }}
                />
            ) : (
                <div style={{ fontSize: 40, marginBottom: 6, opacity: uploading ? 0.5 : 1 }}>{icon}</div>
            )}

            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{label}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: uploading ? "#d97706" : statusColor, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {displayStatus}
            </div>
            {err && <div style={{ fontSize: 9, color: "#dc2626", marginTop: 4 }}>{err}</div>}
        </label>
    );
}

function formatDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    } catch { return ymd; }
}
function formatShortDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    } catch { return ymd; }
}
function formatDelta(kg: number | null, pct: number | null): string {
    if (pct == null) return "—";
    const sign = pct >= 0 ? "−" : "+";
    const k = kg != null ? `${sign}${Math.abs(kg)} kg ` : "";
    return `${k}(${sign}${Math.abs(pct)}%)`;
}

// ─── styles ────────────────────────────────────────────────────────
const headerCard: React.CSSProperties = { background: "linear-gradient(135deg, #065f46, #047857)", borderRadius: 16, padding: 18, marginBottom: 12, boxShadow: "0 4px 20px rgba(4, 120, 87, 0.25)" };
const card: React.CSSProperties = { background: "white", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" };
const cardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 10 };
const badge: React.CSSProperties = { fontSize: 10, fontWeight: 900, background: "rgba(255,255,255,0.2)", color: "white", padding: "3px 10px", borderRadius: 100, letterSpacing: 0.5 };
const sessionPill: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#0f172a", background: "white", padding: "3px 10px", borderRadius: 100, border: "1px solid #e2e8f0", minWidth: 32, textAlign: "center" };
