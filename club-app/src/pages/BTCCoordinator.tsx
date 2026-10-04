/**
 * BTC Coordinator (volunteer) — v2 simplified.
 *
 * PIN-gated. Inside, the coordinator works on the currently active
 * challenge (the only one a member can be enrolled in). Three tabs:
 *
 *   Weigh-ins   — record this member's weight + body fat + arrival time for each session
 *   Meals       — accept / reject uploaded photos (one shared grid)
 *   Leaderboard — both rankings (% weight loss vs. body-fat loss)
 *
 * Members never see this dashboard.
 */

import { useMemo, useState } from "react";
import { usePinAccess } from "@/hooks/usePinAccess";
import PinGate from "@/components/PinGate";
import {
    useActiveBtcChallenge,
    useBtcChallengeParticipants,
    useBtcChallengeWeighIns,
    useBtcChallengeMeals,
    useBtcLeaderboard,
    computeMemberStats,
    computeDisciplineStats,
} from "@/hooks/useBtcChallenges";
import BtcMealReviewGrid from "@/components/btc/BtcMealReviewGrid";
import BtcWeighInForm from "@/components/btc/BtcWeighInForm";
import BtcParticipantAnalyticsModal from "@/components/btc/BtcParticipantAnalyticsModal";
import type { BtcChallenge, BtcChallengeParticipant } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";
type Tab = "weighIns" | "meals" | "leaderboard";

export default function BTCCoordinator() {
    const access = usePinAccess("btc");
    if (access.isLoading) return <div style={pageCenter}>Loading…</div>;
    if (!access.clubId) return <div style={pageCenter}>No club resolved for this domain.</div>;
    if (!access.isVerified) {
        return (
            <PinGate
                type="btc"
                clubName={access.clubName}
                clubLogo={access.clubLogo}
                pinLength={4}
                isLoading={false}
                onVerify={access.verify}
            />
        );
    }
    return <Dashboard clubId={access.clubId} clubName={access.clubName} onLogout={access.logout} />;
}

function Dashboard({ clubId, clubName, onLogout }: { clubId: string; clubName: string; onLogout: () => void }) {
    const { challenge, loading } = useActiveBtcChallenge(clubId);
    const [tab, setTab] = useState<Tab>("weighIns");

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>🏆 BTC Coordinator</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{clubName} · {challenge?.name || "no active challenge"}</div>
                    </div>
                    <button onClick={onLogout} style={ghostBtn}>Log out</button>
                </div>

                {loading && <div style={emptyBox}>Loading…</div>}
                {!loading && !challenge && (
                    <div style={emptyBox}>
                        No active challenge — the owner must activate one from <b>Owner → BTC</b>.
                    </div>
                )}

                {challenge && (
                    <>
                        <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", marginBottom: 14 }}>
                            {(["weighIns", "meals", "leaderboard"] as Tab[]).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    style={{
                                        padding: "8px 14px", border: "none",
                                        background: tab === t ? "#0f172a" : "transparent",
                                        color: tab === t ? "white" : "#64748b",
                                        borderRadius: 6, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                                        textTransform: "capitalize",
                                    }}
                                >{t === "weighIns" ? "Weigh-ins" : t}</button>
                            ))}
                        </div>

                        {tab === "weighIns" && <WeighInsTab clubId={clubId} challenge={challenge} />}
                        {tab === "meals" && <BtcMealReviewGrid clubId={clubId} challengeId={challenge.id} reviewerName="coordinator" />}
                        {tab === "leaderboard" && <LeaderboardTab clubId={clubId} challenge={challenge} />}
                    </>
                )}
            </div>
        </div>
    );
}

// ─── Weigh-ins (per-member quick entry) ────────────────────────────
function WeighInsTab({ clubId, challenge }: { clubId: string; challenge: BtcChallenge }) {
    const { participants } = useBtcChallengeParticipants(clubId, challenge.id);
    const { weighIns } = useBtcChallengeWeighIns(clubId, challenge.id);
    const [selected, setSelected] = useState<BtcChallengeParticipant | null>(null);
    const [term, setTerm] = useState("");

    const filtered = useMemo(() => {
        const t = term.trim().toLowerCase();
        if (!t) return participants;
        return participants.filter(p =>
            p.memberName.toLowerCase().includes(t) || p.memberPhone.includes(t),
        );
    }, [term, participants]);

    if (challenge.weighInSessions?.length === 0) {
        return <div style={emptyBox}>This challenge has no weigh-in sessions configured.</div>;
    }
    if (participants.length === 0) {
        return <div style={emptyBox}>No participants — owner must add them first.</div>;
    }

    if (selected) {
        const myWeighIns = weighIns.filter(w => w.memberId === selected.memberId);
        const stats = computeMemberStats(selected, myWeighIns);
        return (
            <div style={{ background: "white", borderRadius: 14, padding: 16 }}>
                <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", fontSize: 13, fontWeight: 700, color: "#475569", cursor: "pointer", marginBottom: 10, fontFamily: FONT }}>
                    ← All participants
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    {selected.memberPhoto
                        ? <img src={selected.memberPhoto} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover" }} />
                        : <div style={{ width: 52, height: 52, borderRadius: 12, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 20, color: "#475569" }}>{selected.memberName[0]}</div>
                    }
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{selected.memberName}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            {selected.memberPhone} · {selected.participantType.toUpperCase()} · baseline {selected.baselineWeight > 0 ? `${selected.baselineWeight} kg` : "auto"}
                            {stats.kgLossFromBaseline != null && (
                                <span style={{ marginLeft: 6, color: stats.kgLossFromBaseline < 0 ? "#dc2626" : "#16a34a", fontWeight: 800 }}>
                                    · counted {stats.kgLossFromBaseline > 0 ? "−" : "+"}{Math.abs(stats.kgLossFromBaseline)} kg
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                    {challenge.weighInSessions.map(s => {
                        const existing = stats.weighInsBySession[s.index];
                        return (
                            <BtcWeighInForm
                                key={s.index}
                                clubId={clubId}
                                challengeId={challenge.id}
                                memberId={selected.memberId}
                                session={s}
                                existing={existing}
                            />
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div>
            <input
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="Search participant by name or phone…"
                style={{ width: "100%", padding: 12, border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }}
            />
            <div style={{ display: "grid", gap: 8 }}>
                {filtered.map(p => {
                    const myWeighIns = weighIns.filter(w => w.memberId === p.memberId);
                    const stats = computeMemberStats(p, myWeighIns);
                    const done = Object.keys(stats.weighInsBySession).length;
                    const total = challenge.weighInSessions.length;
                    return (
                        <CoordParticipantRow
                            key={p.memberId}
                            clubId={clubId}
                            challenge={challenge}
                            participant={p}
                            done={done}
                            total={total}
                            pctLoss={stats.pctLossFromBaseline}
                            onSelect={() => setSelected(p)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function CoordParticipantRow({ clubId, challenge, participant, done, total, pctLoss, onSelect }: {
    clubId: string;
    challenge: BtcChallenge;
    participant: BtcChallengeParticipant;
    done: number;
    total: number;
    pctLoss: number | null;
    onSelect: () => void;
}) {
    const [viewOpen, setViewOpen] = useState(false);
    return (
        <>
            <div style={{ ...participantCard, gap: 12 }}>
                {participant.memberPhoto
                    ? <img src={participant.memberPhoto} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover" }} />
                    : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{participant.memberName[0]}</div>
                }
                <div style={{ flex: 1, textAlign: "left", cursor: "pointer" }} onClick={onSelect}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{participant.memberName}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{participant.memberPhone || "—"} · {done}/{total} sessions done</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, color: (pctLoss ?? 0) < 0 ? "#dc2626" : "#16a34a", marginRight: 6 }}>
                    {pctLoss != null ? `${pctLoss >= 0 ? "−" : "+"}${Math.abs(pctLoss)}%` : "—"}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setViewOpen(true); }} style={{ padding: "6px 12px", background: "#0f172a", color: "white", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>View</button>
                <button onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ padding: "6px 12px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Weigh-in</button>
            </div>
            {viewOpen && (
                <BtcParticipantAnalyticsModal
                    clubId={clubId}
                    challenge={challenge}
                    participant={participant}
                    onClose={() => setViewOpen(false)}
                />
            )}
        </>
    );
}

// ─── Leaderboard ───────────────────────────────────────────────────
function LeaderboardTab({ clubId, challenge }: { clubId: string; challenge: BtcChallenge }) {
    const challengeId = challenge.id;
    const { weight, bodyFat, loading, participants, weighIns } = useBtcLeaderboard(clubId, challengeId);
    const { meals } = useBtcChallengeMeals(clubId, challengeId);
    const [metric, setMetric] = useState<"weight" | "bodyFat">("weight");
    const rows = metric === "weight" ? weight : bodyFat;

    if (loading) return <div style={emptyBox}>Loading…</div>;
    if (rows.length === 0) return <div style={emptyBox}>No participants.</div>;

    return (
        <div style={{ background: "white", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <button onClick={() => setMetric("weight")} style={{ ...pill, ...(metric === "weight" ? pillActive : {}) }}>% Weight Loss</button>
                <button onClick={() => setMetric("bodyFat")} style={{ ...pill, ...(metric === "bodyFat" ? pillActive : {}) }}>Body Fat % Loss</button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
                {rows.map((r, i) => {
                    const p = participants.find(x => x.memberId === r.memberId);
                    if (!p) return null;
                    const discipline = computeDisciplineStats(p, weighIns, meals, challenge.weighInSessions || []);
                    return <CoordLeaderboardCard key={r.memberId} rank={i + 1} row={r} discipline={discipline} metric={metric} />;
                })}
            </div>
        </div>
    );
}

function CoordLeaderboardCard({ rank, row, discipline, metric }: { rank: number; row: any; discipline: any; metric: "weight" | "bodyFat" }) {
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    const primaryPct = metric === "weight" ? row.pctLossFromBaseline : row.fatLossFromBaseline;
    const primaryColor = (primaryPct ?? 0) < 0 ? "#dc2626" : "#16a34a";

    return (
        <div style={{ background: "#f8fafc", borderRadius: 12, padding: 12, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ width: 36, fontSize: 14, fontWeight: 900, textAlign: "center", color: "#64748b" }}>{medal}</div>
                {row.memberPhoto
                    ? <img src={row.memberPhoto} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                    : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{row.memberName[0]}</div>
                }
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{row.memberName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                        Baseline {metric === "weight" ? (row.baselineWeight ? `${row.baselineWeight} kg` : "—") : (row.baselineBodyFat != null ? `${row.baselineBodyFat}%` : "—")}
                        {" · Latest "}
                        {metric === "weight" ? (row.latestWeight != null ? `${row.latestWeight} kg` : "—") : (row.latestBodyFat != null ? `${row.latestBodyFat}%` : "—")}
                    </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: primaryColor }}>
                    {primaryPct != null ? `${primaryPct >= 0 ? "−" : "+"}${Math.abs(primaryPct)}%` : "—"}
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 6, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                <CoordMetric label="Meal ✓" value={discipline.approvalPct != null ? `${discipline.approvalPct}%` : "—"} color={(discipline.approvalPct ?? 0) >= 70 ? "#16a34a" : "#d97706"} />
                <CoordMetric label="Meal ✗" value={discipline.rejectionPct != null ? `${discipline.rejectionPct}%` : "—"} color={(discipline.rejectionPct ?? 0) > 30 ? "#dc2626" : "#64748b"} />
                <CoordMetric label="Weight" value={discipline.weightLossPct != null ? `${signed(discipline.weightLossPct)}%` : "—"} color={(discipline.weightLossPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <CoordMetric label="Fat" value={discipline.fatLossPct != null ? `${signed(discipline.fatLossPct)}%` : "—"} color={(discipline.fatLossPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <CoordMetric label="Muscle" value={discipline.muscleGainPct != null ? `${signed(discipline.muscleGainPct)}%` : "—"} color={(discipline.muscleGainPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <CoordMetric label="Attend." value={discipline.attendancePct != null ? `${discipline.attendancePct}%` : "—"} color={(discipline.attendancePct ?? 0) >= 80 ? "#16a34a" : (discipline.attendancePct ?? 0) >= 50 ? "#d97706" : "#dc2626"} />
            </div>
        </div>
    );
}

function CoordMetric({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ background: "white", borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 900, color }}>{value}</div>
        </div>
    );
}

function signed(n: number): string {
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}

// ─── styles ───────────────────────────────────────────────────────
const pageCenter: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#64748b" };
const ghostBtn: React.CSSProperties = { padding: "8px 14px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const emptyBox: React.CSSProperties = { background: "white", borderRadius: 12, padding: 40, textAlign: "center", color: "#94a3b8", fontWeight: 700 };
const participantCard: React.CSSProperties = { background: "white", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12, border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT, width: "100%" };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 8px", fontSize: 11, fontWeight: 800, color: "#475569", borderBottom: "1.5px solid #e2e8f0", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "8px 8px", fontSize: 12, color: "#0f172a", borderBottom: "1px solid #f1f5f9" };
const pill: React.CSSProperties = { padding: "6px 14px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 100, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const pillActive: React.CSSProperties = { background: "#0f172a", color: "white", borderColor: "#0f172a" };
