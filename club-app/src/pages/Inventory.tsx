/**
 * /inventory — standalone inventory management kiosk.
 *
 * Reachable at the top-level URL (mirroring /kitchen and /tv). No PIN
 * gate for now — owner said security comes later. Linked from the
 * landing-page nav-hub.
 *
 * Four tabs:
 *   📦 Stock        — current grid of items + low-stock alerts
 *   📥 Stock In     — restock existing OR add a new product
 *   📤 Stock Out    — today's usage / member given / recipient given /
 *                     manual adjustment
 *   🕓 History      — chronological event feed with filters
 *
 * Designed to be simple-to-use for an inventory manager who isn't an
 * admin — no jargon, no buried menus.
 */

import { useEffect, useMemo, useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    useInventoryItems, useInventoryEvents, useInventoryRecipients,
    createInventoryItem, updateInventoryItem, deleteInventoryItem,
    restockItems, recordStockOut,
    type InventoryItem, type EventSubtype,
} from "@/hooks/useInventoryV2";

const FONT = "'Nunito', sans-serif";
const fmtRs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const todayStr = () => new Date().toISOString().slice(0, 10);

type Tab = "stock" | "stockIn" | "stockOut" | "history";

export default function InventoryPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const [tab, setTab] = useState<Tab>("stock");
    const { items, loading: itemsLoading } = useInventoryItems(clubId);
    const { events, loading: eventsLoading } = useInventoryEvents(clubId, 300);
    const recipients = useInventoryRecipients(clubId);

    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const showToast = (kind: "ok" | "err", text: string) => {
        setToast({ kind, text });
        setTimeout(() => setToast(null), 4500);
    };

    if (!clubId) {
        return (
            <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#64748b" }}>
                No club detected for this domain.
            </div>
        );
    }

    const lowStockCount = items.filter(it => (it.lowStockThreshold ?? 0) > 0 && it.quantity <= (it.lowStockThreshold ?? 0)).length;

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>

                {/* ── Header ── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>📦 Inventory</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{club?.name} · {items.length} item{items.length !== 1 ? "s" : ""}{lowStockCount > 0 ? ` · ${lowStockCount} low-stock` : ""}</div>
                    </div>
                </div>

                {/* ── Tabs ── */}
                <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", marginBottom: 14, flexWrap: "wrap" }}>
                    {([
                        { id: "stock",    label: "📦 Stock" },
                        { id: "stockIn",  label: "📥 Stock In" },
                        { id: "stockOut", label: "📤 Stock Out" },
                        { id: "history",  label: "🕓 History" },
                    ] as Array<{ id: Tab; label: string }>).map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                padding: "8px 16px", border: "none",
                                background: tab === t.id ? "#0f172a" : "transparent",
                                color: tab === t.id ? "white" : "#64748b",
                                borderRadius: 6, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                            }}
                        >{t.label}</button>
                    ))}
                </div>

                {/* ── Tab content ── */}
                {tab === "stock" && <StockTab clubId={clubId} items={items} loading={itemsLoading} showToast={showToast} />}
                {tab === "stockIn" && <StockInTab clubId={clubId} items={items} showToast={showToast} />}
                {tab === "stockOut" && <StockOutTab clubId={clubId} items={items} recipients={recipients} showToast={showToast} />}
                {tab === "history" && <HistoryTab events={events} loading={eventsLoading} />}
            </div>

            {toast && (
                <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.kind === "ok" ? "#16a34a" : "#dc2626", color: "white", padding: "12px 22px", borderRadius: 10, fontSize: 13, fontWeight: 800, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT, maxWidth: "90vw" }}>
                    {toast.kind === "ok" ? "✓ " : "✗ "}{toast.text}
                </div>
            )}
        </div>
    );
}

// ═══ STOCK TAB ═════════════════════════════════════════════════════════════

function StockTab({ clubId, items, loading, showToast }: {
    clubId: string;
    items: InventoryItem[];
    loading: boolean;
    showToast: (kind: "ok" | "err", text: string) => void;
}) {
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<InventoryItem | null>(null);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter(it => !q ||
            (it.name || "").toLowerCase().includes(q) ||
            (it.category || "").toLowerCase().includes(q));
    }, [items, search]);

    const lowStock = items.filter(it => (it.lowStockThreshold ?? 0) > 0 && it.quantity <= (it.lowStockThreshold ?? 0));

    return (
        <div>
            {lowStock.length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#991b1b", marginBottom: 4 }}>⚠ Low stock — {lowStock.length} item{lowStock.length !== 1 ? "s" : ""}</div>
                    <div style={{ fontSize: 11, color: "#7f1d1d", fontWeight: 600 }}>
                        {lowStock.map(it => `${it.name} (${it.quantity})`).join(", ")}
                    </div>
                </div>
            )}

            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search item or category…"
                style={{ width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }} />

            {loading ? (
                <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading inventory…</div>
            ) : filtered.length === 0 ? (
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                    {items.length === 0
                        ? "No inventory yet — go to Stock In tab to add your first product."
                        : `No items match "${search}".`}
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                    {filtered.map(it => {
                        const isLow = (it.lowStockThreshold ?? 0) > 0 && it.quantity <= (it.lowStockThreshold ?? 0);
                        const isOut = it.quantity <= 0;
                        return (
                            <button key={it.id}
                                onClick={() => setEditing(it)}
                                style={{
                                    background: isOut ? "#fef2f2" : isLow ? "#fffbeb" : "white",
                                    border: `1.5px solid ${isOut ? "#fecaca" : isLow ? "#fde68a" : "#e2e8f0"}`,
                                    borderRadius: 12, padding: 14, cursor: "pointer", fontFamily: FONT,
                                    textAlign: "left",
                                }}>
                                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{it.name}</div>
                                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                                    {[it.category, it.size].filter(Boolean).join(" · ") || "—"}
                                </div>
                                <div style={{ fontSize: 28, fontWeight: 900, color: isOut ? "#dc2626" : isLow ? "#d97706" : "#16a34a", marginTop: 6 }}>
                                    {it.quantity}<span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 4 }}>{it.unit || "units"}</span>
                                </div>
                                {(it.lowStockThreshold ?? 0) > 0 && (
                                    <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                                        threshold: {it.lowStockThreshold}
                                    </div>
                                )}
                                {isOut && <div style={{ fontSize: 10, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>OUT OF STOCK</div>}
                                {!isOut && isLow && <div style={{ fontSize: 10, fontWeight: 800, color: "#d97706", marginTop: 4 }}>LOW STOCK</div>}
                            </button>
                        );
                    })}
                </div>
            )}

            {editing && (
                <EditItemDialog
                    clubId={clubId}
                    item={editing}
                    onClose={() => setEditing(null)}
                    onSaved={(text) => { setEditing(null); showToast("ok", text); }}
                    onError={(text) => showToast("err", text)}
                />
            )}
        </div>
    );
}

function EditItemDialog({ clubId, item, onClose, onSaved, onError }: {
    clubId: string; item: InventoryItem;
    onClose: () => void;
    onSaved: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [name, setName] = useState(item.name || "");
    const [category, setCategory] = useState(item.category || "");
    const [size, setSize] = useState(item.size || "");
    const [unit, setUnit] = useState(item.unit || "");
    const [threshold, setThreshold] = useState(String(item.lowStockThreshold ?? ""));
    const [price, setPrice] = useState(String(item.pricePerUnit ?? ""));
    const [notes, setNotes] = useState(item.notes || "");
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!name.trim()) { onError("Name is required"); return; }
        setSaving(true);
        const res = await updateInventoryItem(clubId, item.id, {
            name: name.trim(), category: category.trim() || undefined,
            size: size.trim() || undefined, unit: unit.trim() || undefined,
            lowStockThreshold: threshold ? Number(threshold) : undefined,
            pricePerUnit: price ? Number(price) : undefined,
            notes: notes.trim() || undefined,
        });
        setSaving(false);
        if (res.ok) onSaved("Item updated");
        else onError(res.errorMessage || "Save failed");
    };

    const remove = async () => {
        if (!confirm(`Remove ${item.name} from inventory? (history is kept)`)) return;
        setSaving(true);
        const res = await deleteInventoryItem(clubId, item.id);
        setSaving(false);
        if (res.ok) onSaved("Item removed");
        else onError(res.errorMessage || "Delete failed");
    };

    return (
        <ModalShell onClose={onClose}>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>✏ Edit item</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, fontWeight: 600 }}>
                Quantity: {item.quantity} {item.unit || "units"}. To adjust, use Stock In or Stock Out tabs.
            </div>
            <FieldRow>
                <Field label="Name *" value={name} onChange={setName} />
                <Field label="Category" value={category} onChange={setCategory} placeholder="Shake / Tea / Aloe / …" />
            </FieldRow>
            <FieldRow>
                <Field label="Size" value={size} onChange={setSize} placeholder="550g / 1L" />
                <Field label="Unit" value={unit} onChange={setUnit} placeholder="box / bottle / tin" />
            </FieldRow>
            <FieldRow>
                <Field label="Low-stock threshold" value={threshold} onChange={setThreshold} type="number" />
                <Field label="Price per unit (₹)" value={price} onChange={setPrice} type="number" />
            </FieldRow>
            <Field label="Notes" value={notes} onChange={setNotes} />

            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
                <button onClick={remove} disabled={saving} style={{ padding: "10px 16px", background: "white", border: "1.5px solid #fecaca", color: "#dc2626", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT }}>
                    🗑 Remove
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={onClose} disabled={saving} style={{ padding: "10px 16px", background: "white", border: "1.5px solid #e2e8f0", color: "#475569", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT }}>Cancel</button>
                    <button onClick={save} disabled={saving} style={{ padding: "10px 22px", background: saving ? "#cbd5e1" : "#16a34a", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 900, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT }}>
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ═══ STOCK IN TAB ═════════════════════════════════════════════════════════

function StockInTab({ clubId, items, showToast }: {
    clubId: string; items: InventoryItem[]; showToast: (kind: "ok" | "err", text: string) => void;
}) {
    const [mode, setMode] = useState<"restock" | "new">("restock");

    return (
        <div>
            {/* Mode switcher */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button onClick={() => setMode("restock")} style={{ flex: 1, padding: "14px 18px", background: mode === "restock" ? "linear-gradient(135deg,#16a34a,#15803d)" : "white", color: mode === "restock" ? "white" : "#475569", border: `2px solid ${mode === "restock" ? "#16a34a" : "#e2e8f0"}`, borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                    📦 Restock existing
                </button>
                <button onClick={() => setMode("new")} style={{ flex: 1, padding: "14px 18px", background: mode === "new" ? "linear-gradient(135deg,#0284c7,#0369a1)" : "white", color: mode === "new" ? "white" : "#475569", border: `2px solid ${mode === "new" ? "#0284c7" : "#e2e8f0"}`, borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                    ✨ Add new product
                </button>
            </div>

            {mode === "restock" ? <RestockForm clubId={clubId} items={items} showToast={showToast} /> : <NewProductForm clubId={clubId} showToast={showToast} />}
        </div>
    );
}

function RestockForm({ clubId, items, showToast }: {
    clubId: string; items: InventoryItem[]; showToast: (kind: "ok" | "err", text: string) => void;
}) {
    const [lines, setLines] = useState<Array<{ itemId: string; qty: string }>>([{ itemId: "", qty: "" }]);
    const [supplier, setSupplier] = useState("");
    const [invoiceNo, setInvoiceNo] = useState("");
    const [date, setDate] = useState(todayStr());
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        const validLines = lines
            .filter(l => l.itemId && Number(l.qty) > 0)
            .map(l => {
                const item = items.find(it => it.id === l.itemId);
                return { itemId: l.itemId, itemName: item?.name || "—", qty: Number(l.qty) };
            });
        if (validLines.length === 0) { showToast("err", "Add at least one item + qty"); return; }
        setSaving(true);
        const res = await restockItems(clubId, validLines, { supplier: supplier.trim() || undefined, invoiceNo: invoiceNo.trim() || undefined, notes: notes.trim() || undefined, date });
        setSaving(false);
        if (res.ok) {
            showToast("ok", `Restocked ${validLines.length} item${validLines.length !== 1 ? "s" : ""}`);
            setLines([{ itemId: "", qty: "" }]); setSupplier(""); setInvoiceNo(""); setNotes("");
        } else showToast("err", res.errorMessage || "Restock failed");
    };

    return (
        <CardBox title="Add stock to existing items">
            {lines.map((ln, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 36px", gap: 8, marginBottom: 8 }}>
                    <select value={ln.itemId} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}
                        style={{ padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT }}>
                        <option value="">Choose item…</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.name}{it.size ? ` · ${it.size}` : ""} (now: {it.quantity})</option>)}
                    </select>
                    <input type="number" placeholder="Qty" value={ln.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                        style={{ padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                    <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}
                        style={{ background: lines.length === 1 ? "#f1f5f9" : "white", border: "1.5px solid #fecaca", color: lines.length === 1 ? "#cbd5e1" : "#dc2626", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: lines.length === 1 ? "not-allowed" : "pointer", fontFamily: FONT }}>✕</button>
                </div>
            ))}
            <button onClick={() => setLines(ls => [...ls, { itemId: "", qty: "" }])}
                style={{ padding: "8px 14px", background: "white", border: "1.5px dashed #cbd5e1", color: "#475569", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT, marginBottom: 14 }}>
                + Add another line
            </button>

            <FieldRow>
                <Field label="Supplier" value={supplier} onChange={setSupplier} placeholder="e.g. Herbalife Distributor" />
                <Field label="Invoice #" value={invoiceNo} onChange={setInvoiceNo} placeholder="optional" />
            </FieldRow>
            <FieldRow>
                <Field label="Date" value={date} onChange={setDate} type="date" />
                <Field label="Notes" value={notes} onChange={setNotes} placeholder="optional" />
            </FieldRow>

            <button onClick={submit} disabled={saving}
                style={{ width: "100%", padding: 14, background: saving ? "#cbd5e1" : "linear-gradient(135deg,#16a34a,#15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 900, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT, marginTop: 8 }}>
                {saving ? "Saving…" : "📦 Save restock"}
            </button>
        </CardBox>
    );
}

function NewProductForm({ clubId, showToast }: {
    clubId: string; showToast: (kind: "ok" | "err", text: string) => void;
}) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState("");
    const [size, setSize] = useState("");
    const [unit, setUnit] = useState("");
    const [quantity, setQuantity] = useState("");
    const [threshold, setThreshold] = useState("");
    const [price, setPrice] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!name.trim()) { showToast("err", "Product name required"); return; }
        setSaving(true);
        const res = await createInventoryItem(clubId, {
            name: name.trim(), category: category.trim() || undefined,
            size: size.trim() || undefined, unit: unit.trim() || undefined,
            quantity: Number(quantity) || 0,
            lowStockThreshold: threshold ? Number(threshold) : undefined,
            pricePerUnit: price ? Number(price) : undefined,
        });
        setSaving(false);
        if (res.ok) {
            showToast("ok", `Added "${name}"`);
            setName(""); setCategory(""); setSize(""); setUnit(""); setQuantity(""); setThreshold(""); setPrice("");
        } else showToast("err", res.errorMessage || "Failed to add");
    };

    return (
        <CardBox title="New product line">
            <FieldRow>
                <Field label="Product name *" value={name} onChange={setName} placeholder="e.g. Formula 1 Mango" />
                <Field label="Category" value={category} onChange={setCategory} placeholder="Shake / Tea / Aloe / Tea Cream / …" />
            </FieldRow>
            <FieldRow>
                <Field label="Size" value={size} onChange={setSize} placeholder="550g · 1L · etc." />
                <Field label="Unit" value={unit} onChange={setUnit} placeholder="box · bottle · tin" />
            </FieldRow>
            <FieldRow>
                <Field label="Initial quantity" value={quantity} onChange={setQuantity} type="number" placeholder="how many you have right now" />
                <Field label="Low-stock threshold" value={threshold} onChange={setThreshold} type="number" placeholder="optional · alerts when ≤ this" />
            </FieldRow>
            <Field label="Price per unit (₹)" value={price} onChange={setPrice} type="number" placeholder="optional · for valuation" />

            <button onClick={submit} disabled={saving}
                style={{ width: "100%", padding: 14, background: saving ? "#cbd5e1" : "linear-gradient(135deg,#0284c7,#0369a1)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 900, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT, marginTop: 12 }}>
                {saving ? "Adding…" : "✨ Add product"}
            </button>
        </CardBox>
    );
}

// ═══ STOCK OUT TAB ════════════════════════════════════════════════════════

function StockOutTab({ clubId, items, recipients, showToast }: {
    clubId: string;
    items: InventoryItem[];
    recipients: any[];
    showToast: (kind: "ok" | "err", text: string) => void;
}) {
    const [subtype, setSubtype] = useState<"today_usage" | "member_given" | "recipient_given" | "virtual_collection" | "adjustment">("today_usage");
    const [lines, setLines] = useState<Array<{ itemId: string; qty: string }>>([{ itemId: "", qty: "" }]);
    const [date, setDate] = useState(todayStr());
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    // Recipient state — member or named
    const [members, setMembers] = useState<any[]>([]);
    const [memberSearch, setMemberSearch] = useState("");
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [recipientName, setRecipientName] = useState("");

    // Virtual member state (for the new "virtual_collection" subtype)
    const [virtualMembers, setVirtualMembers] = useState<any[]>([]);
    const [virtualSearch, setVirtualSearch] = useState("");
    const [selectedVirtualId, setSelectedVirtualId] = useState<string | null>(null);

    useEffect(() => {
        if (subtype !== "member_given") return;
        // One-shot load — owner can search any member
        (async () => {
            try {
                const snap = await getDocs(query(collection(db, `clubs/${clubId}/members`)));
                setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch {}
        })();
    }, [clubId, subtype]);

    useEffect(() => {
        if (subtype !== "virtual_collection") return;
        // Load virtual members and filter to those with an active membership
        // (renewal payment recorded → membershipEnd in the future). Reception
        // is the source of truth for these docs.
        (async () => {
            try {
                const snap = await getDocs(query(collection(db, `clubs/${clubId}/virtualMembers`)));
                const all = snap.docs.map(d => ({ id: d.id, ...d.data() }) as any);
                setVirtualMembers(all);
            } catch (e) { console.error("[stockOut] load virtual members", e); }
        })();
    }, [clubId, subtype]);

    const filteredMembers = useMemo(() => {
        const q = memberSearch.trim().toLowerCase();
        if (!q) return members.slice(0, 30);
        return members.filter(m =>
            (m.name || "").toLowerCase().includes(q) ||
            (m.phone || "").includes(q) ||
            (m.memberId || "").toString().includes(q)
        ).slice(0, 30);
    }, [members, memberSearch]);

    const filteredRecipients = useMemo(() => {
        const q = recipientName.trim().toLowerCase();
        if (!q) return recipients.slice(0, 8);
        return recipients.filter(r => (r.name || "").toLowerCase().includes(q)).slice(0, 8);
    }, [recipients, recipientName]);

    const subtypeMeta: Record<string, { label: string; emoji: string; bg: string; color: string }> = {
        today_usage:        { label: "Today's usage",            emoji: "🥤", bg: "#fef3c7", color: "#92400e" },
        member_given:       { label: "Given to member",          emoji: "👤", bg: "#dbeafe", color: "#1e40af" },
        recipient_given:    { label: "Given to recipient",       emoji: "🤝", bg: "#ede9fe", color: "#6d28d9" },
        virtual_collection: { label: "Virtual member collection", emoji: "💳", bg: "#f3e8ff", color: "#7c3aed" },
        adjustment:         { label: "Adjustment",               emoji: "🔧", bg: "#f1f5f9", color: "#475569" },
    };

    const submit = async () => {
        const validLines = lines
            .filter(l => l.itemId && Number(l.qty) > 0)
            .map(l => {
                const item = items.find(it => it.id === l.itemId);
                return { itemId: l.itemId, itemName: item?.name || "—", qty: Number(l.qty), unit: item?.unit };
            });
        if (validLines.length === 0) { showToast("err", "Add at least one item + qty"); return; }

        let recipient: { kind: "member" | "named" | "virtual"; id?: string; name: string; phone?: string } | null = null;
        let virtualMemberDoc: any = null;
        if (subtype === "member_given") {
            if (!selectedMemberId) { showToast("err", "Pick a member"); return; }
            const m = members.find(x => x.id === selectedMemberId);
            recipient = { kind: "member", id: selectedMemberId, name: m?.name || "—", phone: m?.phone };
        } else if (subtype === "recipient_given") {
            if (!recipientName.trim()) { showToast("err", "Recipient name required"); return; }
            recipient = { kind: "named", name: recipientName.trim() };
        } else if (subtype === "virtual_collection") {
            if (!selectedVirtualId) { showToast("err", "Pick a virtual member"); return; }
            virtualMemberDoc = virtualMembers.find(x => x.id === selectedVirtualId);
            if (!virtualMemberDoc) { showToast("err", "Virtual member not found"); return; }
            recipient = { kind: "virtual", id: selectedVirtualId, name: virtualMemberDoc.name || "—", phone: virtualMemberDoc.phone };
        }

        setSaving(true);
        const res = await recordStockOut(
            clubId,
            validLines.map(l => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty })),
            subtype,
            recipient,
            { notes: notes.trim() || undefined, date },
        );
        setSaving(false);
        if (!res.ok) { showToast("err", res.errorMessage || "Save failed"); return; }

        showToast("ok", `${subtypeMeta[subtype].label} recorded`);

        // Print prompt — for any subtype that's not today_usage / adjustment
        // (i.e. anything that physically leaves the club with a person).
        const shouldOfferPrint = subtype === "member_given" || subtype === "recipient_given" || subtype === "virtual_collection";
        if (shouldOfferPrint && window.confirm("Stock-out saved. Print receipt now?")) {
            try {
                const { buildStockOutReceipt } = await import("@/utils/receiptBuilder");
                const { printViaRawBT } = await import("@/utils/printReceipt");
                const clubSnap = await getDocs(query(collection(db, "clubs"), where("__name__", "==", clubId)));
                const club = clubSnap.docs[0]?.data() as any;
                const ts = new Date();
                const receiptNumber = `SO-${ts.getTime().toString(36).toUpperCase().slice(-6)}`;
                const renewalDate = virtualMemberDoc?.membershipStart?.toDate
                    ? virtualMemberDoc.membershipStart.toDate()
                    : virtualMemberDoc?.lastRenewalAt?.toDate?.();
                const expiryDate = virtualMemberDoc?.membershipEnd?.toDate?.();
                const collectionDate = virtualMemberDoc?.collectionDate?.toDate?.();
                const titleMap: Record<string, string> = {
                    member_given: "STOCK ISSUE - MEMBER",
                    recipient_given: "STOCK ISSUE - EVENT/RECIPIENT",
                    virtual_collection: "VIRTUAL MEMBER COLLECTION",
                };
                const labelMap: Record<string, string> = {
                    member_given: "Member",
                    recipient_given: "Recipient",
                    virtual_collection: "Virtual Member",
                };
                printViaRawBT(buildStockOutReceipt({
                    club: { name: club?.name || "Magic Nutrition Club", phone: club?.phone, address: club?.address, gstNumber: club?.gstNumber },
                    title: titleMap[subtype],
                    recipientLabel: labelMap[subtype],
                    recipientName: recipient!.name,
                    recipientId: virtualMemberDoc?.memberId || recipient!.id,
                    recipientPhone: recipient!.phone,
                    items: validLines.map(l => ({ name: l.itemName, qty: l.qty, unit: l.unit })),
                    notes: notes.trim() || undefined,
                    renewalDate, expiryDate, collectionDate,
                    timestamp: ts, receiptNumber,
                }));
            } catch (e) { console.error("[stockOut] print", e); }
        }

        // Reset form
        setLines([{ itemId: "", qty: "" }]);
        setNotes("");
        setSelectedMemberId(null);
        setMemberSearch("");
        setRecipientName("");
        setSelectedVirtualId(null);
        setVirtualSearch("");
    };

    return (
        <div>
            {/* Subtype picker */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                {(Object.keys(subtypeMeta) as Array<typeof subtype>).map(k => (
                    <button key={k} onClick={() => setSubtype(k)}
                        style={{
                            padding: "12px 10px",
                            background: subtype === k ? subtypeMeta[k].color : "white",
                            color: subtype === k ? "white" : "#475569",
                            border: `2px solid ${subtype === k ? subtypeMeta[k].color : "#e2e8f0"}`,
                            borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                        }}>
                        <span style={{ fontSize: 20 }}>{subtypeMeta[k].emoji}</span>
                        <span>{subtypeMeta[k].label}</span>
                    </button>
                ))}
            </div>

            <CardBox title={`${subtypeMeta[subtype].emoji} ${subtypeMeta[subtype].label}`}>
                {/* Recipient picker */}
                {subtype === "member_given" && (
                    <div style={{ marginBottom: 14, padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 }}>Member</div>
                        {selectedMemberId ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: "#dbeafe", borderRadius: 6 }}>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#1e40af" }}>{members.find(m => m.id === selectedMemberId)?.name || "—"}</span>
                                <button onClick={() => setSelectedMemberId(null)} style={{ background: "transparent", border: "none", color: "#1e40af", fontSize: 14, cursor: "pointer" }}>✕</button>
                            </div>
                        ) : (
                            <>
                                <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Search member by name / phone / ID…"
                                    style={{ width: "100%", padding: 8, border: "1.5px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontFamily: FONT, boxSizing: "border-box", marginBottom: 6 }} />
                                {memberSearch && (
                                    <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, background: "white" }}>
                                        {filteredMembers.length === 0 ? (
                                            <div style={{ padding: 10, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>No matches</div>
                                        ) : filteredMembers.map(m => (
                                            <button key={m.id} onClick={() => { setSelectedMemberId(m.id); setMemberSearch(""); }}
                                                style={{ display: "block", width: "100%", textAlign: "left", padding: 8, background: "white", border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer", fontFamily: FONT, fontSize: 12 }}>
                                                <div style={{ fontWeight: 700, color: "#0f172a" }}>{m.name}</div>
                                                <div style={{ fontSize: 10, color: "#94a3b8" }}>{m.phone || "no phone"}{m.memberId ? ` · ${m.memberId}` : ""}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
                {subtype === "virtual_collection" && (
                    <div style={{ marginBottom: 14, padding: 10, background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 }}>Virtual Member (with completed payment)</div>
                        {selectedVirtualId ? (() => {
                            const vm = virtualMembers.find(v => v.id === selectedVirtualId);
                            const end = vm?.membershipEnd?.toDate?.();
                            const expired = end ? end.getTime() < Date.now() : true;
                            return (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, background: expired ? "#fef2f2" : "#f3e8ff", borderRadius: 6 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, fontWeight: 800, color: expired ? "#991b1b" : "#6d28d9" }}>{vm?.name || "—"}</div>
                                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                                            {vm?.memberId}{vm?.phone ? ` · ${vm.phone}` : ""}
                                            {vm?.planName ? ` · ${vm.planName}` : ""}
                                            {end ? ` · ${expired ? "expired " : "expires "}${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedVirtualId(null)} style={{ background: "transparent", border: "none", color: "#6d28d9", fontSize: 14, cursor: "pointer" }}>✕</button>
                                </div>
                            );
                        })() : (
                            <>
                                <input value={virtualSearch} onChange={e => setVirtualSearch(e.target.value)} placeholder="Search virtual member by name / phone / ID…"
                                    style={{ width: "100%", padding: 8, border: "1.5px solid #d8b4fe", borderRadius: 6, fontSize: 12, fontFamily: FONT, boxSizing: "border-box", marginBottom: 6 }} />
                                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e9d5ff", borderRadius: 6, background: "white" }}>
                                    {(() => {
                                        const q = virtualSearch.trim().toLowerCase();
                                        const filtered = virtualMembers.filter(vm =>
                                            !q ||
                                            (vm.name || "").toLowerCase().includes(q) ||
                                            (vm.phone || "").includes(q) ||
                                            (vm.memberId || "").toString().toLowerCase().includes(q)
                                        );
                                        if (filtered.length === 0) {
                                            return <div style={{ padding: 12, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
                                                {virtualMembers.length === 0 ? "No virtual members yet" : "No matches"}
                                            </div>;
                                        }
                                        return filtered.map(vm => {
                                            const end = vm.membershipEnd?.toDate?.();
                                            const expired = end ? end.getTime() < Date.now() : true;
                                            return (
                                                <button key={vm.id} onClick={() => { setSelectedVirtualId(vm.id); setVirtualSearch(""); }}
                                                    style={{ display: "block", width: "100%", textAlign: "left", padding: 10, background: "white", border: "none", borderBottom: "1px solid #f3e8ff", cursor: "pointer", fontFamily: FONT, fontSize: 12 }}>
                                                    <div style={{ fontWeight: 700, color: "#1a3a2a" }}>{vm.name}</div>
                                                    <div style={{ fontSize: 10, color: expired ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                                                        {vm.memberId}{vm.phone ? ` · ${vm.phone}` : ""}
                                                        {end ? ` · ${expired ? "expired" : "active"} till ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : " · no plan"}
                                                    </div>
                                                </button>
                                            );
                                        });
                                    })()}
                                </div>
                            </>
                        )}
                    </div>
                )}
                {subtype === "recipient_given" && (
                    <div style={{ marginBottom: 14, padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 }}>Recipient (group / event / club / person)</div>
                        <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Type a name (or pick a recent one below)"
                            style={{ width: "100%", padding: 8, border: "1.5px solid #cbd5e1", borderRadius: 6, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                        {filteredRecipients.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                {filteredRecipients.map(r => (
                                    <button key={r.id} onClick={() => setRecipientName(r.name)}
                                        style={{ padding: "4px 10px", background: "white", border: "1px solid #ddd6fe", color: "#6d28d9", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
                                        {r.name}{r.transactionsCount > 0 ? ` (${r.transactionsCount}×)` : ""}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Item lines */}
                {lines.map((ln, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 36px", gap: 8, marginBottom: 8 }}>
                        <select value={ln.itemId} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}
                            style={{ padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT }}>
                            <option value="">Choose item…</option>
                            {items.map(it => <option key={it.id} value={it.id} disabled={it.quantity <= 0}>{it.name}{it.size ? ` · ${it.size}` : ""} (have: {it.quantity})</option>)}
                        </select>
                        <input type="number" placeholder="Qty" value={ln.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                            style={{ padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                        <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}
                            style={{ background: lines.length === 1 ? "#f1f5f9" : "white", border: "1.5px solid #fecaca", color: lines.length === 1 ? "#cbd5e1" : "#dc2626", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: lines.length === 1 ? "not-allowed" : "pointer", fontFamily: FONT }}>✕</button>
                    </div>
                ))}
                <button onClick={() => setLines(ls => [...ls, { itemId: "", qty: "" }])}
                    style={{ padding: "8px 14px", background: "white", border: "1.5px dashed #cbd5e1", color: "#475569", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT, marginBottom: 14 }}>
                    + Add another line
                </button>

                <FieldRow>
                    <Field label="Date" value={date} onChange={setDate} type="date" />
                    <Field label="Notes" value={notes} onChange={setNotes} placeholder="optional" />
                </FieldRow>

                <button onClick={submit} disabled={saving}
                    style={{ width: "100%", padding: 14, background: saving ? "#cbd5e1" : subtypeMeta[subtype].color, color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 900, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT, marginTop: 8 }}>
                    {saving ? "Saving…" : `${subtypeMeta[subtype].emoji} Record ${subtypeMeta[subtype].label.toLowerCase()}`}
                </button>
            </CardBox>
        </div>
    );
}

// ═══ HISTORY TAB ═══════════════════════════════════════════════════════════

function HistoryTab({ events, loading }: { events: any[]; loading: boolean }) {
    const [filter, setFilter] = useState<"all" | "in" | "out" | EventSubtype>("all");

    const filtered = useMemo(() => {
        if (filter === "all") return events;
        if (filter === "in" || filter === "out") return events.filter(e => e.type === filter);
        return events.filter(e => e.subtype === filter);
    }, [events, filter]);

    const subtypeMeta: Record<string, { emoji: string; bg: string; color: string; label: string }> = {
        restock:            { emoji: "📦", bg: "#dcfce7", color: "#15803d", label: "Restock" },
        new_product:        { emoji: "✨", bg: "#dbeafe", color: "#1e40af", label: "New product" },
        today_usage:        { emoji: "🥤", bg: "#fef3c7", color: "#92400e", label: "Today's usage" },
        member_given:       { emoji: "👤", bg: "#dbeafe", color: "#1e40af", label: "Member" },
        recipient_given:    { emoji: "🤝", bg: "#ede9fe", color: "#6d28d9", label: "Recipient" },
        virtual_collection: { emoji: "💳", bg: "#f3e8ff", color: "#7c3aed", label: "Virtual collection" },
        adjustment:         { emoji: "🔧", bg: "#f1f5f9", color: "#475569", label: "Adjustment" },
    };

    const chips: Array<{ id: typeof filter; label: string }> = [
        { id: "all", label: `All (${events.length})` },
        { id: "in", label: "Stock In" },
        { id: "out", label: "Stock Out" },
        { id: "restock", label: "📦 Restock" },
        { id: "today_usage", label: "🥤 Usage" },
        { id: "member_given", label: "👤 Member" },
        { id: "recipient_given", label: "🤝 Recipient" },
        { id: "virtual_collection", label: "💳 Virtual" },
        { id: "adjustment", label: "🔧 Adjustment" },
    ];

    return (
        <div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {chips.map(c => (
                    <button key={c.id} onClick={() => setFilter(c.id)}
                        style={{ padding: "6px 12px", background: filter === c.id ? "#0f172a" : "white", color: filter === c.id ? "white" : "#475569", border: `1.5px solid ${filter === c.id ? "#0f172a" : "#e2e8f0"}`, borderRadius: 100, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                        {c.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading history…</div>
            ) : filtered.length === 0 ? (
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                    No events match this filter.
                </div>
            ) : (
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                    {filtered.map(e => {
                        const meta = subtypeMeta[e.subtype] || { emoji: "•", bg: "#f1f5f9", color: "#475569", label: e.subtype };
                        const ts = e.createdAt?.toDate?.() as Date | undefined;
                        const totalQty = (e.items || []).reduce((s: number, it: any) => s + Number(it.qty || 0), 0);
                        return (
                            <div key={e.id} style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid #f1f5f9", alignItems: "flex-start" }}>
                                <div style={{ width: 38, height: 38, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{meta.emoji}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                                        {meta.label} · {e.type === "in" ? "+" : "−"}{totalQty}
                                        {e.recipient?.name && <span style={{ color: "#64748b", fontWeight: 600 }}> · {e.recipient.name}</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                                        {(e.items || []).map((it: any) => `${it.itemName} ×${it.qty}`).join(" · ")}
                                    </div>
                                    {(e.supplier || e.invoiceNo || e.notes) && (
                                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                                            {e.supplier ? `Supplier: ${e.supplier}` : ""}
                                            {e.invoiceNo ? ` · Invoice: ${e.invoiceNo}` : ""}
                                            {e.notes ? ` · ${e.notes}` : ""}
                                        </div>
                                    )}
                                </div>
                                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, minWidth: 80, textAlign: "right" }}>
                                    {e.date}
                                    {ts && <div>{ts.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ═══ Shared bits ═══════════════════════════════════════════════════════════

function CardBox({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
            {children}
        </div>
    );
}

function FieldRow({ children }: { children: React.ReactNode }) {
    return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>{children}</div>;
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
    return (
        <label style={{ display: "block" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
            <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                style={{ width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
        </label>
    );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, fontFamily: FONT }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 500, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                {children}
            </div>
        </div>
    );
}
