import { useState } from "react";
import type { User as Member, Product } from "@/types/firestore";
import type { ParsedAction, RowStatus } from "./types";

interface Props {
    action: ParsedAction;
    allMembers: Member[];                  // for the edit dropdown
    products: Product[];                   // for the edit dropdown
    partner?: Member | null;               // resolved couple partner (if any)
    onChangeMember: (id: string, newMemberId: string) => void;
    onChangeItem:   (id: string, newProductId: string) => void;
    onChangeCouple: (id: string, choice: "both" | "self" | "partner") => void;
    onRemove:       (id: string) => void;
    onToggleVolunteer?: (id: string) => void;   // flip the volunteer modifier
}

// Status → border + chip colour. We map every state explicitly so
// future statuses get a noisy fallback instead of silent grey.
const STATUS_THEME: Record<RowStatus, { border: string; chip: string; label: string }> = {
    ready:         { border: "#2d9653", chip: "#dcfce7", label: "Ready" },
    needs_member:  { border: "#dc2626", chip: "#fee2e2", label: "Pick the right member" },
    needs_item:    { border: "#d97706", chip: "#fef3c7", label: "Pick a shake" },
    needs_couple:  { border: "#7c3aed", chip: "#ede9fe", label: "Couple — choose" },
    duplicate:     { border: "#6b7280", chip: "#f3f4f6", label: "Duplicate" },
};

export default function MemberCard({
    action, allMembers, products, partner,
    onChangeMember, onChangeItem, onChangeCouple, onRemove, onToggleVolunteer,
}: Props) {
    const [editing, setEditing] = useState<"none" | "member" | "item">("none");
    const [memberSearch, setMemberSearch] = useState("");

    const theme = STATUS_THEME[action.status];
    const m = action.memberMatch;

    // Member docs in this project use BOTH `photoUrl` (older, member-portal
    // upload path) and `photo` (newer, set on enrol/reception capture). Try
    // both so the avatar never silently falls back to an initial.
    const photo = (m as any)?.photoUrl || m?.photo || "";
    const initial = (m?.name?.[0] || "?").toUpperCase();
    const isOrder = action.action === "order" || action.action === "both";
    const isAttendance = action.action === "attendance" || action.action === "both";

    const filteredMembers = allMembers.filter((mm) => {
        if (!memberSearch.trim()) return true;
        const q = memberSearch.toLowerCase();
        return (mm.name?.toLowerCase() ?? "").includes(q)
            || (mm.memberId?.toLowerCase() ?? "").includes(q);
    }).slice(0, 12);

    return (
        <div style={{
            width: 220,
            background: "white",
            borderRadius: 14,
            border: `2px solid ${theme.border}`,
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            padding: 12,
            display: "flex", flexDirection: "column", gap: 8,
            position: "relative",
            fontFamily: "Nunito, sans-serif",
        }}>
            {/* status chip */}
            <div style={{
                position: "absolute", top: -10, left: 12,
                background: theme.chip, color: theme.border,
                fontSize: 11, fontWeight: 800, padding: "3px 8px",
                borderRadius: 10, border: `1.5px solid ${theme.border}`,
            }}>{theme.label}</div>

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

            {/* photo */}
            <div style={{
                width: 76, height: 76, borderRadius: 38,
                background: photo ? `center/cover url(${photo})` : "#ede9fe",
                color: "#7c3aed",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, fontWeight: 800, margin: "8px auto 0",
                border: "3px solid #faf5ff",
            }}>
                {!photo && initial}
            </div>

            {/* name + id */}
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1f2937", lineHeight: 1.1 }}>
                    {m?.name || `Member ${action.memberIdSpoken}`}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    {m?.memberId || `(heard "${action.memberIdSpoken}")`}
                </div>
            </div>

            {/* member edit popover */}
            {editing === "member" && (
                <div style={{ marginTop: 4, background: "#f9fafb", padding: 6, borderRadius: 8 }}>
                    <input
                        autoFocus
                        placeholder="Search name or ID..."
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }}
                    />
                    <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
                        {filteredMembers.map((mm) => (
                            <button
                                key={mm.id}
                                onClick={() => { onChangeMember(action.id, mm.id); setEditing("none"); setMemberSearch(""); }}
                                style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", fontSize: 12, cursor: "pointer", borderRadius: 4, fontFamily: "inherit" }}
                                onMouseOver={(e) => (e.currentTarget.style.background = "#ede9fe")}
                                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                                <span style={{ fontWeight: 700 }}>{mm.name}</span>
                                <span style={{ color: "#6b7280" }}> · {mm.memberId}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* action pills */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {isAttendance && (
                    <div style={{ background: "#dbeafe", color: "#1e40af", padding: "5px 9px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                        ✓ Mark attendance
                    </div>
                )}
                {isOrder && (
                    <div style={{ background: action.itemMatch ? "#fef3c7" : "#fee2e2", color: action.itemMatch ? "#92400e" : "#991b1b", padding: "5px 9px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                        {action.itemMatch ? `🥤 ${action.itemMatch.name}` : `? "${action.itemName ?? "shake"}"`}
                    </div>
                )}
                {/* Volunteer pill — clickable to toggle on/off */}
                {onToggleVolunteer && (
                    <button
                        onClick={() => onToggleVolunteer(action.id)}
                        style={{
                            background: action.asVolunteer ? "#dcfce7" : "transparent",
                            color: action.asVolunteer ? "#166534" : "#9ca3af",
                            padding: "5px 9px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            border: `1px dashed ${action.asVolunteer ? "#86efac" : "#e5e7eb"}`,
                            cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                        }}
                    >
                        {action.asVolunteer ? "🙌 Volunteer ✓" : "+ Mark as volunteer"}
                    </button>
                )}
            </div>

            {/* item edit popover */}
            {editing === "item" && (
                <div style={{ marginTop: 4, background: "#f9fafb", padding: 6, borderRadius: 8 }}>
                    {products.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => { onChangeItem(action.id, p.id); setEditing("none"); }}
                            style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", fontSize: 12, cursor: "pointer", borderRadius: 4, fontFamily: "inherit" }}
                            onMouseOver={(e) => (e.currentTarget.style.background = "#fef3c7")}
                            onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                            🥤 {p.name}
                        </button>
                    ))}
                </div>
            )}

            {/* name disambiguation — show candidates inline when the spoken
                 name matched more than one member. One tap picks it. */}
            {action.status === "needs_member" && action.candidates && action.candidates.length > 0 && (
                <div style={{ marginTop: 4, background: "#fef2f2", padding: 6, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#991b1b", marginBottom: 4, fontWeight: 700 }}>
                        Heard "{action.memberIdSpoken}" — which one?
                    </div>
                    {action.candidates.map((cand) => (
                        <button
                            key={cand.id}
                            onClick={() => onChangeMember(action.id, cand.id)}
                            style={{
                                display: "flex", alignItems: "center", gap: 6,
                                width: "100%", textAlign: "left", padding: "4px 6px",
                                marginBottom: 3, border: "1px solid #fecaca",
                                background: "white", borderRadius: 6, fontSize: 11,
                                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                color: "#991b1b",
                            }}
                        >
                            {(() => {
                                const candPhoto = (cand as any).photoUrl || cand.photo || "";
                                return (
                                    <div style={{
                                        width: 22, height: 22, borderRadius: 11,
                                        background: candPhoto ? `center/cover url(${candPhoto})` : "#fee2e2",
                                        color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 10, fontWeight: 800, flexShrink: 0,
                                    }}>
                                        {!candPhoto && (cand.name?.[0] ?? "?").toUpperCase()}
                                    </div>
                                );
                            })()}
                            <span>{cand.name} · {cand.memberId}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* couple chooser */}
            {action.status === "needs_couple" && m && (
                <div style={{ marginTop: 4, background: "#faf5ff", padding: 6, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#6b21a8", marginBottom: 4, fontWeight: 700 }}>
                        Couple linked — mark for:
                    </div>
                    {(["both", "self", "partner"] as const).map((choice) => (
                        <button
                            key={choice}
                            onClick={() => onChangeCouple(action.id, choice)}
                            style={{
                                width: "100%", textAlign: "left", padding: "5px 8px",
                                border: "1px solid #d8b4fe", marginBottom: 4,
                                background: "white", borderRadius: 6, fontSize: 11.5,
                                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                color: "#6b21a8",
                            }}
                        >
                            {choice === "both" && `Both (${m.name} + ${partner?.name ?? "partner"})`}
                            {choice === "self" && `Only ${m.name}`}
                            {choice === "partner" && `Only ${partner?.name ?? "partner"}`}
                        </button>
                    ))}
                </div>
            )}

            {/* edit buttons row */}
            <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 4 }}>
                <button
                    onClick={() => setEditing(editing === "member" ? "none" : "member")}
                    style={{ flex: 1, padding: "5px 0", border: "1px solid #d1d5db", background: "white", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#374151" }}
                >
                    Edit member
                </button>
                {isOrder && (
                    <button
                        onClick={() => setEditing(editing === "item" ? "none" : "item")}
                        style={{ flex: 1, padding: "5px 0", border: "1px solid #d1d5db", background: "white", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#374151" }}
                    >
                        Edit shake
                    </button>
                )}
            </div>
        </div>
    );
}
