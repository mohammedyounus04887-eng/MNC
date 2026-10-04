import { useState } from "react";
import type { User as Member } from "@/types/firestore";
import type { ParsedAction } from "./types";

interface Props {
    action: ParsedAction;          // action.firstDay is guaranteed set
    allMembers: Member[];          // for inviter dropdown
    onChange: (id: string, patch: Partial<ParsedAction["firstDay"]>) => void;
    onCaptureFace: (id: string) => void;
    onResolveDuplicate: (id: string, choice: "mark_again" | "new_photo" | "ignore") => void;
    onRemove: (id: string) => void;
}

// ─── FirstDayCard ─────────────────────────────────────────────────────
// Variant of MemberCard for first-day guests. Different chrome because
// the data shape is different (no member id, no shake choice — just
// name + phone + inviter + face capture).

export default function FirstDayCard({
    action, allMembers, onChange, onCaptureFace, onResolveDuplicate, onRemove,
}: Props) {
    const fd = action.firstDay!;
    const [editingName, setEditingName] = useState(false);
    const [editingPhone, setEditingPhone] = useState(false);
    const [inviterSearch, setInviterSearch] = useState("");
    const [showInviterEdit, setShowInviterEdit] = useState(false);

    const filteredInviters = allMembers.filter((m) => {
        if (!inviterSearch.trim()) return true;
        const q = inviterSearch.toLowerCase();
        return (m.name?.toLowerCase() ?? "").includes(q)
            || (m.memberId?.toLowerCase() ?? "").includes(q);
    }).slice(0, 8);

    // Status theme — green/red border
    const ready = action.status === "ready"
        && !!fd.name
        && fd.phoneDigits.length >= 5
        && !!fd.capturedFile
        && !fd.existingMatch;   // duplicate must be resolved
    const themeColor = ready ? "#f59e0b" : "#dc2626";
    const themeChip = ready ? "#fef3c7" : "#fee2e2";
    const themeLabel = !fd.name ? "Name missing"
        : fd.phoneDigits.length < 5 ? "Phone missing"
        : fd.existingMatch && !fd.duplicateChoice ? "Already visited — confirm"
        : !fd.capturedFile ? "Capture face"
        : "Ready to send";

    return (
        <div style={{
            width: 260,
            background: "white",
            borderRadius: 14,
            border: `2px solid ${themeColor}`,
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            padding: 14,
            display: "flex", flexDirection: "column", gap: 10,
            position: "relative",
            fontFamily: "Nunito, sans-serif",
        }}>
            {/* badge */}
            <div style={{
                position: "absolute", top: -10, left: 12,
                background: themeChip, color: themeColor,
                fontSize: 11, fontWeight: 800, padding: "3px 10px",
                borderRadius: 10, border: `1.5px solid ${themeColor}`,
            }}>
                ☀️ First Day · {themeLabel}
            </div>

            {/* remove × */}
            <button
                onClick={() => onRemove(action.id)}
                title="Remove this row"
                style={{
                    position: "absolute", top: 8, right: 8,
                    width: 22, height: 22, borderRadius: 11,
                    border: "none", background: "#f3f4f6", color: "#6b7280",
                    fontWeight: 700, cursor: "pointer", fontSize: 13, lineHeight: 1,
                }}
            >×</button>

            {/* captured photo OR capture button */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                {fd.capturedDataUrl ? (
                    <div style={{
                        width: 96, height: 96, borderRadius: 48,
                        background: `center/cover url(${fd.capturedDataUrl})`,
                        border: "3px solid #f59e0b",
                    }} />
                ) : (
                    <button
                        onClick={() => onCaptureFace(action.id)}
                        style={{
                            width: 96, height: 96, borderRadius: 48,
                            border: "3px dashed #fbbf24",
                            background: "#fffbeb",
                            color: "#92400e", cursor: "pointer",
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 800, fontFamily: "inherit",
                        }}
                    >
                        <span style={{ fontSize: 24 }}>📸</span>
                        <span>Capture</span>
                    </button>
                )}
            </div>

            {/* duplicate warning — must resolve before submit */}
            {fd.existingMatch && !fd.duplicateChoice && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#991b1b", marginBottom: 6 }}>
                        Already had a First Day on {fd.existingMatch.date}.
                        {fd.existingMatch.count >= 2 && <> ({fd.existingMatch.count}/2 used)</>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button onClick={() => onResolveDuplicate(action.id, "mark_again")}
                            disabled={fd.existingMatch.count >= 2}
                            style={dupBtn(fd.existingMatch.count >= 2)}>
                            Mark again ({2 - fd.existingMatch.count} left)
                        </button>
                        <button onClick={() => onResolveDuplicate(action.id, "new_photo")}
                            disabled={fd.existingMatch.count >= 2}
                            style={dupBtn(fd.existingMatch.count >= 2)}>
                            New photo, mark again
                        </button>
                        <button onClick={() => onResolveDuplicate(action.id, "ignore")}
                            style={dupBtn(false)}>
                            Different person, ignore warning
                        </button>
                    </div>
                </div>
            )}

            {/* NAME row */}
            <Field label="Name">
                {editingName ? (
                    <input
                        autoFocus
                        defaultValue={fd.name}
                        onBlur={(e) => { onChange(action.id, { name: e.target.value.trim() }); setEditingName(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                        style={fieldInput}
                    />
                ) : (
                    <button onClick={() => setEditingName(true)} style={fieldDisplay}>
                        {fd.name || <span style={{ color: "#9ca3af" }}>(tap to set)</span>}
                        <span style={fieldEditHint}>✎</span>
                    </button>
                )}
            </Field>

            {/* PHONE row */}
            <Field label="Phone">
                {editingPhone ? (
                    <input
                        autoFocus
                        defaultValue={fd.phoneDigits}
                        inputMode="tel"
                        onBlur={(e) => { onChange(action.id, { phoneDigits: e.target.value.replace(/\D/g, "") }); setEditingPhone(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                        style={fieldInput}
                    />
                ) : (
                    <button onClick={() => setEditingPhone(true)} style={fieldDisplay}>
                        {fd.phoneDigits || <span style={{ color: "#9ca3af" }}>(tap to set)</span>}
                        <span style={fieldEditHint}>✎</span>
                    </button>
                )}
            </Field>

            {/* INVITER row */}
            <Field label="Invited by">
                {fd.inviterMatch ? (
                    <button onClick={() => setShowInviterEdit((v) => !v)} style={fieldDisplay}>
                        <span style={{ fontWeight: 700 }}>{fd.inviterMatch.name}</span>
                        <span style={{ color: "#9ca3af", fontSize: 10 }}> · {fd.inviterMatch.memberId}</span>
                        <span style={fieldEditHint}>✎</span>
                    </button>
                ) : (
                    <button onClick={() => setShowInviterEdit((v) => !v)} style={fieldDisplay}>
                        {fd.inviterRaw
                            ? <span style={{ color: "#dc2626", fontSize: 11 }}>Heard "{fd.inviterRaw}" — pick</span>
                            : <span style={{ color: "#9ca3af" }}>(optional — tap to add)</span>}
                        <span style={fieldEditHint}>✎</span>
                    </button>
                )}
            </Field>

            {/* Inviter candidates from parser */}
            {fd.inviterCandidates && fd.inviterCandidates.length > 0 && !fd.inviterMatch && (
                <div style={{ background: "#fef2f2", padding: 6, borderRadius: 8 }}>
                    {fd.inviterCandidates.map((cand) => (
                        <button
                            key={cand.id}
                            onClick={() => onChange(action.id, { inviterMatch: cand, inviterCandidates: undefined })}
                            style={candidateBtn}
                        >
                            <span style={{ fontWeight: 700 }}>{cand.name}</span>
                            <span style={{ color: "#6b7280" }}> · {cand.memberId}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Inviter search/edit */}
            {showInviterEdit && (
                <div style={{ background: "#f9fafb", padding: 6, borderRadius: 8 }}>
                    <input
                        autoFocus
                        placeholder="Search inviter by name or ID..."
                        value={inviterSearch}
                        onChange={(e) => setInviterSearch(e.target.value)}
                        style={fieldInput}
                    />
                    {fd.inviterMatch && (
                        <button
                            onClick={() => { onChange(action.id, { inviterMatch: null }); setShowInviterEdit(false); }}
                            style={{ ...candidateBtn, color: "#dc2626" }}
                        >
                            ✕ Clear inviter
                        </button>
                    )}
                    <div style={{ maxHeight: 140, overflowY: "auto", marginTop: 4 }}>
                        {filteredInviters.map((mm) => (
                            <button
                                key={mm.id}
                                onClick={() => {
                                    onChange(action.id, { inviterMatch: mm, inviterCandidates: undefined });
                                    setShowInviterEdit(false); setInviterSearch("");
                                }}
                                style={candidateBtn}
                            >
                                <span style={{ fontWeight: 700 }}>{mm.name}</span>
                                <span style={{ color: "#6b7280" }}> · {mm.memberId}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Re-capture button when photo already captured */}
            {fd.capturedDataUrl && (
                <button
                    onClick={() => onCaptureFace(action.id)}
                    style={{
                        padding: "6px 0", border: "1px solid #d1d5db",
                        background: "white", borderRadius: 8, fontSize: 11,
                        fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        color: "#374151",
                    }}
                >
                    📸 Re-capture face
                </button>
            )}
        </div>
    );
}

// ─── styling helpers (kept inline so the card stays self-contained) ──

const fieldInput: React.CSSProperties = {
    width: "100%", padding: "6px 8px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
};
const fieldDisplay: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6,
    width: "100%", textAlign: "left", padding: "6px 8px",
    border: "1px solid #e5e7eb", background: "#f9fafb",
    borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
    color: "#1f2937",
};
const fieldEditHint: React.CSSProperties = {
    marginLeft: "auto", color: "#9ca3af", fontSize: 11,
};
const candidateBtn: React.CSSProperties = {
    width: "100%", textAlign: "left", padding: "5px 8px",
    border: "1px solid #fecaca", marginBottom: 3,
    background: "white", borderRadius: 6, fontSize: 11.5,
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    color: "#1f2937",
};
const dupBtn = (disabled: boolean): React.CSSProperties => ({
    width: "100%", textAlign: "left", padding: "6px 10px",
    border: "1px solid #fecaca",
    background: disabled ? "#f3f4f6" : "white", borderRadius: 6, fontSize: 11.5,
    fontWeight: 700, cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit", color: disabled ? "#9ca3af" : "#991b1b",
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{
                fontSize: 9, fontWeight: 800, color: "#6b7280",
                letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3,
            }}>{label}</div>
            {children}
        </div>
    );
}
