/**
 * Inventory Deadlines — track personal borrows.
 *
 * Top: month calendar with dots on days that have at least one pending or
 * overdue return. Clicking a day filters the list to that day.
 *
 * Bottom: tabbed list (All / Pending / Overdue / Returned). Each card shows
 * the borrower, item summary, deadline, and a "Mark Returned" button which
 * adds stock back and stamps the borrow as completed.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    ArrowLeft, ChevronLeft, ChevronRight, Phone, Package,
    CheckCircle2, AlertTriangle, Clock,
} from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";
import {
    usePersonalBorrows,
    useMarkBorrowReturned,
    type PersonalBorrow,
} from "@/hooks/useSimpleInventory";

const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const ACCENT = "#2d9653";

type Tab = "all" | "pending" | "overdue" | "returned";

const todayStr = () => new Date().toISOString().slice(0, 10);

const isOverdue = (b: PersonalBorrow) =>
    b.status === "pending" && b.returnDeadline < todayStr();

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

const formatDate = (s: string) => {
    if (!s) return "—";
    try {
        const d = new Date(s);
        return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
    } catch { return s; }
};

const daysFromToday = (s: string): number => {
    if (!s) return 0;
    const t = new Date(todayStr()).getTime();
    const d = new Date(s).getTime();
    return Math.round((d - t) / 86400_000);
};

// ─── Main ────────────────────────────────────────────────────────────────

export default function InventoryDeadlines() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const borrowsQ = usePersonalBorrows(clubId);
    const markReturned = useMarkBorrowReturned();
    const borrows = borrowsQ.data || [];

    const [tab, setTab] = useState<Tab>("pending");
    const [cursor, setCursor] = useState<Date>(() => new Date());     // month being viewed
    const [pickedDay, setPickedDay] = useState<string | null>(null);
    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const showToast = (k: "ok" | "err", t: string) => {
        setToast({ kind: k, text: t });
        setTimeout(() => setToast(null), 4000);
    };

    // Counts by status
    const counts = useMemo(() => {
        let pending = 0, overdue = 0, returned = 0;
        for (const b of borrows) {
            if (b.status === "returned") returned++;
            else if (isOverdue(b)) overdue++;
            else pending++;
        }
        return { all: borrows.length, pending, overdue, returned };
    }, [borrows]);

    // Filtered list
    const filtered = useMemo(() => {
        let list = borrows;
        if (tab === "pending")  list = list.filter(b => b.status === "pending" && !isOverdue(b));
        if (tab === "overdue")  list = list.filter(isOverdue);
        if (tab === "returned") list = list.filter(b => b.status === "returned");
        if (pickedDay)          list = list.filter(b => b.returnDeadline === pickedDay);
        // Sort: pending/overdue first by deadline asc; returned by returnedAt desc
        return [...list].sort((a, b) => {
            if (a.status === "returned" && b.status !== "returned") return 1;
            if (b.status === "returned" && a.status !== "returned") return -1;
            return a.returnDeadline.localeCompare(b.returnDeadline);
        });
    }, [borrows, tab, pickedDay]);

    // For the calendar: deadlines grouped by date (only non-returned)
    const byDay = useMemo(() => {
        const m = new Map<string, { pending: number; overdue: number }>();
        for (const b of borrows) {
            if (b.status === "returned") continue;
            const day = b.returnDeadline;
            if (!m.has(day)) m.set(day, { pending: 0, overdue: 0 });
            const cell = m.get(day)!;
            if (isOverdue(b)) cell.overdue++;
            else cell.pending++;
        }
        return m;
    }, [borrows]);

    const handleMarkReturned = async (b: PersonalBorrow) => {
        if (!clubId) return;
        if (!confirm(`Mark return from ${b.personName} as complete? ${b.totalBoxes} box${b.totalBoxes === 1 ? "" : "es"} will be added back to stock.`)) return;
        try {
            await markReturned.mutateAsync({ clubId, borrowId: b.id });
            showToast("ok", `Returned — ${b.totalBoxes} box${b.totalBoxes === 1 ? "" : "es"} restocked`);
        } catch (e: any) {
            showToast("err", e.message || "Mark return failed");
        }
    };

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: "20px 16px 60px" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
                    <div>
                        <Link to=".." relative="path" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", fontWeight: 700, textDecoration: "none", marginBottom: 6 }}>
                            <ArrowLeft className="w-4 h-4" /> Back to Inventory
                        </Link>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>📅 Return Deadlines</div>
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{club?.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <StatTile label="Pending" value={counts.pending} accent="#d97706" />
                        <StatTile label="Overdue" value={counts.overdue} accent="#dc2626" />
                        <StatTile label="Returned" value={counts.returned} accent={ACCENT} />
                    </div>
                </div>

                {/* Calendar */}
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <CalendarGrid
                        cursor={cursor}
                        onPrev={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
                        onNext={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
                        onToday={() => setCursor(new Date())}
                        byDay={byDay}
                        pickedDay={pickedDay}
                        onPick={day => {
                            if (pickedDay === day) setPickedDay(null);
                            else setPickedDay(day);
                        }}
                    />
                    {pickedDay && (
                        <div style={{ marginTop: 10, padding: "8px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 12, color: "#475569", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>Filtered to <b>{formatDate(pickedDay)}</b></span>
                            <button onClick={() => setPickedDay(null)} style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear</button>
                        </div>
                    )}
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", marginBottom: 12, overflowX: "auto" }}>
                    {([
                        { id: "all",      label: `All (${counts.all})` },
                        { id: "pending",  label: `Pending (${counts.pending})` },
                        { id: "overdue",  label: `Overdue (${counts.overdue})` },
                        { id: "returned", label: `Returned (${counts.returned})` },
                    ] as Array<{ id: Tab; label: string }>).map(t => {
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                style={{
                                    padding: "8px 16px", border: "none",
                                    background: active ? "#0f172a" : "transparent",
                                    color: active ? "white" : "#64748b",
                                    borderRadius: 6, fontSize: 12, fontWeight: 800,
                                    cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                                }}
                            >{t.label}</button>
                        );
                    })}
                </div>

                {/* List */}
                {borrowsQ.isLoading ? (
                    <div style={{ fontSize: 13, color: "#64748b", padding: 30, textAlign: "center" }}>Loading…</div>
                ) : filtered.length === 0 ? (
                    <div style={{ background: "white", border: "2px dashed #cbd5e1", borderRadius: 14, padding: "60px 20px", textAlign: "center" }}>
                        <Package className="w-12 h-12" style={{ color: "#cbd5e1", margin: "0 auto 12px" }} />
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>Nothing here</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                            {borrows.length === 0
                                ? "No personal borrows yet. Use \"Give to Person\" on the inventory page."
                                : "No matches for this filter."}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {filtered.map(b => (
                            <BorrowCard
                                key={b.id}
                                borrow={b}
                                onMarkReturned={() => handleMarkReturned(b)}
                                busy={markReturned.isPending}
                            />
                        ))}
                    </div>
                )}

                {toast && (
                    <div style={{
                        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
                        background: toast.kind === "ok" ? ACCENT : "#dc2626", color: "white",
                        padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 800,
                        zIndex: 1500, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT, maxWidth: "90vw",
                    }}>
                        {toast.kind === "ok" ? "✓ " : "✗ "}{toast.text}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Calendar grid ───────────────────────────────────────────────────────

function CalendarGrid({ cursor, onPrev, onNext, onToday, byDay, pickedDay, onPick }: {
    cursor: Date;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    byDay: Map<string, { pending: number; overdue: number }>;
    pickedDay: string | null;
    onPick: (day: string) => void;
}) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();         // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayStr();

    // Build a 6x7 grid (some cells may be empty)
    const cells: Array<{ day: number; key: string } | null> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ day: d, key });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const monthLabel = firstDay.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{monthLabel}</div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={onPrev} style={navBtnStyle}><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={onToday} style={{ ...navBtnStyle, width: "auto", padding: "0 12px", fontSize: 11, fontWeight: 800 }}>Today</button>
                    <button onClick={onNext} style={navBtnStyle}><ChevronRight className="w-4 h-4" /></button>
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                    <div key={d} style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", textAlign: "center", padding: "4px 0" }}>{d}</div>
                ))}
                {cells.map((c, i) => {
                    if (!c) return <div key={i} />;
                    const cell = byDay.get(c.key);
                    const isToday = c.key === today;
                    const isPicked = c.key === pickedDay;
                    const totalCount = cell ? cell.pending + cell.overdue : 0;
                    const accentColor = cell?.overdue ? "#dc2626" : cell?.pending ? "#d97706" : null;
                    return (
                        <button
                            key={i}
                            onClick={() => onPick(c.key)}
                            style={{
                                position: "relative",
                                padding: "8px 4px", minHeight: 52,
                                background: isPicked ? "#0f172a" : isToday ? "#e0f2fe" : "white",
                                color: isPicked ? "white" : "#0f172a",
                                border: `1px solid ${isPicked ? "#0f172a" : isToday ? "#7dd3fc" : "#e2e8f0"}`,
                                borderRadius: 6, cursor: "pointer", fontFamily: FONT,
                                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                            }}
                        >
                            <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.day}</span>
                            {totalCount > 0 && (
                                <span style={{
                                    fontSize: 9, fontWeight: 800,
                                    color: isPicked ? "white" : accentColor || "#475569",
                                    background: isPicked ? "rgba(255,255,255,0.2)" : (accentColor ? `${accentColor}15` : "#f1f5f9"),
                                    padding: "1px 6px", borderRadius: 100,
                                }}>{totalCount}</span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Borrow card ─────────────────────────────────────────────────────────

function BorrowCard({ borrow: b, onMarkReturned, busy }: {
    borrow: PersonalBorrow;
    onMarkReturned: () => void;
    busy: boolean;
}) {
    const overdue = isOverdue(b);
    const returned = b.status === "returned";
    const dDays = daysFromToday(b.returnDeadline);

    const statusColor = returned ? ACCENT : overdue ? "#dc2626" : "#d97706";
    const statusBg = returned ? "#dcfce7" : overdue ? "#fee2e2" : "#fef3c7";
    const statusIcon = returned
        ? <CheckCircle2 className="w-3.5 h-3.5" />
        : overdue ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />;
    const statusLabel = returned ? "Returned" : overdue ? "Overdue" : "Pending Return";

    let deadlineHint = "";
    if (!returned) {
        if (dDays === 0)       deadlineHint = "due today";
        else if (dDays === 1)  deadlineHint = "due tomorrow";
        else if (dDays > 1)    deadlineHint = `due in ${dDays} days`;
        else                   deadlineHint = `${Math.abs(dDays)} day${Math.abs(dDays) === 1 ? "" : "s"} overdue`;
    }

    return (
        <div style={{
            background: "white", border: "1px solid #e2e8f0",
            borderLeft: `4px solid ${statusColor}`,
            borderRadius: 12, padding: "14px 16px",
        }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{b.personName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {b.personPhone && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                <Phone className="w-3 h-3" />{b.personPhone}
                            </span>
                        )}
                        {b.notes && <span style={{ color: "#94a3b8" }}>{b.notes}</span>}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 10, fontWeight: 800, color: statusColor, background: statusBg,
                        padding: "3px 8px", borderRadius: 100, textTransform: "uppercase", letterSpacing: 0.3,
                    }}>
                        {statusIcon}{statusLabel}
                    </span>
                    <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>
                        {returned
                            ? <>Returned <b>{tsToDate(b.returnedAt)?.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) || "—"}</b></>
                            : <>Return by <b>{formatDate(b.returnDeadline)}</b> {deadlineHint && <span style={{ color: statusColor }}>· {deadlineHint}</span>}</>
                        }
                    </div>
                </div>
            </div>

            <div style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 8, padding: "8px 10px" }}>
                {b.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "#475569" }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#cbd5e1", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: 700 }}>
                            {it.productName}
                            {it.productFlavor && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {it.productFlavor}</span>}
                            {it.productSize && <span style={{ color: "#cbd5e1", fontWeight: 500 }}> · {it.productSize}</span>}
                        </span>
                        <span style={{ fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{it.quantity} box{it.quantity === 1 ? "" : "es"}</span>
                    </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e2e8f0", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                    <span>Total</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{b.totalBoxes} box{b.totalBoxes === 1 ? "" : "es"}</span>
                </div>
            </div>

            {!returned && (
                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                    <button
                        onClick={onMarkReturned}
                        disabled={busy}
                        style={{
                            background: busy ? "#cbd5e1" : ACCENT, color: "white", border: "none",
                            padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                            cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT,
                            display: "inline-flex", alignItems: "center", gap: 6,
                        }}
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        {busy ? "Saving…" : "Mark Returned"}
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Bits ────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
    width: 32, height: 32, border: "1px solid #cbd5e1", background: "white",
    borderRadius: 8, cursor: "pointer", color: "#475569",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
};

function StatTile({ label, value, accent }: { label: string; value: number; accent: string }) {
    return (
        <div style={{
            background: "white", border: `1px solid ${accent}30`, borderLeft: `4px solid ${accent}`,
            borderRadius: 8, padding: "8px 14px", minWidth: 84,
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        </div>
    );
}
