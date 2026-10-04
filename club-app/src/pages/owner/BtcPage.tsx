/**
 * Owner BTC v2 — challenge list + per-challenge detail.
 *
 * Top level shows the list of challenges. Click one to drill in:
 *   Participants — add by phone, edit baseline / type / weekly weights, toggle paid
 *   Schedule     — view & edit weigh-in sessions and instructions
 *   Weigh-ins    — grid of weight + body fat per session per member (inline edit)
 *   Meals        — accept / reject all uploaded meal photos
 *   Leaderboard  — both rankings, owner-only
 */

import { useMemo, useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import {
    deleteBtcChallenge, setBtcChallengeActive,
    useBtcChallenges, useBtcChallenge, useBtcChallengeParticipants,
    useBtcChallengeWeighIns, useBtcChallengeMeals, useBtcLeaderboard,
    deleteBtcWeighIn, updateBtcParticipant, removeBtcParticipant,
    disqualifyBtcParticipant, reinstateBtcParticipant,
    computeMemberStats, computeDisciplineStats,
} from "@/hooks/useBtcChallenges";
import type { BtcChallenge, BtcChallengeParticipant } from "@/types/firestore";
import BtcChallengeForm from "@/components/btc/BtcChallengeForm";
import BtcAddParticipantDialog from "@/components/btc/BtcAddParticipantDialog";
import BtcMealReviewGrid from "@/components/btc/BtcMealReviewGrid";
import BtcWeighInForm from "@/components/btc/BtcWeighInForm";
import BtcParticipantAnalyticsModal from "@/components/btc/BtcParticipantAnalyticsModal";
import BtcCoachesTab from "@/components/btc/BtcCoachesTab";

const FONT = "'Nunito', sans-serif";
const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

type Tab = "participants" | "schedule" | "weighIns" | "meals" | "leaderboard" | "weekly" | "coaches";

export default function BtcPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [editingChallenge, setEditingChallenge] = useState<BtcChallenge | null>(null);

    if (!clubId) return null;

    if (selectedId) {
        return (
            <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
                <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                    <button onClick={() => setSelectedId(null)} style={{ background: "transparent", border: "none", fontSize: 13, fontWeight: 700, color: "#475569", cursor: "pointer", marginBottom: 12, fontFamily: FONT }}>
                        ← All Challenges
                    </button>
                    <ChallengeDetail
                        clubId={clubId}
                        challengeId={selectedId}
                        onEdit={(c) => { setEditingChallenge(c); setFormOpen(true); }}
                    />
                </div>
                {formOpen && editingChallenge && (
                    <BtcChallengeForm clubId={clubId} existing={editingChallenge} onClose={() => { setFormOpen(false); setEditingChallenge(null); }} />
                )}
            </div>
        );
    }

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
                <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>🏆 BTC Challenges</div>
                        <div style={{ fontSize: 13, color: "#64748b" }}>{club?.name}</div>
                    </div>
                    <button
                        onClick={() => { setEditingChallenge(null); setFormOpen(true); }}
                        style={primaryBtn}
                    >+ New Challenge</button>
                </div>

                <ChallengeList clubId={clubId} onOpen={setSelectedId} onEdit={(c) => { setEditingChallenge(c); setFormOpen(true); }} />
            </div>

            {formOpen && (
                <BtcChallengeForm
                    clubId={clubId}
                    existing={editingChallenge}
                    onClose={() => { setFormOpen(false); setEditingChallenge(null); }}
                />
            )}
        </div>
    );
}

// ─── List ────────────────────────────────────────────────────────────
function ChallengeList({ clubId, onOpen, onEdit }: { clubId: string; onOpen: (id: string) => void; onEdit: (c: BtcChallenge) => void }) {
    const { challenges, loading } = useBtcChallenges(clubId);
    const [confirmDelete, setConfirmDelete] = useState<BtcChallenge | null>(null);

    if (loading) return <div style={emptyBox}>Loading…</div>;
    if (challenges.length === 0) {
        return <div style={emptyBox}>No challenges yet — click <b>+ New Challenge</b> to start.</div>;
    }
    return (
        <div style={{ display: "grid", gap: 10 }}>
            {challenges.map(c => (
                <div key={c.id} style={card}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{c.name}</div>
                            {c.isActive
                                ? <span style={activeBadge}>ACTIVE</span>
                                : <span style={archivedBadge}>archived</span>
                            }
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                            {c.weighInSessions?.length || 0} weigh-in sessions · created {tsToDate(c.createdAt)?.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) || "—"}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => onOpen(c.id)} style={smallBtn}>Open</button>
                        <button onClick={() => onEdit(c)} style={ghostBtn}>Edit</button>
                        <button onClick={() => setBtcChallengeActive(clubId, c.id, !c.isActive)} style={ghostBtn}>
                            {c.isActive ? "Archive" : "Activate"}
                        </button>
                        <button onClick={() => setConfirmDelete(c)} style={dangerBtn}>Delete</button>
                    </div>
                </div>
            ))}
            {confirmDelete && (
                <div style={overlay}>
                    <div style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 360, width: "100%" }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Delete &quot;{confirmDelete.name}&quot;?</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                            This removes the challenge and ALL participants, weigh-ins and meal photos inside it. Cannot be undone.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setConfirmDelete(null)} style={{ ...primaryBtn, flex: 1, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                            <button
                                onClick={async () => { await deleteBtcChallenge(clubId, confirmDelete.id); setConfirmDelete(null); }}
                                style={{ ...primaryBtn, flex: 1, background: "#dc2626" }}
                            >Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Detail ──────────────────────────────────────────────────────────
function ChallengeDetail({ clubId, challengeId, onEdit }: { clubId: string; challengeId: string; onEdit: (c: BtcChallenge) => void }) {
    const { challenge, loading } = useBtcChallenge(clubId, challengeId);
    const [tab, setTab] = useState<Tab>("participants");

    if (loading || !challenge) return <div style={emptyBox}>Loading…</div>;

    return (
        <>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{challenge.name}</div>
                        {challenge.isActive
                            ? <span style={activeBadge}>ACTIVE</span>
                            : <span style={archivedBadge}>archived</span>
                        }
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button
                        onClick={() => window.open("/btc-winners", "_blank")}
                        title="Open the award-ceremony reveal page (new tab — drag to the TV/projector)"
                        style={{ padding: "8px 14px", border: "none", background: "linear-gradient(135deg,#f59e0b,#b45309)", color: "white", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, boxShadow: "0 2px 10px rgba(245,158,11,0.4)" }}
                    >🏆 Winners Page</button>
                    <button onClick={() => onEdit(challenge)} style={ghostBtn}>Edit</button>
                    <button onClick={() => setBtcChallengeActive(clubId, challengeId, !challenge.isActive)} style={ghostBtn}>
                        {challenge.isActive ? "Archive" : "Activate"}
                    </button>
                </div>
            </div>

            <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", marginBottom: 14, flexWrap: "wrap" }}>
                {(["participants", "coaches", "schedule", "weighIns", "meals", "leaderboard", "weekly"] as Tab[]).map(t => (
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
                    >{t === "weighIns" ? "Weigh-ins" : t === "weekly" ? "Weekly Awards" : t}</button>
                ))}
            </div>

            {tab === "participants" && <ParticipantsTab clubId={clubId} challenge={challenge} />}
            {tab === "coaches" && <BtcCoachesTab clubId={clubId} challenge={challenge} />}
            {tab === "schedule" && <ScheduleTab challenge={challenge} />}
            {tab === "weighIns" && <WeighInsTab clubId={clubId} challenge={challenge} />}
            {tab === "meals" && <BtcMealReviewGrid clubId={clubId} challengeId={challengeId} reviewerName="owner" />}
            {tab === "leaderboard" && <LeaderboardTab clubId={clubId} challengeId={challengeId} />}
            {tab === "weekly" && <WeeklyAwardsTab clubId={clubId} challenge={challenge} />}
        </>
    );
}

// ─── Participants tab ────────────────────────────────────────────────
function ParticipantsTab({ clubId, challenge }: { clubId: string; challenge: BtcChallenge }) {
    const challengeId = challenge.id;
    const { participants, loading } = useBtcChallengeParticipants(clubId, challengeId);
    const { weighIns } = useBtcChallengeWeighIns(clubId, challengeId);
    const [addOpen, setAddOpen] = useState(false);
    const existingIds = useMemo(() => new Set(participants.map(p => p.memberId)), [participants]);
    const weighInsByMember = useMemo(() => {
        const out: Record<string, typeof weighIns> = {};
        for (const w of weighIns) (out[w.memberId] ||= []).push(w);
        return out;
    }, [weighIns]);

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>
                    {participants.length} participant{participants.length === 1 ? "" : "s"}
                </div>
                <button onClick={() => setAddOpen(true)} style={primaryBtn}>+ Add by phone</button>
            </div>
            {loading && <div style={emptyBox}>Loading…</div>}
            {!loading && participants.length === 0 && <div style={emptyBox}>No participants yet.</div>}
            {!loading && participants.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                    {participants.map(p => (
                        <ParticipantRow
                            key={p.memberId}
                            clubId={clubId}
                            challenge={challenge}
                            participant={p}
                            weighIns={weighInsByMember[p.memberId] || []}
                        />
                    ))}
                </div>
            )}
            {addOpen && (
                <BtcAddParticipantDialog
                    clubId={clubId}
                    challengeId={challengeId}
                    existingMemberIds={existingIds}
                    onClose={() => setAddOpen(false)}
                />
            )}
        </>
    );
}

function ParticipantRow({ clubId, challenge, participant, weighIns }: {
    clubId: string; challenge: BtcChallenge; participant: BtcChallengeParticipant; weighIns: any[];
}) {
    const challengeId = challenge.id;
    const [editing, setEditing] = useState(false);
    const [viewOpen, setViewOpen] = useState(false);
    const [baseline, setBaseline] = useState(String(participant.baselineWeight || ""));
    const [fat, setFat] = useState(participant.baselineBodyFat != null ? String(participant.baselineBodyFat) : "");
    const [type, setType] = useState<"new" | "old">(participant.participantType);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [disqualifyOpen, setDisqualifyOpen] = useState(false);
    const [disqReason, setDisqReason] = useState("");
    const [disqBusy, setDisqBusy] = useState(false);
    const stats = useMemo(() => computeMemberStats(participant, weighIns), [participant, weighIns]);
    const gender = (participant.gender ?? null) as "male" | "female" | null;
    const isDisqualified = !!participant.disqualified;

    const save = async () => {
        await updateBtcParticipant(clubId, challengeId, participant.memberId, {
            baselineWeight: parseFloat(baseline) || 0,
            baselineBodyFat: fat ? parseFloat(fat) : null,
            participantType: type,
        });
        setEditing(false);
    };

    const setGender = (g: "male" | "female") => {
        void updateBtcParticipant(clubId, challengeId, participant.memberId, { gender: g });
    };

    const doDisqualify = async () => {
        const reason = disqReason.trim();
        if (!reason) return;
        setDisqBusy(true);
        try {
            await disqualifyBtcParticipant(clubId, challengeId, participant.memberId, reason, "owner");
            setDisqualifyOpen(false);
            setDisqReason("");
        } finally {
            setDisqBusy(false);
        }
    };

    return (
        <div style={{ ...card, opacity: isDisqualified ? 0.85 : 1, border: isDisqualified ? "1.5px solid #fecaca" : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                {participant.memberPhoto
                    ? <img src={participant.memberPhoto} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", filter: isDisqualified ? "grayscale(0.8)" : undefined }} />
                    : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{participant.memberName[0]}</div>
                }
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{participant.memberName}</div>
                        <span style={{ ...badgeBase, background: type === "old" ? "#fef3c7" : "#dcfce7", color: type === "old" ? "#92400e" : "#15803d" }}>
                            {type === "old" ? "OLD" : "NEW"}
                        </span>
                        {gender === "male" && <span style={{ ...badgeBase, background: "#dbeafe", color: "#1e40af" }}>♂ MALE</span>}
                        {gender === "female" && <span style={{ ...badgeBase, background: "#fce7f3", color: "#9d174d" }}>♀ FEMALE</span>}
                        {participant.paid && <span style={{ ...badgeBase, background: "#dbeafe", color: "#1e40af" }}>PAID</span>}
                        {isDisqualified && <span style={{ ...badgeBase, background: "#fee2e2", color: "#b91c1c" }}>DISQUALIFIED</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                        {participant.memberPhone || "—"}
                        {" · baseline "}{participant.baselineWeight > 0 ? `${participant.baselineWeight} kg` : <i>auto from week 1</i>}
                        {stats.latestWeight != null && <>{" · latest "}{stats.latestWeight} kg</>}
                        {stats.kgLossFromBaseline != null && (
                            <>{" · counted "}
                                <span style={{ color: stats.kgLossFromBaseline < 0 ? "#dc2626" : "#16a34a", fontWeight: 800 }}>
                                    {stats.kgLossFromBaseline > 0 ? "−" : "+"}{Math.abs(stats.kgLossFromBaseline)} kg ({stats.pctLossFromBaseline! > 0 ? "−" : "+"}{Math.abs(stats.pctLossFromBaseline!)}%)
                                </span>
                            </>
                        )}
                    </div>
                    {isDisqualified && participant.disqualifiedReason && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#b91c1c", fontWeight: 700 }}>
                            Reason: <span style={{ fontWeight: 600 }}>{participant.disqualifiedReason}</span>
                        </div>
                    )}
                    {!gender && (
                        <div style={{ marginTop: 6, padding: 6, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#92400e" }}>Set gender:</span>
                            <button onClick={() => setGender("male")} style={{ ...ghostBtn, padding: "4px 10px", fontSize: 11, color: "#1e40af", borderColor: "#1e40af" }}>♂ Male</button>
                            <button onClick={() => setGender("female")} style={{ ...ghostBtn, padding: "4px 10px", fontSize: 11, color: "#9d174d", borderColor: "#9d174d" }}>♀ Female</button>
                        </div>
                    )}
                </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#475569", cursor: "pointer" }}>
                    <input
                        type="checkbox"
                        checked={participant.paid}
                        onChange={e => updateBtcParticipant(clubId, challengeId, participant.memberId, { paid: e.target.checked })}
                    />
                    paid
                </label>
                <button onClick={() => setViewOpen(true)} style={{ ...ghostBtn, color: "#0f172a", borderColor: "#0f172a" }}>View</button>
                <button onClick={() => setEditing(v => !v)} style={ghostBtn}>{editing ? "Close" : "Edit"}</button>
                {isDisqualified
                    ? <button onClick={() => reinstateBtcParticipant(clubId, challengeId, participant.memberId)} style={{ ...ghostBtn, color: "#16a34a", borderColor: "#16a34a" }}>Reinstate</button>
                    : <button onClick={() => setDisqualifyOpen(true)} style={{ ...ghostBtn, color: "#b91c1c", borderColor: "#fecaca" }}>Disqualify</button>
                }
                <button onClick={() => setConfirmRemove(true)} style={dangerBtn}>Remove</button>
            </div>

            {viewOpen && (
                <BtcParticipantAnalyticsModal
                    clubId={clubId}
                    challenge={challenge}
                    participant={participant}
                    onClose={() => setViewOpen(false)}
                />
            )}

            {editing && (
                <div style={{ flexBasis: "100%", marginTop: 10, padding: 12, background: "#f8fafc", borderRadius: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
                    <div>
                        <div style={miniLabel}>Type</div>
                        <select value={type} onChange={e => setType(e.target.value as any)} style={miniInput}>
                            <option value="new">New (baseline auto)</option>
                            <option value="old">Old (manual baseline)</option>
                        </select>
                    </div>
                    <div>
                        <div style={miniLabel}>Gender</div>
                        <select
                            value={gender || ""}
                            onChange={e => updateBtcParticipant(clubId, challengeId, participant.memberId, { gender: (e.target.value || null) as any })}
                            style={miniInput}
                        >
                            <option value="">Not set</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                        </select>
                    </div>
                    <div>
                        <div style={miniLabel}>Baseline weight (kg)</div>
                        <input value={baseline} onChange={e => setBaseline(e.target.value)} placeholder="0" inputMode="decimal" style={miniInput} />
                    </div>
                    <div>
                        <div style={miniLabel}>Baseline body fat %</div>
                        <input value={fat} onChange={e => setFat(e.target.value)} placeholder="optional" inputMode="decimal" style={miniInput} />
                    </div>
                    <button onClick={save} style={{ ...primaryBtn, padding: "10px 14px" }}>Save</button>
                </div>
            )}

            {disqualifyOpen && (
                <div style={overlay}>
                    <div style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 420, width: "100%" }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Disqualify {participant.memberName}?</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                            They will be moved to the &quot;Disqualified&quot; section of the leaderboard. They can still upload meals and have weigh-ins recorded.
                        </div>
                        <div style={miniLabel}>Reason <span style={{ color: "#dc2626" }}>*</span></div>
                        <input
                            value={disqReason}
                            onChange={e => setDisqReason(e.target.value)}
                            placeholder="e.g. Club owner — not eligible for prize pool"
                            autoFocus
                            style={{ ...miniInput, borderColor: disqReason.trim() ? "#e2e8f0" : "#fecaca", marginBottom: 12 }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => { setDisqualifyOpen(false); setDisqReason(""); }} style={{ ...primaryBtn, flex: 1, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                            <button
                                disabled={disqBusy || !disqReason.trim()}
                                onClick={doDisqualify}
                                style={{ ...primaryBtn, flex: 1, background: disqReason.trim() ? "#dc2626" : "#fca5a5", cursor: disqReason.trim() && !disqBusy ? "pointer" : "not-allowed" }}
                            >{disqBusy ? "Disqualifying…" : "Disqualify"}</button>
                        </div>
                    </div>
                </div>
            )}

            {confirmRemove && (
                <div style={overlay}>
                    <div style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Remove {participant.memberName}?</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                            This deletes their weigh-ins and meal uploads from this challenge. To keep their data but exclude them from rankings, use &quot;Disqualify&quot; instead.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setConfirmRemove(false)} style={{ ...primaryBtn, flex: 1, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                            <button
                                onClick={async () => { await removeBtcParticipant(clubId, challengeId, participant.memberId); setConfirmRemove(false); }}
                                style={{ ...primaryBtn, flex: 1, background: "#dc2626" }}
                            >Remove</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Schedule tab ────────────────────────────────────────────────────
function ScheduleTab({ challenge }: { challenge: BtcChallenge }) {
    return (
        <div style={{ background: "white", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Weigh-in Schedule</div>
            {challenge.weighInSessions?.length ? (
                <div style={{ display: "grid", gap: 6 }}>
                    {challenge.weighInSessions.map(s => (
                        <div key={s.index} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "#f8fafc", borderRadius: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", background: "white", padding: "3px 10px", borderRadius: 100 }}>#{s.index + 1}</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{formatDate(s.date)} · {s.time}</div>
                                {s.notes && <div style={{ fontSize: 11, color: "#64748b" }}>{s.notes}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            ) : <div style={{ fontSize: 12, color: "#94a3b8", padding: 14, textAlign: "center" }}>No sessions configured yet — click Edit.</div>}

            <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginTop: 18, marginBottom: 8 }}>Instructions</div>
            {challenge.instructions
                ? <div style={{ fontSize: 13, lineHeight: 1.6, color: "#0f172a", whiteSpace: "pre-wrap", padding: 12, background: "#f8fafc", borderRadius: 10 }}>{challenge.instructions}</div>
                : <div style={{ fontSize: 12, color: "#94a3b8", padding: 14, textAlign: "center" }}>No instructions yet — click Edit.</div>
            }
        </div>
    );
}

// ─── Weigh-ins tab ──────────────────────────────────────────────────
function WeighInsTab({ clubId, challenge }: { clubId: string; challenge: BtcChallenge }) {
    const { participants } = useBtcChallengeParticipants(clubId, challenge.id);
    const { weighIns } = useBtcChallengeWeighIns(clubId, challenge.id);
    const sessions = challenge.weighInSessions || [];
    const [editing, setEditing] = useState<{ memberId: string; sessionIndex: number } | null>(null);
    const wiKey = (m: string, s: number) => `${m}_${s}`;
    const byKey = useMemo(() => {
        const out: Record<string, any> = {};
        for (const w of weighIns) out[wiKey(w.memberId, w.sessionIndex)] = w;
        return out;
    }, [weighIns]);

    if (sessions.length === 0) {
        return <div style={emptyBox}>Add weigh-in sessions in <b>Schedule</b> first.</div>;
    }
    if (participants.length === 0) {
        return <div style={emptyBox}>Add participants first.</div>;
    }

    return (
        <>
            <div style={{ background: "white", borderRadius: 14, padding: 14, overflowX: "auto" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>
                    Tap a cell to record or edit a full weigh-in (all body composition fields).
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT }}>
                    <thead>
                        <tr>
                            <th style={th}>Member</th>
                            <th style={th}>Baseline</th>
                            {sessions.map(s => (
                                <th key={s.index} style={th}>S{s.index + 1}<br /><span style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8" }}>{s.date}</span></th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {participants.map(p => (
                            <tr key={p.memberId}>
                                <td style={{ ...td, fontWeight: 800 }}>{p.memberName}</td>
                                <td style={td}>{p.baselineWeight > 0 ? `${p.baselineWeight} kg` : "—"}</td>
                                {sessions.map(s => {
                                    const w = byKey[wiKey(p.memberId, s.index)];
                                    return (
                                        <td key={s.index} style={td}>
                                            <WeighInCell
                                                existing={w}
                                                onOpen={() => setEditing({ memberId: p.memberId, sessionIndex: s.index })}
                                                onClear={() => deleteBtcWeighIn(clubId, challenge.id, p.memberId, s.index)}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {editing && (
                <WeighInEditorModal
                    clubId={clubId}
                    challenge={challenge}
                    memberId={editing.memberId}
                    sessionIndex={editing.sessionIndex}
                    existing={byKey[wiKey(editing.memberId, editing.sessionIndex)]}
                    onClose={() => setEditing(null)}
                />
            )}
        </>
    );
}

function WeighInCell({ existing, onOpen, onClear }: { existing: any; onOpen: () => void; onClear: () => void }) {
    if (!existing) {
        return (
            <button onClick={onOpen} style={{ background: "white", border: "1.5px dashed #cbd5e1", borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 11, fontWeight: 800, color: "#475569", fontFamily: FONT, minWidth: 90 }}>
                + Add
            </button>
        );
    }
    return (
        <button onClick={onOpen} style={{ background: "#f0fdf4", border: "1.5px solid #16a34a", borderRadius: 8, padding: "6px 8px", cursor: "pointer", textAlign: "left", fontFamily: FONT, minWidth: 90, position: "relative" }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{existing.weight} kg</div>
            {existing.bodyFat != null && <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>{existing.bodyFat}% fat</div>}
            {existing.recordedAtTime && <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>⏱ {existing.recordedAtTime}</div>}
            <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#dc2626", fontWeight: 800, padding: "2px 4px", borderRadius: 4, background: "rgba(220, 38, 38, 0.1)", cursor: "pointer" }}
            >
                ✕
            </span>
        </button>
    );
}

function WeighInEditorModal({ clubId, challenge, memberId, sessionIndex, existing, onClose }: {
    clubId: string; challenge: BtcChallenge; memberId: string; sessionIndex: number; existing: any; onClose: () => void;
}) {
    const session = challenge.weighInSessions.find(s => s.index === sessionIndex);
    if (!session) return null;
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={onClose}>
            <div style={{ background: "white", borderRadius: 14, padding: 14, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Record Weigh-in</div>
                    <button onClick={onClose} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 800, color: "#475569" }}>✕</button>
                </div>
                <BtcWeighInForm
                    clubId={clubId}
                    challengeId={challenge.id}
                    memberId={memberId}
                    session={session}
                    existing={existing}
                    expanded
                    onSaved={onClose}
                />
            </div>
        </div>
    );
}

// ─── Leaderboard tab ───────────────────────────────────────────────
type LBMetric = "weight" | "bodyFat" | "muscle";
type GenderFilter = "all" | "male" | "female";

function LeaderboardTab({ clubId, challengeId }: { clubId: string; challengeId: string }) {
    const { weight, bodyFat, muscle, loading, participants, weighIns } = useBtcLeaderboard(clubId, challengeId);
    const { meals } = useBtcChallengeMeals(clubId, challengeId);
    const { challenge } = useBtcChallenge(clubId, challengeId);
    const [metric, setMetric] = useState<LBMetric>("weight");
    const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

    if (loading || !challenge) return <div style={emptyBox}>Loading…</div>;
    if (participants.length === 0) return <div style={emptyBox}>No participants yet.</div>;

    // Pick the ranked list for the current metric
    const ranked = metric === "weight" ? weight : metric === "bodyFat" ? bodyFat : muscle;

    // Apply gender filter (keeps "unspecified" out of male/female views)
    const matchesGender = (g: "male" | "female" | null) =>
        genderFilter === "all" ? true : g === genderFilter;

    const passGender = ranked.filter(r => matchesGender(r.gender));
    const active = passGender.filter(r => !r.disqualified);
    const disqualified = passGender.filter(r => r.disqualified);

    // For each disqualified row, compute their hypothetical rank as if
    // disqualification didn't exist (within the gender-filtered universe).
    const hypoRank: Record<string, number> = {};
    passGender.forEach((r, i) => { hypoRank[r.memberId] = i + 1; });

    const metricLabel = metric === "weight" ? "% Weight Loss"
        : metric === "bodyFat" ? "Body Fat % Loss"
        : "Muscle Gain %";

    return (
        <div style={{ background: "white", borderRadius: 14, padding: 14 }}>
            {/* Metric tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                <button onClick={() => setMetric("weight")}   style={{ ...pill, ...(metric === "weight" ? pillActive : {}) }}>📉 % Weight Loss</button>
                <button onClick={() => setMetric("bodyFat")}  style={{ ...pill, ...(metric === "bodyFat" ? pillActive : {}) }}>🔥 Max Fat Loss</button>
                <button onClick={() => setMetric("muscle")}   style={{ ...pill, ...(metric === "muscle" ? pillActive : {}) }}>💪 Max Muscle Gain</button>
            </div>

            {/* Gender filter */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <button onClick={() => setGenderFilter("all")}    style={{ ...pillSm, ...(genderFilter === "all"    ? pillSmActive : {}) }}>All</button>
                <button onClick={() => setGenderFilter("male")}   style={{ ...pillSm, ...(genderFilter === "male"   ? pillSmActive : {}) }}>♂ Men</button>
                <button onClick={() => setGenderFilter("female")} style={{ ...pillSm, ...(genderFilter === "female" ? pillSmActive : {}) }}>♀ Women</button>
            </div>

            {active.length === 0 && disqualified.length === 0 && (
                <div style={emptyBox}>No participants match the current filter.</div>
            )}

            {active.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                    {active.map((r, i) => {
                        const p = participants.find(x => x.memberId === r.memberId);
                        if (!p) return null;
                        const discipline = computeDisciplineStats(p, weighIns, meals, challenge.weighInSessions || []);
                        return <LeaderboardCard key={r.memberId} rank={i + 1} row={r} discipline={discipline} metric={metric} />;
                    })}
                </div>
            )}

            {/* Disqualified section */}
            {disqualified.length > 0 && (
                <>
                    <div style={{ marginTop: 18, marginBottom: 6, paddingTop: 12, borderTop: "2px dashed #fecaca" }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#b91c1c" }}>
                            ⚠ Disqualified ({disqualified.length})
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                            Excluded from the {metricLabel.toLowerCase()} ranking above. Stats and where they would have placed are shown below.
                        </div>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                        {disqualified.map(r => {
                            const p = participants.find(x => x.memberId === r.memberId);
                            if (!p) return null;
                            const discipline = computeDisciplineStats(p, weighIns, meals, challenge.weighInSessions || []);
                            return (
                                <LeaderboardCard
                                    key={r.memberId}
                                    rank={hypoRank[r.memberId]}
                                    row={r}
                                    discipline={discipline}
                                    metric={metric}
                                    disqualified
                                />
                            );
                        })}
                    </div>
                </>
            )}

            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 14, fontWeight: 600 }}>
                Ranking uses <b>From Baseline</b>. Negative numbers (red) mean the participant has not yet crossed their baseline. Muscle gain uses first to latest recorded muscle mass.
            </div>
        </div>
    );
}

function LeaderboardCard({ rank, row, discipline, metric, disqualified }: {
    rank: number;
    row: any;
    discipline: any;
    metric: LBMetric;
    disqualified?: boolean;
}) {
    const medal = disqualified
        ? `would have been #${rank}`
        : rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    const primaryPct = metric === "weight" ? row.pctLossFromBaseline
        : metric === "bodyFat" ? row.fatLossFromBaseline
        : row.muscleGainPct;
    const isPositive = (primaryPct ?? 0) >= 0;
    // For weight loss / fat loss positive = good (loss). For muscle gain positive = good (gain).
    const primaryColor = isPositive ? "#16a34a" : "#dc2626";
    const primaryDisplay = primaryPct != null
        ? (metric === "muscle"
            ? `${isPositive ? "+" : "−"}${Math.abs(primaryPct)}%`
            : `${isPositive ? "−" : "+"}${Math.abs(primaryPct)}%`)
        : "—";
    const primaryCaption = metric === "weight" ? "from baseline"
        : metric === "bodyFat" ? "fat-pp drop"
        : "muscle change";

    return (
        <div style={{
            background: disqualified ? "#fff7f7" : "#f8fafc",
            borderRadius: 12, padding: 12,
            border: disqualified ? "1.5px dashed #fecaca" : "1px solid #e2e8f0",
            opacity: disqualified ? 0.92 : 1,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ minWidth: 36, fontSize: 13, fontWeight: 900, textAlign: "center", color: disqualified ? "#b91c1c" : "#64748b" }}>{medal}</div>
                {row.memberPhoto
                    ? <img src={row.memberPhoto} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", filter: disqualified ? "grayscale(0.5)" : undefined }} />
                    : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{row.memberName[0]}</div>
                }
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {row.memberName}
                        <span style={{ ...badgeBase, background: row.participantType === "old" ? "#fef3c7" : "#dcfce7", color: row.participantType === "old" ? "#92400e" : "#15803d" }}>
                            {row.participantType === "old" ? "OLD" : "NEW"}
                        </span>
                        {row.gender === "male"   && <span style={{ ...badgeBase, background: "#dbeafe", color: "#1e40af" }}>♂</span>}
                        {row.gender === "female" && <span style={{ ...badgeBase, background: "#fce7f3", color: "#9d174d" }}>♀</span>}
                        {disqualified && <span style={{ ...badgeBase, background: "#fee2e2", color: "#b91c1c" }}>DISQUALIFIED</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                        {metric === "muscle" ? (
                            <>First muscle {row.muscleGainKg != null && row.muscleGainPct != null ? `→ +${row.muscleGainKg} kg` : "—"}</>
                        ) : (
                            <>Baseline {metric === "weight" ? (row.baselineWeight ? `${row.baselineWeight} kg` : "—") : (row.baselineBodyFat != null ? `${row.baselineBodyFat}%` : "—")}
                            {" · Latest "}
                            {metric === "weight" ? (row.latestWeight != null ? `${row.latestWeight} kg` : "—") : (row.latestBodyFat != null ? `${row.latestBodyFat}%` : "—")}</>
                        )}
                    </div>
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: primaryColor }}>{primaryDisplay}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>{primaryCaption}</div>
                </div>
            </div>

            {/* Discipline metrics row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                <Metric label="Meal approval" value={discipline.approvalPct != null ? `${discipline.approvalPct}%` : "—"} color={(discipline.approvalPct ?? 0) >= 70 ? "#16a34a" : "#d97706"} />
                <Metric label="Meal rejection" value={discipline.rejectionPct != null ? `${discipline.rejectionPct}%` : "—"} color={(discipline.rejectionPct ?? 0) > 30 ? "#dc2626" : "#64748b"} />
                <Metric label="Weight loss" value={discipline.weightLossPct != null ? `${signed(discipline.weightLossPct)}%` : "—"} color={(discipline.weightLossPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <Metric label="Fat loss" value={discipline.fatLossPct != null ? `${signed(discipline.fatLossPct)}%` : "—"} color={(discipline.fatLossPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <Metric label="Muscle gain" value={discipline.muscleGainPct != null ? `${signed(discipline.muscleGainPct)}%` : "—"} color={(discipline.muscleGainPct ?? 0) < 0 ? "#dc2626" : "#16a34a"} />
                <Metric label="Attendance" value={discipline.attendancePct != null ? `${discipline.attendancePct}%` : "—"} color={(discipline.attendancePct ?? 0) >= 80 ? "#16a34a" : (discipline.attendancePct ?? 0) >= 50 ? "#d97706" : "#dc2626"} />
            </div>

            {disqualified && row.disqualifiedReason && (
                <div style={{ marginTop: 8, padding: 8, background: "#fee2e2", borderRadius: 8, fontSize: 11, color: "#7f1d1d", fontWeight: 700 }}>
                    Reason for disqualification: <span style={{ fontWeight: 600 }}>{row.disqualifiedReason}</span>
                </div>
            )}
        </div>
    );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
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


function formatDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } catch { return ymd; }
}

// ─── styles ──────────────────────────────────────────────────────────
const primaryBtn: React.CSSProperties = { padding: "10px 16px", background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const smallBtn: React.CSSProperties = { padding: "8px 14px", background: "#0f172a", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const ghostBtn: React.CSSProperties = { padding: "8px 12px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
const dangerBtn: React.CSSProperties = { padding: "8px 12px", background: "white", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
// ─── Weekly Awards tab — week-to-week winners per category ──────────
// For each consecutive pair of weigh-in sessions (Week N → Week N+1), find the
// participant with the biggest change in each category. Only participants who
// were weighed at BOTH of the two sessions are eligible for that week.
function WeeklyAwardsTab({ clubId, challenge }: { clubId: string; challenge: BtcChallenge }) {
    const { participants, weighIns, loading } = useBtcLeaderboard(clubId, challenge.id);

    const sessions = useMemo(
        () => (challenge.weighInSessions || []).slice().sort((a, b) => a.index - b.index),
        [challenge.weighInSessions],
    );

    const byKey = useMemo(() => {
        const m = new Map<string, any>();
        for (const w of weighIns) m.set(`${w.memberId}_${w.sessionIndex}`, w);
        return m;
    }, [weighIns]);

    const transitions = useMemo(() => {
        const num = (x: any) => (x == null || x === "" ? null : Number(x));
        const out: any[] = [];
        for (let i = 0; i < sessions.length - 1; i++) {
            const from = sessions[i], to = sessions[i + 1];
            const rows = participants
                .filter((p: any) => !p.disqualified)
                .map((p: any) => {
                    const a = byKey.get(`${p.memberId}_${from.index}`);
                    const b = byKey.get(`${p.memberId}_${to.index}`);
                    if (!a || !b) return null;
                    const wA = num(a.weight), wB = num(b.weight);
                    const fA = num(a.bodyFat), fB = num(b.bodyFat);
                    const mA = num(a.muscleMass ?? a.skeletalMuscle), mB = num(b.muscleMass ?? b.skeletalMuscle);
                    const weightDelta = (wA != null && wB != null) ? +(wA - wB).toFixed(1) : null;  // + = lost
                    const fatDelta = (fA != null && fB != null) ? +(fA - fB).toFixed(1) : null;      // + = lost (pp)
                    const muscleDelta = (mA != null && mB != null) ? +(mB - mA).toFixed(2) : null;   // + = gained
                    return {
                        memberId: p.memberId, name: p.memberName || "—", photo: p.memberPhoto || "",
                        fatLoss: fatDelta, weightLoss: weightDelta, muscleGain: muscleDelta,
                        weightGain: weightDelta != null ? +(-weightDelta).toFixed(1) : null,
                    };
                })
                .filter(Boolean) as any[];
            // Full ranking per category: every measured participant, best first.
            // Each metric is oriented so a higher value is better for its
            // category, so a single descending sort ranks them correctly.
            const ranked = (key: string) =>
                rows.filter(r => r[key] != null).sort((x, y) => y[key] - x[key]);
            out.push({
                from, to, weekFrom: from.index + 1, weekTo: to.index + 1, counted: rows.length,
                rows: rows.slice().sort((x, y) => (y.fatLoss ?? -1e9) - (x.fatLoss ?? -1e9)),
                awards: [
                    { key: "fatLoss", icon: "🔥", label: "Highest Fat Loss", unit: "pp", ranked: ranked("fatLoss") },
                    { key: "weightLoss", icon: "📉", label: "Highest Weight Loss", unit: "kg", ranked: ranked("weightLoss") },
                    { key: "muscleGain", icon: "💪", label: "Highest Muscle Gain", unit: "kg", ranked: ranked("muscleGain") },
                    { key: "weightGain", icon: "⬆️", label: "Highest Weight Gain", unit: "kg", ranked: ranked("weightGain") },
                ],
            });
        }
        return out.reverse(); // newest week first
    }, [sessions, participants, byKey]);

    if (loading) return <div style={emptyBox}>Loading…</div>;
    if (sessions.length < 2) return <div style={emptyBox}>Add at least two weigh-in sessions in <b>Schedule</b> to compare weeks.</div>;

    return (
        <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, background: "white", borderRadius: 12, padding: "10px 14px" }}>
                🏆 Full ranking of every participant's change between consecutive weigh-in sessions, per category. Only participants weighed at <i>both</i> sessions count. Fat loss is body-fat percentage points; weight &amp; muscle are in kg.
            </div>
            {transitions.map((t: any) => (
                <div key={`${t.from.index}-${t.to.index}`} style={{ background: "white", borderRadius: 14, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Week {t.weekFrom} → Week {t.weekTo}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>{fmtSessDate(t.from.date)} → {fmtSessDate(t.to.date)} · {t.counted} measured</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                        {t.awards.map((a: any) => <AwardCard key={a.key} award={a} />)}
                    </div>
                    <FullResultsTable rows={t.rows} />
                </div>
            ))}
        </div>
    );
}

function AwardCard({ award }: { award: any }) {
    const list: any[] = award.ranked || [];
    const lossMetric = award.key === "fatLoss" || award.key === "weightLoss";
    // Each metric is oriented so positive = good for its category. Loss
    // categories display a positive value as a reduction (−); gain categories
    // display it as an increase (+). Green = good outcome, red = wrong way.
    const fmtChange = (v: number) => {
        const decimals = award.key === "muscleGain" ? 2 : 1;
        const mag = Math.abs(v).toFixed(decimals);
        const sign = lossMetric ? (v >= 0 ? "−" : "+") : (v >= 0 ? "+" : "−");
        return { text: `${sign}${mag}${award.unit === "kg" ? " kg" : " pp"}`, color: v >= 0 ? "#16a34a" : "#dc2626" };
    };
    return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>{award.icon} {award.label}</div>
                {list.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>{list.length}</div>}
            </div>
            {list.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, padding: "10px 0" }}>No qualifying entries</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                    {list.map((r: any, idx: number) => {
                        const c = fmtChange(r[award.key]);
                        const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`;
                        return (
                            <div key={r.memberId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ width: 22, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#64748b", flexShrink: 0 }}>{medal}</div>
                                {r.photo
                                    ? <img src={r.photo} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                    : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#1e40af", fontSize: 12, flexShrink: 0 }}>{(r.name || "?")[0]}</div>}
                                <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: c.color, flexShrink: 0 }}>{c.text}</div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// Full per-participant breakdown for a week-to-week transition. Shows every
// member weighed at both sessions with their fat / weight / muscle deltas.
function FullResultsTable({ rows }: { rows: any[] }) {
    const [open, setOpen] = useState(true);
    if (!rows || rows.length === 0) return null;

    const delta = (v: number | null, kind: "loss" | "gain", unit: string) => {
        if (v == null) return <span style={{ color: "#cbd5e1" }}>—</span>;
        // loss metrics: positive = lost (good, green). gain metrics: positive = gained (good, green).
        const good = v > 0;
        const sign = v > 0 ? (kind === "loss" ? "−" : "+") : (kind === "loss" ? "+" : "−");
        return <span style={{ color: v === 0 ? "#94a3b8" : good ? "#16a34a" : "#dc2626", fontWeight: 800 }}>
            {v === 0 ? "0" : `${sign}${Math.abs(v)}`}{unit}
        </span>;
    };

    const th: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" };
    const td: React.CSSProperties = { fontSize: 12.5, padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #f1f5f9" };

    return (
        <div style={{ marginTop: 12 }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800, color: "#64748b", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}
            >
                {open ? "▾" : "▸"} Full results — all {rows.length} measured
            </button>
            {open && (
                <div style={{ overflowX: "auto", marginTop: 6 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                        <thead>
                            <tr>
                                <th style={{ ...th, textAlign: "left" }}>Participant</th>
                                <th style={th}>🔥 Fat</th>
                                <th style={th}>📉 Weight</th>
                                <th style={th}>💪 Muscle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r: any) => (
                                <tr key={r.memberId}>
                                    <td style={{ ...td, textAlign: "left" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            {r.photo
                                                ? <img src={r.photo} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                                : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, color: "#1e40af", flexShrink: 0 }}>{(r.name || "?")[0]}</div>}
                                            <span style={{ fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{r.name}</span>
                                        </div>
                                    </td>
                                    <td style={td}>{delta(r.fatLoss, "loss", " pp")}</td>
                                    <td style={td}>{delta(r.weightLoss, "loss", " kg")}</td>
                                    <td style={td}>{delta(r.muscleGain, "gain", " kg")}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function fmtSessDate(d: string): string {
    if (!d) return "—";
    try {
        const [y, m, dd] = d.split("-").map(Number);
        return new Date(y, m - 1, dd).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    } catch { return d; }
}

const card: React.CSSProperties = { background: "white", borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", flexWrap: "wrap" };
const emptyBox: React.CSSProperties = { background: "white", borderRadius: 12, padding: 40, textAlign: "center", color: "#94a3b8", fontWeight: 700 };
const badgeBase: React.CSSProperties = { fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 100, letterSpacing: 0.5 };
const activeBadge: React.CSSProperties = { ...badgeBase, background: "#16a34a", color: "white" };
const archivedBadge: React.CSSProperties = { ...badgeBase, background: "#e2e8f0", color: "#64748b", textTransform: "uppercase" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 8px", fontSize: 11, fontWeight: 800, color: "#475569", borderBottom: "1.5px solid #e2e8f0", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "8px 8px", fontSize: 12, color: "#0f172a", borderBottom: "1px solid #f1f5f9" };
const miniLabel: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 4 };
const miniInput: React.CSSProperties = { padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box", width: "100%" };
const pill: React.CSSProperties = { padding: "6px 14px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 100, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const pillActive: React.CSSProperties = { background: "#0f172a", color: "white", borderColor: "#0f172a" };
const pillSm: React.CSSProperties = { padding: "4px 12px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 100, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const pillSmActive: React.CSSProperties = { background: "#475569", color: "white", borderColor: "#475569" };
