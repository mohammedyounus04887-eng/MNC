/**
 * New Customer Gift Card Checklist — Reception → Settings.
 *
 * Groups "First Day" guest entries by the member who invited them
 * (guestEntry.invitedBy.memberId), so reception can see, per referrer:
 *   - referrer photo + name
 *   - how many gift cards they've earned (= distinct new customers brought)
 *   - the list of referred customers, each with a "Gift card given" toggle
 *
 * Pure accountability — toggling only records giftCardGiven on the guest
 * entry; it does NOT credit coins or wallets.
 *
 * invitedBy.memberId may be the human code ("MNC-001") OR the Firestore doc
 * id, so we resolve referrers against BOTH keys (mirrors useInvitedGuests).
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const FONT = "Nunito, sans-serif";
const GREEN = "#2d9653";

export default function GiftCardChecklist({ clubId, members, onClose }: {
    clubId: string;
    members: any[];
    onClose: () => void;
}) {
    const [guests, setGuests] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(collection(db, `clubs/${clubId}/guestEntries`), snap => {
            setGuests(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((g: any) => g?.invitedBy?.memberId));
            setLoading(false);
        }, () => setLoading(false));
    }, [clubId]);

    // Resolve a referrer by either doc id or human member code.
    const memberByKey = useMemo(() => {
        const m = new Map<string, any>();
        for (const mem of members) { m.set(mem.id, mem); if (mem.memberId) m.set(mem.memberId, mem); }
        return m;
    }, [members]);

    const groups = useMemo(() => {
        const g = new Map<string, { key: string; ref: any; guests: any[] }>();
        for (const ge of guests) {
            const key = (ge as any).invitedBy.memberId;
            if (!g.has(key)) g.set(key, { key, ref: memberByKey.get(key) || null, guests: [] });
            g.get(key)!.guests.push(ge);
        }
        const arr = [...g.values()];
        for (const grp of arr) grp.guests.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        arr.sort((a, b) => b.guests.length - a.guests.length);
        return arr;
    }, [guests, memberByKey]);

    const filteredGroups = useMemo(() => {
        const t = search.trim().toLowerCase();
        if (!t) return groups;
        return groups.filter(grp => {
            const name = (grp.ref?.name || grp.guests[0]?.invitedBy?.name || "").toLowerCase();
            const phone = (grp.ref?.phone || "").toLowerCase();
            return name.includes(t) || phone.includes(t);
        });
    }, [groups, search]);

    const toggle = (ge: any) => {
        const next = !ge.giftCardGiven;
        updateDoc(doc(db, `clubs/${clubId}/guestEntries/${ge.id}`), {
            giftCardGiven: next,
            giftCardGivenAt: next ? serverTimestamp() : null,
            giftCardGivenBy: next ? "reception" : "",
        }).catch(() => { /* non-fatal */ });
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "#f8fafc", fontFamily: FONT, zIndex: 1000, overflowY: "auto" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 5, background: "white", borderBottom: "1px solid #e5e7eb", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 14, fontWeight: 800, color: "#475569", cursor: "pointer", fontFamily: FONT, padding: "6px 10px" }}>← Back</button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#1a3a2a" }}>🎁 New Customer Gift Card Checklist</div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>{groups.length} referrer{groups.length === 1 ? "" : "s"} · mark gift cards as given</div>
                </div>
            </div>

            <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search referrer by name or phone…"
                    style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, marginBottom: 14, boxSizing: "border-box" }}
                />

                {loading && <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>Loading…</div>}
                {!loading && filteredGroups.length === 0 && (
                    <div style={{ background: "white", borderRadius: 14, padding: 40, textAlign: "center", color: "#9ca3af", fontWeight: 700 }}>
                        No referred guests yet. When a member brings a friend for a First Day shake, they'll appear here.
                    </div>
                )}

                <div style={{ display: "grid", gap: 12 }}>
                    {filteredGroups.map(grp => {
                        const refName = grp.ref?.name || grp.guests[0]?.invitedBy?.name || "Unknown referrer";
                        const refPhone = grp.ref?.phone || grp.guests[0]?.invitedBy?.phone || "";
                        const refPhoto = grp.ref?.photoUrl || grp.ref?.photo || "";
                        const distinctCustomers = new Set(grp.guests.map((g: any) => g.guestPhone || g.guestName)).size;
                        const givenCount = grp.guests.filter((g: any) => g.giftCardGiven).length;
                        return (
                            <div key={grp.key} style={{ background: "white", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#f0fdf4", borderBottom: "1px solid #dcfce7" }}>
                                    {refPhoto
                                        ? <img src={refPhoto} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />
                                        : <div style={{ width: 44, height: 44, borderRadius: "50%", background: GREEN, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18 }}>{refName[0]?.toUpperCase() || "?"}</div>}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 15, fontWeight: 900, color: "#1a3a2a" }}>{refName}</div>
                                        <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{refPhone}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontSize: 22, fontWeight: 900, color: GREEN }}>{distinctCustomers}</div>
                                        <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700 }}>gift card{distinctCustomers === 1 ? "" : "s"} earned</div>
                                        <div style={{ fontSize: 10, color: givenCount === grp.guests.length ? GREEN : "#d97706", fontWeight: 800, marginTop: 2 }}>{givenCount}/{grp.guests.length} given</div>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gap: 4, padding: 8 }}>
                                    {grp.guests.map((ge: any) => (
                                        <div key={ge.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: ge.giftCardGiven ? "#f0fdf4" : "#f8fafc", border: `1px solid ${ge.giftCardGiven ? "#86efac" : "#e5e7eb"}`, borderRadius: 10 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a2a" }}>{ge.guestName || "Guest"}</div>
                                                <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>{ge.guestPhone || "—"} · {ge.date || ""}</div>
                                            </div>
                                            <button
                                                onClick={() => toggle(ge)}
                                                style={{
                                                    padding: "7px 14px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: FONT,
                                                    fontSize: 12, fontWeight: 800,
                                                    background: ge.giftCardGiven ? GREEN : "#e5e7eb",
                                                    color: ge.giftCardGiven ? "white" : "#475569",
                                                }}
                                            >
                                                {ge.giftCardGiven ? "✓ Given" : "Mark given"}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
