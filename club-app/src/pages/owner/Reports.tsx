/**
 * Owner — Reports.
 *
 * One screen that answers, for any day / month / year:
 *   - How much money came in (cash vs UPI vs split, by source)
 *   - How many shakes were served
 *   - How many products sold
 *   - How many members visited (and who)
 *   - How many guests / walk-ins (paid + free)
 *   - What were the top shakes / top products
 *   - Full audit lists of orders + payments
 *   - Month/Year trend lines
 *
 * Cancelled / rejected orders are excluded from revenue and counts but
 * shown separately so the owner can audit them.
 */

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
    collection, collectionGroup, query, where, getDocs, onSnapshot, doc, getDoc, Timestamp,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useGuestEntriesByDate } from "@/hooks/useGuestEntries";
import {
    deletePaymentCascade, updatePaymentCascade, cancelOrderCascade,
    deleteGuestCascade, removeAttendanceCascade, deleteExpenseCascade,
    addExpenseForDate, updateExpense,
} from "@/lib/cascadeService";
import ReportDateEditModal from "@/components/owner/ReportDateEditModal";
import { fetchClubAndPrint, formatINR } from "@/utils/printReceipt";
import { buildHeader, buildFooter } from "@/utils/receiptBuilder";
import { splitOf, summarizeMoney, isWalletTopup } from "@/lib/paymentSplit";
import {
    ALIGN_CENTER, ALIGN_LEFT, BOLD_ON, BOLD_OFF,
    SIZE_MEDIUM, SIZE_NORMAL, LF, DIVIDER, DIVIDER_THIN,
    twoCol, truncate, PAPER_WIDTH,
} from "@/utils/escpos";
import {
    format, addDays, addMonths, addYears, startOfMonth, endOfMonth,
    startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval,
    isSameDay, isToday,
} from "date-fns";

// ─── Constants ───────────────────────────────────────────────────────────
type Period = "day" | "month" | "year";
const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const TABULAR: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

// ─── Helpers ─────────────────────────────────────────────────────────────
const fmt = (n: number) => Math.round(n || 0).toLocaleString("en-IN");
const fmtRs = (n: number) => "₹" + fmt(n);
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const ym = (d: Date) => format(d, "yyyy-MM");

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

// Trigger a file download from a Blob — used by CSV / JSON export.
const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// Status helpers — match Today's Report logic. A "cancelled" order is one
// the kitchen rejected (status === 'rejected') OR an explicit 'cancelled'
// status. Anything else counts toward sales/activity.
const isOrderCancelled = (o: any) => o.status === "rejected" || o.status === "cancelled";

// ─── Date range from period + anchor ─────────────────────────────────────
function computeRange(period: Period, anchor: Date): { start: Date; end: Date; label: string } {
    if (period === "day") {
        return { start: anchor, end: anchor, label: format(anchor, "EEEE, d MMM yyyy") };
    }
    if (period === "month") {
        return {
            start: startOfMonth(anchor),
            end: endOfMonth(anchor),
            label: format(anchor, "MMMM yyyy"),
        };
    }
    return {
        start: startOfYear(anchor),
        end: endOfYear(anchor),
        label: format(anchor, "yyyy"),
    };
}

// ─── Query hook: pulls everything for a date range ───────────────────────
function useReportData(clubId: string | null, period: Period, range: { start: Date; end: Date }, reloadKey = 0) {
    const [orders, setOrders] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [productSales, setProductSales] = useState<any[]>([]);
    const [topupRequests, setTopupRequests] = useState<any[]>([]);
    const [attendance, setAttendance] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const startStr = ymd(range.start);
    const endStr = ymd(range.end);
    const isLiveToday = period === "day" && isToday(range.start);

    useEffect(() => {
        if (!clubId) return;
        let cancelled = false;
        setLoading(true);

        const fetchAll = async () => {
            try {
                if (isLiveToday) {
                    // Real-time listeners for today only.
                    const subs: Array<() => void> = [];
                    subs.push(onSnapshot(
                        query(collection(db, `clubs/${clubId}/orders`), where("date", "==", startStr)),
                        snap => !cancelled && setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                    ));
                    subs.push(onSnapshot(
                        query(collection(db, `clubs/${clubId}/payments`), where("date", "==", startStr)),
                        snap => !cancelled && setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                    ));
                    subs.push(onSnapshot(
                        query(collection(db, `clubs/${clubId}/productSales`), where("date", "==", startStr)),
                        snap => !cancelled && setProductSales(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
                    ));
                    setLoading(false);
                    return () => subs.forEach(u => u());
                }

                // One-shot fetches for past dates / month / year.
                const ordersSnap = await getDocs(query(
                    collection(db, `clubs/${clubId}/orders`),
                    where("date", ">=", startStr),
                    where("date", "<=", endStr),
                ));
                const paymentsSnap = await getDocs(query(
                    collection(db, `clubs/${clubId}/payments`),
                    where("date", ">=", startStr),
                    where("date", "<=", endStr),
                ));
                const productSalesSnap = await getDocs(query(
                    collection(db, `clubs/${clubId}/productSales`),
                    where("date", ">=", startStr),
                    where("date", "<=", endStr),
                ));
                if (cancelled) return;
                setOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setPayments(paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setProductSales(productSalesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error("[Reports fetch]", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
            return undefined;
        };

        const cleanup = fetchAll();
        return () => {
            cancelled = true;
            Promise.resolve(cleanup).then(fn => typeof fn === "function" && (fn as () => void)());
        };
    }, [clubId, startStr, endStr, isLiveToday, reloadKey]);

    // Approved top-ups (separate query as date semantics differ)
    useEffect(() => {
        if (!clubId) return;
        let cancelled = false;
        getDocs(query(
            collection(db, `clubs/${clubId}/topupRequests`),
            where("status", "==", "approved"),
        )).then(snap => {
            if (cancelled) return;
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter by resolvedAt within range (in-memory).
            const startMs = range.start.getTime();
            const endMs = range.end.getTime() + 86400000 - 1;
            setTopupRequests(all.filter(r => {
                const t = tsToDate((r as any).resolvedAt) || tsToDate((r as any).requestedAt);
                if (!t) return false;
                const ms = t.getTime();
                return ms >= startMs && ms <= endMs;
            }));
        }).catch(err => console.error("[Reports topups]", err));
        return () => { cancelled = true; };
    }, [clubId, startStr, endStr]);

    // Attendance via ONE indexed collectionGroup query over the whole range,
    // replacing the old "read every member, then getDoc each member's day"
    // (1 + N reads). Member attendance docs carry userId/userName/userPhoto +
    // clubId + date + type, so a single query returns everything we render.
    // Fetched for day + month (month powers the per-day breakdown table);
    // skipped for year to avoid an unbounded read on long histories.
    useEffect(() => {
        if (!clubId || period === "year") { setAttendance([]); return; }
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDocs(query(
                    collectionGroup(db, "attendance"),
                    where("clubId", "==", clubId),
                    where("date", ">=", startStr),
                    where("date", "<=", endStr),
                ));
                if (cancelled) return;
                const rows = snap.docs
                    .filter(d => (d.data() as any).type !== "volunteer")
                    .map(d => {
                        const data = d.data() as any;
                        return {
                            memberId: d.ref.parent.parent?.id || data.userId || data.memberId || "",
                            memberName: data.userName || data.memberName || "",
                            memberPhoto: data.userPhoto || data.memberPhoto || "",
                            ...data,
                        };
                    });
                if (!cancelled) setAttendance(rows);
            } catch (err) {
                console.error("[Reports attendance]", err);
                if (!cancelled) setAttendance([]);
            }
        })();
        return () => { cancelled = true; };
    }, [clubId, startStr, endStr, period]);

    return { orders, payments, productSales, topupRequests, attendance, loading };
}

// ─── Aggregations ────────────────────────────────────────────────────────
function aggregate(orders: any[], payments: any[], productSales: any[], topupRequests: any[]) {
    const liveOrders = orders.filter(o => !isOrderCancelled(o));
    const cancelledOrders = orders.filter(o => isOrderCancelled(o));

    // Live payment docs (excluding any soft-deleted)
    const livePayments = payments.filter(p => !p.deleted);

    // Money into a wallet is not money earned — it is owed back in shakes, and
    // the wallet is being retired. Excluded from every total here, whichever
    // door it came through: the owner/reception desk writes a `wallet_topup`
    // payment doc, the member app writes a `topupRequests` doc, and counting
    // one but not the other gave the same event two different answers.
    // They still appear in the payment LISTS below — only the totals skip them.
    const isWalletTopup = (p: any) => p?.type === "wallet_topup" || p?.type === "topup";
    const revenuePayments = livePayments.filter(p => !isWalletTopup(p));

    // Cash + UPI totals (from payment docs, includes split breakdown when present)
    let cashTotal = 0;
    let upiTotal = 0;
    const upiByAccount: Record<string, { name: string; amount: number; count: number }> = {};

    for (const p of revenuePayments) {
        const { cash, upi } = splitOf(p);
        cashTotal += cash;
        upiTotal += upi;
        if (upi > 0) {
            const key = p.upiAccountId || p.upiAccountName || p.upiApp || "UPI";
            const name = p.upiAccountName || p.upiApp || "UPI";
            if (!upiByAccount[key]) upiByAccount[key] = { name, amount: 0, count: 0 };
            upiByAccount[key].amount += upi;
            upiByAccount[key].count += 1;
        }
    }
    // Wallet top-ups are NOT revenue and are deliberately excluded from every
    // total on this page. A top-up is money owed back in shakes, not money
    // earned, and the wallet is being retired — counting it here made the top
    // summary disagree with the monthly breakdown and the day table beneath it,
    // which have always totalled the payment docs alone.
    const COUNT_TOPUPS_AS_REVENUE = false;
    for (const r of COUNT_TOPUPS_AS_REVENUE ? topupRequests : []) {
        const amt = Number((r as any).approvedAmount ?? (r as any).requestedAmount) || 0;
        const { cash, upi } = splitOf({ ...(r as any), amount: amt });
        cashTotal += cash;
        upiTotal += upi;
        if (upi > 0) {
            const key = (r as any).upiAccountId || (r as any).upiAccountName || "UPI";
            const name = (r as any).upiAccountName || "UPI";
            if (!upiByAccount[key]) upiByAccount[key] = { name, amount: 0, count: 0 };
            upiByAccount[key].amount += upi;
            upiByAccount[key].count += 1;
        }
    }
    // Recover money received via a method that isn't classified as cash or
    // UPI (card / blank / "other", or a split whose breakdown is missing).
    // Previously totalRevenue = cashTotal + upiTotal, so those payments — though
    // counted in the by-source breakdown — were dropped from the total, which
    // systematically UNDER-counted monthly revenue. Add the residual back.
    let otherMethodTotal = 0;
    for (const p of revenuePayments) {
        otherMethodTotal += splitOf(p).other;
    }
    const totalRevenue = cashTotal + upiTotal + otherMethodTotal;

    // Revenue by source
    const bySource: Record<string, number> = {
        "Membership Plans": 0,
        "One-Day Shakes": 0,
        "Products": 0,
        "Guest Payments": 0,
        "Virtual Member Payments": 0,
        "Other": 0,
    };
    for (const p of revenuePayments) {
        const amt = Number(p.amount) || 0;
        switch (p.type) {
            case "plan_purchase": case "membership": bySource["Membership Plans"] += amt; break;
            case "oneday_shake": bySource["One-Day Shakes"] += amt; break;
            case "product_sale": bySource["Products"] += amt; break;
            case "guest_payment": bySource["Guest Payments"] += amt; break;
            case "virtual_member": bySource["Virtual Member Payments"] += amt; break;
            default: bySource["Other"] += amt;
        }
    }
    // No "Wallet Top-ups" row: this breakdown must add up to Total Revenue,
    // and top-ups are no longer part of it.

    // Shakes served — from orders. Each live order represents one or more
    // shakes (after the recent split, usually qty=1 each).
    // Served means served. This counted every live order including ones still
    // waiting in the kitchen, so "Shakes Served" ran ahead of reality and
    // disagreed with Today's Report, which has always counted served only.
    const shakesServed = liveOrders
        .filter(o => o.status === "served")
        .reduce((s, o) => {
            const items = o.items || [];
            return s + items.reduce((ss: number, it: any) => ss + (it.qty || it.quantity || 1), 0);
        }, 0);
    // Still useful to see what is outstanding, without inflating the served figure.
    const shakesPending = liveOrders
        .filter(o => o.status !== "served")
        .reduce((s, o) => {
            const items = o.items || [];
            return s + items.reduce((ss: number, it: any) => ss + (it.qty || it.quantity || 1), 0);
        }, 0);

    // Top shakes
    const shakeCounts: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const o of liveOrders) {
        for (const it of (o.items || [])) {
            const name = it.itemName || it.productName || it.name || "Shake";
            const q = it.qty || it.quantity || 1;
            const rev = (it.price || it.pricePerUnit || 0) * q;
            if (!shakeCounts[name]) shakeCounts[name] = { name, qty: 0, revenue: 0 };
            shakeCounts[name].qty += q;
            shakeCounts[name].revenue += rev;
        }
    }
    const topShakes = Object.values(shakeCounts).sort((a, b) => b.qty - a.qty);

    // Products sold — from productSales
    const productCounts: Record<string, { name: string; qty: number; revenue: number }> = {};
    let productsSold = 0;
    let productRevenue = 0;
    for (const ps of productSales) {
        const name = (ps as any).productName || "Product";
        const q = (ps as any).quantity || 0;
        const amt = (ps as any).totalAmount || 0;
        productsSold += q;
        productRevenue += amt;
        if (!productCounts[name]) productCounts[name] = { name, qty: 0, revenue: 0 };
        productCounts[name].qty += q;
        productCounts[name].revenue += amt;
    }
    const topProducts = Object.values(productCounts).sort((a, b) => b.qty - a.qty);

    // Top members (by spend across payments)
    const memberSpend: Record<string, { id: string; name: string; amount: number; visits: number }> = {};
    for (const p of revenuePayments) {
        if (!p.memberId) continue;
        if (!memberSpend[p.memberId]) memberSpend[p.memberId] = { id: p.memberId, name: p.memberName || "—", amount: 0, visits: 0 };
        memberSpend[p.memberId].amount += Number(p.amount) || 0;
    }
    // Top-ups excluded here too — a member who put ₹2,000 in their wallet has
    // not spent ₹2,000, and counting it made them out-spend members who
    // actually bought more.
    for (const o of liveOrders) {
        if (!o.memberId) continue;
        if (!memberSpend[o.memberId]) memberSpend[o.memberId] = { id: o.memberId, name: o.memberName || "—", amount: 0, visits: 0 };
        memberSpend[o.memberId].visits += 1;
    }
    const topMembers = Object.values(memberSpend).sort((a, b) => b.amount - a.amount);

    // What was COLLECTED as top-ups in this range, both doors. Not revenue —
    // but it is in the drawer and the bank, so the page must say it exists or
    // its totals can never be reconciled against the physical money.
    let topupsCollected = 0;
    for (const p of livePayments) { if (isWalletTopup(p)) topupsCollected += splitOf(p).amount; }
    for (const r of topupRequests) {
        topupsCollected += Number((r as any).approvedAmount ?? (r as any).requestedAmount) || 0;
    }

    return {
        liveOrders, cancelledOrders, livePayments, revenuePayments,
        cashTotal, upiTotal, totalRevenue, otherMethodTotal, topupsCollected,
        upiByAccount: Object.values(upiByAccount).sort((a, b) => b.amount - a.amount),
        bySource, shakesServed, shakesPending, topShakes,
        productsSold, productRevenue, topProducts,
        topMembers,
    };
}

// ─── Tile ────────────────────────────────────────────────────────────────
function Tile({ label, value, sub, accent = "#16a34a", icon }: {
    label: string; value: React.ReactNode; sub?: string; accent?: string; icon?: string;
}) {
    return (
        <div style={{
            background: "white", border: "1px solid #e2e8f0", borderTop: `3px solid ${accent}`,
            borderRadius: 10, padding: "16px 18px", flex: "1 1 180px", minWidth: 160,
            fontFamily: FONT,
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                {icon && <div style={{ fontSize: 16 }}>{icon}</div>}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", lineHeight: 1.05, ...TABULAR }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, fontWeight: 600 }}>{sub}</div>}
        </div>
    );
}

// ─── Section card ────────────────────────────────────────────────────────
function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 14, fontFamily: FONT }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
                {action}
            </div>
            {children}
        </div>
    );
}

// ─── Bar chart (simple SVG, no recharts) ─────────────────────────────────
function BarChart({ rows, height = 160 }: { rows: { label: string; value: number }[]; height?: number }) {
    if (rows.length === 0) return <div style={{ fontSize: 12, color: "#94a3b8", padding: "20px 0", textAlign: "center" }}>No data</div>;
    const max = Math.max(1, ...rows.map(r => r.value));
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
            {rows.map((r, i) => {
                const h = Math.max(2, (r.value / max) * (height - 30));
                return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                        <div title={`${r.label}: ${fmtRs(r.value)}`} style={{ width: "100%", height: h, background: "linear-gradient(180deg,#16a34a,#15803d)", borderRadius: "4px 4px 0 0" }} />
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{r.label}</div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main ────────────────────────────────────────────────────────────────
export default function OwnerReports() {
    const { club } = useClubContext();
    const clubId = club?.id || null;

    const [period, setPeriod] = useState<Period>("day");
    const [anchor, setAnchor] = useState<Date>(() => new Date());
    const range = useMemo(() => computeRange(period, anchor), [period, anchor]);
    const startStr = ymd(range.start);
    const endStr = ymd(range.end);

    // Bump to force a re-fetch after a manual correction is written.
    const [reloadKey, setReloadKey] = useState(0);
    const [editRange, setEditRange] = useState<{ start: string; end: string; label: string } | null>(null);
    const { orders, payments, productSales, topupRequests, attendance, loading } =
        useReportData(clubId, period, range, reloadKey);

    // Guests: use the existing hook for day-only; for range, query inline.
    const guestsDay = useGuestEntriesByDate(clubId, period === "day" ? startStr : null);
    const [guestsRange, setGuestsRange] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId || period === "day") return;
        getDocs(query(
            collection(db, `clubs/${clubId}/guestEntries`),
            where("date", ">=", ymd(range.start)),
            where("date", "<=", ymd(range.end)),
        )).then(snap => setGuestsRange(
            snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((g: any) => !g.deleted),
        ))
          .catch(() => setGuestsRange([]));
    }, [clubId, period, range.start.getTime(), range.end.getTime()]);
    const guests = period === "day" ? (guestsDay.data || []) : guestsRange;

    // Volunteers: one-shot fetch over the selected date range from the
    // `volunteerAttendance` collection. Each doc has a `date` field, so the
    // same range query works for day / month / year.
    const [volunteers, setVolunteers] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId) { setVolunteers([]); return; }
        let cancelled = false;
        getDocs(query(
            collection(db, `clubs/${clubId}/volunteerAttendance`),
            where("date", ">=", ymd(range.start)),
            where("date", "<=", ymd(range.end)),
        )).then(snap => {
            if (cancelled) return;
            setVolunteers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }).catch(err => {
            console.error("[Reports volunteers]", err);
            if (!cancelled) setVolunteers([]);
        });
        return () => { cancelled = true; };
    }, [clubId, range.start.getTime(), range.end.getTime()]);

    // New members created within the range — powers the per-day "new
    // customers" column and the monthly total. Single-field createdAt range
    // query within the club's members subcollection (no composite index).
    const [newMembers, setNewMembers] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId || period === "day") { setNewMembers([]); return; }
        let cancelled = false;
        const s = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), 0, 0, 0);
        const e = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59, 59);
        getDocs(query(
            collection(db, `clubs/${clubId}/members`),
            where("createdAt", ">=", Timestamp.fromDate(s)),
            where("createdAt", "<=", Timestamp.fromDate(e)),
        )).then(snap => { if (!cancelled) setNewMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); })
          .catch(() => { if (!cancelled) setNewMembers([]); });
        return () => { cancelled = true; };
    }, [clubId, period, range.start.getTime(), range.end.getTime()]);

    const agg = useMemo(
        () => aggregate(orders, payments, productSales, topupRequests),
        [orders, payments, productSales, topupRequests],
    );

    // ── Per-day breakdown for the monthly report ─────────────────────────
    // For each day in the month: member check-ins, distinct volunteers,
    // shakes served, new customers, and revenue split into One-Day Shakes /
    // Memberships / Products / Other. All from data already fetched.
    const monthBreakdown = useMemo(() => {
        if (period !== "month") return null;
        const days = eachDayOfInterval({ start: range.start, end: range.end });
        type Row = { date: string; members: number; vol: Set<string>; shakes: number; newCust: number; revShake: number; revMember: number; revProduct: number; revOther: number };
        const map: Record<string, Row> = {};
        for (const d of days) map[ymd(d)] = { date: ymd(d), members: 0, vol: new Set(), shakes: 0, newCust: 0, revShake: 0, revMember: 0, revProduct: 0, revOther: 0 };
        for (const a of attendance) { const r = map[(a as any).date]; if (r) r.members++; }
        for (const v of volunteers) { const r = map[(v as any).date]; if (r && (v as any).memberId) r.vol.add((v as any).memberId); }
        for (const o of orders) {
            // Served means served — the same rule the summary above uses. This
            // counted everything still waiting in the kitchen too, so the
            // breakdown ran one or two ahead of the "Shakes Served" tile.
            if ((o as any).status !== "served") continue;
            const r = map[(o as any).date]; if (!r) continue;
            r.shakes += ((o as any).items || []).reduce((s: number, it: any) => s + (Number(it.qty ?? it.quantity) || 1), 0);
        }
        for (const m of newMembers) { const t = tsToDate((m as any).createdAt); if (!t) continue; const r = map[ymd(t)]; if (r) r.newCust++; }
        for (const p of payments) {
            if ((p as any).deleted) continue;
            // Wallet top-ups are not revenue — same rule as the summary above,
            // so this table and those tiles cannot disagree.
            if ((p as any).type === "wallet_topup" || (p as any).type === "topup") continue;
            const r = map[(p as any).date]; if (!r) continue;
            const amt = Number((p as any).amount) || 0;
            switch ((p as any).type) {
                case "oneday_shake": r.revShake += amt; break;
                case "plan_purchase": case "membership": r.revMember += amt; break;
                case "product_sale": r.revProduct += amt; break;
                default: r.revOther += amt;
            }
        }
        const rows = days.map(d => {
            const r = map[ymd(d)];
            return { date: r.date, members: r.members, volunteers: r.vol.size, shakes: r.shakes, newCust: r.newCust, revShake: r.revShake, revMember: r.revMember, revProduct: r.revProduct, revOther: r.revOther, total: r.revShake + r.revMember + r.revProduct + r.revOther };
        });
        const totals = rows.reduce((t, r) => ({
            members: t.members + r.members, volunteers: t.volunteers + r.volunteers, shakes: t.shakes + r.shakes,
            newCust: t.newCust + r.newCust, revShake: t.revShake + r.revShake, revMember: t.revMember + r.revMember,
            revProduct: t.revProduct + r.revProduct, revOther: t.revOther + r.revOther, total: t.total + r.total,
        }), { members: 0, volunteers: 0, shakes: 0, newCust: 0, revShake: 0, revMember: 0, revProduct: 0, revOther: 0, total: 0 });
        const membershipsSold = payments.filter((p: any) => !p.deleted && (p.type === "plan_purchase" || p.type === "membership")).length;
        return { rows, totals, membershipsSold };
    }, [period, range.start.getTime(), range.end.getTime(), attendance, volunteers, orders, payments, newMembers]); // eslint-disable-line react-hooks/exhaustive-deps

    // Members visited (day = from attendance scan; range = unique memberIds from orders)
    const membersVisited = useMemo(() => {
        if (period === "day") return attendance.length;
        const ids = new Set<string>();
        for (const o of agg.liveOrders) { if (o.memberId) ids.add(o.memberId); }
        for (const p of agg.livePayments) { if (p.memberId) ids.add(p.memberId); }
        return ids.size;
    }, [period, attendance, agg.liveOrders, agg.livePayments]);

    // Guests breakdown
    const guestsPaid = guests.filter((g: any) => g.type === "paid").length;
    const guestsFree = guests.filter((g: any) => g.type !== "paid").length;
    const guestRevenue = guests.reduce((s, g: any) => s + (g.amountPaid || 0), 0);

    // ─── Search + filter state ───────────────────────────────────────────
    // Single search box filters every list below. Mode chips filter by
    // cash/UPI. Source chips filter payments by their `type` field.
    const [searchQuery, setSearchQuery] = useState("");
    const [modeFilter, setModeFilter] = useState<"all" | "cash" | "upi">("all");
    const [sourceFilter, setSourceFilter] = useState<"all" | "membership" | "shake" | "product" | "guest" | "topup" | "virtual">("all");
    const [showCancelled, setShowCancelled] = useState(false);

    // Defer the search text so typing stays responsive even when the page
    // re-renders dozens of long lists. The input updates immediately; the
    // filtered lists below catch up after the user pauses.
    const deferredQuery = useDeferredValue(searchQuery);
    const q = deferredQuery.trim().toLowerCase();
    const anyMatch = (...vals: any[]) =>
        !q || vals.some(v => v != null && String(v).toLowerCase().includes(q));

    const matchesSource = (type: string | undefined) => {
        if (sourceFilter === "all") return true;
        if (sourceFilter === "membership") return type === "plan_purchase" || type === "membership";
        if (sourceFilter === "shake") return type === "oneday_shake";
        if (sourceFilter === "product") return type === "product_sale";
        if (sourceFilter === "guest") return type === "guest_payment";
        if (sourceFilter === "topup") return type === "topup";
        if (sourceFilter === "virtual") return type === "virtual_member";
        return true;
    };

    const matchesMode = (p: any) => {
        if (modeFilter === "all") return true;
        const { cash, upi } = splitOf(p);
        if (modeFilter === "cash") return cash > 0;
        if (modeFilter === "upi") return upi > 0;
        return true;
    };

    const filteredAttendance = useMemo(
        () => attendance.filter(a => anyMatch(a.memberName)),
        [attendance, q],
    );
    const filteredGuests = useMemo(
        () => (guests as any[]).filter(g => anyMatch(g.guestName, g.guestPhone)),
        [guests, q],
    );
    const filteredVolunteers = useMemo(
        () => volunteers.filter(v => anyMatch(v.memberName)),
        [volunteers, q],
    );
    const filteredOrders = useMemo(() => {
        const pool = showCancelled ? orders : agg.liveOrders;
        return pool.filter(o => anyMatch(
            o.memberName, o.tokenNumber,
            (o.items || []).map((i: any) => i.itemName || i.productName || i.name).join(" "),
        ));
    }, [orders, agg.liveOrders, showCancelled, q]);
    const filteredPayments = useMemo(
        () => agg.livePayments.filter(p =>
            anyMatch(p.memberName, p.guestName, p.type, p.paymentMethod, p.upiAccountName, p.amount, p.description)
            && matchesSource(p.type)
            && matchesMode(p),
        ),
        [agg.livePayments, q, sourceFilter, modeFilter],
    );
    const filteredCancelled = useMemo(
        () => agg.cancelledOrders.filter(o => anyMatch(
            o.memberName, o.tokenNumber, o.rejectReason,
            (o.items || []).map((i: any) => i.itemName || i.productName || i.name).join(" "),
        )),
        [agg.cancelledOrders, q],
    );
    const filteredTopShakes = useMemo(() => agg.topShakes.filter(s => anyMatch(s.name)), [agg.topShakes, q]);
    const filteredTopProducts = useMemo(() => agg.topProducts.filter(p => anyMatch(p.name)), [agg.topProducts, q]);
    const filteredTopMembers = useMemo(() => agg.topMembers.filter(m => anyMatch(m.name)), [agg.topMembers, q]);
    const filteredUpiByAccount = useMemo(() => agg.upiByAccount.filter(u => anyMatch(u.name)), [agg.upiByAccount, q]);

    const filtersActive = !!q || modeFilter !== "all" || sourceFilter !== "all" || showCancelled;
    const clearFilters = () => { setSearchQuery(""); setModeFilter("all"); setSourceFilter("all"); setShowCancelled(false); };

    // ── Cascade actions UI state ──────────────────────────────────────────
    // One generic confirm modal for destructive actions; an edit modal for
    // payment amount/mode changes. Both close on success and the live
    // listeners refresh the page automatically.
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        reversesPreview: string[];   // bullets shown to admin BEFORE confirming
        accentColor: string;
        run: () => Promise<void>;
    } | null>(null);
    const [editingPayment, setEditingPayment] = useState<any | null>(null);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    // Expenses for the selected date (live listener) + Add Expense form state
    const [expenses, setExpenses] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId) { setExpenses([]); return; }
        if (period !== "day") {
            // Month/year: pull every expense in the range (one-shot).
            (async () => {
                try {
                    const snap = await getDocs(query(
                        collection(db, `clubs/${clubId}/expenses`),
                        where("date", ">=", startStr),
                        where("date", "<=", endStr),
                    ));
                    setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((e: any) => !e.deleted));
                } catch (err) { console.error("[expenses range]", err); }
            })();
            return;
        }
        // Day view: live listener for the selected date
        const u = onSnapshot(
            query(collection(db, `clubs/${clubId}/expenses`), where("date", "==", startStr)),
            (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((e: any) => !e.deleted)),
            (err) => console.error("[expenses live]", err),
        );
        return () => u();
    }, [clubId, startStr, endStr, period]);

    const expensesTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const [showExpenseForm, setShowExpenseForm] = useState(false);
    const [expenseName, setExpenseName] = useState("");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseAmount, setExpenseAmount] = useState("");

    const showToast = (kind: "ok" | "err", text: string) => {
        setToast({ kind, text });
        setTimeout(() => setToast(null), 5000);
    };

    // ── Cascade action helpers — each wraps the service call with the
    // standard confirm → run → toast → refresh dance, so the row-level
    // handlers below stay tiny.
    const handleDeletePayment = (p: any) => {
        setConfirmAction({
            title: "Delete this payment?",
            message: `${p.type} of ₹${p.amount} for ${p.memberName || p.guestName || "—"} on ${p.date}`,
            reversesPreview: buildPaymentDeletePreview(p),
            accentColor: "#dc2626",
            run: async () => {
                setBusy(true);
                const res = await deletePaymentCascade(clubId, p);
                setBusy(false);
                if (res.ok) {
                    showToast("ok", `Deleted · ${res.reversed.length} effect${res.reversed.length !== 1 ? "s" : ""} reversed${res.skipped.length ? ` · ${res.skipped.length} skipped` : ""}`);
                } else {
                    showToast("err", res.errorMessage || "Delete failed");
                }
            },
        });
    };

    const handleCancelOrder = (o: any) => {
        setConfirmAction({
            title: "Cancel this order?",
            message: `${o.memberName || "Walk-in"} · ${(o.items || []).map((i: any) => i.itemName || i.productName).join(", ")}`,
            reversesPreview: buildOrderCancelPreview(o),
            accentColor: "#dc2626",
            run: async () => {
                setBusy(true);
                const res = await cancelOrderCascade(clubId, o);
                setBusy(false);
                if (res.ok) {
                    showToast("ok", `Cancelled · ${res.reversed.join("; ")}`);
                } else showToast("err", res.errorMessage || "Cancel failed");
            },
        });
    };

    const handleDeleteGuest = (g: any) => {
        setConfirmAction({
            title: "Delete this guest entry?",
            message: `${g.guestName || "Guest"}${g.guestPhone ? ` · ${g.guestPhone}` : ""}`,
            reversesPreview: ["Guest entry hidden from reports", g.type === "paid" ? `₹${g.amountPaid} removed from guest revenue` : ""].filter(Boolean) as string[],
            accentColor: "#dc2626",
            run: async () => {
                setBusy(true);
                const res = await deleteGuestCascade(clubId, g);
                setBusy(false);
                if (res.ok) showToast("ok", "Guest entry deleted");
                else showToast("err", res.errorMessage || "Delete failed");
            },
        });
    };

    const handleRemoveAttendance = (a: any) => {
        setConfirmAction({
            title: "Remove this check-in?",
            message: `${a.memberName} on ${startStr}`,
            reversesPreview: ["Attendance record removed", "Member's lastVisit cleared"],
            accentColor: "#dc2626",
            run: async () => {
                setBusy(true);
                const res = await removeAttendanceCascade(clubId, a.memberId, startStr, a.memberName || "—");
                setBusy(false);
                if (res.ok) showToast("ok", "Attendance removed");
                else showToast("err", res.errorMessage || "Remove failed");
            },
        });
    };

    const handleDeleteExpense = (e: any) => {
        setConfirmAction({
            title: "Delete this expense?",
            message: `${e.description || "—"} · ₹${e.amount}`,
            reversesPreview: ["Expense hidden from reports (it doesn't affect revenue)"],
            accentColor: "#dc2626",
            run: async () => {
                setBusy(true);
                const res = await deleteExpenseCascade(clubId, e);
                setBusy(false);
                if (res.ok) showToast("ok", "Expense deleted");
                else showToast("err", res.errorMessage || "Delete failed");
            },
        });
    };

    const handleAddExpense = async () => {
        const amt = Number(expenseAmount);
        if (!expenseDesc.trim()) { showToast("err", "Description required"); return; }
        if (!amt || amt <= 0) { showToast("err", "Valid amount required"); return; }
        setBusy(true);
        const res = await addExpenseForDate(clubId, expenseDesc.trim(), amt, startStr, expenseName.trim());
        setBusy(false);
        if (res.ok) {
            showToast("ok", `Expense added for ${startStr}`);
            setExpenseName(""); setExpenseDesc(""); setExpenseAmount(""); setShowExpenseForm(false);
        } else showToast("err", res.errorMessage || "Could not add expense");
    };

    // Inline edit for an existing expense (description + amount). Safe — no cascade.
    const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
    const [editExpName, setEditExpName] = useState("");
    const [editExpDesc, setEditExpDesc] = useState("");
    const [editExpAmount, setEditExpAmount] = useState("");
    const beginEditExpense = (e: any) => { setEditingExpenseId(e.id); setEditExpName(e.name || ""); setEditExpDesc(e.description || ""); setEditExpAmount(String(e.amount ?? "")); };
    const saveEditExpense = async (e: any) => {
        if (!clubId) return;
        const amt = Number(editExpAmount);
        if (!editExpDesc.trim()) { showToast("err", "Description required"); return; }
        if (!amt || amt <= 0) { showToast("err", "Valid amount required"); return; }
        setBusy(true);
        const res = await updateExpense(clubId, e, { name: editExpName.trim(), description: editExpDesc.trim(), amount: amt });
        setBusy(false);
        if (res.ok) { showToast("ok", "Expense updated"); setEditingExpenseId(null); }
        else showToast("err", res.errorMessage || "Could not update expense");
    };

    // ─── Export dialog state ─────────────────────────────────────────────
    // The "Export" button opens a modal where the user ticks which sections
    // to include and picks a format. Replaces the old "print everything"
    // buttons that would dump 1000-row PDFs.
    const ALL_SECTIONS: Array<{ id: string; label: string; range?: "day" | "range" | "dayMonth" }> = [
        { id: "summary",        label: "Summary (totals & KPIs)" },
        { id: "bySource",       label: "Revenue by source" },
        { id: "upiByAccount",   label: "UPI by account" },
        { id: "topShakes",      label: "Top shakes" },
        { id: "topProducts",    label: "Top products" },
        { id: "topMembers",     label: "Top members (spend & visits)", range: "range" },
        { id: "trend",          label: "Daily / monthly breakdown", range: "range" },
        { id: "membersVisited", label: "Member check-ins", range: "dayMonth" },
        { id: "volunteers",     label: "Volunteers" },
        { id: "guests",         label: "Guests / walk-ins" },
        { id: "orders",         label: "All orders" },
        { id: "payments",       label: "All payments" },
        { id: "expenses",       label: "Expenses" },
        { id: "topups",         label: "Wallet top-ups" },
        { id: "cancelled",      label: "Cancelled orders" },
    ];
    const visibleSections = ALL_SECTIONS.filter(s => {
        if (!s.range) return true;
        if (s.range === "day") return period === "day";
        if (s.range === "dayMonth") return period !== "year"; // day + month (attendance fetched)
        return period !== "day"; // "range" → month / year only
    });

    const [exportOpen, setExportOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<"pdf" | "excel" | "csv" | "json">("pdf");
    // Default OFF so an export contains the FULL period (everything visible),
    // not just rows matching whatever filter happens to be active on screen.
    const [exportUseFilters, setExportUseFilters] = useState(false);
    // Default to EVERY section so a plain "download" is complete out of the box;
    // the user can untick what they don't want.
    const [exportSections, setExportSections] = useState<Set<string>>(
        () => new Set(visibleSections.map(s => s.id)),
    );
    const toggleSection = (id: string) => setExportSections(s => {
        const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
    });
    const selectAllSections = () => setExportSections(new Set(visibleSections.map(s => s.id)));
    const selectNoSections = () => setExportSections(new Set());

    // ── Thermal print section picker ─────────────────────────────────────
    // The 🧾 Thermal button opens a picker so the owner chooses which blocks
    // go on the receipt (this is the section-chooser moved here from the
    // Reception "Today's Report" modal). Volunteers/orders aren't thermal
    // sections, so they're excluded from the list.
    const thermalSectionList = visibleSections.filter(s => !["volunteers", "orders", "expenses"].includes(s.id));
    const [thermalOpen, setThermalOpen] = useState(false);
    const [thermalSections, setThermalSections] = useState<Set<string>>(
        () => new Set(["summary", "bySource", "upiByAccount", "topShakes", "topProducts"]),
    );
    const toggleThermalSection = (id: string) => setThermalSections(s => {
        const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
    });

    // Daily/monthly trend rows for month/year view
    const trendRows = useMemo(() => {
        if (period === "month") {
            const days = eachDayOfInterval({ start: range.start, end: range.end });
            return days.map(d => {
                const ds = ymd(d);
                const ordersOn = orders.filter(o => o.date === ds && !isOrderCancelled(o));
                const paymentsOn = payments.filter(p => p.date === ds && !p.deleted);
                const cash = paymentsOn.reduce((s, p) => s + splitOf(p).cash, 0);
                const upi = paymentsOn.reduce((s, p) => s + splitOf(p).upi, 0);
                return { label: format(d, "d"), date: ds, value: cash + upi, shakes: ordersOn.length };
            });
        }
        if (period === "year") {
            const months = eachMonthOfInterval({ start: range.start, end: range.end });
            return months.map(m => {
                const mPrefix = ym(m);
                const paymentsOn = payments.filter(p => (p.date || "").startsWith(mPrefix) && !p.deleted);
                const cash = paymentsOn.reduce((s, p) => s + splitOf(p).cash, 0);
                const upi = paymentsOn.reduce((s, p) => s + splitOf(p).upi, 0);
                const ordersOn = orders.filter(o => (o.date || "").startsWith(mPrefix) && !isOrderCancelled(o));
                return { label: format(m, "MMM"), date: mPrefix, value: cash + upi, shakes: ordersOn.length };
            });
        }
        return [];
    }, [period, range.start.getTime(), range.end.getTime(), orders, payments]);

    // ─── Navigation ──────────────────────────────────────────────────────
    const goPrev = () => setAnchor(a => period === "day" ? addDays(a, -1) : period === "month" ? addMonths(a, -1) : addYears(a, -1));
    const goNext = () => setAnchor(a => period === "day" ? addDays(a, 1) : period === "month" ? addMonths(a, 1) : addYears(a, 1));
    const goToday = () => setAnchor(new Date());

    // ─── Export data resolver ────────────────────────────────────────────
    // Returns either filtered or unfiltered slices depending on the dialog
    // toggle. Every builder (PDF/Excel/CSV/JSON) calls this once so output
    // is consistent.
    const getExportData = (useFilters: boolean) => ({
        orders:       useFilters ? filteredOrders       : (showCancelled ? orders : agg.liveOrders),
        payments:     useFilters ? filteredPayments     : agg.livePayments,
        cancelled:    useFilters ? filteredCancelled    : agg.cancelledOrders,
        topShakes:    useFilters ? filteredTopShakes    : agg.topShakes,
        topProducts:  useFilters ? filteredTopProducts  : agg.topProducts,
        topMembers:   useFilters ? filteredTopMembers   : agg.topMembers,
        upiByAccount: useFilters ? filteredUpiByAccount : agg.upiByAccount,
        attendance:   useFilters ? filteredAttendance   : attendance,
        guests:       (useFilters ? filteredGuests      : guests) as any[],
        volunteers:   useFilters ? filteredVolunteers   : volunteers,
        topups:       topupRequests,
        // Expenses aren't search-filtered (they don't carry member/source
        // metadata) — always the full list for the selected period.
        expenses,
    });

    // ─── Excel export (comprehensive, styled workbook) ───────────────────
    // Builds a complete audit workbook — not just the summary. A rich
    // Summary + Revenue-by-source, a full day-wise breakdown (month/year),
    // and transaction-level sheets (orders, payments, check-ins, guests,
    // volunteers, expenses) plus the Top tables. Styled via `xlsx-js-style`
    // (coloured/bold headers, zebra rows, ₹ number formats, auto widths),
    // which is loaded lazily so the styling build only ships on export.
    const exportExcel = async (included: Set<string>, useFilters: boolean) => {
        const XLSX: any = await import("xlsx-js-style");
        const data = getExportData(useFilters);
        const wb = XLSX.utils.book_new();

        // ── Palette + style primitives ───────────────────────────────────
        const C = {
            title: "0F172A", header: "16A34A", band: "DCFCE7",
            zebra: "F8FAFC", total: "FEF3C7", white: "FFFFFF", label: "334155",
        };
        const RUPEE = '"₹"#,##0';
        const thin = { style: "thin", color: { rgb: "E2E8F0" } };
        const border = { top: thin, bottom: thin, left: thin, right: thin };
        const titleStyle = { font: { bold: true, sz: 14, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.title } }, alignment: { horizontal: "left", vertical: "center" } };
        const headerStyle = { font: { bold: true, sz: 11, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.header } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border };

        const timeStr = (t: any) => tsToDate(t)?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) || "";
        const fmtMins = (m: any) => { const n = Number(m); if (!n || n <= 0) return ""; const h = Math.floor(n / 60), mm = n % 60; return h ? `${h}h ${mm}m` : `${mm}m`; };

        const setStyle = (ws: any, r: number, c: number, s: any) => {
            const ref = XLSX.utils.encode_cell({ r, c });
            if (!ws[ref]) ws[ref] = { t: "s", v: "" };
            ws[ref].s = { ...(ws[ref].s || {}), ...s };
        };
        const add = (ws: any, name: string) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));

        // Generic table sheet: title banner → coloured header row → zebra
        // body. `money` columns get the ₹ format + right alignment; an
        // optional totals row is highlighted.
        type Col = { header: string; width?: number; money?: boolean; align?: string };
        const tableSheet = (titleText: string, columns: Col[], rows: any[][], opts: { totalsRow?: boolean } = {}) => {
            const ncol = columns.length;
            const aoa: any[][] = [[titleText], [], columns.map(c => c.header), ...rows];
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws["!cols"] = columns.map(c => ({ wch: c.width || 16 }));
            ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, ncol - 1) } }];
            setStyle(ws, 0, 0, titleStyle);
            for (let c = 0; c < ncol; c++) setStyle(ws, 2, c, headerStyle);
            const first = 3, last = first + rows.length - 1;
            for (let r = first; r <= last; r++) {
                const isTotal = !!opts.totalsRow && r === last;
                const zebra = !isTotal && ((r - first) % 2 === 1);
                for (let c = 0; c < ncol; c++) {
                    const col = columns[c];
                    const st: any = { border, alignment: { horizontal: col.align || (col.money ? "right" : "left"), vertical: "center" } };
                    if (isTotal) { st.font = { bold: true }; st.fill = { fgColor: { rgb: C.total } }; }
                    else if (zebra) st.fill = { fgColor: { rgb: C.zebra } };
                    setStyle(ws, r, c, st);
                    if (col.money) {
                        const ref = XLSX.utils.encode_cell({ r, c });
                        if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = RUPEE;
                    }
                }
            }
            return ws;
        };

        // ── 1. Summary (label/value with coloured section bands) ─────────
        if (included.has("summary")) {
            let cardTotal = 0, splitCount = 0, otherTotal = 0;
            for (const p of data.payments) {
                const amt = Number(p.amount) || 0;
                const { cash, upi } = splitOf(p);
                if (p.paymentMethod === "card") cardTotal += amt;
                if (p.paymentMethod === "split" || (cash > 0 && upi > 0)) splitCount++;
                const residual = amt - cash - upi;
                if (residual > 0.5 && p.paymentMethod !== "card") otherTotal += residual;
            }
            const distinctVolunteers = new Set(data.volunteers.map((v: any) => v.memberId || v.id)).size;
            const sumRows: Array<[string, any, any?]> = [
                ["Report", range.label],
                ["Period", period.toUpperCase()],
                ["Generated", new Date().toLocaleString("en-IN")],
                ["Filters", useFilters && filtersActive ? `search="${searchQuery}" mode=${modeFilter} source=${sourceFilter}` : "None"],
                ["COLLECTIONS", "", { section: true }],
                ["Total Revenue", agg.totalRevenue, { money: true, bold: true }],
                ["Cash Revenue", agg.cashTotal, { money: true }],
                ["UPI Revenue", agg.upiTotal, { money: true }],
                ["Card Revenue", cardTotal, { money: true }],
                ["Other / Unclassified", otherTotal, { money: true }],
                ["Split Payments (count)", splitCount],
                ["Total Expenses", expensesTotal, { money: true }],
                ["Net Collection", agg.totalRevenue - expensesTotal, { money: true, bold: true }],
                ["ACTIVITY", "", { section: true }],
                ["Total Shakes", agg.shakesServed],
                ["Products Sold", agg.productsSold],
                ["Member Check-ins", membersVisited],
                ["Total Guests", data.guests.length],
                ["Total Volunteers", distinctVolunteers],
                ["Total Orders", agg.liveOrders.length],
                ["Cancelled Orders", agg.cancelledOrders.length],
                ["Wallet Top-ups", data.topups.length],
            ];
            const aoa: any[][] = [["REPORT SUMMARY"], []];
            for (const [label, value, meta] of sumRows) aoa.push(meta && (meta as any).section ? [label] : [label, value]);
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws["!cols"] = [{ wch: 30 }, { wch: 24 }];
            ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
            setStyle(ws, 0, 0, titleStyle);
            sumRows.forEach((row, i) => {
                const r = i + 2;
                const m: any = row[2] || {};
                if (m.section) {
                    setStyle(ws, r, 0, { font: { bold: true, sz: 11, color: { rgb: C.header } }, fill: { fgColor: { rgb: C.band } } });
                    setStyle(ws, r, 1, { fill: { fgColor: { rgb: C.band } } });
                    ws["!merges"].push({ s: { r, c: 0 }, e: { r, c: 1 } });
                } else {
                    setStyle(ws, r, 0, { font: { bold: !!m.bold, color: { rgb: C.label } } });
                    setStyle(ws, r, 1, { alignment: { horizontal: "right" }, font: m.bold ? { bold: true } : undefined });
                    if (m.money) {
                        const ref = XLSX.utils.encode_cell({ r, c: 1 });
                        if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = RUPEE;
                    }
                }
            });
            add(ws, "Summary");
        }

        // ── 2. Revenue by source ─────────────────────────────────────────
        if (included.has("bySource")) {
            const rows: any[][] = (Object.entries(agg.bySource) as [string, number][])
                .map(([k, v]) => [k, v, agg.totalRevenue > 0 ? Math.round((v / agg.totalRevenue) * 100) + "%" : "0%"]);
            rows.push(["TOTAL", agg.totalRevenue, "100%"]);
            add(tableSheet("REVENUE BY SOURCE", [
                { header: "Source", width: 28 },
                { header: "Amount", width: 16, money: true },
                { header: "Share", width: 10, align: "right" },
            ], rows, { totalsRow: true }), "Revenue by Source");
        }

        // ── 3. Day-wise breakdown (month → full table, year → monthly) ───
        if (included.has("trend")) {
            if (period === "month" && monthBreakdown) {
                const guestByDay: Record<string, number> = {};
                const prodByDay: Record<string, number> = {};
                const memByDay: Record<string, number> = {};
                const expByDay: Record<string, number> = {};
                for (const g of data.guests) { const d = (g as any).date; if (d) guestByDay[d] = (guestByDay[d] || 0) + 1; }
                for (const ps of productSales as any[]) { const d = ps.date; if (d) prodByDay[d] = (prodByDay[d] || 0) + (Number(ps.quantity) || 0); }
                for (const p of payments as any[]) { if (p.deleted) continue; if (p.type === "plan_purchase" || p.type === "membership") { const d = p.date; if (d) memByDay[d] = (memByDay[d] || 0) + 1; } }
                for (const e of data.expenses as any[]) { const d = e.date; if (d) expByDay[d] = (expByDay[d] || 0) + (Number(e.amount) || 0); }
                const sumOf = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
                const rows: any[][] = monthBreakdown.rows.map(r => [
                    r.date, r.total, r.members, guestByDay[r.date] || 0, r.shakes,
                    prodByDay[r.date] || 0, memByDay[r.date] || 0, r.volunteers, expByDay[r.date] || 0,
                ]);
                const t = monthBreakdown.totals;
                rows.push(["TOTAL", t.total, t.members, sumOf(guestByDay), t.shakes, sumOf(prodByDay), monthBreakdown.membershipsSold, t.volunteers, sumOf(expByDay)]);
                add(tableSheet("DAILY BREAKDOWN", [
                    { header: "Date", width: 12 }, { header: "Revenue", width: 14, money: true },
                    { header: "Members", width: 9, align: "right" }, { header: "Guests", width: 8, align: "right" },
                    { header: "Shakes", width: 8, align: "right" }, { header: "Products", width: 9, align: "right" },
                    { header: "Memberships", width: 12, align: "right" }, { header: "Volunteers", width: 11, align: "right" },
                    { header: "Expenses", width: 12, money: true },
                ], rows, { totalsRow: true }), "Daily Breakdown");
            } else if (trendRows.length > 0) {
                const rows: any[][] = trendRows.map(r => [r.date, r.value, r.shakes]);
                rows.push(["TOTAL", trendRows.reduce((s, r) => s + r.value, 0), trendRows.reduce((s, r) => s + r.shakes, 0)]);
                add(tableSheet(period === "year" ? "MONTHLY BREAKDOWN" : "DAILY BREAKDOWN", [
                    { header: period === "year" ? "Month" : "Day", width: 14 },
                    { header: "Revenue", width: 14, money: true },
                    { header: "Orders", width: 10, align: "right" },
                ], rows, { totalsRow: true }), period === "year" ? "Monthly Breakdown" : "Daily Breakdown");
            }
        }

        // ── 4. All orders ────────────────────────────────────────────────
        if (included.has("orders")) {
            const sorted = [...data.orders].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
            const rows: any[][] = sorted.map(o => {
                const items = o.items || [];
                const qty = items.reduce((s: number, it: any) => s + (Number(it.qty ?? it.quantity) || 1), 0);
                return [
                    o.date || "", timeStr(o.createdAt),
                    o.memberName || "Walk-in", o.memberId || "", o.memberPhone || "",
                    o.memberId ? "Member" : "Walk-in",
                    items.map((it: any) => `${it.itemName || it.productName || it.name || "Shake"} ×${it.qty || it.quantity || 1}`).join(", "),
                    qty, Number(o.totalAmount) || 0,
                    o.walletDeducted ? "Wallet" : (o.paymentMethod || ""), o.status || "",
                ];
            });
            add(tableSheet("ALL ORDERS", [
                { header: "Date", width: 12 }, { header: "Time", width: 10 },
                { header: "Member", width: 22 }, { header: "Member ID", width: 16 },
                { header: "Mobile", width: 14 }, { header: "Order Type", width: 11 },
                { header: "Shake / Items", width: 34 }, { header: "Qty", width: 7, align: "right" },
                { header: "Amount", width: 12, money: true }, { header: "Payment", width: 11 },
                { header: "Status", width: 11 },
            ], rows), "Orders");
        }

        // ── 5. All payments ──────────────────────────────────────────────
        if (included.has("payments")) {
            const sorted = [...data.payments].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
            const methodLabel = (p: any) => {
                const amt = Number(p.amount) || 0;
                const { cash, upi } = splitOf(p);
                if (cash > 0 && upi > 0) return `Split (₹${fmt(cash)} cash / ₹${fmt(upi)} UPI)`;
                if (upi > 0) return `UPI${p.upiAccountName ? ` · ${p.upiAccountName}` : ""}`;
                if (cash > 0) return "Cash";
                return p.paymentMethod || "";
            };
            const rows: any[][] = sorted.map(p => [
                p.date || "", timeStr(p.createdAt),
                p.memberName || p.guestName || "", p.memberId || "",
                p.type || "",
                p.planName || (p.type === "plan_purchase" || p.type === "membership" ? (p.description || "") : ""),
                p.type === "product_sale" ? (p.productName || p.description || "") : "",
                Number(p.amount) || 0, methodLabel(p),
                p.recordedBy || p.accountantVerifiedBy || "",
                p.notes || p.description || "",
            ]);
            add(tableSheet("ALL PAYMENTS", [
                { header: "Date", width: 12 }, { header: "Time", width: 10 },
                { header: "Member / Guest", width: 22 }, { header: "Member ID", width: 16 },
                { header: "Type", width: 14 }, { header: "Membership", width: 18 },
                { header: "Products", width: 18 }, { header: "Amount", width: 12, money: true },
                { header: "Cash / UPI / Split", width: 26 }, { header: "Accountant", width: 16 },
                { header: "Remarks", width: 24 },
            ], rows), "Payments");
        }

        // ── 6. Member check-ins (cross-refs orders for "shake ordered") ──
        if (included.has("membersVisited")) {
            const orderItemsByKey: Record<string, string[]> = {};
            for (const o of data.orders) {
                const key = `${o.memberId || ""}|${o.date || ""}`;
                const names = (o.items || []).map((it: any) => `${it.itemName || it.productName || it.name || "Shake"}${(it.qty || it.quantity || 1) > 1 ? ` ×${it.qty || it.quantity}` : ""}`);
                if (!orderItemsByKey[key]) orderItemsByKey[key] = [];
                orderItemsByKey[key].push(...names);
            }
            const sorted = [...data.attendance].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.checkInTime)?.getTime() ?? 0) - (tsToDate(b.checkInTime)?.getTime() ?? 0));
            const rows: any[][] = sorted.map((a: any) => {
                const shake = (orderItemsByKey[`${a.memberId || ""}|${a.date || ""}`] || []).join(", ");
                const status = `Present${a.checkInMethod ? ` (${a.checkInMethod})` : ""}${a.couplePresence ? ` · ${a.couplePresence}` : ""}`;
                return [a.date || "", timeStr(a.checkInTime), a.memberName || "—", a.memberId || "", shake, status];
            });
            add(tableSheet("MEMBER CHECK-INS", [
                { header: "Date", width: 12 }, { header: "Time", width: 10 },
                { header: "Member", width: 24 }, { header: "Member ID", width: 16 },
                { header: "Shake Ordered", width: 30 }, { header: "Status", width: 22 },
            ], rows), "Member Check-ins");
        }

        // ── 7. Guest entries ─────────────────────────────────────────────
        if (included.has("guests")) {
            const sorted = [...data.guests].sort((a: any, b: any) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
            const rows: any[][] = sorted.map((g: any) => [
                g.guestName || "Guest", g.guestPhone || "",
                g.invitedBy?.name || g.invitedByName || "",
                g.date || "", timeStr(g.createdAt),
                g.type === "paid" ? "Paid" : "Complimentary",
                Number(g.amountPaid) || 0,
            ]);
            add(tableSheet("GUEST ENTRIES", [
                { header: "Guest Name", width: 22 }, { header: "Mobile", width: 14 },
                { header: "Invited By", width: 20 }, { header: "Date", width: 12 },
                { header: "Time", width: 10 }, { header: "Type", width: 14 },
                { header: "Revenue", width: 12, money: true },
            ], rows), "Guests");
        }

        // ── 8. Volunteers ────────────────────────────────────────────────
        if (included.has("volunteers")) {
            const sorted = [...data.volunteers].sort((a: any, b: any) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.loginTime)?.getTime() ?? 0) - (tsToDate(b.loginTime)?.getTime() ?? 0));
            const rows: any[][] = sorted.map((v: any) => [
                v.date || "", v.memberName || "—",
                timeStr(v.loginTime), timeStr(v.logoutTime),
                fmtMins(v.totalMinutes), v.status || (v.logoutTime ? "Completed" : "Active"),
            ]);
            add(tableSheet("VOLUNTEERS", [
                { header: "Date", width: 12 }, { header: "Volunteer", width: 24 },
                { header: "Check-in", width: 12 }, { header: "Check-out", width: 12 },
                { header: "Duration", width: 12, align: "right" }, { header: "Status", width: 14 },
            ], rows), "Volunteers");
        }

        // ── 9. Expenses ──────────────────────────────────────────────────
        if (included.has("expenses")) {
            const sorted = [...data.expenses].sort((a: any, b: any) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
            const rows: any[][] = sorted.map((e: any) => [
                e.date || "", timeStr(e.createdAt), e.name || "", e.description || "", Number(e.amount) || 0,
            ]);
            rows.push(["TOTAL", "", "", "", expensesTotal]);
            add(tableSheet("EXPENSES", [
                { header: "Date", width: 12 }, { header: "Time", width: 10 },
                { header: "Name", width: 18 }, { header: "Description", width: 36 },
                { header: "Amount", width: 12, money: true },
            ], rows, { totalsRow: true }), "Expenses");
        }

        // ── 10. UPI by account + Top tables ──────────────────────────────
        if (included.has("upiByAccount")) {
            add(tableSheet("UPI BY ACCOUNT", [
                { header: "Account", width: 24 }, { header: "Txns", width: 8, align: "right" },
                { header: "Amount", width: 14, money: true },
            ], data.upiByAccount.map(u => [u.name, u.count, u.amount])), "UPI Accounts");
        }
        if (included.has("topShakes")) {
            add(tableSheet("TOP SHAKES", [
                { header: "#", width: 5, align: "right" }, { header: "Shake", width: 28 },
                { header: "Qty", width: 8, align: "right" }, { header: "Revenue", width: 14, money: true },
            ], data.topShakes.map((s, i) => [i + 1, s.name, s.qty, s.revenue])), "Top Shakes");
        }
        if (included.has("topProducts")) {
            add(tableSheet("TOP PRODUCTS", [
                { header: "#", width: 5, align: "right" }, { header: "Product", width: 28 },
                { header: "Qty", width: 8, align: "right" }, { header: "Revenue", width: 14, money: true },
            ], data.topProducts.map((p, i) => [i + 1, p.name, p.qty, p.revenue])), "Top Products");
        }
        if (included.has("topMembers")) {
            const cols: Col[] = [
                { header: "#", width: 5, align: "right" }, { header: "Member", width: 24 },
                { header: "Member ID", width: 16 }, { header: "Visits", width: 8, align: "right" },
                { header: "Spend", width: 14, money: true },
            ];
            const bySpend = [...data.topMembers].sort((a, b) => b.amount - a.amount);
            add(tableSheet("TOP MEMBERS BY SPENDING", cols, bySpend.map((m, i) => [i + 1, m.name, m.id, m.visits, m.amount])), "Top Members (Spend)");
            const byVisits = [...data.topMembers].filter(m => m.visits > 0).sort((a, b) => b.visits - a.visits);
            if (byVisits.length > 0) {
                add(tableSheet("TOP MEMBERS BY VISITS", cols, byVisits.map((m, i) => [i + 1, m.name, m.id, m.visits, m.amount])), "Top Members (Visits)");
            }
        }
        if (included.has("topups")) {
            add(tableSheet("WALLET TOP-UPS", [
                { header: "Member", width: 24 }, { header: "Member ID", width: 16 },
                { header: "Method", width: 12 }, { header: "UPI Account", width: 18 },
                { header: "Amount", width: 14, money: true },
            ], data.topups.map((r: any) => [
                r.memberName || "", r.memberId || "", r.paymentMethod || "", r.upiAccountName || "",
                Number(r.approvedAmount ?? r.requestedAmount) || 0,
            ])), "Top-ups");
        }
        if (included.has("cancelled")) {
            add(tableSheet("CANCELLED / REJECTED ORDERS", [
                { header: "Date", width: 12 }, { header: "Time", width: 10 },
                { header: "Member", width: 22 }, { header: "Items", width: 32 },
                { header: "Reason", width: 18 }, { header: "Amount", width: 12, money: true },
            ], data.cancelled.map(o => [
                o.date || "", timeStr(o.rejectedAt || o.createdAt), o.memberName || "Walk-in",
                (o.items || []).map((it: any) => `${it.itemName || it.productName} ×${it.qty || it.quantity || 1}`).join(", "),
                o.rejectReason || "rejected", Number(o.totalAmount) || 0,
            ])), "Cancelled");
        }

        if (wb.SheetNames.length === 0) {
            // No sheets — XLSX would throw. Give the user a clear hint.
            alert("Pick at least one section to export.");
            return;
        }
        XLSX.writeFile(wb, `report_${period}_${ymd(range.start)}.xlsx`);
    };

    const printSummary = (sel?: Set<string>) => {
        if (!clubId) return;
        // `sel` = which sections to include (from the thermal section picker).
        // Undefined → include everything (back-compat).
        const want = (id: string) => !sel || sel.has(id);

        const periodTitle =
            period === "day" ? "DAILY REPORT" :
            period === "month" ? "MONTHLY REPORT" : "YEARLY REPORT";

        const sectionHeader = (title: string): string[] => [
            DIVIDER_THIN + "\n",
            BOLD_ON, title + "\n", BOLD_OFF,
        ];

        const trendTotal = trendRows.reduce((s, r) => s + r.value, 0);
        const trendShakes = trendRows.reduce((s, r) => s + r.shakes, 0);

        fetchClubAndPrint(clubId, (freshClub) => {
            const lines: string[] = [
                ...buildHeader(freshClub),
                LF,
                ALIGN_CENTER, BOLD_ON, SIZE_MEDIUM,
                periodTitle + "\n",
                SIZE_NORMAL, BOLD_OFF, ALIGN_LEFT,
                ALIGN_CENTER, range.label + "\n", ALIGN_LEFT,
                "Generated: " + new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + "\n",
            ];

            // ── Revenue summary ──────────────────────────────────────
            if (want("summary")) {
                lines.push(
                    ...sectionHeader("REVENUE SUMMARY"),
                    twoCol("Total Revenue", formatINR(agg.totalRevenue)) + "\n",
                    twoCol("Cash", formatINR(agg.cashTotal)) + "\n",
                    twoCol("UPI", formatINR(agg.upiTotal)) + "\n",
                    twoCol("Payments", String(agg.livePayments.length + topupRequests.length)) + "\n",
                    twoCol("Shakes Served", String(agg.shakesServed)) + "\n",
                    twoCol("Orders", String(agg.liveOrders.length)) + "\n",
                    twoCol("Products Sold", String(agg.productsSold)) + "\n",
                    twoCol("Product Revenue", formatINR(agg.productRevenue)) + "\n",
                    twoCol("Members Visited", String(membersVisited)) + "\n",
                    twoCol("Guests", `${guests.length} (${guestsPaid}p/${guestsFree}f)`) + "\n",
                    twoCol("Guest Revenue", formatINR(guestRevenue)) + "\n",
                    ...(agg.cancelledOrders.length > 0 ? [twoCol("Cancelled", String(agg.cancelledOrders.length)) + "\n"] : []),
                );
            }

            // ── Revenue by source ────────────────────────────────────
            if (want("bySource")) {
                lines.push(...sectionHeader("REVENUE BY SOURCE"));
                const rows = Object.entries(agg.bySource)
                    .filter(([_, v]) => (v as number) > 0)
                    .sort(([, a], [, b]) => (b as number) - (a as number));
                if (rows.length === 0) lines.push("(none)\n");
                else lines.push(...rows.map(([k, v]) =>
                    twoCol(`${truncate(k, 20)} ${pct(v as number, agg.totalRevenue)}%`, formatINR(v as number)) + "\n"));
            }

            // ── UPI by account ───────────────────────────────────────
            if (want("upiByAccount")) {
                lines.push(...sectionHeader("UPI BY ACCOUNT"));
                lines.push(...(agg.upiByAccount.length === 0
                    ? ["(none)\n"]
                    : agg.upiByAccount.map(u => twoCol(`${truncate(u.name, 18)} x${u.count}`, formatINR(u.amount)) + "\n")));
            }

            // ── Top shakes ───────────────────────────────────────────
            if (want("topShakes")) {
                lines.push(...sectionHeader(`TOP SHAKES (${agg.topShakes.length})`));
                lines.push(...(agg.topShakes.length === 0
                    ? ["(none)\n"]
                    : agg.topShakes.slice(0, 25).map((s, i) => twoCol(`${i + 1}. ${truncate(s.name, 18)} x${s.qty}`, formatINR(s.revenue)) + "\n")));
            }

            // ── Top products ─────────────────────────────────────────
            if (want("topProducts")) {
                lines.push(...sectionHeader(`TOP PRODUCTS (${agg.topProducts.length})`));
                lines.push(...(agg.topProducts.length === 0
                    ? ["(none)\n"]
                    : agg.topProducts.slice(0, 25).map((p, i) => twoCol(`${i + 1}. ${truncate(p.name, 18)} x${p.qty}`, formatINR(p.revenue)) + "\n")));
            }

            // ── Top members (range only) ─────────────────────────────────
            if (want("topMembers") && period !== "day" && agg.topMembers.length > 0) {
                lines.push(...sectionHeader(`TOP MEMBERS (${Math.min(agg.topMembers.length, 20)})`));
                lines.push(...agg.topMembers.slice(0, 20).map((m, i) =>
                    twoCol(`${i + 1}. ${truncate(m.name, 18)} (${m.visits}v)`, formatINR(m.amount)) + "\n"
                ));
            }

            // ── Daily / Monthly breakdown (range only) ───────────────────
            if (want("trend") && period !== "day" && trendRows.length > 0) {
                lines.push(...sectionHeader(period === "month" ? "DAILY BREAKDOWN" : "MONTHLY BREAKDOWN"));
                lines.push(twoCol(period === "month" ? "Day" : "Month", "Revenue / Ord") + "\n");
                lines.push(...trendRows
                    .filter(r => r.value > 0 || r.shakes > 0)
                    .map(r => twoCol(truncate(r.label, 12), `${formatINR(r.value)} / ${r.shakes}`) + "\n"));
                lines.push(DIVIDER_THIN + "\n");
                lines.push(BOLD_ON);
                lines.push(twoCol("Total", `${formatINR(trendTotal)} / ${trendShakes}`) + "\n");
                lines.push(BOLD_OFF);
            }

            // ── Members visited (day only) ───────────────────────────────
            if (want("membersVisited") && period === "day" && attendance.length > 0) {
                lines.push(...sectionHeader(`MEMBERS VISITED (${attendance.length})`));
                const sorted = [...attendance].sort((a, b) =>
                    (tsToDate(a.checkInTime)?.getTime() ?? 0) - (tsToDate(b.checkInTime)?.getTime() ?? 0));
                lines.push(...sorted.map((a, i) => {
                    const t = tsToDate(a.checkInTime);
                    const ts = t ? t.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
                    return twoCol(`${i + 1}. ${truncate(a.memberName || "—", 22)}`, ts) + "\n";
                }));
            }

            // ── Guests ───────────────────────────────────────────────────
            if (want("guests") && guests.length > 0) {
                lines.push(...sectionHeader(`GUESTS (${guests.length})`));
                lines.push(...guests.map((g: any, i: number) => {
                    const right = g.type === "paid" ? formatINR(g.amountPaid || 0) : "Free";
                    return twoCol(`${i + 1}. ${truncate(g.guestName || "Guest", 22)}`, right) + "\n";
                }));
            }

            // ── All payments ─────────────────────────────────────────────
            if (want("payments") && agg.livePayments.length > 0) {
                lines.push(...sectionHeader(`PAYMENTS (${agg.livePayments.length})`));
                const sortedPays = [...agg.livePayments].sort((a, b) =>
                    (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
                lines.push(...sortedPays.map((p, i) => {
                    const who = p.memberName || p.guestName || "—";
                    const m = p.paymentMethod ? p.paymentMethod[0].toUpperCase() : "?";
                    return twoCol(`${i + 1}. ${truncate(who, 18)} [${m}]`, formatINR(p.amount || 0)) + "\n";
                }));
            }

            // ── Wallet top-ups ───────────────────────────────────────────
            if (want("topups") && topupRequests.length > 0) {
                lines.push(...sectionHeader(`WALLET TOP-UPS (${topupRequests.length})`));
                lines.push(...topupRequests.map((r: any, i: number) => {
                    const amt = Number(r.approvedAmount ?? r.requestedAmount) || 0;
                    return twoCol(`${i + 1}. ${truncate(r.memberName || "—", 22)}`, formatINR(amt)) + "\n";
                }));
            }

            // ── Cancelled orders ─────────────────────────────────────────
            if (want("cancelled") && agg.cancelledOrders.length > 0) {
                lines.push(...sectionHeader(`CANCELLED (${agg.cancelledOrders.length})`));
                lines.push(...agg.cancelledOrders.map((o, i) => {
                    const who = o.memberName || "Walk-in";
                    const amt = o.totalAmount ? formatINR(o.totalAmount) : `${o.creditsUsed || 0}cr`;
                    return twoCol(`${i + 1}. ${truncate(who, 22)}`, amt) + "\n";
                }));
            }

            // ── Grand total banner ───────────────────────────────────────
            lines.push(DIVIDER + "\n");
            lines.push(ALIGN_CENTER, BOLD_ON, SIZE_MEDIUM);
            lines.push("TOTAL " + formatINR(agg.totalRevenue) + "\n");
            lines.push(SIZE_NORMAL, BOLD_OFF, ALIGN_LEFT);

            lines.push(...buildFooter());
            void PAPER_WIDTH; // silence unused-import warning if tree-shaken
            return lines;
        });
    };

    // ─── PDF / printable export ──────────────────────────────────────────
    // Builds an A4 HTML page with only the sections the user ticked, then
    // opens print dialog (user can "Save as PDF" from there). Replaces the
    // old "print everything" report which was 1000+ pages on a busy year.
    const printPdf = (included: Set<string>, useFilters: boolean) => {
        const data = getExportData(useFilters);
        const win = window.open("", "_blank", "width=900,height=1100");
        if (!win) return;

        const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
        const timeStr = (t: any) => {
            const d = tsToDate(t);
            return d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "—";
        };

        const sortedOrders = [...data.orders].sort((a, b) => (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));
        const sortedPayments = [...data.payments].sort((a, b) => (tsToDate(a.createdAt)?.getTime() ?? 0) - (tsToDate(b.createdAt)?.getTime() ?? 0));

        // ── Compose only the requested sections ──────────────────────────
        const summaryBlock = included.has("summary") ? `
<div class="totals">
  <div><div style="font-size: 10px; opacity: 0.7;">TOTAL REVENUE</div><div class="v">${fmtRs(agg.totalRevenue)}</div></div>
  <div><div style="font-size: 10px; opacity: 0.7;">CASH</div><div class="v">${fmtRs(agg.cashTotal)}</div></div>
  <div><div style="font-size: 10px; opacity: 0.7;">UPI</div><div class="v">${fmtRs(agg.upiTotal)}</div></div>
  <div><div style="font-size: 10px; opacity: 0.7;">PAYMENTS</div><div class="v">${fmt(agg.livePayments.length + topupRequests.length)}</div></div>
</div>
<div class="kpis">
  <div class="kpi"><div class="l">Shakes Served</div><div class="v">${fmt(agg.shakesServed)}</div><div class="s">${agg.liveOrders.length} orders</div></div>
  <div class="kpi"><div class="l">Products Sold</div><div class="v">${fmt(agg.productsSold)}</div><div class="s">${fmtRs(agg.productRevenue)}</div></div>
  <div class="kpi"><div class="l">Members Visited</div><div class="v">${fmt(membersVisited)}</div><div class="s">${period === "day" ? "checked in" : "unique"}</div></div>
  <div class="kpi"><div class="l">Guests</div><div class="v">${fmt(data.guests.length)}</div><div class="s">${guestsPaid} paid · ${guestsFree} free · ${fmtRs(guestRevenue)}</div></div>
</div>` : "";

        const bySourceBlock = included.has("bySource") ? `
<div>
  <h2>Revenue by Source</h2>
  <table>
    <thead><tr><th>Source</th><th class="num">Amount</th><th class="num">%</th></tr></thead>
    <tbody>
      ${Object.entries(agg.bySource).filter(([_, v]) => (v as number) > 0).sort(([, a], [, b]) => (b as number) - (a as number)).map(([k, v]) => `
        <tr><td>${esc(k)}</td><td class="num">${fmtRs(v as number)}</td><td class="num">${pct(v as number, agg.totalRevenue)}%</td></tr>
      `).join("") || `<tr><td colspan="3" class="empty">No revenue</td></tr>`}
    </tbody>
  </table>
</div>` : "";

        const upiBlock = included.has("upiByAccount") ? `
<div>
  <h2>UPI by Account</h2>
  <table>
    <thead><tr><th>Account</th><th class="num">Txns</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${data.upiByAccount.map(u => `
        <tr><td>${esc(u.name)}</td><td class="num">${u.count}</td><td class="num">${fmtRs(u.amount)}</td></tr>
      `).join("") || `<tr><td colspan="3" class="empty">No UPI receipts</td></tr>`}
    </tbody>
  </table>
</div>` : "";

        const topShakesBlock = included.has("topShakes") ? `
<div>
  <h2>Top Shakes (${data.topShakes.length})</h2>
  <table>
    <thead><tr><th>#</th><th>Shake</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead>
    <tbody>
      ${data.topShakes.map((s, i) => `
        <tr><td>${i + 1}</td><td>${esc(s.name)}</td><td class="num">${fmt(s.qty)}</td><td class="num">${fmtRs(s.revenue)}</td></tr>
      `).join("") || `<tr><td colspan="4" class="empty">No shakes</td></tr>`}
    </tbody>
  </table>
</div>` : "";

        const topProductsBlock = included.has("topProducts") ? `
<div>
  <h2>Top Products (${data.topProducts.length})</h2>
  <table>
    <thead><tr><th>#</th><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead>
    <tbody>
      ${data.topProducts.map((p, i) => `
        <tr><td>${i + 1}</td><td>${esc(p.name)}</td><td class="num">${fmt(p.qty)}</td><td class="num">${fmtRs(p.revenue)}</td></tr>
      `).join("") || `<tr><td colspan="4" class="empty">No products</td></tr>`}
    </tbody>
  </table>
</div>` : "";

        // Helper: wrap one or two side-by-side blocks. If only one is
        // present, render it full-width so the layout doesn't look broken.
        const pair = (a: string, b: string) => {
            if (a && b) return `<div class="two-col">${a}${b}</div>`;
            return a || b;
        };

        const topMembersBlock = (included.has("topMembers") && period !== "day" && data.topMembers.length > 0) ? `
<h2>Top Members by Spend</h2>
<table>
  <thead><tr><th>#</th><th>Member</th><th class="num">Visits</th><th class="num">Spend</th></tr></thead>
  <tbody>
    ${data.topMembers.slice(0, 30).map((m, i) => `
      <tr><td>${i + 1}</td><td>${esc(m.name)}</td><td class="num">${m.visits}</td><td class="num">${fmtRs(m.amount)}</td></tr>
    `).join("")}
  </tbody>
</table>` : "";

        const trendBlock = (included.has("trend") && period !== "day" && trendRows.length > 0) ? `
<h2>${period === "month" ? "Daily Breakdown" : "Monthly Breakdown"}</h2>
<table>
  <thead><tr><th>${period === "month" ? "Day" : "Month"}</th><th class="num">Revenue</th><th class="num">Orders</th></tr></thead>
  <tbody>
    ${trendRows.map(r => `
      <tr><td>${esc(r.label)}${period === "month" ? ` (${esc(r.date)})` : ""}</td><td class="num">${fmtRs(r.value)}</td><td class="num">${fmt(r.shakes)}</td></tr>
    `).join("")}
    <tr style="font-weight: 800; background: #f1f5f9;">
      <td>Total</td>
      <td class="num">${fmtRs(trendRows.reduce((s, r) => s + r.value, 0))}</td>
      <td class="num">${fmt(trendRows.reduce((s, r) => s + r.shakes, 0))}</td>
    </tr>
  </tbody>
</table>` : "";

        const attendanceBlock = (included.has("membersVisited") && period !== "year" && data.attendance.length > 0) ? `
<h2>Member Check-ins (${data.attendance.length})</h2>
<table>
  <thead><tr><th>#</th><th>Name</th>${period === "day" ? "" : "<th>Date</th>"}<th>Check-in</th></tr></thead>
  <tbody>
    ${[...data.attendance].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (tsToDate(a.checkInTime)?.getTime() ?? 0) - (tsToDate(b.checkInTime)?.getTime() ?? 0)).map((a, i) => `
      <tr><td>${i + 1}</td><td>${esc(a.memberName || "—")}</td>${period === "day" ? "" : `<td>${esc(a.date || "")}</td>`}<td>${esc(timeStr(a.checkInTime))}</td></tr>
    `).join("")}
  </tbody>
</table>` : "";

        const fmtMinutes = (mins: number | null | undefined) => {
            if (mins == null) return "—";
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            if (h > 0) return `${h}h ${m}m`;
            return `${m}m`;
        };
        const volunteersBlock = (included.has("volunteers") && data.volunteers.length > 0) ? `
<h2>Volunteers (${data.volunteers.length})</h2>
<table>
  <thead><tr><th>#</th><th>Name</th><th>Date</th><th>Login</th><th>Logout</th><th class="num">Duration</th><th>Status</th></tr></thead>
  <tbody>
    ${[...data.volunteers].sort((a: any, b: any) => {
        const da = (a.date || "").localeCompare(b.date || "");
        if (da !== 0) return da;
        return (tsToDate(a.loginTime)?.getTime() ?? 0) - (tsToDate(b.loginTime)?.getTime() ?? 0);
    }).map((v: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(v.memberName || "—")}</td>
        <td>${esc(v.date || "")}</td>
        <td>${esc(timeStr(v.loginTime))}</td>
        <td>${esc(timeStr(v.logoutTime))}</td>
        <td class="num">${esc(fmtMinutes(v.totalMinutes))}</td>
        <td>${esc(v.status || "—")}</td>
      </tr>
    `).join("")}
  </tbody>
</table>` : "";

        const guestsBlock = (included.has("guests") && data.guests.length > 0) ? `
<h2>Guests / Walk-ins (${data.guests.length} · ${fmtRs(guestRevenue)})</h2>
<table>
  <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Items</th><th>Type</th><th class="num">Amount</th></tr></thead>
  <tbody>
    ${data.guests.map((g: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(g.guestName || "Guest")}</td>
        <td>${esc(g.guestPhone || "—")}</td>
        <td>${esc((g.items || []).map((it: any) => `${it.productName} ×${it.qty}`).join(", "))}</td>
        <td>${g.type === "paid" ? "Paid" : "Free"}</td>
        <td class="num">${g.type === "paid" ? fmtRs(g.amountPaid || 0) : "—"}</td>
      </tr>
    `).join("")}
  </tbody>
</table>` : "";

        const ordersBlock = included.has("orders") ? `
<h2>All Orders (${sortedOrders.length})</h2>
<table>
  <thead><tr><th>#</th><th>Time</th><th>Date</th><th>Member</th><th>Items</th><th>Token</th><th>Status</th><th class="num">Amount</th></tr></thead>
  <tbody>
    ${sortedOrders.map((o, i) => {
      const cls = o.status === "served" ? "b-served" : (o.status === "rejected" || o.status === "cancelled") ? "b-rejected" : "b-other";
      const amt = o.totalAmount ? fmtRs(o.totalAmount) : `${o.creditsUsed || 0} cr`;
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(timeStr(o.createdAt))}</td>
        <td>${esc(o.date || "")}</td>
        <td>${esc(o.memberName || "Walk-in")}</td>
        <td>${esc((o.items || []).map((it: any) => `${it.itemName || it.productName} ×${it.qty || it.quantity || 1}`).join(", "))}</td>
        <td>#${esc(o.tokenNumber || "—")}</td>
        <td><span class="badge ${cls}">${esc(o.status || "—")}</span></td>
        <td class="num">${amt}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" class="empty">No orders</td></tr>`}
  </tbody>
</table>` : "";

        const paymentsBlock = included.has("payments") ? `
<h2>All Payments (${sortedPayments.length})</h2>
<table>
  <thead><tr><th>#</th><th>Time</th><th>Date</th><th>Member / Guest</th><th>Type</th><th>Method</th><th class="num">Cash</th><th class="num">UPI</th><th class="num">Total</th></tr></thead>
  <tbody>
    ${sortedPayments.map((p, i) => {
      // Through splitOf, like every other total on this page. These three
      // columns are the ones a person adds up by hand, and they used to be
      // built from the raw fields with the old broken fallback — a payment
      // storing cashAmount next to a method of "upi" printed its full amount
      // in BOTH columns, so the hand-added columns beat the Total column.
      const s = splitOf(p);
      return `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(timeStr(p.createdAt))}</td>
        <td>${esc(p.date || "")}</td>
        <td>${esc(p.memberName || p.guestName || "—")}</td>
        <td>${esc(p.type || "—")}</td>
        <td>${esc(p.paymentMethod || "—")}${p.upiAccountName ? ` (${esc(p.upiAccountName)})` : ""}</td>
        <td class="num">${fmtRs(s.cash)}</td>
        <td class="num">${fmtRs(s.upi)}</td>
        <td class="num">${fmtRs(s.amount)}</td>
      </tr>
    `; }).join("") || `<tr><td colspan="9" class="empty">No payments</td></tr>`}
  </tbody>
  ${sortedPayments.length ? `<tfoot><tr style="font-weight:800;background:#f1f5f9">
    <td colspan="6">TOTAL — ${sortedPayments.length} payment${sortedPayments.length === 1 ? "" : "s"}</td>
    <td class="num">${fmtRs(sortedPayments.reduce((t, p) => t + splitOf(p).cash, 0))}</td>
    <td class="num">${fmtRs(sortedPayments.reduce((t, p) => t + splitOf(p).upi, 0))}</td>
    <td class="num">${fmtRs(sortedPayments.reduce((t, p) => t + splitOf(p).amount, 0))}</td>
  </tr></tfoot>` : ""}
</table>` : "";

        const topupsBlock = (included.has("topups") && data.topups.length > 0) ? `
<h2>Wallet Top-ups (${data.topups.length})</h2>
<table>
  <thead><tr><th>#</th><th>Member</th><th>Method</th><th class="num">Amount</th></tr></thead>
  <tbody>
    ${data.topups.map((r: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(r.memberName || "—")}</td>
        <td>${esc(r.paymentMethod || "—")}${r.upiAccountName ? ` (${esc(r.upiAccountName)})` : ""}</td>
        <td class="num">${fmtRs(Number(r.approvedAmount ?? r.requestedAmount) || 0)}</td>
      </tr>
    `).join("")}
  </tbody>
</table>` : "";

        const cancelledBlock = (included.has("cancelled") && data.cancelled.length > 0) ? `
<h2>Cancelled / Rejected Orders (${data.cancelled.length})</h2>
<table>
  <thead><tr><th>#</th><th>Time</th><th>Member</th><th>Items</th><th>Reason</th><th class="num">Amount</th></tr></thead>
  <tbody>
    ${data.cancelled.map((o, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(timeStr(o.rejectedAt) || timeStr(o.createdAt))}</td>
        <td>${esc(o.memberName || "Walk-in")}</td>
        <td>${esc((o.items || []).map((it: any) => `${it.itemName || it.productName} ×${it.qty || it.quantity || 1}`).join(", "))}</td>
        <td>${esc(o.rejectReason || "rejected")}</td>
        <td class="num">${o.totalAmount ? fmtRs(o.totalAmount) : `${o.creditsUsed || 0} cr`}</td>
      </tr>
    `).join("")}
  </tbody>
</table>` : "";

        const expensesBlock = (included.has("expenses") && (data.expenses || []).length > 0) ? `
<h2>Expenses (${data.expenses.length} · ${fmtRs(expensesTotal)})</h2>
<table>
  <thead><tr><th>#</th><th>Date</th><th>Time</th><th>Name</th><th>Description</th><th class="num">Amount</th></tr></thead>
  <tbody>
    ${[...data.expenses].sort((a: any, b: any) => (a.date || "").localeCompare(b.date || "")).map((e: any, i: number) => `
      <tr><td>${i + 1}</td><td>${esc(e.date || "")}</td><td>${esc(timeStr(e.createdAt))}</td><td>${esc(e.name || "")}</td><td>${esc(e.description || "")}</td><td class="num">${fmtRs(Number(e.amount) || 0)}</td></tr>
    `).join("")}
    <tr style="font-weight: 800; background: #f1f5f9;"><td colspan="5">Total</td><td class="num">${fmtRs(expensesTotal)}</td></tr>
  </tbody>
</table>` : "";

        const filtersBanner = (useFilters && filtersActive) ? `
<div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 6px 10px; border-radius: 4px; margin-bottom: 10px; font-size: 10px; color: #78350f;">
  <strong>Filtered view:</strong>
  ${searchQuery ? `search="${esc(searchQuery)}" · ` : ""}${modeFilter !== "all" ? `mode=${modeFilter} · ` : ""}${sourceFilter !== "all" ? `source=${sourceFilter} · ` : ""}${showCancelled ? "cancelled-included" : ""}
</div>` : "";

        const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(club?.name || "Report")} — ${esc(range.label)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #0f172a; font-size: 11px; margin: 0; padding: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1.5px solid #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub { color: #64748b; font-size: 11px; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8px; border-bottom: 2px solid #0f172a; margin-bottom: 12px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 6px; }
  .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .kpi .l { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
  .kpi .v { font-size: 16px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .kpi .s { font-size: 9px; color: #94a3b8; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { padding: 4px 6px; text-align: left; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .totals { background: #0f172a; color: white; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; margin: 8px 0; }
  .totals .v { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #94a3b8; text-align: center; }
  .badge { display: inline-block; font-size: 8px; font-weight: 700; padding: 1px 6px; border-radius: 8px; color: white; text-transform: uppercase; }
  .b-served { background: #16a34a; } .b-rejected { background: #dc2626; } .b-other { background: #d97706; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .empty { color: #94a3b8; font-style: italic; padding: 6px; }
  @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .toolbar { padding: 10px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; }
  .toolbar button { padding: 6px 14px; font-weight: 700; border: 1px solid #0f172a; background: #0f172a; color: white; border-radius: 6px; cursor: pointer; margin-right: 8px; }
  .toolbar button.alt { background: white; color: #0f172a; }
</style></head>
<body>
<div class="toolbar no-print">
  <button onclick="window.print()">🖨️ Print</button>
  <button class="alt" onclick="window.close()">Close</button>
</div>
<div style="padding: 8px 16px;">

<div class="hdr">
  <div>
    <h1>${esc(club?.name || "Club")}</h1>
    <div class="sub">${esc(club?.address || "")}</div>
  </div>
  <div style="text-align: right;">
    <div style="font-size: 14px; font-weight: 800;">${esc(range.label)}</div>
    <div class="sub">${period.toUpperCase()} REPORT · Generated ${new Date().toLocaleString("en-IN")}</div>
  </div>
</div>

${filtersBanner}
${summaryBlock}
${pair(bySourceBlock, upiBlock)}
${pair(topShakesBlock, topProductsBlock)}
${topMembersBlock}
${trendBlock}
${attendanceBlock}
${volunteersBlock}
${guestsBlock}
${ordersBlock}
${paymentsBlock}
${expensesBlock}
${topupsBlock}
${cancelledBlock}

<div class="footer">
  ${esc(club?.name || "")} · ${esc(range.label)} · Total Revenue ${fmtRs(agg.totalRevenue)} · ${agg.liveOrders.length} orders · ${agg.shakesServed} shakes
</div>

</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;

        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    // ─── Volunteers-only PDF ─────────────────────────────────────────────
    // Standalone printable PDF for just the volunteer log over the selected
    // range. Opens in a new tab; user can print or "Save as PDF" from there.
    const downloadVolunteersPdf = () => {
        const list = filteredVolunteers;
        const win = window.open("", "_blank", "width=900,height=1100");
        if (!win) return;

        const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
        const timeStr = (t: any) => {
            const d = tsToDate(t);
            return d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "—";
        };
        const fmtMinutes = (mins: number | null | undefined) => {
            if (mins == null) return "—";
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            if (h > 0) return `${h}h ${m}m`;
            return `${m}m`;
        };

        const sorted = [...list].sort((a, b) => {
            const da = (a.date || "").localeCompare(b.date || "");
            if (da !== 0) return da;
            return (tsToDate(a.loginTime)?.getTime() ?? 0) - (tsToDate(b.loginTime)?.getTime() ?? 0);
        });

        const totalMinutes = sorted.reduce((s, v) => s + (Number(v.totalMinutes) || 0), 0);
        const activeCount = sorted.filter(v => v.status === "active").length;

        const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(club?.name || "Club")} — Volunteers ${esc(range.label)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #0f172a; font-size: 11px; margin: 0; padding: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1.5px solid #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub { color: #64748b; font-size: 11px; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8px; border-bottom: 2px solid #0f172a; margin-bottom: 12px; }
  .totals { background: #0f172a; color: white; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; margin: 8px 0; }
  .totals .v { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { padding: 5px 7px; text-align: left; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .badge { display: inline-block; font-size: 8px; font-weight: 700; padding: 1px 6px; border-radius: 8px; color: white; text-transform: uppercase; }
  .b-active { background: #16a34a; } .b-done { background: #64748b; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #94a3b8; text-align: center; }
  @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .toolbar { padding: 10px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; }
  .toolbar button { padding: 6px 14px; font-weight: 700; border: 1px solid #0f172a; background: #0f172a; color: white; border-radius: 6px; cursor: pointer; margin-right: 8px; }
  .toolbar button.alt { background: white; color: #0f172a; }
  .empty { color: #94a3b8; font-style: italic; padding: 10px; text-align: center; }
</style></head>
<body>
<div class="toolbar no-print">
  <button onclick="window.print()">🖨️ Print</button>
  <button class="alt" onclick="window.close()">Close</button>
</div>
<div style="padding: 8px 16px;">

<div class="hdr">
  <div>
    <h1>${esc(club?.name || "Club")}</h1>
    <div class="sub">${esc(club?.address || "")}</div>
  </div>
  <div style="text-align: right;">
    <div style="font-size: 14px; font-weight: 800;">Volunteers · ${esc(range.label)}</div>
    <div class="sub">${period.toUpperCase()} · Generated ${new Date().toLocaleString("en-IN")}</div>
  </div>
</div>

<div class="totals">
  <div><div style="font-size: 10px; opacity: 0.7;">TOTAL SESSIONS</div><div class="v">${fmt(sorted.length)}</div></div>
  <div><div style="font-size: 10px; opacity: 0.7;">ACTIVE NOW</div><div class="v">${fmt(activeCount)}</div></div>
  <div><div style="font-size: 10px; opacity: 0.7;">TOTAL HOURS</div><div class="v">${fmtMinutes(totalMinutes)}</div></div>
</div>

<h2>Volunteer Log (${sorted.length})</h2>
${sorted.length === 0 ? `<div class="empty">No volunteer sessions in this period</div>` : `
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Name</th>
      <th>Date</th>
      <th>Login</th>
      <th>Logout</th>
      <th class="num">Duration</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${sorted.map((v, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(v.memberName || "—")}</td>
        <td>${esc(v.date || "")}</td>
        <td>${esc(timeStr(v.loginTime))}</td>
        <td>${esc(timeStr(v.logoutTime))}</td>
        <td class="num">${esc(fmtMinutes(v.totalMinutes))}</td>
        <td><span class="badge ${v.status === "active" ? "b-active" : "b-done"}">${esc(v.status || "—")}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>`}

<div class="footer">
  ${esc(club?.name || "")} · Volunteers · ${esc(range.label)} · ${sorted.length} session${sorted.length !== 1 ? "s" : ""} · ${fmtMinutes(totalMinutes)}
</div>

</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;

        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    // ─── CSV export ──────────────────────────────────────────────────────
    // Multiple sections in one file are separated by "## SECTION NAME"
    // header rows. Most spreadsheet apps still import this cleanly.
    const exportCsv = (included: Set<string>, useFilters: boolean) => {
        const data = getExportData(useFilters);
        const csvEscape = (v: any) => {
            const s = String(v ?? "");
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const toCsv = (rows: any[][]) =>
            rows.map(r => r.map(csvEscape).join(",")).join("\n");

        const parts: string[] = [];
        const addSection = (name: string, rows: any[][]) => {
            if (rows.length <= 1) return; // header-only = empty
            parts.push(`## ${name}`);
            parts.push(toCsv(rows));
            parts.push("");
        };

        if (included.has("summary")) {
            addSection("SUMMARY", [
                ["Metric", "Value"],
                ["Report", range.label],
                ["Generated", new Date().toLocaleString()],
                ["Total Revenue", agg.totalRevenue],
                ["Cash", agg.cashTotal],
                ["UPI", agg.upiTotal],
                ["Shakes Served", agg.shakesServed],
                ["Products Sold", agg.productsSold],
                ["Members Visited", membersVisited],
                ["Guests", data.guests.length],
                ["Cancelled Orders", agg.cancelledOrders.length],
            ]);
        }
        if (included.has("bySource")) {
            addSection("REVENUE BY SOURCE", [
                ["Source", "Amount"],
                ...Object.entries(agg.bySource).map(([k, v]) => [k, v as number]),
            ]);
        }
        if (included.has("upiByAccount")) {
            addSection("UPI BY ACCOUNT", [
                ["Account", "Txns", "Amount"],
                ...data.upiByAccount.map(u => [u.name, u.count, u.amount]),
            ]);
        }
        if (included.has("topShakes")) {
            addSection("TOP SHAKES", [
                ["Rank", "Shake", "Qty", "Revenue"],
                ...data.topShakes.map((s, i) => [i + 1, s.name, s.qty, s.revenue]),
            ]);
        }
        if (included.has("topProducts")) {
            addSection("TOP PRODUCTS", [
                ["Rank", "Product", "Qty", "Revenue"],
                ...data.topProducts.map((p, i) => [i + 1, p.name, p.qty, p.revenue]),
            ]);
        }
        if (included.has("topMembers")) {
            addSection("TOP MEMBERS", [
                ["Rank", "Member", "Visits", "Spend"],
                ...data.topMembers.map((m, i) => [i + 1, m.name, m.visits, m.amount]),
            ]);
        }
        if (included.has("trend") && trendRows.length > 0) {
            addSection(period === "month" ? "DAILY TREND" : "MONTHLY TREND", [
                [period === "month" ? "Day" : "Month", "Revenue", "Orders"],
                ...trendRows.map(r => [r.label, r.value, r.shakes]),
            ]);
        }
        if (included.has("membersVisited")) {
            addSection("MEMBERS VISITED", [
                ["#", "Name", "Check-in Time"],
                ...data.attendance.map((a, i) => [
                    i + 1, a.memberName,
                    tsToDate(a.checkInTime)?.toLocaleTimeString("en-IN") || "",
                ]),
            ]);
        }
        if (included.has("volunteers")) {
            addSection("VOLUNTEERS", [
                ["#", "Name", "Date", "Login", "Logout", "Minutes", "Status"],
                ...data.volunteers.map((v: any, i: number) => [
                    i + 1, v.memberName || "", v.date || "",
                    tsToDate(v.loginTime)?.toLocaleTimeString("en-IN") || "",
                    tsToDate(v.logoutTime)?.toLocaleTimeString("en-IN") || "",
                    v.totalMinutes ?? "",
                    v.status || "",
                ]),
            ]);
        }
        if (included.has("guests")) {
            addSection("GUESTS", [
                ["#", "Name", "Phone", "Type", "Items", "Amount"],
                ...data.guests.map((g, i) => [
                    i + 1, g.guestName || "Guest", g.guestPhone || "", g.type || "free",
                    (g.items || []).map((it: any) => `${it.productName} x${it.qty}`).join(" | "),
                    g.amountPaid || 0,
                ]),
            ]);
        }
        if (included.has("orders")) {
            addSection("ORDERS", [
                ["Date", "Time", "Member", "Items", "Status", "Token", "Amount"],
                ...data.orders.map(o => [
                    o.date, tsToDate(o.createdAt)?.toLocaleTimeString("en-IN") || "",
                    o.memberName || "Walk-in",
                    (o.items || []).map((i: any) => `${i.itemName || i.productName} x${i.qty || i.quantity || 1}`).join(" | "),
                    o.status, o.tokenNumber || "", o.totalAmount || 0,
                ]),
            ]);
        }
        if (included.has("payments")) {
            // splitOf-derived, and with a TOTAL row. These columns were the raw
            // stored fields while the SUMMARY section of the same file was
            // splitOf-derived — so a SUM() under the Cash column disagreed with
            // the Cash figure a few rows above it, in one spreadsheet.
            addSection("PAYMENTS", [
                ["Date", "Time", "Member/Guest", "Type", "Method", "UPI Account", "Cash", "UPI", "Amount", "Description"],
                ...data.payments.map(p => {
                    const s = splitOf(p);
                    return [
                        p.date, tsToDate(p.createdAt)?.toLocaleTimeString("en-IN") || "",
                        p.memberName || p.guestName || "", p.type || "", p.paymentMethod || "",
                        p.upiAccountName || "", s.cash, s.upi, s.amount, p.description || "",
                    ];
                }),
                ["TOTAL", "", "", "", "", "",
                    data.payments.reduce((t, p) => t + splitOf(p).cash, 0),
                    data.payments.reduce((t, p) => t + splitOf(p).upi, 0),
                    data.payments.reduce((t, p) => t + splitOf(p).amount, 0), ""],
            ]);
        }
        if (included.has("expenses")) {
            addSection("EXPENSES", [
                ["Date", "Time", "Name", "Description", "Amount"],
                ...data.expenses.map((e: any) => [
                    e.date || "", tsToDate(e.createdAt)?.toLocaleTimeString("en-IN") || "",
                    e.name || "", e.description || "", Number(e.amount) || 0,
                ]),
                ["TOTAL", "", "", "", expensesTotal],
            ]);
        }
        if (included.has("topups")) {
            addSection("TOP-UPS", [
                ["Member", "Method", "UPI Account", "Amount"],
                ...data.topups.map((r: any) => [
                    r.memberName || "", r.paymentMethod || "", r.upiAccountName || "",
                    Number(r.approvedAmount ?? r.requestedAmount) || 0,
                ]),
            ]);
        }
        if (included.has("cancelled")) {
            addSection("CANCELLED", [
                ["Date", "Member", "Items", "Reason", "Amount"],
                ...data.cancelled.map(o => [
                    o.date, o.memberName || "Walk-in",
                    (o.items || []).map((i: any) => `${i.itemName || i.productName} x${i.qty || i.quantity || 1}`).join(" | "),
                    o.rejectReason || "rejected", o.totalAmount || 0,
                ]),
            ]);
        }

        if (parts.length === 0) { alert("Pick at least one section to export."); return; }
        const blob = new Blob([parts.join("\n")], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `report_${period}_${ymd(range.start)}.csv`);
    };

    // ─── JSON export ─────────────────────────────────────────────────────
    // Raw structured data for further processing (analytics scripts, etc.)
    const exportJson = (included: Set<string>, useFilters: boolean) => {
        const data = getExportData(useFilters);
        const out: Record<string, any> = {
            meta: {
                club: club?.name || "",
                period, range: { start: ymd(range.start), end: ymd(range.end), label: range.label },
                generated: new Date().toISOString(),
                filters: useFilters && filtersActive ? {
                    search: searchQuery || undefined,
                    mode: modeFilter !== "all" ? modeFilter : undefined,
                    source: sourceFilter !== "all" ? sourceFilter : undefined,
                    showCancelled: showCancelled || undefined,
                } : null,
            },
        };
        if (included.has("summary")) out.summary = {
            totalRevenue: agg.totalRevenue, cash: agg.cashTotal, upi: agg.upiTotal,
            shakesServed: agg.shakesServed, productsSold: agg.productsSold,
            productRevenue: agg.productRevenue, membersVisited,
            guests: data.guests.length, cancelledCount: agg.cancelledOrders.length,
        };
        if (included.has("bySource"))     out.revenueBySource = agg.bySource;
        if (included.has("upiByAccount")) out.upiByAccount    = data.upiByAccount;
        if (included.has("topShakes"))    out.topShakes       = data.topShakes;
        if (included.has("topProducts"))  out.topProducts     = data.topProducts;
        if (included.has("topMembers"))   out.topMembers      = data.topMembers;
        if (included.has("trend"))        out.trend           = trendRows;
        if (included.has("membersVisited")) out.membersVisited = data.attendance;
        if (included.has("volunteers"))   out.volunteers      = data.volunteers;
        if (included.has("guests"))       out.guests          = data.guests;
        if (included.has("orders"))       out.orders          = data.orders;
        if (included.has("payments"))     out.payments        = data.payments;
        if (included.has("expenses"))     out.expenses        = data.expenses;
        if (included.has("topups"))       out.topups          = data.topups;
        if (included.has("cancelled"))    out.cancelled       = data.cancelled;

        if (Object.keys(out).length <= 1) { alert("Pick at least one section to export."); return; }
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
        downloadBlob(blob, `report_${period}_${ymd(range.start)}.json`);
    };

    // ─── Export dispatcher ───────────────────────────────────────────────
    // Wired to the dialog's "Export" button. Closes the dialog after run.
    const runExport = () => {
        if (exportSections.size === 0) { alert("Pick at least one section to include."); return; }
        if (exportFormat === "pdf")   printPdf(exportSections, exportUseFilters);
        if (exportFormat === "excel") exportExcel(exportSections, exportUseFilters).catch(err => {
            console.error("[Reports excel export]", err);
            alert("Could not generate the Excel file. Please try again.");
        });
        if (exportFormat === "csv")   exportCsv(exportSections, exportUseFilters);
        if (exportFormat === "json")  exportJson(exportSections, exportUseFilters);
        setExportOpen(false);
    };

    // ─── Render ──────────────────────────────────────────────────────────
    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: "20px 16px 60px" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>

                {/* ── Header: title + period tabs + nav + export ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                        <div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>📊 Reports</div>
                            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{club?.name}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => setThermalOpen(true)} style={{ padding: "8px 14px", border: "1px solid #16a34a", background: "#16a34a", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>🧾 Thermal</button>
                            <button onClick={() => setExportOpen(true)} style={{ padding: "8px 14px", border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>📤 Export / Print…</button>
                        </div>
                    </div>

                    {/* Period tabs */}
                    <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content" }}>
                        {(["day", "month", "year"] as Period[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                style={{
                                    padding: "8px 18px", border: "none",
                                    background: period === p ? "#0f172a" : "transparent",
                                    color: period === p ? "white" : "#64748b",
                                    borderRadius: 6, fontSize: 13, fontWeight: 700,
                                    cursor: "pointer", fontFamily: FONT, textTransform: "capitalize",
                                }}
                            >{p}</button>
                        ))}
                    </div>

                    {/* Date nav */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={goPrev} style={{ width: 36, height: 36, border: "1px solid #cbd5e1", background: "white", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, color: "#475569" }}>‹</button>
                        <button onClick={goNext} style={{ width: 36, height: 36, border: "1px solid #cbd5e1", background: "white", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, color: "#475569" }}>›</button>
                        <button onClick={goToday} style={{ padding: "8px 14px", border: "1px solid #cbd5e1", background: "white", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Today</button>
                        <input
                            type={period === "day" ? "date" : period === "month" ? "month" : "number"}
                            value={period === "day" ? ymd(anchor) : period === "month" ? ym(anchor) : String(anchor.getFullYear())}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return;
                                if (period === "day") setAnchor(new Date(v));
                                else if (period === "month") {
                                    const [y, m] = v.split("-").map(Number);
                                    setAnchor(new Date(y, m - 1, 1));
                                } else setAnchor(new Date(parseInt(v, 10), 0, 1));
                            }}
                            style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: FONT }}
                        />
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginLeft: 8 }}>
                            {range.label}
                            {period === "day" && isToday(anchor) && (
                                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "white", background: "#16a34a", padding: "2px 8px", borderRadius: 100 }}>LIVE</span>
                            )}
                        </div>
                        <button
                            onClick={() => setEditRange({ start: startStr, end: endStr, label: range.label })}
                            title="See, add, edit & delete every transaction behind these totals"
                            style={{ marginLeft: "auto", padding: "8px 14px", border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
                        >🧾 Transactions</button>
                    </div>
                </div>

                {/* ── Quick date presets ── */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {[
                        { label: "Today",      onClick: () => { setPeriod("day");   setAnchor(new Date()); } },
                        { label: "Yesterday",  onClick: () => { setPeriod("day");   setAnchor(addDays(new Date(), -1)); } },
                        { label: "This Month", onClick: () => { setPeriod("month"); setAnchor(new Date()); } },
                        { label: "Last Month", onClick: () => { setPeriod("month"); setAnchor(addMonths(new Date(), -1)); } },
                        { label: "This Year",  onClick: () => { setPeriod("year");  setAnchor(new Date()); } },
                    ].map(p => (
                        <button
                            key={p.label}
                            onClick={p.onClick}
                            style={{
                                padding: "6px 12px", border: "1px solid #cbd5e1", background: "white",
                                borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer",
                                color: "#475569", fontFamily: FONT,
                            }}
                        >{p.label}</button>
                    ))}
                </div>

                {/* ── Search + filter bar ── */}
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 260px", position: "relative", minWidth: 220 }}>
                            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8" }}>🔍</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search name, phone, item, token, amount, UPI account…"
                                style={{
                                    width: "100%", padding: "10px 36px 10px 36px",
                                    border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13,
                                    fontFamily: FONT, outline: "none", background: "#f8fafc",
                                }}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, border: "none", background: "#e2e8f0", color: "#64748b", borderRadius: "50%", cursor: "pointer", fontSize: 12, fontWeight: 800, lineHeight: 1 }}
                                    aria-label="Clear search"
                                >×</button>
                            )}
                        </div>
                        {filtersActive && (
                            <button
                                onClick={clearFilters}
                                style={{ padding: "8px 14px", border: "1px solid #dc2626", background: "white", color: "#dc2626", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
                            >Clear filters</button>
                        )}
                    </div>

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        {/* Mode */}
                        <FilterChipGroup
                            label="Mode"
                            value={modeFilter}
                            onChange={v => setModeFilter(v as any)}
                            options={[
                                { value: "all", label: "All" },
                                { value: "cash", label: "💵 Cash" },
                                { value: "upi", label: "📱 UPI" },
                            ]}
                        />
                        {/* Source */}
                        <FilterChipGroup
                            label="Source"
                            value={sourceFilter}
                            onChange={v => setSourceFilter(v as any)}
                            options={[
                                { value: "all", label: "All" },
                                { value: "membership", label: "Membership" },
                                { value: "shake", label: "Shakes" },
                                { value: "product", label: "Products" },
                                { value: "guest", label: "Guests" },
                                { value: "topup", label: "Top-ups" },
                                { value: "virtual", label: "💳 Virtual" },
                            ]}
                        />
                        {/* Cancelled toggle */}
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#475569", cursor: "pointer", marginLeft: "auto" }}>
                            <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
                            Include cancelled in orders
                        </label>
                    </div>
                </div>

                {loading && <div style={{ fontSize: 13, color: "#64748b", padding: 20, textAlign: "center" }}>Loading…</div>}

                {/* ── KPI tiles ── */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                    <Tile icon="💰" label="Total Revenue" value={fmtRs(agg.totalRevenue)} sub={`${agg.revenuePayments.length} payments`} accent="#16a34a" />
                    <Tile icon="💵" label="Cash" value={fmtRs(agg.cashTotal)} sub={`${pct(agg.cashTotal, agg.totalRevenue)}%`} accent="#65a30d" />
                    <Tile icon="📱" label="UPI" value={fmtRs(agg.upiTotal)} sub={`${pct(agg.upiTotal, agg.totalRevenue)}%`} accent="#0284c7" />
                    {/* No third tile: Total Revenue is exactly Cash + UPI.
                        Older docs whose method was never written are reported
                        as UPI — see lib/paymentSplit.ts. */}
                    <Tile icon="🥤" label="Shakes Served" value={fmt(agg.shakesServed)} sub={agg.shakesPending > 0 ? `${agg.shakesPending} still to serve` : `${agg.liveOrders.length} order${agg.liveOrders.length !== 1 ? "s" : ""}`} accent="#d97706" />
                    <Tile icon="🛍️" label="Products Sold" value={fmt(agg.productsSold)} sub={fmtRs(agg.productRevenue)} accent="#6d28d9" />
                    <Tile icon="💸" label="Total Expense" value={fmtRs(expensesTotal)} sub={expenses.length ? `${expenses.length} item${expenses.length !== 1 ? "s" : ""}` : "none logged"} accent="#dc2626" />
                    <Tile icon="👥" label="Members Visited" value={fmt(membersVisited)} sub={period === "day" ? "checked in" : "unique"} accent="#0891b2" />
                    <Tile icon="🧑‍🤝‍🧑" label="Guests" value={fmt(guests.length)} sub={`${guestsPaid} paid · ${guestsFree} free`} accent="#64748b" />
                    {agg.topupsCollected > 0 && (
                        <Tile icon="👛" label="Wallet Top-ups" value={fmtRs(agg.topupsCollected)} sub="collected, not revenue" accent="#b45309" />
                    )}
                    {agg.cancelledOrders.length > 0 && (
                        <Tile icon="❌" label="Cancelled" value={fmt(agg.cancelledOrders.length)} sub="not in revenue" accent="#dc2626" />
                    )}
                </div>

                {/* ── Trend chart for month/year ── */}
                {period !== "day" && (
                    <Card title={period === "month" ? "Daily Revenue" : "Monthly Revenue"}>
                        <BarChart rows={trendRows} height={180} />
                    </Card>
                )}

                {/* ── Monthly per-day breakdown table + totals ── */}
                {period === "month" && monthBreakdown && (
                    <Card title="Monthly Breakdown">
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                            <button
                                onClick={() => {
                                    const rows = monthBreakdown.rows.map(r => ({
                                        Date: r.date, Members: r.members, Volunteers: r.volunteers, Shakes: r.shakes,
                                        "New Customers": r.newCust, "One-Day (Rs)": r.revShake, "Membership (Rs)": r.revMember,
                                        "Products (Rs)": r.revProduct, "Other (Rs)": r.revOther, "Day Total (Rs)": r.total,
                                    }));
                                    const t = monthBreakdown.totals;
                                    rows.push({ Date: "TOTAL", Members: t.members, Volunteers: t.volunteers, Shakes: t.shakes, "New Customers": t.newCust, "One-Day (Rs)": t.revShake, "Membership (Rs)": t.revMember, "Products (Rs)": t.revProduct, "Other (Rs)": t.revOther, "Day Total (Rs)": t.total });
                                    const ws = XLSX.utils.json_to_sheet(rows);
                                    const wb = XLSX.utils.book_new();
                                    XLSX.utils.book_append_sheet(wb, ws, "Monthly Breakdown");
                                    XLSX.writeFile(wb, `monthly-breakdown-${ymd(range.start).slice(0, 7)}.xlsx`);
                                }}
                                style={{ padding: "8px 14px", border: "1px solid #16a34a", background: "#16a34a", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                            >⬇ Download Excel</button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 10, marginBottom: 14 }}>
                            <Tile icon="💰" label="Total Revenue" value={fmtRs(monthBreakdown.totals.total)} sub="this month" accent="#16a34a" />
                            <Tile icon="🥤" label="Shakes Served" value={fmt(monthBreakdown.totals.shakes)} sub="total" accent="#0891b2" />
                            <Tile icon="👥" label="Member Check-ins" value={fmt(monthBreakdown.totals.members)} sub="visits" accent="#7c3aed" />
                            <Tile icon="🙌" label="Volunteer Days" value={fmt(monthBreakdown.totals.volunteers)} sub="total" accent="#d97706" />
                            <Tile icon="🆕" label="New Customers" value={fmt(monthBreakdown.totals.newCust)} sub="joined" accent="#db2777" />
                            <Tile icon="🪪" label="Memberships Sold" value={fmt(monthBreakdown.membershipsSold)} sub="plans" accent="#2563eb" />
                            <Tile icon="📦" label="Products Sold" value={fmt(agg.productsSold)} sub="units" accent="#0d9488" />
                            <Tile icon="💸" label="Total Expense" value={fmtRs(expensesTotal)} sub="this month" accent="#dc2626" />
                        </div>
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT }}>
                                <thead>
                                    <tr>
                                        {["Date", "Members", "Vol", "Shakes", "New", "1-Day ₹", "Membership ₹", "Products ₹", "Other ₹", "Day Total ₹", ""].map((h, i) => (
                                            <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 10px", fontSize: 11, fontWeight: 800, color: "#64748b", borderBottom: "1.5px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {monthBreakdown.rows.map(r => {
                                        const [yy, mm, dd] = r.date.split("-").map(Number);
                                        const lbl = new Date(yy, mm - 1, dd).toLocaleDateString("en-IN", { day: "2-digit", weekday: "short" });
                                        const empty = !r.total && !r.members && !r.shakes && !r.volunteers && !r.newCust;
                                        const tdR: React.CSSProperties = { textAlign: "right", padding: "7px 10px", color: "#334155", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
                                        return (
                                            <tr key={r.date} style={{ opacity: empty ? 0.45 : 1 }}>
                                                <td style={{ textAlign: "left", padding: "7px 10px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>{lbl}</td>
                                                <td style={tdR}>{r.members || "—"}</td>
                                                <td style={tdR}>{r.volunteers || "—"}</td>
                                                <td style={tdR}>{r.shakes || "—"}</td>
                                                <td style={tdR}>{r.newCust || "—"}</td>
                                                <td style={tdR}>{r.revShake ? fmtRs(r.revShake) : "—"}</td>
                                                <td style={tdR}>{r.revMember ? fmtRs(r.revMember) : "—"}</td>
                                                <td style={tdR}>{r.revProduct ? fmtRs(r.revProduct) : "—"}</td>
                                                <td style={tdR}>{r.revOther ? fmtRs(r.revOther) : "—"}</td>
                                                <td style={{ ...tdR, fontWeight: 900, color: r.total ? "#16a34a" : "#94a3b8" }}>{r.total ? fmtRs(r.total) : "—"}</td>
                                                <td style={{ textAlign: "center", padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                                                    <button onClick={() => setEditRange({ start: r.date, end: r.date, label: new Date(yy, mm - 1, dd).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) })} title="See, add, edit & delete this day's transactions"
                                                        style={{ padding: "4px 10px", border: "1px solid #cbd5e1", background: "white", color: "#0f172a", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>✎ Edit</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: "2px solid #e2e8f0" }}>
                                        {[
                                            "Total",
                                            monthBreakdown.totals.members, monthBreakdown.totals.volunteers, monthBreakdown.totals.shakes, monthBreakdown.totals.newCust,
                                            fmtRs(monthBreakdown.totals.revShake), fmtRs(monthBreakdown.totals.revMember), fmtRs(monthBreakdown.totals.revProduct), fmtRs(monthBreakdown.totals.revOther), fmtRs(monthBreakdown.totals.total), "",
                                        ].map((v, i) => (
                                            <td key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "9px 10px", fontWeight: 900, color: i === 9 ? "#16a34a" : "#0f172a", whiteSpace: "nowrap" }}>{v}</td>
                                        ))}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </Card>
                )}

                {/* ── Two columns: revenue breakdown + UPI by account ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
                    <Card title="Revenue by Source">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {Object.entries(agg.bySource)
                                .filter(([_, v]) => v > 0)
                                .sort(([, a], [, b]) => (b as number) - (a as number))
                                .map(([k, v]) => (
                                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        <div style={{ flex: 1, fontSize: 13, color: "#475569", fontWeight: 600 }}>{k}</div>
                                        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", ...TABULAR }}>{fmtRs(v as number)}</div>
                                        <div style={{ width: 60, fontSize: 11, color: "#94a3b8", textAlign: "right", fontWeight: 600 }}>{pct(v as number, agg.totalRevenue)}%</div>
                                    </div>
                                ))}
                            {Object.values(agg.bySource).every(v => v === 0) && (
                                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0", textAlign: "center" }}>No revenue in this period</div>
                            )}
                        </div>
                    </Card>

                    <Card title="UPI by Account">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {filteredUpiByAccount.length === 0 && (
                                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0", textAlign: "center" }}>{agg.upiByAccount.length === 0 ? "No UPI receipts" : "No matches"}</div>
                            )}
                            {filteredUpiByAccount.map((u, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <span style={{ fontSize: 16 }}>📱</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{u.count} txn{u.count !== 1 ? "s" : ""}</div>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0284c7", ...TABULAR }}>{fmtRs(u.amount)}</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>

                {/* ── Two columns: top shakes + top products ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
                    <Card title="Top Shakes">
                        <RankedList rows={filteredTopShakes.slice(0, 10).map(s => ({ name: s.name, qty: s.qty, amount: s.revenue }))} unit="" />
                    </Card>
                    <Card title="Top Products">
                        <RankedList rows={filteredTopProducts.slice(0, 10).map(p => ({ name: p.name, qty: p.qty, amount: p.revenue }))} unit="" />
                    </Card>
                </div>

                {/* ── Top members (range only) ── */}
                {period !== "day" && filteredTopMembers.length > 0 && (
                    <Card title="Top Members by Spend">
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {filteredTopMembers.slice(0, 10).map((m, i) => (
                                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", borderBottom: i < 9 ? "1px solid #f1f5f9" : "none" }}>
                                    <div style={{ width: 22, fontSize: 11, fontWeight: 800, color: "#94a3b8" }}>{i + 1}</div>
                                    <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{m.visits} visit{m.visits !== 1 ? "s" : ""}</div>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#16a34a", ...TABULAR }}>{fmtRs(m.amount)}</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* ── Member check-ins (day only) ── */}
                {period === "day" && (
                    <Card title={`Members Visited Today (${filteredAttendance.length}${q && filteredAttendance.length !== attendance.length ? ` of ${attendance.length}` : ""})`}>
                        {attendance.length === 0 ? (
                            <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0", textAlign: "center" }}>No check-ins yet</div>
                        ) : filteredAttendance.length === 0 ? (
                            <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0", textAlign: "center" }}>No matches for “{searchQuery}”</div>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                                {[...filteredAttendance]
                                    .sort((a, b) => ((tsToDate(a.checkInTime)?.getTime() ?? 0) - (tsToDate(b.checkInTime)?.getTime() ?? 0)))
                                    .map((a, idx) => (
                                    <div key={a.memberId} style={{ display: "flex", alignItems: "center", gap: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", position: "relative" }}>
                                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#e2e8f0", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid white", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
                                            {a.memberPhoto ? <img src={a.memberPhoto} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" /> : <span style={{ fontSize: 16, fontWeight: 800, color: "#64748b" }}>{(a.memberName || "?")[0]}</span>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.memberName || "—"}</div>
                                            <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, marginTop: 2, ...TABULAR }}>
                                                {tsToDate(a.checkInTime)?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) || "—"}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", ...TABULAR }}>#{idx + 1}</div>
                                        <button
                                            onClick={() => handleRemoveAttendance(a)}
                                            title="Remove check-in"
                                            style={{ width: 22, height: 22, border: "1px solid #fecaca", background: "white", color: "#dc2626", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT, position: "absolute", top: 4, right: 4 }}
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                )}

                {/* ── Volunteers ── */}
                <Card
                    title={`Volunteers (${filteredVolunteers.length}${q && filteredVolunteers.length !== volunteers.length ? ` of ${volunteers.length}` : ""})`}
                    action={
                        <button
                            onClick={downloadVolunteersPdf}
                            disabled={filteredVolunteers.length === 0}
                            style={{
                                fontSize: 11, fontWeight: 800, color: "white",
                                background: filteredVolunteers.length === 0 ? "#cbd5e1" : "#0f172a",
                                border: "none", padding: "5px 10px", borderRadius: 6,
                                cursor: filteredVolunteers.length === 0 ? "not-allowed" : "pointer",
                                fontFamily: FONT,
                            }}
                        >📄 Download PDF</button>
                    }
                >
                    {volunteers.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", textAlign: "center" }}>
                            No volunteer sessions in {range.label}
                        </div>
                    ) : filteredVolunteers.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", textAlign: "center" }}>
                            No matches for “{searchQuery}”
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {[...filteredVolunteers]
                                .sort((a, b) => {
                                    const da = (a.date || "").localeCompare(b.date || "");
                                    if (da !== 0) return da;
                                    return (tsToDate(a.loginTime)?.getTime() ?? 0) - (tsToDate(b.loginTime)?.getTime() ?? 0);
                                })
                                .map(v => {
                                    const login = tsToDate(v.loginTime);
                                    const logout = tsToDate(v.logoutTime);
                                    const mins = Number(v.totalMinutes) || 0;
                                    const dur = v.totalMinutes == null
                                        ? "—"
                                        : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                                    return (
                                        <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                                            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e2e8f0", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {v.memberPhoto ? <img src={v.memberPhoto} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" /> : <span style={{ fontSize: 13, fontWeight: 800, color: "#64748b" }}>{(v.memberName || "?")[0]}</span>}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {v.memberName || "—"}
                                                    {v.status === "active" && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: "white", background: "#16a34a", padding: "1px 6px", borderRadius: 100 }}>ACTIVE</span>}
                                                </div>
                                                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginTop: 2, ...TABULAR }}>
                                                    {v.date}
                                                    {login ? ` · in ${login.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}
                                                    {logout ? ` · out ${logout.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", ...TABULAR }}>{dur}</div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </Card>

                {/* ── Guests / walk-ins ── */}
                {guests.length > 0 && (
                    <Card title={`Guests (${filteredGuests.length}${q && filteredGuests.length !== guests.length ? ` of ${guests.length}` : ""} · ${fmtRs(guestRevenue)})`}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {filteredGuests.length === 0 && q && (
                                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0", textAlign: "center" }}>No matches for “{searchQuery}”</div>
                            )}
                            {filteredGuests.map((g: any) => (
                                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                                    <span style={{ fontSize: 16 }}>{g.type === "paid" ? "💵" : "🆓"}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {g.guestName || "Guest"}
                                            {g.guestPhone ? <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {g.guestPhone}</span> : null}
                                        </div>
                                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                                            {(g.items || []).map((it: any) => `${it.productName} ×${it.qty}`).join(", ")}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 12, fontWeight: 800, color: g.type === "paid" ? "#16a34a" : "#94a3b8", ...TABULAR }}>
                                        {g.type === "paid" ? fmtRs(g.amountPaid || 0) : "Free"}
                                    </div>
                                    <button onClick={() => handleDeleteGuest(g)}
                                        title="Delete guest entry"
                                        style={{ width: 22, height: 22, border: "1px solid #fecaca", background: "white", color: "#dc2626", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>✕</button>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* ── Expenses — informational, editable for the selected date ── */}
                <Card
                    title={`Expenses · ${fmtRs(expensesTotal)}`}
                    action={
                        <button onClick={() => { setExpenseDesc(""); setExpenseAmount(""); setShowExpenseForm(s => !s); }}
                            style={{ fontSize: 11, fontWeight: 800, color: "white", background: "#dc2626", border: "none", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontFamily: FONT }}
                        >+ Add expense for {range.label}</button>
                    }
                >
                    {showExpenseForm && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <input value={expenseName} onChange={e => setExpenseName(e.target.value)} placeholder="Name (e.g. Vignesh)"
                                style={{ width: 130, padding: 8, border: "1.5px solid #fecaca", borderRadius: 6, fontSize: 12, fontFamily: FONT }} />
                            <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="What was it for? (e.g. Photocopies, 20 copies)"
                                style={{ flex: "1 1 200px", padding: 8, border: "1.5px solid #fecaca", borderRadius: 6, fontSize: 12, fontFamily: FONT }} />
                            <input value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} placeholder="₹ amount" type="number"
                                style={{ width: 110, padding: 8, border: "1.5px solid #fecaca", borderRadius: 6, fontSize: 12, fontFamily: FONT }} />
                            <button onClick={handleAddExpense} disabled={busy}
                                style={{ padding: "8px 14px", background: "#dc2626", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Save</button>
                            <button onClick={() => setShowExpenseForm(false)}
                                style={{ padding: "8px 14px", background: "white", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
                        </div>
                    )}
                    {expenses.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", textAlign: "center" }}>
                            No expenses logged for {range.label}
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {expenses.map(e => (
                                editingExpenseId === e.id ? (
                                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 4px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                                        <input value={editExpName} onChange={ev => setEditExpName(ev.target.value)} placeholder="Name"
                                            style={{ width: 110, padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT }} />
                                        <input value={editExpDesc} onChange={ev => setEditExpDesc(ev.target.value)} placeholder="Description"
                                            style={{ flex: 1, minWidth: 120, padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT }} />
                                        <input value={editExpAmount} onChange={ev => setEditExpAmount(ev.target.value)} placeholder="₹" type="number"
                                            style={{ width: 90, padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT }} />
                                        <button onClick={() => saveEditExpense(e)} disabled={busy}
                                            style={{ padding: "8px 12px", border: "none", background: "#16a34a", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Save</button>
                                        <button onClick={() => setEditingExpenseId(null)}
                                            style={{ padding: "8px 10px", border: "1px solid #e2e8f0", background: "white", color: "#475569", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
                                    </div>
                                ) : (
                                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {e.name ? <span style={{ color: "#dc2626" }}>{e.name} — </span> : null}{e.description}
                                            </div>
                                            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                                                {e.date}
                                                {tsToDate(e.createdAt) ? ` · added ${tsToDate(e.createdAt)?.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}` : ""}
                                                {e.backdated ? " · backdated" : ""}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 800, color: "#dc2626", ...TABULAR }}>{fmtRs(e.amount)}</div>
                                        <button onClick={() => beginEditExpense(e)}
                                            style={{ width: 26, height: 26, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>✎</button>
                                        <button onClick={() => handleDeleteExpense(e)}
                                            style={{ width: 26, height: 26, border: "1px solid #fecaca", background: "white", color: "#dc2626", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>✕</button>
                                    </div>
                                )
                            ))}
                        </div>
                    )}
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginTop: 6, fontStyle: "italic" }}>
                        Expenses are tracked separately and are NOT subtracted from revenue.
                    </div>
                </Card>

                {/* ── All orders (collapsible) ── */}
                <CollapsibleListCard
                    title={`All Orders (${filteredOrders.length}${filtersActive && filteredOrders.length !== (showCancelled ? orders.length : agg.liveOrders.length) ? ` of ${showCancelled ? orders.length : agg.liveOrders.length}` : ""})`}
                    defaultOpen={!!q}
                    rows={filteredOrders.map(o => ({
                        id: o.id,
                        primary: o.memberName || "Walk-in",
                        secondary: `${(o.items || []).map((i: any) => `${i.itemName || i.productName} ×${i.qty || i.quantity || 1}`).join(", ")} · #${o.tokenNumber || "—"}`,
                        amount: o.totalAmount ? fmtRs(o.totalAmount) : `${o.creditsUsed || 0}cr`,
                        time: tsToDate(o.createdAt),
                        status: o.status,
                        // Only allow cancel on non-cancelled orders. Cascade refunds credits/wallet.
                        onDelete: (o.status !== "cancelled" && o.status !== "rejected") ? () => handleCancelOrder(o) : undefined,
                        deleteDisabled: o.status === "cancelled" || o.status === "rejected",
                        deleteDisabledReason: "Already cancelled",
                    }))}
                />

                {/* ── All payments (collapsible) ── */}
                <CollapsibleListCard
                    title={`All Payments (${filteredPayments.length}${filtersActive && filteredPayments.length !== agg.livePayments.length ? ` of ${agg.livePayments.length}` : ""})`}
                    defaultOpen={!!q || modeFilter !== "all" || sourceFilter !== "all"}
                    rows={filteredPayments.map(p => ({
                        id: p.id,
                        primary: p.memberName || p.guestName || "—",
                        secondary: `${p.type || "payment"}${p.paymentMethod ? ` · ${p.paymentMethod}` : ""}${p.upiAccountName ? ` (${p.upiAccountName})` : ""}`,
                        amount: fmtRs(p.amount || 0),
                        time: tsToDate(p.createdAt),
                        // Edit opens a modal to change amount / mode / UPI account.
                        // Delete cascades reverse to member state per payment.type.
                        onEdit: () => setEditingPayment(p),
                        onDelete: () => handleDeletePayment(p),
                    }))}
                />

                {/* ── Cancelled orders ── */}
                {agg.cancelledOrders.length > 0 && (
                    <CollapsibleListCard
                        title={`Cancelled Orders (${filteredCancelled.length}${q && filteredCancelled.length !== agg.cancelledOrders.length ? ` of ${agg.cancelledOrders.length}` : ""})`}
                        defaultOpen={!!q}
                        rows={filteredCancelled.map(o => ({
                            id: o.id,
                            primary: o.memberName || "Walk-in",
                            secondary: `${(o.items || []).map((i: any) => `${i.itemName || i.productName} ×${i.qty || i.quantity || 1}`).join(", ")} · ${o.rejectReason || "rejected"}`,
                            amount: o.totalAmount ? fmtRs(o.totalAmount) : `${o.creditsUsed || 0}cr`,
                            time: tsToDate(o.rejectedAt) || tsToDate(o.createdAt),
                            status: "rejected",
                            deleteDisabled: true,
                            deleteDisabledReason: "Already cancelled",
                            onDelete: () => {/* noop */},
                        }))}
                    />
                )}

                {/* ── Footer note ── */}
                <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 14, fontWeight: 600 }}>
                    {period === "day" && isToday(anchor) ? "● Live updating" : "Snapshot at " + new Date().toLocaleTimeString()}
                </div>
            </div>

            {/* ── Toast ── */}
            {toast && (
                <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.kind === "ok" ? "#16a34a" : "#dc2626", color: "white", padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 800, zIndex: 1500, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT, maxWidth: "90vw" }}>
                    {toast.kind === "ok" ? "✓ " : "✗ "}{toast.text}
                </div>
            )}

            {/* ── Confirm cascade modal ── */}
            {confirmAction && (
                <div onClick={() => !busy && setConfirmAction(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300, padding: 16, fontFamily: FONT }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>{confirmAction.title}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontWeight: 600 }}>{confirmAction.message}</div>
                        <div style={{ marginTop: 14, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>This will:</div>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#7f1d1d", fontWeight: 600, lineHeight: 1.7 }}>
                                {confirmAction.reversesPreview.map((b, i) => <li key={i}>{b}</li>)}
                            </ul>
                            <div style={{ fontSize: 10, color: "#991b1b", fontStyle: "italic", marginTop: 6 }}>
                                The original record is soft-deleted (kept in audit log) — recoverable later.
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                            <button onClick={() => setConfirmAction(null)} disabled={busy} style={{ padding: "10px 16px", background: "white", border: "1.5px solid #e2e8f0", color: "#475569", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT }}>Cancel</button>
                            <button onClick={async () => { await confirmAction.run(); setConfirmAction(null); }} disabled={busy} style={{ padding: "10px 22px", background: busy ? "#cbd5e1" : confirmAction.accentColor, color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 900, cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT }}>
                                {busy ? "Working…" : "Yes, confirm"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit payment modal ── */}
            {editingPayment && (
                <EditPaymentModal
                    clubId={clubId}
                    payment={editingPayment}
                    onClose={() => setEditingPayment(null)}
                    onSaved={(res) => {
                        setEditingPayment(null);
                        if (res.ok) showToast("ok", `Saved · ${res.reversed.length} change(s) applied`);
                        else showToast("err", res.errorMessage || "Save failed");
                    }}
                />
            )}

            {/* ── Export dialog ── */}
            {/* Transaction manager: see / add / edit / delete the entries behind the totals */}
            {editRange && clubId && (
                <ReportDateEditModal
                    clubId={clubId}
                    startStr={editRange.start}
                    endStr={editRange.end}
                    label={editRange.label}
                    onClose={() => setEditRange(null)}
                    onChanged={() => setReloadKey(k => k + 1)}
                />
            )}

            {/* Thermal print section picker — choose which blocks to print */}
            {thermalOpen && (
                <div
                    onClick={() => setThermalOpen(false)}
                    style={{
                        position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 1000, padding: 16, fontFamily: FONT,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>🧾 Thermal Print</div>
                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{range.label} · choose sections to print</div>
                            </div>
                            <button onClick={() => setThermalOpen(false)} style={{ width: 32, height: 32, border: "none", background: "#f1f5f9", borderRadius: "50%", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b" }} aria-label="Close">×</button>
                        </div>
                        <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
                            <button onClick={() => setThermalSections(new Set(thermalSectionList.map(s => s.id)))} style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#dcfce7", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>Select all</button>
                            <button onClick={() => setThermalSections(new Set())} style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>Clear</button>
                        </div>
                        <div style={{ display: "grid", gap: 4, marginBottom: 16 }}>
                            {thermalSectionList.map(s => (
                                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: thermalSections.has(s.id) ? "#f0fdf4" : "#f8fafc", border: `1.5px solid ${thermalSections.has(s.id) ? "#86efac" : "transparent"}`, borderRadius: 8, cursor: "pointer" }}>
                                    <input type="checkbox" checked={thermalSections.has(s.id)} onChange={() => toggleThermalSection(s.id)} style={{ width: 16, height: 16 }} />
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{s.label}</span>
                                </label>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setThermalOpen(false)} style={{ flex: 1, padding: 12, background: "white", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
                            <button
                                disabled={thermalSections.size === 0}
                                onClick={() => { printSummary(thermalSections); setThermalOpen(false); }}
                                style={{ flex: 2, padding: 12, background: thermalSections.size === 0 ? "#86efac" : "#16a34a", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: thermalSections.size === 0 ? "not-allowed" : "pointer", fontFamily: FONT }}
                            >🧾 Print {thermalSections.size} section{thermalSections.size === 1 ? "" : "s"}</button>
                        </div>
                    </div>
                </div>
            )}

            {exportOpen && (
                <div
                    onClick={() => setExportOpen(false)}
                    style={{
                        position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 1000, padding: 16, fontFamily: FONT,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: "white", borderRadius: 14, padding: 24,
                            maxWidth: 580, width: "100%", maxHeight: "90vh", overflowY: "auto",
                            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>📤 Export / Print</div>
                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{range.label} · pick what to include</div>
                            </div>
                            <button
                                onClick={() => setExportOpen(false)}
                                style={{ width: 32, height: 32, border: "none", background: "#f1f5f9", borderRadius: "50%", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b" }}
                                aria-label="Close"
                            >×</button>
                        </div>

                        {/* Format selector */}
                        <div style={{ marginTop: 18 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Format</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                                {([
                                    { v: "pdf",   icon: "📄", label: "PDF",   hint: "Printable, save as PDF from print dialog" },
                                    { v: "excel", icon: "📊", label: "Excel", hint: ".xlsx with one sheet per section" },
                                    { v: "csv",   icon: "📋", label: "CSV",   hint: "Plain text, sections separated by header rows" },
                                    { v: "json",  icon: "🧾", label: "JSON",  hint: "Raw structured data for scripts" },
                                ] as const).map(f => {
                                    const active = exportFormat === f.v;
                                    return (
                                        <button
                                            key={f.v}
                                            onClick={() => setExportFormat(f.v as any)}
                                            title={f.hint}
                                            style={{
                                                padding: "12px 8px",
                                                border: `2px solid ${active ? "#0f172a" : "#e2e8f0"}`,
                                                background: active ? "#0f172a" : "white",
                                                color: active ? "white" : "#475569",
                                                borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                                                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                                            }}
                                        >
                                            <span style={{ fontSize: 22 }}>{f.icon}</span>
                                            <span style={{ fontSize: 12, fontWeight: 800 }}>{f.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Filter source */}
                        <div style={{ marginTop: 18, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
                                <input
                                    type="checkbox"
                                    checked={exportUseFilters}
                                    onChange={e => setExportUseFilters(e.target.checked)}
                                    style={{ width: 16, height: 16, cursor: "pointer" }}
                                />
                                Apply current page filters
                                {filtersActive && (
                                    <span style={{ fontSize: 10, fontWeight: 800, color: "#16a34a", background: "#dcfce7", padding: "2px 6px", borderRadius: 100 }}>
                                        ACTIVE: {[
                                            q && `search="${searchQuery}"`,
                                            modeFilter !== "all" && `mode=${modeFilter}`,
                                            sourceFilter !== "all" && `source=${sourceFilter}`,
                                            showCancelled && "+cancelled",
                                        ].filter(Boolean).join(" · ")}
                                    </span>
                                )}
                            </label>
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, marginLeft: 24, fontWeight: 600 }}>
                                {exportUseFilters && filtersActive
                                    ? "Output will contain only rows matching the active filters."
                                    : "Output will contain every row for the selected period."}
                            </div>
                        </div>

                        {/* Section checklist */}
                        <div style={{ marginTop: 18 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                    Sections to include ({exportSections.size}/{visibleSections.length})
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={selectAllSections} style={{ padding: "4px 10px", border: "1px solid #cbd5e1", background: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", color: "#475569" }}>Select all</button>
                                    <button onClick={selectNoSections} style={{ padding: "4px 10px", border: "1px solid #cbd5e1", background: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", color: "#475569" }}>Select none</button>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                                {visibleSections.map(s => {
                                    const checked = exportSections.has(s.id);
                                    return (
                                        <label
                                            key={s.id}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 8,
                                                padding: "8px 10px", cursor: "pointer",
                                                background: checked ? "#f0fdf4" : "transparent",
                                                border: `1px solid ${checked ? "#86efac" : "transparent"}`,
                                                borderRadius: 6, fontSize: 12, fontWeight: 600,
                                                color: "#0f172a",
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleSection(s.id)}
                                                style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
                                            />
                                            {s.label}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                onClick={() => setExportOpen(false)}
                                style={{ padding: "10px 18px", border: "1px solid #cbd5e1", background: "white", color: "#475569", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
                            >Cancel</button>
                            <button
                                onClick={runExport}
                                disabled={exportSections.size === 0}
                                style={{
                                    padding: "10px 22px", border: "1px solid #16a34a",
                                    background: exportSections.size === 0 ? "#cbd5e1" : "#16a34a",
                                    color: "white", borderRadius: 8, fontSize: 13, fontWeight: 800,
                                    cursor: exportSections.size === 0 ? "not-allowed" : "pointer",
                                    fontFamily: FONT,
                                }}
                            >
                                {exportFormat === "pdf" ? "🖨️ Print / Save PDF" : `Download .${exportFormat === "excel" ? "xlsx" : exportFormat}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const pct = (part: number, total: number) => total > 0 ? Math.round((part / total) * 100) : 0;

// ─── Filter chip group ───────────────────────────────────────────────────
function FilterChipGroup({ label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
            {options.map(o => {
                const active = value === o.value;
                return (
                    <button
                        key={o.value}
                        onClick={() => onChange(o.value)}
                        style={{
                            padding: "5px 10px",
                            border: `1px solid ${active ? "#0f172a" : "#cbd5e1"}`,
                            background: active ? "#0f172a" : "white",
                            color: active ? "white" : "#475569",
                            borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            fontFamily: FONT,
                        }}
                    >{o.label}</button>
                );
            })}
        </div>
    );
}

// ─── Ranked list (top shakes / top products) ─────────────────────────────
function RankedList({ rows, unit = "" }: { rows: { name: string; qty: number; amount: number }[]; unit?: string }) {
    if (rows.length === 0) {
        return <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0", textAlign: "center" }}>No data</div>;
    }
    const max = Math.max(1, ...rows.map(r => r.qty));
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
                <div key={i}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                        <div style={{ width: 18, fontSize: 11, fontWeight: 800, color: "#94a3b8" }}>{i + 1}</div>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>×{r.qty}{unit}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#16a34a", ...TABULAR, minWidth: 60, textAlign: "right" }}>{fmtRs(r.amount)}</div>
                    </div>
                    <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2, marginLeft: 26 }}>
                        <div style={{ height: "100%", width: `${(r.qty / max) * 100}%`, background: "linear-gradient(90deg,#16a34a,#15803d)", borderRadius: 2 }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Collapsible list card ───────────────────────────────────────────────
// Row shape extended with optional Edit/Delete actions for the cascade-
// aware Reports page. Callers that don't pass actions render a read-only
// row (same as before), so legacy users are unaffected.
interface ListRow {
    id: string;
    primary: string;
    secondary: string;
    amount: string;
    time: Date | null;
    status?: string;
    onEdit?: () => void;
    onDelete?: () => void;
    deleteDisabled?: boolean;     // e.g. already cancelled — disable but show
    deleteDisabledReason?: string;
}

function CollapsibleListCard({ title, rows, defaultOpen = false }: {
    title: string;
    rows: ListRow[];
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    // Keep `open` in sync when the caller flips defaultOpen (e.g. user starts
    // searching → all three audit lists auto-expand to show matches).
    useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
    const sorted = [...rows].sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0));
    return (
        <Card
            title={title}
            action={
                <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, fontWeight: 700, color: "#0284c7", background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT }}>
                    {open ? "Hide ▴" : "Show ▾"}
                </button>
            }
        >
            {open && (sorted.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0", textAlign: "center" }}>None</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
                    {sorted.map(r => {
                        const statusColor = r.status === "served" ? "#16a34a" : r.status === "rejected" || r.status === "cancelled" ? "#dc2626" : "#d97706";
                        return (
                            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.primary}</div>
                                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.secondary}</div>
                                </div>
                                {r.status && <span style={{ fontSize: 9, fontWeight: 800, color: "white", background: statusColor, padding: "2px 8px", borderRadius: 100, textTransform: "uppercase" }}>{r.status}</span>}
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", ...TABULAR, minWidth: 70, textAlign: "right" }}>{r.amount}</div>
                                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, minWidth: 60, textAlign: "right" }}>{r.time?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) || "—"}</div>
                                {/* Edit / Delete actions — only render if caller wired them */}
                                {(r.onEdit || r.onDelete) && (
                                    <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                                        {r.onEdit && (
                                            <button
                                                onClick={r.onEdit}
                                                title="Edit"
                                                style={{ width: 26, height: 26, border: "1px solid #bfdbfe", background: "white", color: "#1d4ed8", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                                            >✏</button>
                                        )}
                                        {r.onDelete && (
                                            <button
                                                onClick={r.onDelete}
                                                disabled={r.deleteDisabled}
                                                title={r.deleteDisabled ? (r.deleteDisabledReason || "Already deleted") : "Delete (with cascade)"}
                                                style={{ width: 26, height: 26, border: `1px solid ${r.deleteDisabled ? "#e2e8f0" : "#fecaca"}`, background: "white", color: r.deleteDisabled ? "#cbd5e1" : "#dc2626", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: r.deleteDisabled ? "not-allowed" : "pointer", fontFamily: FONT, opacity: r.deleteDisabled ? 0.5 : 1 }}
                                            >✕</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}
        </Card>
    );
}

// Suppress unused import warning — Timestamp is referenced in the augmented
// types only. Kept here as a guard against future schema imports.
void isSameDay;
void Timestamp;

// ─── Cascade preview helpers ────────────────────────────────────────────
// Per Q1=A: before deleting, show the admin EXACTLY what side-effects
// will be reversed. Pre-compute the bullets from the payment / order
// fields we already have in memory so there's no extra Firestore round-trip.
function buildPaymentDeletePreview(p: any): string[] {
    const out: string[] = ["Payment marked deleted (hidden from revenue sums)"];
    const amt = Number(p.amount) || 0;
    switch (p.type) {
        case "topup": case "wallet_topup":
            if (p.memberId) out.push(`Subtract ₹${amt} from ${p.memberName || "member"}'s wallet`);
            break;
        case "plan_purchase":
            if (p.creditsAdded) out.push(`Subtract ${p.creditsAdded} shake credits + lower plan-total denominator`);
            break;
        case "oneday_shake":
            out.push("Decrement one-day shake count");
            if (Number(p.daysPaid) > 1) out.push(`Reverse ${Number(p.daysPaid) - 1} prepaid day(s)`);
            break;
        case "product_sale":
            if (p.productId && Number(p.quantity)) out.push(`Restock ${p.quantity} unit(s)`);
            if (p.paymentMethod === "wallet" && amt) out.push(`Refund ₹${amt} to member's wallet`);
            break;
        case "guest_payment":
            out.push("(Cash/UPI receipt only — no member state)");
            break;
        case "btc_enrolment":
            out.push("Unenroll member from BTC + clear deposit/fee fields");
            break;
    }
    return out;
}

function buildOrderCancelPreview(o: any): string[] {
    const out: string[] = ["Order marked cancelled (excluded from sums)"];
    const credits = Number(o.creditsUsed) || 0;
    const amount = Number(o.totalAmount) || 0;
    if (credits > 0) out.push(`Refund ${credits} shake credit(s) to member`);
    else if (amount > 0 && String(o.paymentMethod || "").includes("wallet")) {
        out.push(`Refund ₹${amount} to member's wallet`);
    }
    return out;
}

// ─── Edit Payment modal — amount + mode change with cascade delta ───────
// Owner can change a past payment's amount and tender; the delta cascades
// to the member's wallet for wallet-impacting payment types (topup,
// product_sale paid by wallet). Cash/UPI deltas don't cascade since the
// physical money is outside the app's reach — the doc just gets updated.
function EditPaymentModal({ clubId, payment, onClose, onSaved }: {
    clubId: string;
    payment: any;
    onClose: () => void;
    onSaved: (res: { ok: boolean; reversed: string[]; errorMessage?: string }) => void;
}) {
    const [amount, setAmount] = useState<string>(String(payment.amount ?? ""));
    const [method, setMethod] = useState<"cash" | "upi" | "split">(payment.paymentMethod || "cash");
    const [cashAmount, setCashAmount] = useState<string>(String(splitOf(payment).cash));
    const [upiAmount, setUpiAmount] = useState<string>(String(splitOf(payment).upi));
    const [saving, setSaving] = useState(false);

    const totalNum = Number(amount) || 0;
    const cashNum = method === "cash" ? totalNum : method === "split" ? (Number(cashAmount) || 0) : 0;
    const upiNum  = method === "upi"  ? totalNum : method === "split" ? (Number(upiAmount)  || 0) : 0;
    const splitOk = method !== "split" || (cashNum + upiNum === totalNum && cashNum >= 0 && upiNum >= 0);
    const delta = totalNum - (Number(payment.amount) || 0);

    const submit = async () => {
        if (!totalNum || totalNum <= 0) { alert("Enter a valid amount"); return; }
        if (!splitOk) { alert("Split parts must sum to total"); return; }
        setSaving(true);
        const res = await updatePaymentCascade(clubId, payment, {
            amount: totalNum,
            paymentMethod: method,
            cashAmount: cashNum,
            upiAmount: upiNum,
        });
        setSaving(false);
        onSaved(res);
    };

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1400, padding: 16, fontFamily: FONT }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>✏ Edit payment</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, marginBottom: 14, fontWeight: 600 }}>
                    {payment.type} · {payment.memberName || payment.guestName || "—"} · {payment.date}
                </div>

                <label style={{ display: "block", marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Amount (₹)</div>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                        style={{ width: "100%", padding: 10, border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }} />
                </label>

                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Mode</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        {(["cash", "upi", "split"] as const).map(m => (
                            <button key={m} onClick={() => setMethod(m)} style={{ padding: 10, border: `2px solid ${method === m ? "#0f172a" : "#e2e8f0"}`, background: method === m ? "#0f172a" : "white", color: method === m ? "white" : "#475569", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", textTransform: "capitalize", fontFamily: FONT }}>
                                {m === "cash" ? "💵 Cash" : m === "upi" ? "📱 UPI" : "🔀 Split"}
                            </button>
                        ))}
                    </div>
                </div>

                {method === "split" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                        <label>
                            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>Cash ₹</div>
                            <input type="number" value={cashAmount} onChange={e => { setCashAmount(e.target.value); setUpiAmount(String(Math.max(0, totalNum - (Number(e.target.value) || 0)))); }} style={{ width: "100%", padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                        </label>
                        <label>
                            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>UPI ₹</div>
                            <input type="number" value={upiAmount} onChange={e => { setUpiAmount(e.target.value); setCashAmount(String(Math.max(0, totalNum - (Number(e.target.value) || 0)))); }} style={{ width: "100%", padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                        </label>
                    </div>
                )}

                {delta !== 0 && (
                    <div style={{ padding: 10, background: delta > 0 ? "#fef3c7" : "#dbeafe", border: `1px solid ${delta > 0 ? "#fcd34d" : "#93c5fd"}`, borderRadius: 8, marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: delta > 0 ? "#92400e" : "#1e40af" }}>
                            Amount delta: {delta > 0 ? "+" : ""}{fmtRs(delta)}
                        </div>
                        {(payment.type === "topup" || payment.type === "wallet_topup") && (
                            <div style={{ fontSize: 10, color: delta > 0 ? "#92400e" : "#1e40af", fontWeight: 600, marginTop: 2 }}>
                                Wallet will be {delta > 0 ? "credited" : "debited"} by {fmtRs(Math.abs(delta))}
                            </div>
                        )}
                        {(payment.type === "product_sale" && payment.paymentMethod === "wallet") && (
                            <div style={{ fontSize: 10, color: delta > 0 ? "#92400e" : "#1e40af", fontWeight: 600, marginTop: 2 }}>
                                Wallet will be {delta > 0 ? "debited" : "credited"} by {fmtRs(Math.abs(delta))}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={onClose} disabled={saving} style={{ padding: "10px 16px", background: "white", border: "1.5px solid #e2e8f0", color: "#475569", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT }}>Cancel</button>
                    <button onClick={submit} disabled={saving || !splitOk} style={{ padding: "10px 22px", background: saving || !splitOk ? "#cbd5e1" : "#16a34a", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 900, cursor: saving || !splitOk ? "not-allowed" : "pointer", fontFamily: FONT }}>
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}
