/**
 * Sell Product — rebuilt.
 *
 * Pick the item, say how many, say how they paid. The buyer is optional,
 * because plenty of sales are to people walking past.
 *
 * Goes through lib/sellProduct, so the money, the sale record and the stock all
 * move together — reception's old cart wrote only the money, so items sold at
 * the desk never left inventory and never showed under "products sold".
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import MemberPicker, { type PickedMember } from "@/components/reception/MemberPicker";
import { sellProduct } from "@/lib/sellProduct";
import type { PayMethod } from "@/lib/recordPayment";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

export default function SellProductPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [items, setItems] = useState<any[]>([]);
    const [q, setQ] = useState("");
    const [picked, setPicked] = useState<any | null>(null);
    const [qty, setQty] = useState(1);
    const [method, setMethod] = useState<PayMethod>("cash");
    const [buyer, setBuyer] = useState<PickedMember | null>(null);
    const [showBuyer, setShowBuyer] = useState(false);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ name: string; total: number; left: number | null } | null>(null);
    const [err, setErr] = useState("");

    // StationAccess authenticates and authorizes this route before mounting.

    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            collection(db, "clubs", clubId, "inventory"),
            s => setItems(
                s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter((p: any) => !p.deleted)
                    .sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
            ),
            e => setErr(e.message),
        );
    }, [clubId]);

    const shown = useMemo(() => {
        const t = q.trim().toLowerCase();
        return t ? items.filter(i => String(i.name ?? "").toLowerCase().includes(t)) : items;
    }, [items, q]);

    const unitPrice = Number(picked?.sellPrice ?? picked?.price ?? 0) || 0;
    const total = unitPrice * qty;

    const collect = async () => {
        if (!clubId || !picked || busy) return;
        setBusy(true); setErr("");
        try {
            const res = await sellProduct({
                clubId,
                product: { id: picked.id, name: picked.name, unit: picked.unit, price: unitPrice },
                quantity: qty,
                unitPrice,
                method,
                buyer: buyer ? { id: buyer.id, name: buyer.name, memberId: buyer.memberId } : null,
            });
            setDone({ name: picked.name, total: res.total, left: res.stockLeft });
            setPicked(null); setQty(1); setBuyer(null); setShowBuyer(false); setMethod("cash"); setQ("");
        } catch (e: any) {
            setErr(e?.message || "Could not complete the sale. Nothing was charged — try again.");
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <Shell club={club?.name}>
                <div style={{ background: "#0f2825", border: "2px solid #54b5a8", borderRadius: 18, padding: 28, textAlign: "center" }}>
                    <div style={{ fontSize: 52 }}>✅</div>
                    <div style={{ fontSize: 23, fontWeight: 900, marginTop: 6 }}>{done.name} sold</div>
                    <div style={{ fontSize: 16, color: "#a2b0ab", marginTop: 6 }}>
                        {rs(done.total)} collected{done.left != null && <> · {done.left} left in stock</>}
                    </div>
                    <button onClick={() => setDone(null)} style={btnPrimary}>Sell something else</button>
                </div>
            </Shell>
        );
    }

    return (
        <Shell club={club?.name}>
            {err && <Err>{err}</Err>}

            {!picked ? (
                <>
                    <input
                        autoFocus value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Search products…"
                        style={inputStyle}
                    />
                    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                        {shown.map(p => {
                            const stock = Number(p.quantity);
                            const out = Number.isFinite(stock) && stock <= 0;
                            return (
                                <button
                                    key={p.id}
                                    disabled={out}
                                    onClick={() => { setPicked(p); setQty(1); }}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                        background: "#151d1b", border: "1px solid #25302d", borderRadius: 13,
                                        padding: "13px 15px", cursor: out ? "not-allowed" : "pointer",
                                        opacity: out ? .45 : 1, fontFamily: "inherit",
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 900, fontSize: 16 }}>{p.name}</div>
                                        <div style={{ fontSize: 12.5, color: "#6f7e79" }}>
                                            {Number.isFinite(stock) ? (out ? "Out of stock" : `${stock} in stock`) : "Stock not tracked"}
                                            {p.unit ? ` · ${p.unit}` : ""}
                                        </div>
                                    </div>
                                    <div style={{ marginLeft: "auto", fontWeight: 900, fontSize: 18 }}>
                                        {rs(Number(p.sellPrice ?? p.price ?? 0))}
                                    </div>
                                </button>
                            );
                        })}
                        {shown.length === 0 && <div style={{ color: "#6f7e79", fontSize: 14 }}>Nothing matches.</div>}
                    </div>
                </>
            ) : (
                <>
                    <div style={{ background: "#151d1b", border: "2px solid #54b5a8", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                        <div>
                            <div style={{ fontWeight: 900, fontSize: 17 }}>{picked.name}</div>
                            <div style={{ fontSize: 13, color: "#6f7e79" }}>{rs(unitPrice)} each</div>
                        </div>
                        <button onClick={() => setPicked(null)} style={{ ...btnGhost, marginLeft: "auto" }}>Change</button>
                    </div>

                    <Label>How many?</Label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <button onClick={() => setQty(n => Math.max(1, n - 1))} style={stepBtn}>−</button>
                        <div style={{ fontSize: 30, fontWeight: 900, minWidth: 54, textAlign: "center" }}>{qty}</div>
                        <button onClick={() => setQty(n => n + 1)} style={stepBtn}>+</button>
                        <div style={{ marginLeft: "auto", fontSize: 24, fontWeight: 900 }}>{rs(total)}</div>
                    </div>

                    <Label>Who is buying? <span style={{ fontWeight: 600, color: "#6f7e79" }}>(optional)</span></Label>
                    {buyer ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#151d1b", border: "1px solid #25302d", borderRadius: 12, padding: "11px 13px" }}>
                            <div style={{ fontWeight: 800 }}>{buyer.name}</div>
                            <div style={{ fontSize: 12.5, color: "#6f7e79" }}>{buyer.memberId}</div>
                            <button onClick={() => setBuyer(null)} style={{ ...btnGhost, marginLeft: "auto" }}>Remove</button>
                        </div>
                    ) : showBuyer ? (
                        <MemberPicker onPick={m => { setBuyer(m); setShowBuyer(false); }} placeholder="Scan a card or search…" />
                    ) : (
                        <button onClick={() => setShowBuyer(true)} style={{ ...btnGhost, padding: "12px 16px" }}>
                            + Link to a member
                        </button>
                    )}

                    <Label>How did they pay?</Label>
                    <div style={{ display: "flex", gap: 8 }}>
                        {(["cash", "upi"] as PayMethod[]).map(m => (
                            <button key={m} onClick={() => setMethod(m)} style={{
                                flex: 1, padding: 16, borderRadius: 13, cursor: "pointer", fontFamily: "inherit",
                                border: `2px solid ${method === m ? "#54b5a8" : "#25302d"}`,
                                background: method === m ? "#0f2825" : "#151d1b",
                                fontSize: 16, fontWeight: 900, textTransform: "uppercase",
                            }}>
                                {m === "cash" ? "💵 Cash" : "📱 UPI"}
                            </button>
                        ))}
                    </div>

                    <button onClick={collect} disabled={busy} style={{ ...btnPrimary, opacity: busy ? .6 : 1 }}>
                        {busy ? "Saving…" : `Collect ${rs(total)}`}
                    </button>
                    <div style={{ fontSize: 12.5, color: "#6f7e79", textAlign: "center", marginTop: 8 }}>
                        Records the sale and takes {qty} off the shelf.
                    </div>
                </>
            )}
        </Shell>
    );
}

function Shell({ club, children }: { club?: string; children: React.ReactNode }) {
    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Sell Product</div>
                <div style={{ fontSize: 13, opacity: .8 }}>{club}</div>
            </div>
            <div style={{ padding: 18, maxWidth: 620, margin: "0 auto" }}>{children}</div>
        </div>
    );
}
const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#6f7e79", margin: "20px 0 9px" }}>{children}</div>
);
const Err = ({ children }: { children: React.ReactNode }) => (
    <div style={{ background: "#2b1512", border: "1px solid #5c2a24", color: "#f0776b", borderRadius: 12, padding: "12px 14px", fontWeight: 800, marginBottom: 14 }}>{children}</div>
);
const inputStyle: React.CSSProperties = { width: "100%", padding: "15px 18px", borderRadius: 13, border: "2px solid #25302d", fontSize: 17, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { width: "100%", marginTop: 18, padding: 18, border: "none", borderRadius: 14, background: "#54b5a8", color: "#151d1b", fontSize: 18, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "8px 14px", border: "1.5px solid #25302d", background: "#151d1b", borderRadius: 10, fontSize: 13, fontWeight: 800, color: "#a2b0ab", cursor: "pointer", fontFamily: "inherit" };
const stepBtn: React.CSSProperties = { width: 52, height: 52, borderRadius: 13, border: "1.5px solid #25302d", background: "#151d1b", fontSize: 26, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", color: "#54b5a8" };
