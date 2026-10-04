/**
 * Check In — rebuilt.
 *
 * Scan the card, or type the name. That is the whole screen.
 *
 * No face scan: the receptionist is looking at the person, and matching faces
 * was the app's most common failure — a 6.8 MB model download on every cold
 * start, cameras left running, and members who could never be recognised at
 * all. Attendance goes through the shared writer, so a check-in here is
 * identical to one made anywhere else.
 */

import { useEffect, useState } from "react";


import { useClubContext } from "@/lib/clubDetection";
import MemberPicker, { type PickedMember } from "@/components/reception/MemberPicker";
import { markMemberAttendance } from "@/lib/attendance";
import { todayLocal } from "@/lib/clubDay";

interface Row { key: string; name: string; memberId?: string; photo?: string; at: string; repeat: boolean }

export default function ReceptionCheckInPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const [rows, setRows] = useState<Row[]>([]);
    const [flash, setFlash] = useState<{ kind: "ok" | "repeat" | "err"; text: string } | null>(null);
    const [busy, setBusy] = useState(false);

    // StationAccess authenticates and authorizes this route before mounting.

    const say = (kind: "ok" | "repeat" | "err", text: string) => {
        setFlash({ kind, text });
        setTimeout(() => setFlash(null), 2800);
    };

    const check = async (m: PickedMember) => {
        if (!clubId || busy) return;
        setBusy(true);
        try {
            const res = await markMemberAttendance({
                clubId,
                memberId: m.id,
                memberName: m.name || "",
                memberPhoto: m.photoUrl || "",
                method: "card",
            });
            setRows(prev => [{
                key: `${m.id}-${Date.now()}`,
                name: m.name || "Member",
                memberId: m.memberId,
                photo: m.photoUrl,
                at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
                repeat: res.alreadyPresent,
            }, ...prev].slice(0, 50));
            say(res.alreadyPresent ? "repeat" : "ok",
                res.alreadyPresent ? `${m.name} was already marked present` : `${m.name} marked present`);
        } catch (e: any) {
            say("err", e?.message || "Could not mark present.");
        } finally {
            setBusy(false);
        }
    };

    const fresh = rows.filter(r => !r.repeat).length;

    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Check In</div>
                <div style={{ fontSize: 13, opacity: .8 }}>{club?.name} · {todayLocal()}</div>
                <span style={{ marginLeft: "auto", background: "#c9a45c", borderRadius: 999, padding: "6px 14px", fontWeight: 900, fontSize: 14 }}>
                    {fresh} today
                </span>
            </div>

            <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
                <div style={{
                    borderRadius: 16, padding: "18px 16px", textAlign: "center", marginBottom: 16,
                    border: `2px ${flash ? "solid" : "dashed"} ${
                        flash?.kind === "ok" ? "#54b5a8" : flash?.kind === "repeat" ? "#e0a94a" : flash?.kind === "err" ? "#f0776b" : "#25302d"}`,
                    background: flash?.kind === "ok" ? "#0f2825" : flash?.kind === "repeat" ? "#241c0c" : flash?.kind === "err" ? "#2b1512" : "#151d1b",
                }}>
                    <div style={{ fontSize: 30 }}>{flash ? (flash.kind === "ok" ? "✅" : flash.kind === "repeat" ? "↺" : "⚠️") : "🎴"}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>
                        {flash ? flash.text : busy ? "Working…" : "Scan a card, or search below"}
                    </div>
                </div>

                <MemberPicker onPick={check} />

                {rows.length > 0 && (
                    <>
                        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase", color: "#6f7e79", margin: "22px 0 8px" }}>
                            Checked in
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                            {rows.map(r => (
                                <div key={r.key} style={{
                                    display: "flex", alignItems: "center", gap: 12, background: "#151d1b",
                                    border: `1px solid ${r.repeat ? "#5c4a1e" : "#25302d"}`, borderRadius: 12, padding: "10px 12px",
                                }}>
                                    {r.photo ? (
                                        <img src={r.photo} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#0f2825", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#54b5a8" }}>
                                            {r.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, fontSize: 15 }}>{r.name}</div>
                                        <div style={{ fontSize: 12, color: "#6f7e79" }}>{r.memberId} · {r.at}{r.repeat && " · already present"}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
