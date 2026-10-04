/**
 * Coaches tab inside the Owner BTC page.
 *
 * A coach is a club member granted view-and-comment access to a small set
 * of participants' meal photos. Assignment lives on the participant doc
 * (coachId), so coaches can rotate between challenges without losing the
 * link history of past challenges.
 *
 * UX:
 *   - "+ Add coach" → search club members → promote to coach
 *   - Each coach card shows: name, photo, assignee count, manage button
 *   - "Manage customers" → modal with checkboxes for every participant
 *   - "Remove coach" → revokes the role + clears their assignments here
 */

import { useEffect, useMemo, useState } from "react";
import {
    useBtcChallengeParticipants,
    useBtcCoaches,
    setMemberIsBtcCoach,
    removeBtcCoach,
    bulkAssignCoach,
    bulkRemoveCoach,
    migrateParticipantCoachIds,
    coachIdsOf,
    searchClubMembers,
    type BtcCoachLite,
    type MemberLite,
} from "@/hooks/useBtcChallenges";
import type { BtcChallenge, BtcChallengeParticipant } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";

interface Props {
    clubId: string;
    challenge: BtcChallenge;
}

export default function BtcCoachesTab({ clubId, challenge }: Props) {
    const challengeId = challenge.id;
    const { coaches, loading: coachesLoading } = useBtcCoaches(clubId);
    const { participants, loading: pLoading } = useBtcChallengeParticipants(clubId, challengeId);
    const [addOpen, setAddOpen] = useState(false);
    const [manage, setManage] = useState<BtcCoachLite | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<BtcCoachLite | null>(null);

    // One-time migration: fold any legacy single `coachId` into `coachIds`
    // so the array-contains query (coach's own view) finds them.
    useEffect(() => {
        if (!participants.length) return;
        migrateParticipantCoachIds(clubId, challengeId, participants).catch(() => {});
    }, [clubId, challengeId, participants]);

    // Map coachId → number of customers assigned in THIS challenge. A
    // customer can be under several coaches, so they count for each.
    const assigneeCountsByCoachId = useMemo(() => {
        const out: Record<string, number> = {};
        for (const p of participants) {
            for (const cid of coachIdsOf(p)) out[cid] = (out[cid] || 0) + 1;
        }
        return out;
    }, [participants]);

    const unassignedCount = useMemo(
        () => participants.filter(p => coachIdsOf(p).length === 0).length,
        [participants],
    );

    if (coachesLoading || pLoading) {
        return <div style={emptyBox}>Loading…</div>;
    }

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>
                    {coaches.length} coach{coaches.length === 1 ? "" : "es"}
                    {participants.length > 0 && (
                        <>{" · "}{participants.length - unassignedCount}/{participants.length} customers assigned</>
                    )}
                </div>
                <button onClick={() => setAddOpen(true)} style={primaryBtn}>+ Add coach</button>
            </div>

            {coaches.length === 0 && (
                <div style={emptyBox}>
                    No coaches yet. Promote a member to a coach and they'll see a "View Customer's Meal Photos" section
                    on their app for the customers you assign here.
                </div>
            )}

            {coaches.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                    {coaches.map(c => {
                        const count = assigneeCountsByCoachId[c.id] || 0;
                        return (
                            <div key={c.id} style={card}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                    {c.photo
                                        ? <img src={c.photo} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover" }} />
                                        : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#1e40af" }}>
                                            {c.name[0]}
                                        </div>
                                    }
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{c.name}</div>
                                            <span style={coachBadge}>COACH</span>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                            {c.phone || "—"} · <b style={{ color: count > 0 ? "#16a34a" : "#94a3b8" }}>{count} customer{count === 1 ? "" : "s"}</b> assigned
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                    <button onClick={() => setManage(c)} style={{ ...ghostBtn, color: "#0f172a", borderColor: "#0f172a" }}>
                                        Manage customers
                                    </button>
                                    <button onClick={() => setConfirmRemove(c)} style={dangerBtn}>
                                        Remove coach
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {addOpen && (
                <AddCoachDialog
                    clubId={clubId}
                    existingCoachIds={new Set(coaches.map(c => c.id))}
                    onClose={() => setAddOpen(false)}
                />
            )}

            {manage && (
                <CoachAssignModal
                    clubId={clubId}
                    challengeId={challengeId}
                    coach={manage}
                    coaches={coaches}
                    participants={participants}
                    onClose={() => setManage(null)}
                />
            )}

            {confirmRemove && (
                <div style={overlay}>
                    <div style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 380, width: "100%" }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Remove {confirmRemove.name} as coach?</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                            They will lose access to the "View Customer's Meal Photos" section. Their {(assigneeCountsByCoachId[confirmRemove.id] || 0)} assigned customer{(assigneeCountsByCoachId[confirmRemove.id] || 0) === 1 ? "" : "s"} in this challenge will be unassigned. Past comments they made stay visible.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setConfirmRemove(null)} style={{ ...primaryBtn, flex: 1, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                            <button
                                onClick={async () => {
                                    await removeBtcCoach(clubId, confirmRemove.id, challengeId);
                                    setConfirmRemove(null);
                                }}
                                style={{ ...primaryBtn, flex: 1, background: "#dc2626" }}
                            >Remove coach</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Add coach dialog ────────────────────────────────────────────────
// Reuses the existing club-member search hook. Filters out anyone
// already promoted to coach.
function AddCoachDialog({ clubId, existingCoachIds, onClose }: {
    clubId: string;
    existingCoachIds: Set<string>;
    onClose: () => void;
}) {
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<MemberLite[]>([]);
    const [searching, setSearching] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);   // memberId currently being promoted

    useEffect(() => {
        let cancelled = false;
        if (term.trim().length < 2) { setResults([]); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const rows = await searchClubMembers(clubId, term);
                if (!cancelled) setResults(rows);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);   // small debounce so we don't fire on every keystroke
        return () => { cancelled = true; clearTimeout(t); };
    }, [clubId, term]);

    const promote = async (m: MemberLite) => {
        if (existingCoachIds.has(m.id)) return;
        setBusy(m.id);
        try {
            await setMemberIsBtcCoach(clubId, m.id, true);
            onClose();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={{ background: "white", borderRadius: 14, padding: 18, maxWidth: 480, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>➕ Add Coach</div>
                    <button onClick={onClose} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 800, color: "#475569" }}>✕</button>
                </div>
                <div style={miniLabel}>Search by name or phone</div>
                <input
                    value={term}
                    onChange={e => setTerm(e.target.value)}
                    placeholder="Type at least 2 characters…"
                    autoFocus
                    style={{ ...miniInput, marginBottom: 10 }}
                />
                <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 6 }}>
                    {searching && <div style={{ fontSize: 12, color: "#64748b", padding: 10 }}>Searching…</div>}
                    {!searching && term.trim().length >= 2 && results.length === 0 && (
                        <div style={{ fontSize: 12, color: "#94a3b8", padding: 10 }}>No matching member found.</div>
                    )}
                    {results.map(m => {
                        const already = existingCoachIds.has(m.id);
                        return (
                            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "#f8fafc", borderRadius: 10, opacity: already ? 0.55 : 1 }}>
                                {m.photo
                                    ? <img src={m.photo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                                    : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{m.name[0]}</div>
                                }
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        {m.name}
                                        {already && <span style={{ fontSize: 9, fontWeight: 900, color: "#1e40af", background: "#dbeafe", padding: "2px 8px", borderRadius: 100, letterSpacing: 0.5 }}>ALREADY A COACH</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#64748b" }}>{m.phone || "—"}</div>
                                </div>
                                <button
                                    onClick={() => promote(m)}
                                    disabled={already || busy === m.id}
                                    style={{ ...primaryBtn, padding: "6px 12px", fontSize: 12, opacity: already ? 0.5 : 1, cursor: already ? "not-allowed" : "pointer" }}
                                >
                                    {busy === m.id ? "Adding…" : already ? "Added" : "Make coach"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ─── Assign customers modal ──────────────────────────────────────────
// Shows every participant in the current challenge with a checkbox. The
// initial checked state is the current `coachId === coach.id`. On Save
// we diff and run the additions in one batch + the removals in another.
function CoachAssignModal({ clubId, challengeId, coach, coaches, participants, onClose }: {
    clubId: string;
    challengeId: string;
    coach: BtcCoachLite;
    coaches: BtcCoachLite[];
    participants: BtcChallengeParticipant[];
    onClose: () => void;
}) {
    const coachNameById = useMemo(() => {
        const m: Record<string, string> = {};
        for (const c of coaches) m[c.id] = c.name;
        return m;
    }, [coaches]);
    // Initial selection = anyone currently coached by THIS coach
    const initiallySelected = useMemo(
        () => new Set(participants.filter(p => coachIdsOf(p).includes(coach.id)).map(p => p.memberId)),
        [participants, coach.id],
    );
    const [selected, setSelected] = useState<Set<string>>(initiallySelected);
    const [filter, setFilter] = useState("");
    const [busy, setBusy] = useState(false);

    const toggle = (memberId: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
            return next;
        });
    };

    const filtered = useMemo(() => {
        const t = filter.trim().toLowerCase();
        if (!t) return participants;
        return participants.filter(p =>
            (p.memberName || "").toLowerCase().includes(t) ||
            (p.memberPhone || "").includes(t),
        );
    }, [participants, filter]);

    const save = async () => {
        setBusy(true);
        try {
            // Diff against the coaches each participant already has. Adding a
            // coach never removes another — a customer can have many coaches.
            const adds: string[] = [];
            const removes: string[] = [];
            for (const p of participants) {
                const want = selected.has(p.memberId);
                const have = coachIdsOf(p).includes(coach.id);
                if (want && !have) adds.push(p.memberId);
                if (!want && have) removes.push(p.memberId);
            }
            if (adds.length) {
                await bulkAssignCoach(clubId, challengeId, adds, { id: coach.id, name: coach.name });
            }
            if (removes.length) {
                await bulkRemoveCoach(clubId, challengeId, removes, coach.id);
            }
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={{ background: "white", borderRadius: 14, padding: 18, maxWidth: 560, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>👥 Assign customers to {coach.name}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            {selected.size} selected · {participants.length} total participants
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 800, color: "#475569" }}>✕</button>
                </div>

                <input
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter by name or phone…"
                    style={{ ...miniInput, marginBottom: 10 }}
                />

                <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 4, paddingRight: 4 }}>
                    {filtered.length === 0 && (
                        <div style={{ fontSize: 12, color: "#94a3b8", padding: 10 }}>No participants match.</div>
                    )}
                    {filtered.map(p => {
                        const isMine = coachIdsOf(p).includes(coach.id);
                        const otherCoaches = coachIdsOf(p)
                            .filter(id => id !== coach.id)
                            .map(id => coachNameById[id] || "another coach");
                        const checked = selected.has(p.memberId);
                        return (
                            <label
                                key={p.memberId}
                                style={{
                                    display: "flex", alignItems: "center", gap: 10, padding: 8,
                                    background: checked ? "#f0fdf4" : "#f8fafc",
                                    border: checked ? "1.5px solid #86efac" : "1.5px solid transparent",
                                    borderRadius: 10, cursor: "pointer",
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(p.memberId)}
                                    style={{ width: 18, height: 18, cursor: "pointer" }}
                                />
                                {p.memberPhoto
                                    ? <img src={p.memberPhoto} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
                                    : <div style={{ width: 32, height: 32, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{p.memberName[0]}</div>
                                }
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{p.memberName}</div>
                                    <div style={{ fontSize: 10, color: "#64748b" }}>
                                        {p.memberPhone || "—"}
                                        {isMine && <> · <b style={{ color: "#16a34a" }}>assigned to {coach.name}</b></>}
                                        {otherCoaches.length > 0 && <> · <span style={{ color: "#2563eb" }}>also: {otherCoaches.join(", ")}</span></>}
                                    </div>
                                </div>
                            </label>
                        );
                    })}
                </div>

                <div style={{ marginTop: 10, padding: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 11, color: "#1e40af", fontWeight: 700 }}>
                    ℹ A customer can have several coaches — assigning here adds {coach.name} without removing anyone else.
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onClose} style={{ ...primaryBtn, flex: 1, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                    <button
                        onClick={save}
                        disabled={busy}
                        style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.7 : 1 }}
                    >
                        {busy ? "Saving…" : "Save assignments"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── styles ─────────────────────────────────────────────────────────
const primaryBtn: React.CSSProperties = { padding: "10px 16px", background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const ghostBtn: React.CSSProperties = { padding: "8px 12px", background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
const dangerBtn: React.CSSProperties = { padding: "8px 12px", background: "white", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
const card: React.CSSProperties = { background: "white", borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", flexWrap: "wrap" };
const emptyBox: React.CSSProperties = { background: "white", borderRadius: 12, padding: 32, textAlign: "center", color: "#94a3b8", fontWeight: 700, lineHeight: 1.5 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 };
const miniLabel: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 4 };
const miniInput: React.CSSProperties = { padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box", width: "100%" };
const coachBadge: React.CSSProperties = { fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 100, letterSpacing: 0.5, background: "#dbeafe", color: "#1e40af" };
