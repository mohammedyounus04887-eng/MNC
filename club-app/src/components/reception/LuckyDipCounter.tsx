/**
 * Lucky Dip counter — Reception home screen, top-left.
 *
 * Lists members whose shake credits are running low (1..3 left) so the
 * receptionist can nudge them to renew BEFORE they hit 0 — renewing while
 * still holding ≥1 credit is what keeps them in the Lucky Dip pool.
 *
 * Most-urgent (fewest credits) first. Reads the already-loaded members list,
 * so it costs zero extra Firestore reads. Renders nothing when nobody is low.
 */

import { useState } from "react";
import { lowCreditMembers } from "@/lib/luckyDip";

const FONT = "Nunito, sans-serif";

export default function LuckyDipCounter({ members, onPick }: {
    members: any[];
    onPick?: (member: any) => void;
}) {
    const low = lowCreditMembers(members);
    // Collapsed by default — shows just the summary header to save space.
    const [open, setOpen] = useState(false);
    if (low.length === 0) return null;

    return (
        <div style={{
            position: "absolute", top: 18, left: 18, zIndex: 5,
            width: 250, maxHeight: "72vh", display: "flex", flexDirection: "column",
            background: "rgba(255,255,255,0.97)", borderRadius: 16,
            boxShadow: "0 8px 28px rgba(0,0,0,0.28)", overflow: "hidden",
            fontFamily: FONT,
        }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    padding: "12px 14px", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "white",
                    border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, width: "100%",
                }}
            >
                <div style={{ fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span>🎲 Lucky Dip Reminders ({low.length})</span>
                    <span style={{ fontSize: 14 }}>{open ? "▾" : "▸"}</span>
                </div>
                {open && (
                    <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.92, marginTop: 2, lineHeight: 1.35 }}>
                        Low on credits — renew before they hit 0 to keep Lucky Dip eligibility
                    </div>
                )}
            </button>
            {open && (
            <div style={{ overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {low.map(({ member, nudge }) => (
                    <button
                        key={member.id}
                        onClick={() => onPick?.(member)}
                        style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
                            background: "#f8fafc", border: `1px solid ${nudge.border}`, borderRadius: 10,
                            cursor: onPick ? "pointer" : "default", textAlign: "left", fontFamily: FONT,
                        }}
                    >
                        {member.photoUrl
                            ? <img src={member.photoUrl} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
                            : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#2d9653", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13 }}>
                                {(member.name || "?").charAt(0).toUpperCase()}
                            </div>
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {member.name || "Member"}
                            </div>
                            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                                {member.memberId || member.phone || ""}
                            </div>
                        </div>
                        <span style={{
                            fontSize: 10, fontWeight: 900, color: nudge.color, background: nudge.bg,
                            border: `1px solid ${nudge.border}`, padding: "3px 8px", borderRadius: 100, whiteSpace: "nowrap",
                        }}>
                            {nudge.label}
                        </span>
                    </button>
                ))}
            </div>
            )}
        </div>
    );
}
