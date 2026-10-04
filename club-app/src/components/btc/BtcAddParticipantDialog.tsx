/**
 * Add-by-phone dialog for BTC v2.
 *
 * Only existing club members are addable. Volunteer chooses
 * New / Old; for "Old" the baseline weight is collected manually.
 * For "New" the baseline is set automatically from the first weigh-in.
 */

import { useEffect, useState } from "react";
import { addBtcParticipant, getMemberByPhone, searchClubMembers, type MemberLite } from "@/hooks/useBtcChallenges";

const FONT = "'Nunito', sans-serif";

export default function BtcAddParticipantDialog({
    clubId, challengeId, onClose, existingMemberIds,
}: {
    clubId: string;
    challengeId: string;
    onClose: () => void;
    existingMemberIds: Set<string>;
}) {
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<MemberLite[]>([]);
    const [selected, setSelected] = useState<MemberLite | null>(null);
    const [participantType, setParticipantType] = useState<"new" | "old">("new");
    const [gender, setGender] = useState<"male" | "female" | null>(null);
    const [baselineWeight, setBaselineWeight] = useState("");
    const [baselineFat, setBaselineFat] = useState("");
    const [paid, setPaid] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (!term || term.trim().length < 2) { setResults([]); return; }
        let cancelled = false;
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const phoneMatch = await getMemberByPhone(clubId, term);
                const rough = await searchClubMembers(clubId, term);
                if (cancelled) return;
                const combined: MemberLite[] = [];
                if (phoneMatch && !rough.some(r => r.id === phoneMatch.id)) combined.push(phoneMatch);
                combined.push(...rough);
                setResults(combined);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(t); };
    }, [term, clubId]);

    useEffect(() => {
        // Auto-suggest "old" when the member has prior BTC history.
        if (selected) setParticipantType(selected.hasPriorBtc ? "old" : "new");
    }, [selected]);

    const submit = async () => {
        setErr("");
        if (!selected) { setErr("Pick a member first."); return; }
        if (!gender) { setErr("Pick Male or Female — required for leaderboard filtering."); return; }
        if (participantType === "old") {
            const w = parseFloat(baselineWeight);
            if (!w || w <= 0) { setErr("Enter a baseline weight (kg) for an old participant."); return; }
        }
        setBusy(true);
        try {
            await addBtcParticipant(clubId, challengeId, {
                memberId: selected.id,
                memberName: selected.name,
                memberPhone: selected.phone,
                memberPhoto: selected.photo,
                participantType,
                gender,
                baselineWeight: participantType === "old" ? parseFloat(baselineWeight) : 0,
                baselineBodyFat: participantType === "old" && baselineFat ? parseFloat(baselineFat) : null,
                paid,
            });
            onClose();
        } catch (e: any) {
            setErr(e?.message || "Could not add participant.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>➕ Add Participant</div>
                    <button onClick={onClose} style={iconBtn}>✕</button>
                </div>

                {!selected ? (
                    <>
                        <div style={label}>Search by name or phone</div>
                        <input
                            autoFocus
                            value={term}
                            onChange={e => setTerm(e.target.value)}
                            placeholder="Type at least 2 characters…"
                            style={input}
                        />
                        <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 10 }}>
                            {searching && <div style={hint}>Searching…</div>}
                            {!searching && term.length >= 2 && results.length === 0 && (
                                <div style={hint}>No matching member found.</div>
                            )}
                            {results.map(r => {
                                const already = existingMemberIds.has(r.id);
                                return (
                                    <button
                                        key={r.id}
                                        disabled={already}
                                        onClick={() => setSelected(r)}
                                        style={{
                                            ...row,
                                            opacity: already ? 0.5 : 1,
                                            cursor: already ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        {r.photo
                                            ? <img src={r.photo} alt="" style={avatar} />
                                            : <div style={{ ...avatar, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{r.name[0]}</div>
                                        }
                                        <div style={{ flex: 1, textAlign: "left" }}>
                                            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{r.name}</div>
                                            <div style={{ fontSize: 11, color: "#64748b" }}>{r.phone || "—"}{r.hasPriorBtc ? " · prior BTC" : ""}</div>
                                        </div>
                                        {already && <div style={badge}>already added</div>}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, background: "#f8fafc", borderRadius: 10, marginBottom: 14 }}>
                            {selected.photo
                                ? <img src={selected.photo} alt="" style={avatar} />
                                : <div style={{ ...avatar, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#475569" }}>{selected.name[0]}</div>
                            }
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{selected.name}</div>
                                <div style={{ fontSize: 11, color: "#64748b" }}>{selected.phone}</div>
                            </div>
                            <button onClick={() => setSelected(null)} style={{ ...iconBtn, fontSize: 11 }}>Change</button>
                        </div>

                        <div style={label}>Participant type</div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                            <button
                                onClick={() => setParticipantType("new")}
                                style={{
                                    ...typeBtn,
                                    background: participantType === "new" ? "#16a34a" : "white",
                                    color: participantType === "new" ? "white" : "#0f172a",
                                    borderColor: participantType === "new" ? "#16a34a" : "#e2e8f0",
                                }}
                            >🆕 New Participant</button>
                            <button
                                onClick={() => setParticipantType("old")}
                                style={{
                                    ...typeBtn,
                                    background: participantType === "old" ? "#d97706" : "white",
                                    color: participantType === "old" ? "white" : "#0f172a",
                                    borderColor: participantType === "old" ? "#d97706" : "#e2e8f0",
                                }}
                            >🔁 Old Participant</button>
                        </div>
                        {selected.hasPriorBtc && (
                            <div style={{ fontSize: 11, color: "#d97706", fontWeight: 700, marginBottom: 10 }}>
                                Existing BTC history detected — &quot;Old&quot; pre-selected. You can override.
                            </div>
                        )}
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
                            {participantType === "new"
                                ? "First weigh-in will become this person's baseline."
                                : "Enter their prior best weight — all loss math is calculated from here."}
                        </div>

                        <div style={label}>Gender <span style={{ color: "#dc2626" }}>*</span></div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                            <button
                                type="button"
                                onClick={() => setGender("male")}
                                style={{
                                    ...typeBtn,
                                    background: gender === "male" ? "#1e40af" : "white",
                                    color: gender === "male" ? "white" : "#0f172a",
                                    borderColor: gender === "male" ? "#1e40af" : "#e2e8f0",
                                }}
                            >♂️ Male</button>
                            <button
                                type="button"
                                onClick={() => setGender("female")}
                                style={{
                                    ...typeBtn,
                                    background: gender === "female" ? "#be185d" : "white",
                                    color: gender === "female" ? "white" : "#0f172a",
                                    borderColor: gender === "female" ? "#be185d" : "#e2e8f0",
                                }}
                            >♀️ Female</button>
                        </div>

                        {participantType === "old" && (
                            <>
                                <div style={label}>Baseline weight (kg) <span style={{ color: "#dc2626" }}>*</span></div>
                                <input
                                    value={baselineWeight}
                                    onChange={e => setBaselineWeight(e.target.value)}
                                    placeholder="e.g. 60.5"
                                    inputMode="decimal"
                                    style={input}
                                />
                                <div style={label}>Baseline body fat % (optional)</div>
                                <input
                                    value={baselineFat}
                                    onChange={e => setBaselineFat(e.target.value)}
                                    placeholder="e.g. 24.5"
                                    inputMode="decimal"
                                    style={input}
                                />
                            </>
                        )}

                        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", cursor: "pointer" }}>
                            <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Mark as paid</span>
                        </label>

                        {err && <div style={errBox}>{err}</div>}

                        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                            <button onClick={onClose} style={{ ...primaryBtn, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                            <button onClick={submit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                                {busy ? "Adding…" : "Add Participant"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, fontFamily: FONT };
const modal: React.CSSProperties = { background: "white", borderRadius: 16, padding: 22, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginTop: 4, marginBottom: 6 };
const input: React.CSSProperties = { width: "100%", padding: 11, border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, fontFamily: FONT, marginBottom: 10, boxSizing: "border-box" };
const row: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", padding: 10, width: "100%", background: "white", border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 6, cursor: "pointer", fontFamily: FONT };
const avatar: React.CSSProperties = { width: 38, height: 38, borderRadius: 8, objectFit: "cover" };
const badge: React.CSSProperties = { fontSize: 10, fontWeight: 700, padding: "3px 8px", background: "#fef3c7", color: "#92400e", borderRadius: 100 };
const iconBtn: React.CSSProperties = { background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#475569", fontFamily: FONT };
const typeBtn: React.CSSProperties = { flex: 1, padding: "12px 8px", border: "2px solid #e2e8f0", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 800, fontFamily: FONT };
const errBox: React.CSSProperties = { padding: 10, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 700, marginTop: 8 };
const primaryBtn: React.CSSProperties = { flex: 1, padding: 12, background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const hint: React.CSSProperties = { fontSize: 12, color: "#94a3b8", padding: 16, textAlign: "center", fontWeight: 600 };
