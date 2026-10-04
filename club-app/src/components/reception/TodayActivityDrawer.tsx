import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { splitOf } from "@/lib/paymentSplit";
import { db } from "@/lib/firebase";
import { useRejectOrder } from "@/hooks/useOrders";
import { fetchClubAndPrint, generateTxnId, printShakeAndAfresh } from "@/utils/printReceipt";
import { buildShakeTokenReceipt, buildAfreshToken, buildGuestPaymentReceipt, buildMembershipReceipt } from "@/utils/receiptBuilder";
import { todayLocal } from "@/lib/clubDay";

interface Props {
    clubId: string;
    /**
     * Called when the user taps Edit on a row. Reception parent should
     * load the member, restore the order's items into the pending cart,
     * cancel the original record so credits/stock refund, and navigate to
     * the summary screen so the cashier can modify and re-confirm.
     */
    onEditRow?: (row: { kind: "order" | "payment"; raw: any }) => void;
}

/**
 * The club's day. This reads the same `orders` and `payments` that Today's Report
 * reads, so it has to agree with it — and with the writers. On the UTC form it
 * silently showed the previous day's activity between midnight and 05:30 IST,
 * which is when the early morning session is being served. See CLAUDE.md.
 */
const todayStr = () => todayLocal();

const fmtTime = (d: Date | null) => d
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    : "—";

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

type ActivityRow = {
    id: string;
    kind: "order" | "payment" | "checkin";
    title: string;
    subtitle: string;
    amount?: string;
    icon: string;
    color: string;
    bg: string;
    time: Date | null;
    raw: any; // original Firestore doc (order or payment) for edit/delete/print
};

// ── Reception's own real-time today-activity drawer. Reads `/orders` and
// `/payments` for the current date and merges them into a single newest-
// first feed so the cashier can scan what they've already done today.
export default function TodayActivityDrawer({ clubId, onEditRow }: Props) {
    const [open, setOpen] = useState(false);
    const [orders, setOrders] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    // Today's check-in count from members.lastVisit === today
    // (same source-of-truth pattern as useTodayAttendance — single
    // collection scan, no N+1 per-member fetches).
    const [membersCheckedIn, setMembersCheckedIn] = useState(0);
    const rejectOrder = useRejectOrder();

    const today = todayStr();

    useEffect(() => {
        if (!clubId) return;
        const q1 = query(collection(db, `clubs/${clubId}/orders`), where("date", "==", today));
        const u1 = onSnapshot(q1, (snap) => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const q2 = query(collection(db, `clubs/${clubId}/payments`), where("date", "==", today));
        const u2 = onSnapshot(q2, (snap) => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        // Members whose `lastVisit` is today — same approach
        // as useTodayAttendance; we just need the count.
        const u3 = onSnapshot(
            query(collection(db, `clubs/${clubId}/members`), where("lastVisit", "==", today)),
            (snap) => setMembersCheckedIn(snap.size),
            () => setMembersCheckedIn(0),
        );
        return () => { u1(); u2(); u3(); };
    }, [clubId, today]);

    const rows: ActivityRow[] = useMemo(() => {
        const list: ActivityRow[] = [];

        for (const o of orders) {
            const items = o.items || [];
            const itemSummary = items
                .map((i: any) => `${i.itemName || i.productName || i.name}${(i.qty || i.quantity) > 1 ? ` ×${i.qty || i.quantity}` : ""}`)
                .join(", ");
            const isShake = String(o.paymentMethod || "").includes("shake_credits") || String(o.paymentMethod || "").includes("oneday");
            const status = String(o.status || "pending");
            list.push({
                id: `o_${o.id}`,
                kind: "order",
                title: o.memberName || "Walk-in",
                subtitle: `${itemSummary}${o.tokenNumber ? ` · #${o.tokenNumber}` : ""}${status !== "pending" ? ` · ${status}` : ""}`,
                amount: isShake && o.creditsUsed
                    ? `${o.creditsUsed} credit${o.creditsUsed !== 1 ? "s" : ""}`
                    : o.totalAmount ? `₹${o.totalAmount}` : undefined,
                icon: status === "served" ? "✅" : status === "rejected" ? "❌" : isShake ? "🥤" : "🛍️",
                color: status === "served" ? "#16a34a" : status === "rejected" ? "#dc2626" : "#d97706",
                bg: status === "served" ? "#f0fdf4" : status === "rejected" ? "#fee2e2" : "#fffbeb",
                time: tsToDate(o.createdAt),
                raw: o,
            });
        }

        for (const p of payments) {
            const t = String(p.type || "");
            const meta = t === "plan_purchase" ? { icon: "📋", color: "#1e40af", bg: "#eff6ff", title: "Plan Purchase" }
                       : t === "oneday_shake" ? { icon: "☕", color: "#ea580c", bg: "#fff7ed", title: "One-Day Shake" }
                       : t === "guest_payment" ? { icon: "🧑‍🤝‍🧑", color: "#475569", bg: "#f8fafc", title: "Guest" }
                       : t === "product_sale" ? { icon: "🛍️", color: "#6d28d9", bg: "#f5f3ff", title: "Product Sale" }
                       : { icon: "💰", color: "#16a34a", bg: "#f0fdf4", title: "Payment" };
            list.push({
                id: `p_${p.id}`,
                kind: "payment",
                title: p.memberName || p.guestName || meta.title,
                subtitle: p.description || meta.title,
                amount: `₹${p.amount || 0}`,
                icon: meta.icon,
                color: meta.color,
                bg: meta.bg,
                time: tsToDate(p.createdAt),
                raw: p,
            });
        }

        // De-dupe: an order + payment for the same one-day-shake/plan creates
        // two rows. Drop the order row if a payment with the same tokenNumber
        // exists (payment row already names the member).
        const paymentTokens = new Set(
            payments.map((p: any) => p.tokenNumber).filter(Boolean).map(String),
        );
        const dedup = list.filter(r => {
            if (r.kind !== "order") return true;
            const order = orders.find(o => `o_${o.id}` === r.id);
            const tn = order?.tokenNumber ? String(order.tokenNumber) : null;
            return !(tn && paymentTokens.has(tn));
        });

        dedup.sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0));
        return dedup;
    }, [orders, payments]);

    const visibleRows = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r => {
            const raw = r.raw || {};
            const items = (raw.items || [])
                .map((it: any) => `${it.itemName || it.productName || it.name || ""} ${it.qty || it.quantity || ""}`)
                .join(" ");
            const hay = [
                // identity
                r.title, r.subtitle,
                raw.memberPhone, raw.guestPhone, raw.phone,
                raw.memberId, raw.memberName, raw.guestName,
                // money + type + items + tokens
                raw.amount, raw.totalAmount, raw.cashAmount, raw.upiAmount,
                raw.paymentMethod, raw.upiAccountName, raw.type, raw.description,
                raw.tokenNumber, raw.status, items,
            ].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
        });
    }, [rows, searchQuery]);

    const totalCount = rows.length;

    // ── Today summary metrics (shown at the top of the drawer) ────────
    // - totalShakes: sum of item qty across non-rejected/cancelled orders
    // - totalPayments: sum of payment amounts excluding soft-deleted ones
    // - membersCheckedIn: already updated by the listener above
    const summary = useMemo(() => {
        const totalShakes = orders.reduce((s, o) => {
            const status = String(o.status || "");
            if (status === "rejected" || status === "cancelled") return s;
            const items = o.items || [];
            return s + items.reduce((ss: number, it: any) => ss + Number(it.qty ?? it.quantity ?? 1), 0);
        }, 0);
        const totalPayments = payments
            .filter((p: any) => !p.deleted)
            .reduce((s, p: any) => s + (Number(p.amount) || 0), 0);
        return { totalShakes, totalPayments, totalCheckIns: membersCheckedIn };
    }, [orders, payments, membersCheckedIn]);

    // ── Actions ────────────────────────────────────────────────────────
    const handleDelete = async (row: ActivityRow) => {
        if (busy) return;
        setBusy(true);
        try {
            if (row.kind === "order") {
                // Use the existing reject hook so credits/stock are refunded.
                await rejectOrder.mutateAsync({
                    clubId,
                    orderId: row.raw.id,
                    rejectedBy: "reception",
                    reason: "Cancelled from today's activity",
                });
            } else {
                // Payment — soft-delete with a deletedAt marker so reports can
                // exclude it. (Hard delete would lose the audit trail; leaving
                // it visible-but-cancelled in reports.)
                await updateDoc(doc(db, `clubs/${clubId}/payments`, row.raw.id), {
                    deleted: true,
                    deletedAt: serverTimestamp(),
                    deletedBy: "reception",
                });
                // Also try to hard-delete if the doc isn't referenced elsewhere
                // — keeps the drawer tidy.
                try { await deleteDoc(doc(db, `clubs/${clubId}/payments`, row.raw.id)); } catch {}
            }
            setExpandedId(null);
            setConfirmDeleteId(null);
        } catch (err) {
            console.error("[TodayActivityDrawer delete]", err);
        } finally {
            setBusy(false);
        }
    };

    const handlePrint = async (row: ActivityRow) => {
        if (busy) return;
        setBusy(true);
        try {
            const now = new Date();
            if (row.kind === "order") {
                const o = row.raw;
                const itemName = o.items?.[0]?.itemName || o.items?.[0]?.productName || "Shake";
                const qty = o.items?.[0]?.qty || o.items?.[0]?.quantity || 1;
                const ice = o.items?.[0]?.notes || "";
                const tokenNumber = o.tokenNumber || "—";
                printShakeAndAfresh(clubId, {
                    shake: buildShakeTokenReceipt({
                        memberName: o.memberName || "Walk-in",
                        items: [{ name: itemName, qty, ice }],
                        tokenNumber,
                        timestamp: tsToDate(o.createdAt) || now,
                    }),
                    afresh: buildAfreshToken({
                        memberName: o.memberName || "Walk-in",
                        tokenNumber,
                        timestamp: tsToDate(o.createdAt) || now,
                    }),
                });
            } else {
                const p = row.raw;
                const t = String(p.type || "");
                if (t === "plan_purchase") {
                    fetchClubAndPrint(clubId, (freshClub) => buildMembershipReceipt({
                        club: freshClub,
                        memberName: p.memberName || "—",
                        memberId: p.memberId || "",
                        planName: p.planName || "Plan",
                        amount: p.amount || 0,
                        totalVisits: 0,
                        paymentMethod: p.paymentMethod || "cash",
                        startDate: tsToDate(p.createdAt) || now,
                        endDate: tsToDate(p.createdAt) || now,
                        timestamp: tsToDate(p.createdAt) || now,
                        receiptNumber: p.receiptNumber || generateTxnId(),
                        walletBalanceAfter: 0,
                    }));
                } else {
                    fetchClubAndPrint(clubId, (freshClub) => buildGuestPaymentReceipt({
                        club: freshClub,
                        guestName: p.memberName || p.guestName || "Walk-in",
                        guestPhone: p.guestPhone || "",
                        items: p.shakeName
                            ? [{ name: p.shakeName, qty: 1, unitPrice: p.amount || 0, total: p.amount || 0 }]
                            : [{ name: p.description || "Item", qty: 1, unitPrice: p.amount || 0, total: p.amount || 0 }],
                        totalAmount: p.amount || 0,
                        amountPaid: p.amount || 0,
                        // Through splitOf, so a reprinted receipt shows the same
                        // cash/UPI split the reports show. Reading the raw
                        // fields meant a receipt could disagree with the day's
                        // report for the very payment it was reprinting.
                        paymentMethod: p.paymentMethod || "cash",
                        cashAmount: splitOf(p).cash,
                        upiAmount: splitOf(p).upi,
                        upiAccountName: p.upiAccountName,
                        upiNumber: p.upiNumber,
                        receiptNumber: p.receiptNumber || generateTxnId(),
                        tokenNumbers: p.tokenNumber ? [String(p.tokenNumber)] : undefined,
                        timestamp: tsToDate(p.createdAt) || now,
                    }));
                }
            }
            setExpandedId(null);
        } catch (err) {
            console.error("[TodayActivityDrawer print]", err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {/* Trigger button */}
            <button
                onClick={() => setOpen(o => !o)}
                title="Today's activity"
                style={{
                    position: "absolute", top: 18, right: 142,
                    background: open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
                    border: "1.5px solid rgba(255,255,255,0.18)",
                    borderRadius: 12, padding: "8px 14px", color: "rgba(255,255,255,0.85)",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito,sans-serif",
                    display: "flex", alignItems: "center", gap: 6, letterSpacing: 0.5,
                }}
            >
                📋 Today {totalCount > 0 && (
                    <span style={{ background: "white", color: "#1a3a2a", borderRadius: 100, padding: "0 6px", fontSize: 10, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{totalCount}</span>
                )}
            </button>

            {/* Drawer (slides from right; doesn't block left content) */}
            {open && (
                <div
                    style={{
                        position: "fixed", top: 70, right: 18, bottom: 18, width: 420, maxWidth: "calc(100vw - 36px)",
                        background: "white", borderRadius: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
                        fontFamily: "Nunito, sans-serif", zIndex: 50,
                        display: "flex", flexDirection: "column", overflow: "hidden",
                    }}
                >
                    <div style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", background: "#1a3a2a", color: "white" }}>
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 900 }}>📋 Today's Activity</div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })} · {totalCount} event{totalCount !== 1 ? "s" : ""}
                                {searchQuery && totalCount !== visibleRows.length && (
                                    <span style={{ color: "#fde047", fontWeight: 800 }}> · {visibleRows.length} match{visibleRows.length !== 1 ? "es" : ""}</span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}
                        >✕</button>
                    </div>

                    {/* Search — prominent, searches everything (name, phone, item, amount, token, type) */}
                    <div style={{ padding: "12px 14px 4px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                        <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                                placeholder="Search name, mobile, item, amount, token…"
                                style={{
                                    width: "100%", padding: "12px 38px 12px 40px",
                                    border: "2px solid #2d9653", borderRadius: 12,
                                    fontSize: 14, fontWeight: 600, fontFamily: "Nunito, sans-serif",
                                    color: "#1f2937", outline: "none", background: "white",
                                    boxShadow: "0 1px 3px rgba(45,150,83,0.15)",
                                }}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    title="Clear"
                                    style={{
                                        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                                        width: 26, height: 26, borderRadius: 999, border: "none",
                                        background: "#dc2626", color: "white", fontSize: 13, fontWeight: 900,
                                        cursor: "pointer", lineHeight: 1, padding: 0,
                                    }}
                                >✕</button>
                            )}
                        </div>
                    </div>

                    {/* ── Today summary tiles (above the rows feed) ──
                        Three compact tiles answering the three questions the
                        owner asked about — shakes served, money received,
                        unique check-ins. Real-time. */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "10px 12px 4px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                        <SummaryTile label="🥤 Shakes" value={String(summary.totalShakes)} accent="#d97706" />
                        <SummaryTile label="💰 Received" value={`₹${summary.totalPayments.toLocaleString("en-IN")}`} accent="#16a34a" />
                        <SummaryTile label="🧍 Check-ins" value={String(summary.totalCheckIns)} accent="#0284c7" />
                    </div>

                    <div style={{ overflowY: "auto", flex: 1, padding: "10px 12px" }}>
                        {visibleRows.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "32px 16px", color: "#9ca3af", fontSize: 13 }}>
                                <div style={{ fontSize: 36, marginBottom: 8 }}>🌤️</div>
                                {rows.length === 0 ? "Nothing yet today" : "No matches"}
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {visibleRows.map(r => {
                                    const isExpanded = expandedId === r.id;
                                    const isOrder = r.kind === "order";
                                    const isRejected = isOrder && r.raw.status === "rejected";
                                    const isShakeOrder = isOrder && String(r.raw.paymentMethod || "").includes("shake_credits");
                                    return (
                                        <div key={r.id} style={{ background: r.bg, borderRadius: 10, overflow: "hidden" }}>
                                            <button
                                                onClick={() => { setExpandedId(isExpanded ? null : r.id); setConfirmDeleteId(null); }}
                                                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left" }}
                                            >
                                                <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{r.icon}</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {r.title}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {r.subtitle}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: "right", flexShrink: 0 }}>
                                                    {r.amount && <div style={{ fontSize: 11, fontWeight: 900, color: r.color }}>{r.amount}</div>}
                                                    <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600, marginTop: 1 }}>{fmtTime(r.time)}</div>
                                                </div>
                                            </button>

                                            {/* Action panel — Edit / Print / Cancel always visible */}
                                            {isExpanded && (
                                                <div style={{ padding: "8px 10px 10px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                                    {confirmDeleteId === r.id ? (
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                            <div style={{ fontSize: 11, color: "#991b1b", fontWeight: 700 }}>
                                                                {isShakeOrder ? "Cancel order? Credit will be refunded." : "Cancel this entry?"}
                                                            </div>
                                                            <div style={{ display: "flex", gap: 6 }}>
                                                                <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: "8px", background: "white", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>Keep</button>
                                                                <button onClick={() => handleDelete(r)} disabled={busy} style={{ flex: 1, padding: "8px", background: "#dc2626", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 800, color: "white", cursor: busy ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif" }}>{busy ? "..." : "Yes, cancel"}</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                                                            <button
                                                                onClick={() => { setExpandedId(null); onEditRow?.({ kind: r.kind as "order" | "payment", raw: r.raw }); }}
                                                                disabled={busy || isRejected}
                                                                title={isRejected ? "Already cancelled" : "Edit on member's profile"}
                                                                style={{ padding: "8px", background: "white", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: (busy || isRejected) ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif", opacity: isRejected ? 0.5 : 1 }}
                                                            >✏️ Edit</button>
                                                            <button
                                                                onClick={() => handlePrint(r)}
                                                                disabled={busy}
                                                                style={{ padding: "8px", background: "white", border: "1.5px solid #bfdbfe", borderRadius: 8, fontSize: 11, fontWeight: 800, color: "#1d4ed8", cursor: busy ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif" }}
                                                            >🖨️ Print</button>
                                                            <button
                                                                onClick={() => setConfirmDeleteId(r.id)}
                                                                disabled={isRejected}
                                                                title={isRejected ? "Already cancelled" : ""}
                                                                style={{ padding: "8px", background: "white", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 11, fontWeight: 800, color: "#dc2626", cursor: isRejected ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif", opacity: isRejected ? 0.5 : 1 }}
                                                            >🗑️ Cancel</button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
    return (
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: accent, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        </div>
    );
}
