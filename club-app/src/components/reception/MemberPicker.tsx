/**
 * Finding a member — shared by the rebuilt reception pages.
 *
 * Card reader first, typing second. Both land in the same place, so a forgotten
 * card never blocks anybody.
 */

import { useMemo, useState } from "react";
import { useClubMembers } from "@/hooks/useOwner";
import { useCardScanner } from "@/lib/qrScan";

export interface PickedMember {
    id: string;
    name: string;
    memberId?: string;
    photoUrl?: string;
    shakeCredits?: number;
    membershipEndDate?: any;
    membershipEnd?: any;
}

export default function MemberPicker({
    onPick, placeholder = "Scan a card, or type a name, number or member ID…", autoFocus = true,
}: {
    onPick: (m: PickedMember) => void;
    placeholder?: string;
    autoFocus?: boolean;
}) {
    const { data: members, isLoading } = useClubMembers();
    const [q, setQ] = useState("");
    const [err, setErr] = useState("");

    const byId = useMemo(() => {
        const m = new Map<string, any>();
        (members ?? []).forEach((x: any) => m.set(x.id, x));
        return m;
    }, [members]);

    useCardScanner({
        onCard: id => {
            const m = byId.get(id);
            if (!m) { setErr("That card isn't in this club."); return; }
            setErr("");
            setQ("");
            onPick({ id: m.id, ...m });
        },
        onUnknown: () => setErr("That isn't a club card."),
    });

    const matches = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return [];
        return (members ?? [])
            .filter((m: any) => [m.name, m.memberId, m.phone].filter(Boolean).join(" ").toLowerCase().includes(t))
            .slice(0, 12);
    }, [members, q]);

    return (
        <div>
            <input
                autoFocus={autoFocus}
                value={q}
                onChange={e => { setQ(e.target.value); setErr(""); }}
                placeholder={placeholder}
                style={{
                    width: "100%", padding: "15px 18px", borderRadius: 13,
                    border: "2px solid #d9e2dc", fontSize: 17, fontFamily: "inherit",
                    outline: "none", boxSizing: "border-box", background: "#fff",
                }}
            />
            {err && <div style={{ marginTop: 8, color: "#b0332a", fontWeight: 800, fontSize: 14 }}>{err}</div>}
            {isLoading && <div style={{ marginTop: 10, color: "#8d9994", fontSize: 14 }}>Loading members…</div>}

            {matches.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    {matches.map((m: any) => (
                        <button
                            key={m.id}
                            onClick={() => { setQ(""); onPick({ id: m.id, ...m }); }}
                            style={{
                                display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                background: "#fff", border: "1px solid #e0d9cd", borderRadius: 12,
                                padding: "10px 12px", cursor: "pointer", fontFamily: "inherit",
                            }}
                        >
                            {m.photoUrl ? (
                                <img src={m.photoUrl} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                            ) : (
                                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#e2eeec", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#0d5c56" }}>
                                    {(m.name || "?").charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, fontSize: 15.5 }}>{m.name || "Member"}</div>
                                <div style={{ fontSize: 12.5, color: "#8d9994" }}>
                                    {m.memberId || ""}{m.phone ? ` · ${m.phone}` : ""}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
