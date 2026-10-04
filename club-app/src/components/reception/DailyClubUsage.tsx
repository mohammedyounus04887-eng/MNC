/**
 * Daily Club Usage — Reception → Settings.
 *
 * Lets the inventory manager record today's product usage WITHOUT going into
 * the Admin Dashboard. Uses the same recorder as Admin Inventory
 * (useRecordClubUsage → club_usage stock movement), so entries flow straight
 * into Inventory History, and the Product Usage Breakdown that now appears in
 * Today's Report / the printed receipt / saved reports.
 *
 * Shows: shakes served today (cross-check) + today's recorded product usage +
 * the product list with a Use → quantity action.
 */

import { useState } from "react";
import { useSimpleProducts, useRecordClubUsage } from "@/hooks/useSimpleInventory";
import { useTodayShakes } from "@/hooks/owner/useTodayShakes";
import { useTodayProductUsage } from "@/hooks/owner/useTodayProductUsage";

const FONT = "Nunito, sans-serif";
const GREEN = "#2d9653";

export default function DailyClubUsage({ clubId, onClose }: { clubId: string; onClose: () => void }) {
    const { data: products = [], isLoading } = useSimpleProducts(clubId);
    const record = useRecordClubUsage();
    const todayShakes = useTodayShakes(clubId);
    const { usage: todayUsage } = useTodayProductUsage(clubId);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [qty, setQty] = useState("");
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const active = products.find((p: any) => p.id === activeId) || null;

    const confirm = async () => {
        if (!active) return;
        const n = parseInt(qty, 10);
        if (!Number.isFinite(n) || n <= 0) { setMsg({ kind: "err", text: "Enter a quantity greater than zero" }); return; }
        if (n > active.currentStock) { setMsg({ kind: "err", text: `Only ${active.currentStock} box${active.currentStock === 1 ? "" : "es"} available` }); return; }
        try {
            await record.mutateAsync({ clubId, product: { id: active.id, name: active.name, flavor: active.flavor, size: active.size }, quantity: n });
            setMsg({ kind: "ok", text: `−${n} ${active.name} recorded` });
            setActiveId(null); setQty("");
        } catch (e: any) {
            setMsg({ kind: "err", text: e?.message || "Could not record usage" });
        }
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "#f8fafc", fontFamily: FONT, zIndex: 1000, overflowY: "auto" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 5, background: "white", borderBottom: "1px solid #e5e7eb", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 14, fontWeight: 800, color: "#475569", cursor: "pointer", fontFamily: FONT, padding: "6px 10px" }}>← Back</button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#1a3a2a" }}>📦 Daily Club Usage</div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>Record today's product usage — flows into Today's Report &amp; Inventory History</div>
                </div>
            </div>

            <div style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
                {/* Shakes served today */}
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d" }}>🥤 Shakes served today</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#15803d" }}>{todayShakes.loading ? "…" : todayShakes.total}</div>
                    </div>
                    {!todayShakes.loading && todayShakes.byShake.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {todayShakes.byShake.map(sh => (
                                <span key={sh.name} style={{ fontSize: 11, fontWeight: 700, color: "#166534", background: "white", border: "1px solid #bbf7d0", padding: "3px 9px", borderRadius: 100 }}>{sh.name} × {sh.qty}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Today's recorded product usage */}
                {todayUsage.length > 0 && (
                    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Recorded today</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {todayUsage.map(u => (
                                <span key={u.name} style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", background: "#eef2ff", border: "1px solid #c7d2fe", padding: "3px 10px", borderRadius: 100 }}>{u.name} × {u.qty}</span>
                            ))}
                        </div>
                    </div>
                )}

                {msg && (
                    <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "white", background: msg.kind === "ok" ? GREEN : "#dc2626" }}>{msg.text}</div>
                )}

                {/* Product list */}
                <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280", marginBottom: 8 }}>Tap a product to record usage</div>
                {isLoading && <div style={{ color: "#9ca3af", padding: 16, textAlign: "center" }}>Loading…</div>}
                <div style={{ display: "grid", gap: 8 }}>
                    {products.map((p: any) => (
                        <div key={p.id} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1a3a2a" }}>{p.name}</div>
                                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{[p.flavor, p.size].filter(Boolean).join(" · ") || "—"} · <b style={{ color: p.currentStock <= 0 ? "#dc2626" : "#16a34a" }}>{p.currentStock} box{p.currentStock === 1 ? "" : "es"}</b></div>
                                </div>
                                {activeId === p.id ? null : (
                                    <button onClick={() => { setActiveId(p.id); setQty(""); setMsg(null); }} disabled={p.currentStock <= 0}
                                        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: p.currentStock <= 0 ? "#cbd5e1" : "#0f172a", color: "white", fontSize: 13, fontWeight: 800, cursor: p.currentStock <= 0 ? "not-allowed" : "pointer", fontFamily: FONT }}>Use</button>
                                )}
                            </div>
                            {activeId === p.id && (
                                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                                    <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty used" autoFocus min={1} max={p.currentStock}
                                        style={{ flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }} />
                                    <button onClick={confirm} disabled={record.isPending} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: GREEN, color: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>{record.isPending ? "Saving…" : "Save"}</button>
                                    <button onClick={() => { setActiveId(null); setQty(""); }} style={{ padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "white", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
                                </div>
                            )}
                        </div>
                    ))}
                    {!isLoading && products.length === 0 && (
                        <div style={{ background: "white", borderRadius: 12, padding: 24, textAlign: "center", color: "#9ca3af", fontWeight: 700 }}>No products yet. Add them in Admin → Inventory.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
