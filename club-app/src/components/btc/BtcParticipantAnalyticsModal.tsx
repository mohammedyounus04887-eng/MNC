/**
 * BTC participant analytics — opened from the "View" button on the
 * participant list. Owner + coordinator only.
 *
 * Sections:
 *   1. Meal stats — uploaded / approved / rejected + %
 *   2. Rejection breakdown — each rejected meal with preview + reason
 *   3. Body transformation summary — baseline, current, all deltas
 *   4. Weekly progress table — all body comp fields per session
 *   5. Charts — weight, fat %, muscle, timeline
 */

import { useMemo } from "react";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
    computeDisciplineStats, computeMemberStats,
    useBtcChallengeMeals, useBtcChallengeWeighIns,
} from "@/hooks/useBtcChallenges";
import type {
    BtcChallenge, BtcChallengeMeal, BtcChallengeParticipant,
} from "@/types/firestore";

const FONT = "'Nunito', sans-serif";

export default function BtcParticipantAnalyticsModal({
    clubId, challenge, participant, onClose,
}: {
    clubId: string;
    challenge: BtcChallenge;
    participant: BtcChallengeParticipant;
    onClose: () => void;
}) {
    const { weighIns } = useBtcChallengeWeighIns(clubId, challenge.id);
    const { meals } = useBtcChallengeMeals(clubId, challenge.id);
    const myWeighIns = useMemo(() => weighIns.filter(w => w.memberId === participant.memberId), [weighIns, participant.memberId]);
    const myMeals = useMemo(() => meals.filter(m => m.memberId === participant.memberId), [meals, participant.memberId]);
    const rejectedMeals = useMemo(() => myMeals.filter(m => m.status === "rejected"), [myMeals]);
    const stats = useMemo(() => computeMemberStats(participant, myWeighIns), [participant, myWeighIns]);
    const discipline = useMemo(() => computeDisciplineStats(participant, weighIns, meals, challenge.weighInSessions || []), [participant, weighIns, meals, challenge.weighInSessions]);

    const sessions = challenge.weighInSessions || [];

    // Chart data: one row per session that has a weigh-in
    const chartData = useMemo(() => {
        return sessions
            .map(s => ({ session: s, w: stats.weighInsBySession[s.index] }))
            .filter(x => x.w)
            .map(({ session, w }) => ({
                label: `S${session.index + 1}`,
                date: session.date,
                weight: w.weight,
                bodyFat: w.bodyFat ?? null,
                muscleMass: w.muscleMass ?? null,
                skeletalMuscle: w.skeletalMuscle ?? null,
            }));
    }, [sessions, stats.weighInsBySession]);

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ position: "sticky", top: 0, background: "white", padding: "18px 22px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {participant.memberPhoto
                            ? <img src={participant.memberPhoto} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
                            : <div style={{ width: 44, height: 44, borderRadius: 10, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#475569", fontSize: 18 }}>{participant.memberName[0]}</div>
                        }
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{participant.memberName}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{participant.memberPhone || "—"} · {participant.participantType.toUpperCase()} · {challenge.name}</div>
                        </div>
                    </div>
                    <button onClick={onClose} style={closeBtn}>✕</button>
                </div>

                <div style={{ padding: 22 }}>

                    {/* Meal stats */}
                    <SectionTitle>📸 Meals</SectionTitle>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 14 }}>
                        <StatTile label="Uploaded" value={String(discipline.mealsUploaded)} />
                        <StatTile label="Approved" value={String(discipline.mealsApproved)} color="#16a34a" />
                        <StatTile label="Rejected" value={String(discipline.mealsRejected)} color="#dc2626" />
                        <StatTile label="Pending" value={String(discipline.mealsPending)} color="#d97706" />
                        <StatTile label="Approval %" value={discipline.approvalPct != null ? `${discipline.approvalPct}%` : "—"} color="#16a34a" />
                        <StatTile label="Rejection %" value={discipline.rejectionPct != null ? `${discipline.rejectionPct}%` : "—"} color="#dc2626" />
                    </div>

                    {/* Rejection breakdown */}
                    {rejectedMeals.length > 0 && (
                        <>
                            <SectionTitle>❌ Rejection Breakdown</SectionTitle>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 18 }}>
                                {rejectedMeals.map(m => <RejectedMealCard key={m.id} meal={m} />)}
                            </div>
                        </>
                    )}

                    {/* Body transformation */}
                    <SectionTitle>📊 Body Transformation</SectionTitle>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 18 }}>
                        <StatTile label="Baseline weight" value={participant.baselineWeight > 0 ? `${participant.baselineWeight} kg` : "—"} />
                        <StatTile label="Latest weight" value={stats.latestWeight != null ? `${stats.latestWeight} kg` : "—"} />
                        <StatTile label="Total loss vs baseline" value={fmtDelta(stats.kgLossFromBaseline, "kg")} color={(stats.pctLossFromBaseline ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                        <StatTile label="Loss from week 1" value={fmtDelta(stats.kgLossFromWeek1, "kg")} color={(stats.pctLossFromWeek1 ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                        <StatTile label="Fat loss" value={discipline.fatLossPct != null ? `${discipline.fatLossPct}%` : "—"} color={(discipline.fatLossPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                        <StatTile label="Muscle gain" value={discipline.muscleGainPct != null ? `${signed(discipline.muscleGainPct)}%` : "—"} color={(discipline.muscleGainPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                        <StatTile label="Skeletal muscle" value={discipline.skeletalMuscleGainPct != null ? `${signed(discipline.skeletalMuscleGainPct)}%` : "—"} color={(discipline.skeletalMuscleGainPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                        <StatTile label="Attendance" value={discipline.attendancePct != null ? `${discipline.attendancePct}% (${discipline.sessionsAttended}/${discipline.sessionsDue})` : "—"} />
                    </div>

                    {/* Charts */}
                    {chartData.length > 0 && (
                        <>
                            <SectionTitle>📈 Progress Timeline</SectionTitle>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 18 }}>
                                <MiniChart title="Weight (kg)" data={chartData} dataKey="weight" stroke="#0f172a" reference={participant.baselineWeight || undefined} />
                                <MiniChart title="Body Fat (%)" data={chartData} dataKey="bodyFat" stroke="#dc2626" reference={participant.baselineBodyFat || undefined} />
                                <MiniChart title="Muscle Mass (kg)" data={chartData} dataKey="muscleMass" stroke="#0ea5e9" />
                                <MiniChart title="Skeletal Muscle (kg)" data={chartData} dataKey="skeletalMuscle" stroke="#8b5cf6" />
                            </div>
                        </>
                    )}

                    {/* Weekly progress table */}
                    <SectionTitle>📅 Weekly Progress</SectionTitle>
                    <div style={{ overflowX: "auto", marginBottom: 12 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT }}>
                            <thead>
                                <tr>
                                    <th style={th}>Session</th>
                                    <th style={th}>Date</th>
                                    <th style={th}>Time</th>
                                    <th style={th}>Weight</th>
                                    <th style={th}>Body fat</th>
                                    <th style={th}>BMI</th>
                                    <th style={th}>Muscle</th>
                                    <th style={th}>Skel. muscle</th>
                                    <th style={th}>BMR</th>
                                    <th style={th}>Visceral fat</th>
                                    <th style={th}>Water %</th>
                                    <th style={th}>vs baseline</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map(s => {
                                    const w = stats.weighInsBySession[s.index];
                                    if (!w) {
                                        return (
                                            <tr key={s.index}>
                                                <td style={td}>S{s.index + 1}</td>
                                                <td style={td}>{s.date}</td>
                                                <td style={td}>—</td>
                                                <td colSpan={9} style={{ ...td, color: "#94a3b8", fontStyle: "italic" }}>not yet recorded</td>
                                            </tr>
                                        );
                                    }
                                    const delta = participant.baselineWeight > 0
                                        ? +(participant.baselineWeight - w.weight).toFixed(1)
                                        : null;
                                    return (
                                        <tr key={s.index}>
                                            <td style={{ ...td, fontWeight: 800 }}>S{s.index + 1}</td>
                                            <td style={td}>{s.date}</td>
                                            <td style={td}>{w.recordedAtTime || "—"}</td>
                                            <td style={{ ...td, fontWeight: 800 }}>{w.weight} kg</td>
                                            <td style={td}>{nz(w.bodyFat, "%")}</td>
                                            <td style={td}>{nz(w.bmi)}</td>
                                            <td style={td}>{nz(w.muscleMass, "kg")}</td>
                                            <td style={td}>{nz(w.skeletalMuscle, "kg")}</td>
                                            <td style={td}>{nz(w.bmr)}</td>
                                            <td style={td}>{nz(w.visceralFat)}</td>
                                            <td style={td}>{nz(w.waterPct, "%")}</td>
                                            <td style={{ ...td, color: (delta ?? 0) < 0 ? "#dc2626" : "#16a34a", fontWeight: 800 }}>
                                                {delta != null ? `${delta >= 0 ? "−" : "+"}${Math.abs(delta)} kg` : "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── helpers ────────────────────────────────────────────────────────
function RejectedMealCard({ meal }: { meal: BtcChallengeMeal }) {
    return (
        <div style={{ background: "white", border: "1.5px solid #fecaca", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ position: "relative", aspectRatio: "1", background: "#f1f5f9" }}>
                {meal.photoUrl && !meal.photoDeleted
                    ? <img src={meal.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 11, fontWeight: 700, padding: 8, textAlign: "center" }}>photo no longer stored</div>
                }
                <span style={{ position: "absolute", top: 4, left: 4, fontSize: 10, fontWeight: 900, color: "white", background: "#dc2626", padding: "2px 8px", borderRadius: 100 }}>REJECTED</span>
            </div>
            <div style={{ padding: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "capitalize" }}>
                    {meal.slot} · {meal.date}
                </div>
                {meal.rejectionReason && (
                    <div style={{ fontSize: 10, color: "#b91c1c", fontWeight: 700, marginTop: 3, fontStyle: "italic" }}>
                        “{meal.rejectionReason}”
                    </div>
                )}
            </div>
        </div>
    );
}

function MiniChart({ title, data, dataKey, stroke, reference }: { title: string; data: any[]; dataKey: string; stroke: string; reference?: number }) {
    const filtered = data.filter(d => d[dataKey] != null);
    if (filtered.length === 0) {
        return (
            <div style={chartCard}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>{title}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", padding: 30, textAlign: "center" }}>no data</div>
            </div>
        );
    }
    return (
        <div style={chartCard}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>{title}</div>
            <ResponsiveContainer width="100%" height={160}>
                <LineChart data={filtered}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ fontSize: 12, fontFamily: FONT }} />
                    {reference && <ReferenceLine y={reference} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "baseline", fontSize: 10, fill: "#94a3b8" }} />}
                    <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function StatTile({ label, value, color = "#0f172a" }: { label: string; value: string; color?: string }) {
    return (
        <div style={{ padding: 12, background: "#f8fafc", borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color }}>{value}</div>
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 10, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</div>;
}

function fmtDelta(kg: number | null, unit: string): string {
    if (kg == null) return "—";
    const sign = kg >= 0 ? "−" : "+";
    return `${sign}${Math.abs(kg)} ${unit}`;
}
function signed(n: number): string {
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}
function nz(n: number | null | undefined, suffix = ""): string {
    if (n == null) return "—";
    return `${n}${suffix}`;
}

// ─── styles ─────────────────────────────────────────────────────────
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 300, padding: 16, overflowY: "auto", fontFamily: FONT };
const modal: React.CSSProperties = { background: "white", borderRadius: 16, maxWidth: 1080, width: "100%", boxShadow: "0 12px 50px rgba(0,0,0,0.25)", margin: "20px 0" };
const closeBtn: React.CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 800, color: "#475569", fontSize: 14, fontFamily: FONT };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 8px", fontSize: 10, fontWeight: 800, color: "#475569", borderBottom: "1.5px solid #e2e8f0", textTransform: "uppercase", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 8px", fontSize: 12, color: "#0f172a", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
const chartCard: React.CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 };
