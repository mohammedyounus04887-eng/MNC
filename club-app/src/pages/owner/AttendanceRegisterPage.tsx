import { useState, useMemo, useCallback, useEffect, CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    collection, collectionGroup, query, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc,
    orderBy, where, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useMembers } from "@/hooks/owner/useMembers";
import type { User, Order, WalletTransaction, Attendance } from "@/types/firestore";
import {
    ChevronLeft, ChevronRight, Search, GripVertical, ChevronUp, ChevronDown,
    X, Check, Clock, ShoppingBag, Coffee, Edit2, Plus, Trash2, Save,
    IndianRupee, AlertTriangle,
} from "lucide-react";
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Constants ──────────────────────────────────────────────────────────
const ACCENT = "#2d9653";
const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}
function ymd(d: Date) {
    return d.toISOString().slice(0, 10);
}
function pad(n: number) {
    return String(n).padStart(2, "0");
}
function fmtTime(ts: any): string {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function formatINR(n: number | undefined | null) {
    const v = Number(n);
    return "₹" + (Number.isFinite(v) ? v : 0).toLocaleString("en-IN");
}

// ─── Main Page ──────────────────────────────────────────────────────────
export default function AttendanceRegisterPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? "";
    const qc = useQueryClient();

    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [search, setSearch] = useState("");
    const [reorderMode, setReorderMode] = useState(false);
    const [popup, setPopup] = useState<{ memberId: string; date: string } | null>(null);

    const numDays = daysInMonth(year, month);
    const todayStr = ymd(today);
    const monthPrefix = `${year}-${pad(month + 1)}`;

    // ── Members ──
    const { data: allMembers } = useMembers(clubId || null);

    // ── Custom order ──
    const { data: savedOrder } = useQuery({
        queryKey: ["attendance-order", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const snap = await getDoc(doc(db, `clubs/${clubId}/settings/attendanceOrder`));
            return (snap.exists() ? snap.data().memberIds : null) as string[] | null;
        },
    });

    const [localOrder, setLocalOrder] = useState<string[] | null>(null);
    useEffect(() => {
        if (savedOrder) setLocalOrder(savedOrder);
    }, [savedOrder]);

    const orderedMembers = useMemo(() => {
        if (!allMembers) return [];
        const filtered = search.trim()
            ? allMembers.filter(m => (m.name || "").toLowerCase().includes(search.toLowerCase()))
            : allMembers;

        const order = localOrder;
        if (!order) {
            return [...filtered].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        }
        const posMap = new Map(order.map((id, i) => [id, i]));
        return [...filtered].sort((a, b) => {
            const pa = posMap.get(a.id) ?? 99999;
            const pb = posMap.get(b.id) ?? 99999;
            if (pa !== pb) return pa - pb;
            return (a.name || "").localeCompare(b.name || "");
        });
    }, [allMembers, search, localOrder]);

    // ── Month grid data (attendance + shakes + payments) ──
    // One collection-group query for the whole club's attendance this month
    // (backed by the clubId+date index) replaces the old N-queries-per-member
    // full-history scan. Two more month-scoped queries (orders, payments) power
    // the ✓ / ⚠️ / 💲 status indicators without any per-cell fetching.
    const { data: grid, isFetching: gridLoading } = useQuery({
        queryKey: ["attendance-register", clubId, monthPrefix],
        enabled: !!clubId,
        queryFn: async () => {
            const start = `${monthPrefix}-01`;
            const end = `${monthPrefix}-31`;
            const [attSnap, ordSnap, paySnap] = await Promise.all([
                getDocs(query(collectionGroup(db, "attendance"),
                    where("clubId", "==", clubId), where("date", ">=", start), where("date", "<=", end))),
                getDocs(query(collection(db, `clubs/${clubId}/orders`),
                    where("date", ">=", start), where("date", "<=", end))),
                getDocs(query(collection(db, `clubs/${clubId}/payments`),
                    where("date", ">=", start), where("date", "<=", end))),
            ]);

            // Attendance keyed by member → date (prefer a "member" doc over a
            // volunteer doc when both exist for the same day).
            const att: Record<string, Record<string, Attendance>> = {};
            attSnap.docs.forEach(d => {
                const a = { id: d.id, ...d.data() } as Attendance;
                const mid = (a as any).userId;
                if (!mid || !a.date) return;
                // Member attendance only. A volunteer session is not a member
                // check-in: counting it here ticked the grid for someone whose
                // only record that day was volunteering, while the day detail —
                // which reads attendance/{date} — correctly said absent. The two
                // then disagreed and the tick could not be cleared.
                if (a.type !== "member") return;
                if (!att[mid]) att[mid] = {};
                att[mid][a.date] = a;
            });

            // Which member had a (non-cancelled) shake order each day.
            const shakes: Record<string, Set<string>> = {};
            ordSnap.docs.forEach(d => {
                const o = d.data() as any;
                if (!o.memberId || o.memberId === "guest" || !o.date) return;
                if (o.status === "cancelled" || o.status === "rejected") return;
                (shakes[o.memberId] ??= new Set()).add(o.date);
            });

            // Which member had a payment recorded each day.
            const pays: Record<string, Set<string>> = {};
            paySnap.docs.forEach(d => {
                const p = d.data() as any;
                if (!p.memberId || !p.date) return;
                (pays[p.memberId] ??= new Set()).add(p.date);
            });

            return { att, shakes, pays };
        },
    });
    const attendanceMap = grid?.att;
    const shakeMap = grid?.shakes;
    const payMap = grid?.pays;

    // ── Reorder ──
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = orderedMembers.findIndex(m => m.id === active.id);
        const newIndex = orderedMembers.findIndex(m => m.id === over.id);
        const reordered = arrayMove(orderedMembers.map(m => m.id), oldIndex, newIndex);
        setLocalOrder(reordered);
    };

    const moveItem = (memberId: string, dir: -1 | 1) => {
        const ids = orderedMembers.map(m => m.id);
        const idx = ids.indexOf(memberId);
        if (idx < 0) return;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= ids.length) return;
        setLocalOrder(arrayMove(ids, idx, newIdx));
    };

    const saveOrder = async () => {
        if (!clubId || !localOrder) return;
        await setDoc(doc(db, `clubs/${clubId}/settings/attendanceOrder`), { memberIds: localOrder });
        qc.invalidateQueries({ queryKey: ["attendance-order", clubId] });
        setReorderMode(false);
    };

    // ── Month navigation ──
    const prevMonth = () => {
        if (month === 0) { setYear(y => y - 1); setMonth(11); }
        else setMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (month === 11) { setYear(y => y + 1); setMonth(0); }
        else setMonth(m => m + 1);
    };

    // ── Styles ──
    const stickyColW = reorderMode ? 260 : 210;

    if (!club) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>;

    return (
        <div style={{ fontFamily: FONT, padding: "20px 16px 60px", maxWidth: 1400, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", margin: 0 }}>Attendance Register</h1>
                    {gridLoading && <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>Loading…</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Search */}
                    <div style={{ position: "relative" }}>
                        <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#94a3b8" }} />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search member…"
                            style={{ paddingLeft: 28, width: 180, height: 34, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 12.5, fontWeight: 600, outline: "none" }}
                        />
                    </div>
                    {/* Month nav */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0 6px", height: 34 }}>
                        <button onClick={prevMonth} style={navBtn}><ChevronLeft style={{ width: 16, height: 16 }} /></button>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", minWidth: 110, textAlign: "center" }}>
                            {new Date(year, month).toLocaleString("en-IN", { month: "long", year: "numeric" })}
                        </span>
                        <button onClick={nextMonth} style={navBtn}><ChevronRight style={{ width: 16, height: 16 }} /></button>
                    </div>
                    {/* Reorder toggle */}
                    {reorderMode ? (
                        <button onClick={saveOrder} style={{ ...pillBtn, background: ACCENT, color: "#fff" }}>
                            <Save style={{ width: 13, height: 13 }} /> Save Order
                        </button>
                    ) : (
                        <button onClick={() => setReorderMode(true)} style={pillBtn}>
                            <GripVertical style={{ width: 13, height: 13 }} /> Reorder
                        </button>
                    )}
                </div>
            </div>

            {/* Grid */}
            <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                <div style={{ overflow: "auto", maxHeight: "calc(100vh - 170px)" }}>
                    <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: stickyColW + numDays * 44 }}>
                        {/* Header row */}
                        <thead>
                            <tr>
                                <th style={{ ...headerCell, width: stickyColW, minWidth: stickyColW, position: "sticky", left: 0, zIndex: 20, background: "#f8fafc", borderRight: "2px solid #e2e8f0", textAlign: "left", paddingLeft: 12 }}>
                                    <span style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Member</span>
                                </th>
                                {Array.from({ length: numDays }, (_, i) => {
                                    const day = i + 1;
                                    const dateStr = `${monthPrefix}-${pad(day)}`;
                                    const dow = new Date(year, month, day).getDay();
                                    const isToday = dateStr === todayStr;
                                    const isSunday = dow === 0;
                                    return (
                                        <th key={day} style={{
                                            ...headerCell,
                                            width: 42, minWidth: 42, textAlign: "center",
                                            background: isToday ? "#dcfce7" : isSunday ? "#fef2f2" : "#f8fafc",
                                            position: "sticky", top: 0, zIndex: 10,
                                        }}>
                                            <div style={{ fontSize: 9, fontWeight: 700, color: isSunday ? "#ef4444" : "#94a3b8", textTransform: "uppercase" }}>
                                                {DAYS[dow]}
                                            </div>
                                            <div style={{ fontSize: 13, fontWeight: 900, color: isToday ? ACCENT : isSunday ? "#ef4444" : "#334155" }}>
                                                {day}
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {reorderMode ? (
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                    <SortableContext items={orderedMembers.map(m => m.id)} strategy={verticalListSortingStrategy}>
                                        {orderedMembers.map((member, idx) => (
                                            <SortableMemberRow
                                                key={member.id}
                                                member={member}
                                                idx={idx}
                                                numDays={numDays}
                                                monthPrefix={monthPrefix}
                                                todayStr={todayStr}
                                                year={year}
                                                month={month}
                                                attendanceMap={attendanceMap}
                                                shakeMap={shakeMap}
                                                payMap={payMap}
                                                stickyColW={stickyColW}
                                                onCellClick={setPopup}
                                                reorderMode
                                                onMove={moveItem}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            ) : (
                                orderedMembers.map((member, idx) => (
                                    <MemberRow
                                        key={member.id}
                                        member={member}
                                        idx={idx}
                                        numDays={numDays}
                                        monthPrefix={monthPrefix}
                                        todayStr={todayStr}
                                        year={year}
                                        month={month}
                                        attendanceMap={attendanceMap}
                                        shakeMap={shakeMap}
                                        payMap={payMap}
                                        stickyColW={stickyColW}
                                        onCellClick={setPopup}
                                    />
                                ))
                            )}
                            {orderedMembers.length === 0 && (
                                <tr>
                                    <td colSpan={numDays + 1} style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>
                                        {search ? "No members match your search" : "No members found"}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Legend */}
            <div style={{ marginTop: 12, display: "flex", gap: 18, fontSize: 12, fontWeight: 700, color: "#64748b", flexWrap: "wrap", alignItems: "center" }}>
                <span>Total members: {orderedMembers.length}</span>
                <LegendDot bg="#22c55e" icon={<Check style={{ width: 10, height: 10, color: "#fff", strokeWidth: 3 }} />} label="Present + shake" />
                <LegendDot bg="#f59e0b" icon={<AlertTriangle style={{ width: 10, height: 10, color: "#fff", strokeWidth: 2.5 }} />} label="Present, no shake" />
                <LegendDot bg="#059669" icon={<IndianRupee style={{ width: 10, height: 10, color: "#fff", strokeWidth: 3 }} />} label="Payment recorded" />
                <LegendDot bg="#fbbf24" icon={<span style={{ fontSize: 8, fontWeight: 900, color: "#fff" }}>H/W</span>} label="Couple (partial)" />
                <LegendDot bg="#f1f5f9" icon={null} label="Absent" />
            </div>

            {/* Detail popup */}
            {popup && (
                <AttendanceDetailPopup
                    clubId={clubId}
                    memberId={popup.memberId}
                    date={popup.date}
                    memberName={allMembers?.find(m => m.id === popup.memberId)?.name || "Member"}
                    onClose={() => setPopup(null)}
                    onUpdated={() => {
                        qc.invalidateQueries({ queryKey: ["attendance-register", clubId, monthPrefix] });
                    }}
                />
            )}
        </div>
    );
}

// ─── Member Row ─────────────────────────────────────────────────────────
interface MemberRowProps {
    member: User;
    idx: number;
    numDays: number;
    monthPrefix: string;
    todayStr: string;
    year: number;
    month: number;
    attendanceMap?: Record<string, Record<string, Attendance>>;
    shakeMap?: Record<string, Set<string>>;
    payMap?: Record<string, Set<string>>;
    stickyColW: number;
    onCellClick: (p: { memberId: string; date: string }) => void;
    reorderMode?: boolean;
    onMove?: (id: string, dir: -1 | 1) => void;
    dragProps?: any;
}

// ─── Day status → indicator ─────────────────────────────────────────────
// Precedence for a PRESENT member on a given day:
//   💲 payment recorded  →  H/W couple-partial  →  ⚠️ no shake  →  ✓ present
type CellKind = "pay" | "couple" | "noshake" | "present" | null;
function cellKind(att: Attendance | undefined, hasShake: boolean, hasPay: boolean): CellKind {
    if (!att) return null; // absent
    if (hasPay) return "pay";
    if (att.couplePresence && att.couplePresence !== "both") return "couple";
    if (!hasShake) return "noshake";
    return "present";
}

function DayCell({ att, hasShake, hasPay, isToday, isSunday, onClick }: {
    att: Attendance | undefined; hasShake: boolean; hasPay: boolean;
    isToday: boolean; isSunday: boolean; onClick: () => void;
}) {
    const kind = cellKind(att, hasShake, hasPay);
    const dot = (bg: string, inner: React.ReactNode, title: string) => (
        <div title={title} style={{
            width: 22, height: 22, borderRadius: "50%", margin: "0 auto",
            background: bg, display: "flex", alignItems: "center", justifyContent: "center",
        }}>{inner}</div>
    );
    let content: React.ReactNode;
    if (kind === "pay") {
        content = dot("#059669", <IndianRupee style={{ width: 12, height: 12, color: "#fff", strokeWidth: 3 }} />, "Present · payment recorded");
    } else if (kind === "couple") {
        content = dot("#fbbf24", <span style={{ fontSize: 9, fontWeight: 900, color: "#fff" }}>{att!.couplePresence === "husband" ? "H" : "W"}</span>, "Present (couple — partial)");
    } else if (kind === "noshake") {
        content = dot("#f59e0b", <AlertTriangle style={{ width: 12, height: 12, color: "#fff", strokeWidth: 2.5 }} />, "Present · no shake ordered");
    } else if (kind === "present") {
        content = dot("#22c55e", <Check style={{ width: 12, height: 12, color: "#fff", strokeWidth: 3 }} />, "Present · shake ordered");
    } else {
        content = <div style={{ width: 22, height: 22, borderRadius: "50%", margin: "0 auto", background: isSunday ? "#fecaca40" : "#f1f5f9" }} />;
    }
    return (
        <td onClick={onClick} style={{
            width: 42, minWidth: 42, textAlign: "center", padding: 4, cursor: "pointer",
            background: isToday ? "#f0fdf4" : isSunday ? "#fef2f2" : undefined,
            borderTop: "1px solid #f1f5f9",
        }}>
            {content}
        </td>
    );
}

function MemberRow({ member, idx, numDays, monthPrefix, todayStr, year, month, attendanceMap, shakeMap, payMap, stickyColW, onCellClick, reorderMode, onMove, dragProps }: MemberRowProps) {
    const memberAtt = attendanceMap?.[member.id] || {};
    const memberShakes = shakeMap?.[member.id];
    const memberPays = payMap?.[member.id];
    const presentCount = Object.keys(memberAtt).length;

    return (
        <tr style={{ background: idx % 2 === 0 ? "#fff" : "#fafbfc" }}>
            <td style={{
                position: "sticky", left: 0, zIndex: 5,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                borderRight: "2px solid #e2e8f0",
                padding: "6px 8px 6px 12px",
                width: stickyColW, minWidth: stickyColW,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }} {...dragProps}>
                    {reorderMode && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                            <button onClick={() => onMove?.(member.id, -1)} style={tinyBtn}><ChevronUp style={{ width: 11, height: 11 }} /></button>
                            <GripVertical style={{ width: 14, height: 14, color: "#94a3b8", cursor: "grab" }} />
                            <button onClick={() => onMove?.(member.id, 1)} style={tinyBtn}><ChevronDown style={{ width: 11, height: 11 }} /></button>
                        </div>
                    )}
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", width: 20, textAlign: "right", flexShrink: 0 }}>{idx + 1}</span>
                    {member.photo ? (
                        <img src={member.photo} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, color: "#1e40af", flexShrink: 0 }}>
                            {(member.name || "?")[0]}
                        </div>
                    )}
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: reorderMode ? 120 : 130 }}>
                        {member.name}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginLeft: "auto", flexShrink: 0 }}>
                        {presentCount}d
                    </span>
                </div>
            </td>
            {Array.from({ length: numDays }, (_, i) => {
                const day = i + 1;
                const dateStr = `${monthPrefix}-${pad(day)}`;
                const dow = new Date(year, month, day).getDay();
                return (
                    <DayCell
                        key={day}
                        att={memberAtt[dateStr]}
                        hasShake={!!memberShakes?.has(dateStr)}
                        hasPay={!!memberPays?.has(dateStr)}
                        isToday={dateStr === todayStr}
                        isSunday={dow === 0}
                        onClick={() => onCellClick({ memberId: member.id, date: dateStr })}
                    />
                );
            })}
        </tr>
    );
}

// ─── Sortable wrapper ───────────────────────────────────────────────────
function SortableMemberRow(props: MemberRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.member.id });
    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };
    return (
        <tr ref={setNodeRef} style={{ ...style, background: props.idx % 2 === 0 ? "#fff" : "#fafbfc" }}>
            {/* Re-render the row content inside the sortable wrapper */}
            <MemberRowContent {...props} dragListeners={{ ...attributes, ...listeners }} />
        </tr>
    );
}

function MemberRowContent({ member, idx, numDays, monthPrefix, todayStr, year, month, attendanceMap, shakeMap, payMap, stickyColW, onCellClick, reorderMode, onMove, dragListeners }: MemberRowProps & { dragListeners?: any }) {
    const memberAtt = attendanceMap?.[member.id] || {};
    const memberShakes = shakeMap?.[member.id];
    const memberPays = payMap?.[member.id];
    const presentCount = Object.keys(memberAtt).length;

    return (
        <>
            <td style={{
                position: "sticky", left: 0, zIndex: 5,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                borderRight: "2px solid #e2e8f0",
                padding: "6px 8px 6px 12px",
                width: stickyColW, minWidth: stickyColW,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {reorderMode && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                            <button onClick={() => onMove?.(member.id, -1)} style={tinyBtn}><ChevronUp style={{ width: 11, height: 11 }} /></button>
                            <div {...dragListeners} style={{ cursor: "grab", lineHeight: 0 }}>
                                <GripVertical style={{ width: 14, height: 14, color: "#94a3b8" }} />
                            </div>
                            <button onClick={() => onMove?.(member.id, 1)} style={tinyBtn}><ChevronDown style={{ width: 11, height: 11 }} /></button>
                        </div>
                    )}
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", width: 20, textAlign: "right", flexShrink: 0 }}>{idx + 1}</span>
                    {member.photo ? (
                        <img src={member.photo} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, color: "#1e40af", flexShrink: 0 }}>
                            {(member.name || "?")[0]}
                        </div>
                    )}
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                        {member.name}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginLeft: "auto", flexShrink: 0 }}>
                        {presentCount}d
                    </span>
                </div>
            </td>
            {Array.from({ length: numDays }, (_, i) => {
                const day = i + 1;
                const dateStr = `${monthPrefix}-${pad(day)}`;
                const dow = new Date(year, month, day).getDay();
                return (
                    <DayCell
                        key={day}
                        att={memberAtt[dateStr]}
                        hasShake={!!memberShakes?.has(dateStr)}
                        hasPay={!!memberPays?.has(dateStr)}
                        isToday={dateStr === todayStr}
                        isSunday={dow === 0}
                        onClick={() => onCellClick({ memberId: member.id, date: dateStr })}
                    />
                );
            })}
        </>
    );
}

// ─── Detail Popup ───────────────────────────────────────────────────────
function AttendanceDetailPopup({ clubId, memberId, date, memberName, onClose, onUpdated }: {
    clubId: string; memberId: string; date: string; memberName: string;
    onClose: () => void; onUpdated: () => void;
}) {
    const qc = useQueryClient();
    const [editingAttendance, setEditingAttendance] = useState(false);
    const [editingTime, setEditingTime] = useState(false);
    const [newCheckIn, setNewCheckIn] = useState("");
    const [editingOrder, setEditingOrder] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Fetch attendance doc
    const { data: attendance, refetch: refetchAtt } = useQuery({
        queryKey: ["att-detail", clubId, memberId, date],
        queryFn: async () => {
            const snap = await getDoc(doc(db, `clubs/${clubId}/members/${memberId}/attendance`, date));
            return snap.exists() ? { id: snap.id, ...snap.data() } as Attendance : null;
        },
    });

    // Fetch orders for this member on this date
    const { data: orders, refetch: refetchOrders } = useQuery({
        queryKey: ["att-orders", clubId, memberId, date],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${clubId}/orders`), where("memberId", "==", memberId), where("date", "==", date))
            );
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        },
    });

    // Fetch payments for this member on this date (authoritative money record —
    // carries amount, payment method and reason/type).
    const { data: payments } = useQuery({
        queryKey: ["att-payments", clubId, memberId, date],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${clubId}/payments`),
                    where("memberId", "==", memberId), where("date", "==", date))
            );
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        },
    });

    // Fetch transactions for this member on this date (wallet-level activity —
    // top-ups, adjustments, referral bonuses etc. not represented as payments).
    const { data: transactions } = useQuery({
        queryKey: ["att-transactions", clubId, memberId, date],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${clubId}/members/${memberId}/transactions`), orderBy("createdAt", "desc"))
            );
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as WalletTransaction));
            return all.filter(tx => {
                if (!tx.createdAt) return false;
                const txDate = (tx.createdAt as any).toDate ? (tx.createdAt as any).toDate().toISOString().slice(0, 10) : "";
                return txDate === date;
            });
        },
    });

    const isPresent = !!attendance;

    // ── Toggle present/absent ──
    const toggleAttendance = async () => {
        setSaving(true);
        try {
            const attRef = doc(db, `clubs/${clubId}/members/${memberId}/attendance`, date);
            if (isPresent) {
                await deleteDoc(attRef);
            } else {
                await setDoc(attRef, {
                    userId: memberId,
                    userName: memberName,
                    userPhoto: "",
                    clubId,
                    type: "member",
                    checkInTime: Timestamp.now(),
                    checkOutTime: null,
                    hoursWorked: null,
                    checkInMethod: "manual",
                    date,
                });
            }
            await refetchAtt();
            onUpdated();
        } finally {
            setSaving(false);
            setEditingAttendance(false);
        }
    };

    // ── Update check-in time ──
    const updateCheckInTime = async () => {
        if (!newCheckIn || !attendance) return;
        setSaving(true);
        try {
            const [h, m] = newCheckIn.split(":").map(Number);
            const d = new Date(date);
            d.setHours(h, m, 0, 0);
            await updateDoc(doc(db, `clubs/${clubId}/members/${memberId}/attendance`, date), {
                checkInTime: Timestamp.fromDate(d),
            });
            await refetchAtt();
            onUpdated();
        } finally {
            setSaving(false);
            setEditingTime(false);
        }
    };

    // Payments (from the authoritative payments collection).
    const payReasonLabel = (p: any): string => {
        const t = (p.type || p.reason || "").toString();
        switch (t) {
            case "plan_purchase": case "membership": case "renewal": return "Membership / Plan";
            case "oneday_shake": return "One-Day Shake";
            case "product": return "Product Purchase";
            case "topup": return "Wallet Top-up";
            default: return p.description || (t ? t.replace(/_/g, " ") : "Payment");
        }
    };
    const totalPaid = (payments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);

    // Wallet-level activity that isn't already shown as a payment above.
    const PAYMENT_REASONS = new Set(["plan_purchase", "membership", "product", "oneday_shake", "renewal"]);
    const walletActivity = (transactions || []).filter(t => !PAYMENT_REASONS.has((t.reason || "") as string));

    const dateObj = new Date(date + "T00:00:00");
    const formattedDate = dateObj.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* Backdrop */}
            <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }} />
            {/* Modal */}
            <div style={{
                position: "relative", background: "#fff", borderRadius: 16, width: "90%", maxWidth: 520,
                maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}>
                {/* Header */}
                <div style={{
                    padding: "16px 20px", borderBottom: "1.5px solid #e2e8f0",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    position: "sticky", top: 0, background: "#fff", zIndex: 5, borderRadius: "16px 16px 0 0",
                }}>
                    <div>
                        <h2 style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", margin: 0 }}>{memberName}</h2>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#64748b", margin: "2px 0 0" }}>{formattedDate}</p>
                    </div>
                    <button onClick={onClose} style={{ ...iconBtn, background: "#f1f5f9" }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>

                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* 1. Attendance Status */}
                    <Section icon={<Check style={{ width: 14, height: 14 }} />} title="Attendance Status" accent={isPresent ? "#22c55e" : "#ef4444"}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{
                                        padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                                        background: isPresent ? "#dcfce7" : "#fef2f2",
                                        color: isPresent ? "#16a34a" : "#dc2626",
                                    }}>
                                        {isPresent ? "PRESENT" : "ABSENT"}
                                    </span>
                                    {attendance?.checkInMethod && (
                                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#94a3b8" }}>
                                            via {attendance.checkInMethod.replace("_", " ")}
                                        </span>
                                    )}
                                </div>
                                {isPresent && (
                                    <div style={{ marginTop: 8, display: "flex", gap: 16, fontSize: 12, fontWeight: 600, color: "#475569" }}>
                                        <span><Clock style={{ width: 12, height: 12, display: "inline", verticalAlign: -2, marginRight: 4 }} />In: {fmtTime(attendance?.checkInTime)}</span>
                                        {attendance?.checkOutTime && <span>Out: {fmtTime(attendance.checkOutTime)}</span>}
                                        {attendance?.couplePresence && (
                                            <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                                                {attendance.couplePresence === "both" ? "Both" : attendance.couplePresence === "husband" ? "Husband only" : "Wife only"}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                                {isPresent && !editingTime && (
                                    <button onClick={() => { setEditingTime(true); setNewCheckIn(""); }} style={smallEditBtn}>
                                        <Clock style={{ width: 11, height: 11 }} />
                                    </button>
                                )}
                                <button onClick={toggleAttendance} disabled={saving} style={{
                                    ...smallEditBtn,
                                    background: isPresent ? "#fef2f2" : "#dcfce7",
                                    color: isPresent ? "#dc2626" : "#16a34a",
                                }}>
                                    {isPresent ? <X style={{ width: 11, height: 11 }} /> : <Plus style={{ width: 11, height: 11 }} />}
                                </button>
                            </div>
                        </div>
                        {editingTime && (
                            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    type="time"
                                    value={newCheckIn}
                                    onChange={e => setNewCheckIn(e.target.value)}
                                    style={{ border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600 }}
                                />
                                <button onClick={updateCheckInTime} disabled={saving || !newCheckIn} style={{ ...smallEditBtn, background: "#dcfce7", color: ACCENT }}>
                                    <Save style={{ width: 11, height: 11 }} />
                                </button>
                                <button onClick={() => setEditingTime(false)} style={smallEditBtn}>
                                    <X style={{ width: 11, height: 11 }} />
                                </button>
                            </div>
                        )}
                    </Section>

                    {/* 2. Shakes Ordered */}
                    <Section icon={<Coffee style={{ width: 14, height: 14 }} />} title="Shakes Ordered" accent="#8b5cf6">
                        {orders && orders.length > 0 ? (
                            orders.map(order => (
                                <OrderCard
                                    key={order.id}
                                    order={order}
                                    clubId={clubId}
                                    isEditing={editingOrder === order.id}
                                    onEdit={() => setEditingOrder(order.id)}
                                    onCancel={() => setEditingOrder(null)}
                                    onSaved={() => { setEditingOrder(null); refetchOrders(); }}
                                />
                            ))
                        ) : (
                            <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, margin: 0 }}>No shakes ordered</p>
                        )}
                    </Section>

                    {/* 3. Payments (authoritative — amount, method, reason) */}
                    <Section icon={<IndianRupee style={{ width: 14, height: 14 }} />} title="Payments" accent="#059669">
                        {payments && payments.length > 0 ? (
                            <>
                                {payments.map((p: any) => (
                                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                                        <div>
                                            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{payReasonLabel(p)}</span>
                                            {p.paymentMethod && (
                                                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0ea5e9", background: "#e0f2fe", padding: "1px 6px", borderRadius: 4, marginLeft: 6, textTransform: "uppercase" }}>
                                                    {p.paymentMethod}
                                                </span>
                                            )}
                                            {p.description && payReasonLabel(p) !== p.description && (
                                                <p style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 600, margin: "2px 0 0" }}>{p.description}</p>
                                            )}
                                            <p style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 600, margin: "2px 0 0" }}>{fmtTime(p.createdAt)}</p>
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 800, color: "#16a34a" }}>{formatINR(Number(p.amount) || 0)}</span>
                                    </div>
                                ))}
                                <div style={{ marginTop: 6, textAlign: "right", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                                    Total paid: {formatINR(totalPaid)}
                                </div>
                            </>
                        ) : (
                            <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, margin: 0 }}>No payments recorded</p>
                        )}
                    </Section>

                    {/* 4. Other wallet activity (top-ups, adjustments, bonuses) */}
                    {walletActivity.length > 0 && (
                        <Section icon={<ShoppingBag style={{ width: 14, height: 14 }} />} title="Other Wallet Activity" accent="#f59e0b">
                            {walletActivity.map(tx => (
                                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                                    <div>
                                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                                            {tx.description || tx.reason?.replace(/_/g, " ") || "Transaction"}
                                        </span>
                                        <p style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 600, margin: "2px 0 0" }}>
                                            {fmtTime(tx.createdAt)}
                                        </p>
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: tx.type === "debit" ? "#dc2626" : "#16a34a" }}>
                                        {tx.type === "debit" ? "−" : "+"}{formatINR(tx.amount)}
                                    </span>
                                </div>
                            ))}
                        </Section>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Order Edit Card ────────────────────────────────────────────────────
function OrderCard({ order, clubId, isEditing, onEdit, onCancel, onSaved }: {
    order: Order; clubId: string; isEditing: boolean;
    onEdit: () => void; onCancel: () => void; onSaved: () => void;
}) {
    const unitPrice = (i: any) => Number(i.pricePerUnit ?? i.price ?? 0) || 0;
    const [items, setItems] = useState((order.items || []).map(i => ({ ...i })));
    const [saving, setSaving] = useState(false);

    const updateItem = (idx: number, field: string, value: any) => {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
    };
    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

    const saveChanges = async () => {
        setSaving(true);
        try {
            const totalCost = items.reduce((s, i) => s + (Number(i.quantity) || 0) * unitPrice(i), 0);
            await updateDoc(doc(db, `clubs/${clubId}/orders`, order.id), { items, totalCost });
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ background: "#faf5ff", borderRadius: 10, padding: 10, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {order.tokenNumber && (
                        <span style={{ fontSize: 10, fontWeight: 900, color: "#8b5cf6", background: "#ede9fe", padding: "2px 6px", borderRadius: 4 }}>
                            #{order.tokenNumber}
                        </span>
                    )}
                    <span style={{
                        fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                        background: order.status === "served" ? "#dcfce7" : order.status === "cancelled" || order.status === "rejected" ? "#fef2f2" : "#fef3c7",
                        color: order.status === "served" ? "#16a34a" : order.status === "cancelled" || order.status === "rejected" ? "#dc2626" : "#d97706",
                    }}>
                        {order.status.toUpperCase()}
                    </span>
                </div>
                {!isEditing ? (
                    <button onClick={onEdit} style={smallEditBtn}>
                        <Edit2 style={{ width: 11, height: 11 }} />
                    </button>
                ) : (
                    <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={saveChanges} disabled={saving} style={{ ...smallEditBtn, background: "#dcfce7", color: ACCENT }}>
                            <Save style={{ width: 11, height: 11 }} />
                        </button>
                        <button onClick={() => { setItems(order.items.map(i => ({ ...i }))); onCancel(); }} style={smallEditBtn}>
                            <X style={{ width: 11, height: 11 }} />
                        </button>
                    </div>
                )}
            </div>
            {isEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map((item, idx) => (
                        <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                                value={item.productName}
                                onChange={e => updateItem(idx, "productName", e.target.value)}
                                style={{ flex: 1, border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600 }}
                            />
                            <input
                                type="number"
                                value={item.quantity}
                                onChange={e => updateItem(idx, "quantity", parseInt(e.target.value) || 1)}
                                style={{ width: 50, border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, textAlign: "center" }}
                                min={1}
                            />
                            <button onClick={() => removeItem(idx)} style={{ ...smallEditBtn, background: "#fef2f2", color: "#dc2626" }}>
                                <Trash2 style={{ width: 11, height: 11 }} />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                (order.items || []).map((item: any, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, fontWeight: 600 }}>
                        <span style={{ color: "#334155" }}>{item.productName || item.itemName}</span>
                        <span style={{ color: "#64748b" }}>×{item.quantity || item.qty || 1} — {formatINR((Number(item.quantity ?? item.qty) || 0) * unitPrice(item))}</span>
                    </div>
                ))
            )}
            <div style={{ marginTop: 4, textAlign: "right", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                Total: {formatINR(isEditing ? items.reduce((s, i) => s + (Number(i.quantity) || 0) * unitPrice(i), 0) : (order.totalCost ?? (order as any).totalAmount))}
            </div>
        </div>
    );
}

// ─── Legend dot ─────────────────────────────────────────────────────────
function LegendDot({ bg, icon, label }: { bg: string; icon: React.ReactNode; label: string }) {
    return (
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {icon}
            </span>
            {label}
        </span>
    );
}

// ─── Section wrapper ────────────────────────────────────────────────────
function Section({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) {
    return (
        <div style={{ background: "#fafbfc", borderRadius: 12, border: "1.5px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ color: accent }}>{icon}</div>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</span>
            </div>
            <div style={{ padding: "10px 12px" }}>
                {children}
            </div>
        </div>
    );
}

// ─── Shared Styles ──────────────────────────────────────────────────────
const headerCell: CSSProperties = {
    padding: "8px 4px", fontSize: 11, fontWeight: 800, color: "#64748b",
    borderBottom: "2px solid #e2e8f0", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc",
};

const navBtn: CSSProperties = {
    background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex",
    alignItems: "center", justifyContent: "center", color: "#64748b", borderRadius: 4,
};

const pillBtn: CSSProperties = {
    display: "flex", alignItems: "center", gap: 5, padding: "0 12px", height: 34,
    border: "1.5px solid #e2e8f0", borderRadius: 8, background: "#fff",
    fontSize: 12, fontWeight: 700, color: "#334155", cursor: "pointer",
};

const tinyBtn: CSSProperties = {
    background: "none", border: "none", cursor: "pointer", padding: 0, color: "#94a3b8",
    display: "flex", alignItems: "center",
};

const iconBtn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b",
};

const smallEditBtn: CSSProperties = {
    width: 26, height: 26, borderRadius: 6, border: "1.5px solid #e2e8f0", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b",
    background: "#fff", fontSize: 0,
};
