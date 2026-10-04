/**
 * Create / edit a BTC challenge.
 *
 * No start/end date — only a name, an instructions block, and a list of
 * weigh-in session date+time rows. "Activate" makes this the active
 * challenge (auto-deactivates any other active challenge for the club).
 */

import { useState } from "react";
import { createBtcChallenge, updateBtcChallenge, type BtcChallenge } from "@/hooks/useBtcChallenges";
import type { BtcWeighInSession } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";

export default function BtcChallengeForm({
    clubId, existing, onClose, onSaved,
}: {
    clubId: string;
    existing?: BtcChallenge | null;
    onClose: () => void;
    onSaved?: (id: string) => void;
}) {
    const [name, setName] = useState(existing?.name || "");
    const [instructions, setInstructions] = useState(existing?.instructions || "");
    const [sessions, setSessions] = useState<BtcWeighInSession[]>(
        existing?.weighInSessions?.length
            ? existing.weighInSessions
            : [{ index: 0, date: "", time: "07:00", notes: "" }],
    );
    const [activate, setActivate] = useState(existing ? existing.isActive : true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const updateSession = (i: number, patch: Partial<BtcWeighInSession>) => {
        setSessions(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
    };
    const addSession = () => {
        setSessions(prev => [...prev, { index: prev.length, date: "", time: "07:00", notes: "" }]);
    };
    const removeSession = (i: number) => {
        setSessions(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx })));
    };

    const submit = async () => {
        setErr("");
        if (!name.trim()) { setErr("Give the challenge a name (e.g. \"BTC – May\")."); return; }
        const cleanSessions = sessions
            .filter(s => s.date)
            .map((s, idx) => ({ index: idx, date: s.date, time: s.time || "07:00", notes: s.notes || "" }));
        setBusy(true);
        try {
            if (existing) {
                await updateBtcChallenge(clubId, existing.id, {
                    name: name.trim(),
                    instructions,
                    weighInSessions: cleanSessions,
                });
                onSaved?.(existing.id);
            } else {
                const id = await createBtcChallenge(clubId, {
                    name: name.trim(),
                    instructions,
                    weighInSessions: cleanSessions,
                    activate,
                });
                onSaved?.(id);
            }
            onClose();
        } catch (e: any) {
            setErr(e?.message || "Could not save challenge.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                        {existing ? "✏️ Edit Challenge" : "🆕 New Challenge"}
                    </div>
                    <button onClick={onClose} style={iconBtn}>✕</button>
                </div>

                <div style={label}>Challenge name</div>
                <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="BTC – May"
                    style={input}
                />

                <div style={{ ...label, marginTop: 6 }}>Weigh-in sessions</div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontWeight: 600 }}>
                    Date + time each session is scheduled. Participants see this list.
                </div>
                {sessions.map((s, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1.2fr 0.9fr 1.5fr auto", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", width: 24, textAlign: "right" }}>#{i + 1}</div>
                        <input type="date" value={s.date} onChange={e => updateSession(i, { date: e.target.value })} style={inputSmall} />
                        <input type="time" value={s.time} onChange={e => updateSession(i, { time: e.target.value })} style={inputSmall} />
                        <input value={s.notes} onChange={e => updateSession(i, { notes: e.target.value })} placeholder="Notes (optional)" style={inputSmall} />
                        <button onClick={() => removeSession(i)} disabled={sessions.length === 1} style={{ ...iconBtn, padding: "6px 10px" }}>−</button>
                    </div>
                ))}
                <button onClick={addSession} style={addBtn}>+ Add session</button>

                <div style={{ ...label, marginTop: 14 }}>Instructions / notice</div>
                <textarea
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder={`e.g.\nUpload 3 meal photos every day — breakfast, lunch, dinner.\nWeigh-ins are at 7:00 AM sharp on the dates above.\nLate arrival = ₹300 fine.`}
                    rows={6}
                    style={{ ...input, resize: "vertical", fontFamily: FONT }}
                />

                {!existing && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", cursor: "pointer" }}>
                        <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Make this the active challenge</span>
                    </label>
                )}

                {err && <div style={errBox}>{err}</div>}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button onClick={onClose} style={{ ...primaryBtn, background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>Cancel</button>
                    <button onClick={submit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                        {busy ? "Saving…" : (existing ? "Save Changes" : "Create Challenge")}
                    </button>
                </div>
            </div>
        </div>
    );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, fontFamily: FONT };
const modal: React.CSSProperties = { background: "white", borderRadius: 16, padding: 22, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 };
const input: React.CSSProperties = { width: "100%", padding: 11, border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, fontFamily: FONT, marginBottom: 4, boxSizing: "border-box" };
const inputSmall: React.CSSProperties = { padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box", width: "100%" };
const iconBtn: React.CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#475569", fontFamily: FONT };
const addBtn: React.CSSProperties = { background: "#f1f5f9", border: "1px dashed #cbd5e1", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#475569", fontFamily: FONT, marginTop: 4 };
const errBox: React.CSSProperties = { padding: 10, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 700, marginTop: 8 };
const primaryBtn: React.CSSProperties = { flex: 1, padding: 12, background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
