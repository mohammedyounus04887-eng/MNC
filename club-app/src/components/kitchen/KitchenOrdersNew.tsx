/**
 * Kitchen orders — rebuilt.
 *
 * The kitchen is read from across the room by someone with wet hands, so this
 * is the opposite of a dashboard: very large type, one card per shake, and a
 * single button. Nothing to learn, no status vocabulary, no menus.
 *
 * Runs only when the club's Kitchen surface is switched to "new"; the existing
 * screen is still there and one flip away. Everything else in the kitchen tabs
 * (specials, stock, schedule) is unchanged and still reachable.
 */

import { useMemo, useState } from "react";
import type { Order } from "@/types/firestore";
import { useUpdateOrderStatus } from "@/hooks/useOrders";
import { T } from "@/styles/theme";

// Muted flavour tints that sit inside the ivory/teal palette rather than
// fighting it — enough to tell two shakes apart at a glance, no more.
const FLAVOUR_TONE: { match: string; bg: string; ink: string }[] = [
    { match: "mango", bg: "#f7ecd6", ink: "#7d5a12" },
    { match: "choco", bg: "#ece0d6", ink: "#5f3f28" },
    { match: "berry", bg: "#f2dfe2", ink: "#7d3040" },
    { match: "orange", bg: "#f7e6d4", ink: "#7d4a16" },
    { match: "vanilla", bg: "#f4eede", ink: "#6f5f22" },
    { match: "caramel", bg: "#f1e3cd", ink: "#6f4a18" },
];
const toneFor = (name: string) => {
    const n = (name || "").toLowerCase();
    return FLAVOUR_TONE.find(t => n.includes(t.match)) ?? { bg: T.tealSoft, ink: T.tealDeep };
};

const isGuest = (o: any) =>
    o?.memberId === "guest" || o?.source === "guest" || o?.orderedFrom === "guest";

const isFirstDay = (o: any) =>
    (o?.items || []).some((i: any) =>
        i?.productId === "first_day_shake" ||
        (i?.productName || i?.itemName || "").toLowerCase().includes("first day"));

const itemName = (o: any) =>
    (o.items || []).map((i: any) => i.productName || i.itemName || "Shake").join(" + ") || "Shake";

const totalQty = (o: any) =>
    (o.items || []).reduce((s: number, i: any) => s + (Number(i.quantity ?? i.qty) || 1), 0);

const waitedMins = (o: any): number | null => {
    try {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
        if (!d) return null;
        return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    } catch {
        return null;
    }
};

export default function KitchenOrdersNew({
    orders, loading, clubId,
}: { orders: Order[]; loading: boolean; clubId: string }) {
    const updateStatus = useUpdateOrderStatus();
    const [working, setWorking] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    const pending = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (orders as any[])
            .filter(o => o.status === "pending" || o.status === "preparing")
            .filter(o => {
                if (!q) return true;
                return [o.memberName, o.tokenNumber, itemName(o), (o as any).memberPhone]
                    .filter(Boolean).join(" ").toLowerCase().includes(q);
            })
            // Guests and first-day visitors first — they are standing at the
            // counter with nothing, and they are the club's first impression.
            .sort((a, b) => {
                const rank = (o: any) => (isFirstDay(o) ? 0 : isGuest(o) ? 1 : 2);
                const r = rank(a) - rank(b);
                if (r !== 0) return r;
                const at = a.createdAt?.toMillis?.() ?? 0;
                const bt = b.createdAt?.toMillis?.() ?? 0;
                return at - bt;
            });
    }, [orders, search]);

    const servedToday = (orders as any[]).filter(o => o.status === "served").length;

    const serve = async (o: any) => {
        setWorking(o.id);
        try {
            await updateStatus.mutateAsync({ clubId, orderId: o.id, newStatus: "served" });
        } catch {
            /* the list is live — a failed serve simply stays on screen */
        } finally {
            setWorking(null);
        }
    };

    return (
        <div style={{ padding: 16 }}>
            {/* counters */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                <div style={{ background: T.brassSoft, color: T.brass, borderRadius: 14, padding: "10px 18px", fontWeight: 800, fontSize: 22, fontFamily: T.serif }}>
                    {pending.length} to make
                </div>
                <div style={{ background: T.tealSoft, color: T.tealDeep, borderRadius: 14, padding: "10px 18px", fontWeight: 800, fontSize: 22, fontFamily: T.serif }}>
                    {servedToday} served
                </div>
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name or token…"
                    style={{
                        marginLeft: "auto", minWidth: 220, flex: "0 1 320px",
                        padding: "12px 16px", borderRadius: 12, border: `2px solid ${T.rule}`,
                        fontSize: 17, fontFamily: "inherit", outline: "none",
                    }}
                />
            </div>

            {loading ? (
                <div style={{ padding: 60, textAlign: "center", color: T.ink3, fontSize: 20, fontWeight: 700 }}>
                    Loading…
                </div>
            ) : pending.length === 0 ? (
                <div style={{ padding: 70, textAlign: "center" }}>
                    <div style={{ fontSize: 64 }}>✅</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>All caught up</div>
                    <div style={{ fontSize: 18, color: T.ink3, marginTop: 4 }}>
                        {search ? `Nothing matches “${search}”` : "No shakes waiting"}
                    </div>
                </div>
            ) : (
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}>
                    {pending.map((o: any) => {
                        const name = itemName(o);
                        const tone = toneFor(name);
                        const qty = totalQty(o);
                        const mins = waitedMins(o);
                        const guest = isGuest(o) || isFirstDay(o);
                        const busy = working === o.id;
                        return (
                            <div
                                key={o.id}
                                style={{
                                    background: T.card, borderRadius: 18, overflow: "hidden",
                                    border: `3px solid ${guest ? T.brass : T.rule}`,
                                    display: "flex", flexDirection: "column",
                                    boxShadow: T.shadow,
                                }}
                            >
                                {guest && (
                                    <div style={{ background: T.brass, color: T.onTeal, fontWeight: 900, fontSize: 14, letterSpacing: 1, padding: "5px 12px", textTransform: "uppercase" }}>
                                        {isFirstDay(o) ? "☀ First day — free" : "Guest"}
                                    </div>
                                )}

                                <div style={{ padding: "14px 16px 0", display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{ fontSize: 30, fontWeight: 900, color: T.brass, letterSpacing: -1 }}>
                                        #{o.tokenNumber ?? "—"}
                                    </div>
                                    {mins != null && (
                                        <div style={{
                                            marginLeft: "auto", fontSize: 15, fontWeight: 800,
                                            color: mins >= 10 ? T.bad : T.ink3,
                                        }}>
                                            {mins}m
                                        </div>
                                    )}
                                </div>

                                <div style={{ padding: "6px 16px 0", display: "flex", alignItems: "center", gap: 10 }}>
                                    {o.memberPhoto ? (
                                        <img src={o.memberPhoto} alt="" style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={{ width: 42, height: 42, borderRadius: "50%", background: T.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: T.teal, fontSize: 18 }}>
                                            {(o.memberName || "?").charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, lineHeight: 1.15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {o.memberName || "Walk-in"}
                                    </div>
                                </div>

                                <div style={{ margin: "12px 12px 0", background: tone.bg, color: tone.ink, borderRadius: 14, padding: "16px 14px", textAlign: "center" }}>
                                    <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, letterSpacing: -0.5 }}>{name}</div>
                                    {qty > 1 && <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4 }}>× {qty}</div>}
                                </div>

                                <button
                                    onClick={() => serve(o)}
                                    disabled={busy}
                                    style={{
                                        margin: 12, marginTop: 14, padding: "18px 12px",
                                        background: busy ? "#3d7a71" : T.teal, color: T.onTeal,
                                        border: "none", borderRadius: 14, fontSize: 20, fontWeight: 900,
                                        cursor: busy ? "default" : "pointer", fontFamily: "inherit",
                                    }}
                                >
                                    {busy ? "Serving…" : "Mark as Served"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
