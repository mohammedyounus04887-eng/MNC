/**
 * Inventory History — append-only audit log of every stock movement.
 *
 * Lists all entries in `clubs/{clubId}/stockMovements` sorted newest first,
 * grouped by date. Event give-aways with the same `batchId` are rendered
 * as a single grouped block.
 *
 * Filters: type (all / product_added / stock_added / club_usage / event_give),
 * and a text search over product / event names.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, ArrowDownToLine, ClipboardList, Send, UserPlus, RotateCcw, Package, X } from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";
import { useStockMovements, type MovementType, type StockMovement } from "@/hooks/useSimpleInventory";

const FONT = "'Inter', system-ui, -apple-system, sans-serif";

type Filter = "all" | MovementType;

const TYPE_META: Record<MovementType, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    product_added:   { label: "Product Added",     color: "#0284c7", bg: "#e0f2fe", icon: <Plus className="w-3.5 h-3.5" /> },
    stock_added:     { label: "Stock Added",       color: "#16a34a", bg: "#dcfce7", icon: <ArrowDownToLine className="w-3.5 h-3.5" /> },
    club_usage:      { label: "Club Usage",        color: "#d97706", bg: "#fef3c7", icon: <ClipboardList className="w-3.5 h-3.5" /> },
    event_give:      { label: "Given for Event",   color: "#7c3aed", bg: "#ede9fe", icon: <Send className="w-3.5 h-3.5" /> },
    give_to_person:  { label: "Given to Person",   color: "#db2777", bg: "#fce7f3", icon: <UserPlus className="w-3.5 h-3.5" /> },
    borrow_returned: { label: "Borrow Returned",   color: "#0d9488", bg: "#ccfbf1", icon: <RotateCcw className="w-3.5 h-3.5" /> },
};

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

const dateKey = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : "—";

const formatDateHeading = (key: string) => {
    if (key === "—") return "Unknown";
    const d = new Date(key);
    const today = new Date().toISOString().slice(0, 10);
    const ydy = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    if (key === today) return `Today · ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    if (key === ydy) return `Yesterday · ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

const formatTime = (d: Date | null) =>
    d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "—";

export default function InventoryHistory() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const movementsQ = useStockMovements(clubId);
    const movements = movementsQ.data || [];

    const [filter, setFilter] = useState<Filter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const deferredQuery = useDeferredValue(searchQuery);
    const q = deferredQuery.trim().toLowerCase();

    // Filter
    const filtered = useMemo(() => {
        return movements.filter(m => {
            if (filter !== "all" && m.type !== filter) return false;
            if (!q) return true;
            const hay = [m.productName, m.productFlavor, m.eventName, m.personName, m.notes].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
        });
    }, [movements, filter, q]);

    // Group by date, then collapse same-batch event entries together
    const groups = useMemo(() => groupByDateThenBatch(filtered), [filtered]);

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: "20px 16px 60px" }}>
            <div style={{ maxWidth: 1000, margin: "0 auto" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
                    <div>
                        <Link to=".." relative="path" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", fontWeight: 700, textDecoration: "none", marginBottom: 6 }}>
                            <ArrowLeft className="w-4 h-4" /> Back to Inventory
                        </Link>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>📜 Inventory History</div>
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{club?.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                        {movements.length} entr{movements.length === 1 ? "y" : "ies"}
                        {filtered.length !== movements.length && ` · ${filtered.length} shown`}
                    </div>
                </div>

                {/* Filters */}
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Search */}
                    <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8" }}>🔍</span>
                        <input
                            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search product, flavor, event…"
                            style={{
                                width: "100%", padding: "10px 36px 10px 36px", border: "1px solid #cbd5e1",
                                borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: "none", background: "#f8fafc",
                            }}
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, border: "none", background: "#e2e8f0", color: "#64748b", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                aria-label="Clear"
                            ><X className="w-3 h-3" /></button>
                        )}
                    </div>

                    {/* Type chips */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(["all", "product_added", "stock_added", "club_usage", "event_give", "give_to_person", "borrow_returned"] as Filter[]).map(t => {
                            const active = filter === t;
                            const meta = t === "all" ? null : TYPE_META[t];
                            return (
                                <button
                                    key={t}
                                    onClick={() => setFilter(t)}
                                    style={{
                                        padding: "6px 12px",
                                        border: `1px solid ${active ? "#0f172a" : "#cbd5e1"}`,
                                        background: active ? "#0f172a" : "white",
                                        color: active ? "white" : "#475569",
                                        borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
                                        display: "inline-flex", alignItems: "center", gap: 6,
                                    }}
                                >
                                    {meta?.icon}
                                    {t === "all" ? "All" : meta!.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Content */}
                {movementsQ.isLoading ? (
                    <div style={{ fontSize: 13, color: "#64748b", padding: 30, textAlign: "center" }}>Loading…</div>
                ) : filtered.length === 0 ? (
                    <div style={{ background: "white", border: "2px dashed #cbd5e1", borderRadius: 14, padding: "60px 20px", textAlign: "center" }}>
                        <Package className="w-12 h-12" style={{ color: "#cbd5e1", margin: "0 auto 12px" }} />
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                            {movements.length === 0 ? "No history yet" : "No matches"}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                            {movements.length === 0
                                ? "Add a product or stock to see history here."
                                : "Try a different filter or search."}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {groups.map(g => (
                            <div key={g.date}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, paddingLeft: 4 }}>
                                    {formatDateHeading(g.date)}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {g.entries.map(e => e.kind === "single"
                                        ? <SingleEntry key={e.movement.id} m={e.movement} />
                                        : <BatchEntry key={e.batchId} batch={e} />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Grouping ────────────────────────────────────────────────────────────

// Types that should be visually grouped when they share a batchId.
const BATCH_TYPES: ReadonlySet<MovementType> = new Set<MovementType>([
    "event_give", "give_to_person", "borrow_returned",
]);

type Entry =
    | { kind: "single"; movement: StockMovement }
    | { kind: "batch"; batchId: string; title: string; type: MovementType; items: StockMovement[]; time: Date | null };

function groupByDateThenBatch(movements: StockMovement[]): Array<{ date: string; entries: Entry[] }> {
    const byDate = new Map<string, StockMovement[]>();
    for (const m of movements) {
        const k = dateKey(tsToDate(m.createdAt));
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k)!.push(m);
    }
    const out: Array<{ date: string; entries: Entry[] }> = [];
    // Maintain newest-first order (movements arrive already sorted desc)
    for (const [date, list] of byDate) {
        const entries: Entry[] = [];
        const seenBatch = new Set<string>();
        for (const m of list) {
            const grouping = BATCH_TYPES.has(m.type) && m.batchId;
            if (grouping && !seenBatch.has(m.batchId!)) {
                seenBatch.add(m.batchId!);
                const items = list.filter(x => x.batchId === m.batchId && x.type === m.type);
                const title =
                    m.type === "event_give"      ? (m.eventName || "Event") :
                    m.type === "give_to_person"  ? (m.personName || "Person") :
                    m.type === "borrow_returned" ? (m.personName ? `Returned by ${m.personName}` : "Returned") :
                                                   "—";
                entries.push({
                    kind: "batch",
                    batchId: m.batchId!,
                    title,
                    type: m.type,
                    items,
                    time: tsToDate(m.createdAt),
                });
            } else if (grouping) {
                // already covered by batch entry
                continue;
            } else {
                entries.push({ kind: "single", movement: m });
            }
        }
        out.push({ date, entries });
    }
    return out;
}

// ─── Entry components ───────────────────────────────────────────────────

function SingleEntry({ m }: { m: StockMovement }) {
    const meta = TYPE_META[m.type];
    const time = formatTime(tsToDate(m.createdAt));
    const deltaText = m.delta > 0 ? `+${m.delta}` : m.delta < 0 ? `${m.delta}` : "";
    const deltaColor = m.delta > 0 ? "#16a34a" : m.delta < 0 ? "#dc2626" : "#64748b";

    return (
        <div style={{
            background: "white", border: "1px solid #e2e8f0", borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 12,
        }}>
            <div style={{
                width: 32, height: 32, borderRadius: 8, background: meta.bg, color: meta.color,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
                {meta.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.productName}
                    {m.productFlavor && <span style={{ color: "#64748b", fontWeight: 600 }}> · {m.productFlavor}</span>}
                    {m.productSize && <span style={{ color: "#94a3b8", fontWeight: 600 }}> · {m.productSize}</span>}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                    <span style={{ color: meta.color, fontWeight: 800 }}>{meta.label}</span>
                    {" · "}{time}
                    {m.notes && <span> · {m.notes}</span>}
                </div>
            </div>
            {deltaText && (
                <div style={{ fontSize: 16, fontWeight: 900, color: deltaColor, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {deltaText} <span style={{ fontSize: 10, fontWeight: 700 }}>box{Math.abs(m.delta) === 1 ? "" : "es"}</span>
                </div>
            )}
        </div>
    );
}

function BatchEntry({ batch }: { batch: Extract<Entry, { kind: "batch" }> }) {
    const meta = TYPE_META[batch.type];
    const time = formatTime(batch.time);
    const signedTotal = batch.items.reduce((s, x) => s + x.delta, 0);
    const totalBoxes = Math.abs(signedTotal);
    const deltaColor = signedTotal > 0 ? "#16a34a" : signedTotal < 0 ? "#dc2626" : "#64748b";
    const sign = signedTotal > 0 ? "+" : signedTotal < 0 ? "-" : "";
    const notes = batch.items.find(x => x.notes)?.notes;

    return (
        <div style={{
            background: "white", border: "1px solid #e2e8f0", borderLeft: `4px solid ${meta.color}`,
            borderRadius: 10, padding: "12px 14px",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {batch.title}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                        <span style={{ color: meta.color, fontWeight: 800 }}>{meta.label}</span>
                        {" · "}{time} · {batch.items.length} product{batch.items.length === 1 ? "" : "s"}
                        {notes && <span> · {notes}</span>}
                    </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, color: deltaColor, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {sign}{totalBoxes} <span style={{ fontSize: 10, fontWeight: 700 }}>box{totalBoxes === 1 ? "" : "es"}</span>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 44 }}>
                {batch.items.map(i => (
                    <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#475569" }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#cbd5e1", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: 700 }}>
                            {i.productName}
                            {i.productFlavor && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {i.productFlavor}</span>}
                        </span>
                        <span style={{ fontWeight: 800, color: i.delta > 0 ? "#16a34a" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>{i.delta > 0 ? `+${i.delta}` : i.delta} box{Math.abs(i.delta) === 1 ? "" : "es"}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
