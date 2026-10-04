/**
 * Member — Weight Log + BTC entry point (v2, simplified).
 *
 * If the member is enrolled in an active BTC challenge → show the new
 * BtcMemberView (rules, schedule, 3-button meal upload, weight stats).
 *
 * Otherwise → simple self-log: button, chart, history. No leaderboard
 * for members — that lives on the owner & coordinator dashboards only.
 */

import { useMemo, useState } from "react";
import { Scale, ListTree } from "lucide-react";
import { addDoc, collection, doc, increment, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { useMemberWeighIns } from "@/hooks/useBTC";
import { useMyActiveBtcChallenge } from "@/hooks/useBtcChallenges";
import WeightLogForm from "@/components/member/WeightLogForm";
import WeightChart from "@/components/member/WeightChart";
import BtcMemberView from "@/components/btc/BtcMemberView";
import BtcCoachFolderView from "@/components/btc/BtcCoachFolderView";

const FONT = "'Nunito', sans-serif";

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};
const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function ProgressPage() {
    const { userProfile } = useAuth();
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const memberId = userProfile?.id || null;

    const { challenge, participant, isParticipant, loading: btcLoading } =
        useMyActiveBtcChallenge(clubId, memberId);
    const { weighIns } = useMemberWeighIns(clubId, memberId);
    const [showLogForm, setShowLogForm] = useState(false);
    const [savingLog, setSavingLog] = useState(false);
    // BTC participants can toggle between the challenge view and the
    // regular weight log. Default is the challenge view.
    const [viewPastWeights, setViewPastWeights] = useState(false);

    const chartData = useMemo(() => {
        return [...weighIns]
            .map(w => ({ id: w.id, weight: w.weight, date: w.createdAt as any, notes: w.notes || "" }))
            .reverse();
    }, [weighIns]);

    const submitLog = async (weight: number, date: string, notes: string) => {
        if (!clubId || !memberId) return;
        setSavingLog(true);
        try {
            const prev = weighIns[0];
            await addDoc(collection(db, `clubs/${clubId}/members/${memberId}/weighIns`), {
                memberId, clubId, weight, date,
                notes: notes || "",
                previousWeight: prev?.weight ?? null,
                change: prev ? +(prev.weight - weight).toFixed(2) : null,
                recordedBy: "member",
                createdAt: serverTimestamp(),
            });
            await updateDoc(doc(db, `clubs/${clubId}/members`, memberId), {
                currentWeight: weight,
                lastWeighIn: serverTimestamp(),
                totalWeighIns: increment(1),
                ...(((userProfile as any)?.startingWeight) ? {} : { startingWeight: weight }),
            });
            setShowLogForm(false);
        } catch (err) {
            console.error("[ProgressPage submitLog]", err);
        } finally {
            setSavingLog(false);
        }
    };

    // BTC participants see the simplified challenge view — unless they've
    // tapped "See past weights" to switch over to the regular log.
    const showBtcView = isParticipant && challenge && participant && clubId && !viewPastWeights;
    if (showBtcView) {
        return (
            <BtcMemberView
                clubId={clubId!}
                challenge={challenge!}
                participant={participant!}
                onShowPastWeights={() => setViewPastWeights(true)}
            />
        );
    }

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, paddingBottom: 60 }}>
            <div style={{ maxWidth: 600, margin: "0 auto", padding: 16 }}>
                {/* "Go to BTC page" — only for participants who are currently
                     viewing the past-weights log. Top of page, full width. */}
                {isParticipant && viewPastWeights && (
                    <button
                        onClick={() => setViewPastWeights(false)}
                        style={{
                            width: "100%", padding: 12, marginBottom: 12,
                            background: "linear-gradient(135deg,#16a34a,#15803d)",
                            color: "white", border: "none", borderRadius: 12,
                            fontSize: 13, fontWeight: 800, cursor: "pointer",
                            fontFamily: FONT, display: "flex",
                            alignItems: "center", justifyContent: "center", gap: 8,
                        }}
                    >
                        🔥 Go to BTC page
                    </button>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>📈 Weight Log</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{userProfile?.name}</div>
                    </div>
                </div>

                {btcLoading && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>Checking BTC status…</div>
                )}

                <button
                    onClick={() => setShowLogForm(true)}
                    style={{ width: "100%", padding: 16, background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white", border: "none", borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: FONT, marginBottom: 12, boxShadow: "0 4px 14px rgba(22,163,74,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                    <Scale className="w-4 h-4" /> Log My Weight
                </button>

                {chartData.length > 0 && (
                    <div style={{ background: "white", borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>📉 My Weight History</div>
                        <WeightChart logs={chartData as any} targetWeight={(userProfile as any)?.targetWeight} />
                    </div>
                )}

                {/* Coach folder view — renders only if this signed-in member
                    has been assigned as a coach to BTC participants in an
                    active challenge. Otherwise returns null silently. */}
                {clubId && memberId && userProfile?.name && (
                    <BtcCoachFolderView
                        clubId={clubId}
                        coach={{ id: memberId, name: userProfile.name }}
                        defaultOpen
                    />
                )}

                <div style={{ background: "white", borderRadius: 16, padding: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <ListTree className="w-4 h-4" /> History ({weighIns.length})
                    </div>
                    {weighIns.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "20px 0" }}>No entries yet</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {weighIns.slice(0, 10).map(w => (
                                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f8fafc", borderRadius: 10 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{w.weight} kg</div>
                                        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                                            {fmtDate(tsToDate(w.createdAt))}{w.recordedBy ? ` · by ${w.recordedBy}` : ""}
                                        </div>
                                    </div>
                                    {w.change != null && (
                                        <span style={{ fontSize: 12, fontWeight: 800, color: w.change > 0 ? "#16a34a" : w.change < 0 ? "#dc2626" : "#64748b" }}>
                                            {w.change > 0 ? "▼" : w.change < 0 ? "▲" : "•"} {Math.abs(w.change)} kg
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {showLogForm && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 999 }} onClick={() => setShowLogForm(false)}>
                    <div style={{ background: "white", borderRadius: "20px 20px 0 0", padding: 0, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                        <WeightLogForm isLoading={savingLog} onClose={() => setShowLogForm(false)} onSubmit={submitLog} />
                    </div>
                </div>
            )}
        </div>
    );
}
