/**
 * Owner dashboard analytics — real data for the charts section.
 *
 * Uses the same safe date-range queries the Reports page relies on
 * (orders / payments / productSales by `date` string — already indexed),
 * NOT the collection-group transaction/attendance hooks whose composite
 * indexes are unreliable. Member / virtual / new-customer counts use cheap
 * getCountFromServer aggregates (no full-collection doc reads).
 */

import { useEffect, useState } from "react";
import { collection, getDocs, getCountFromServer, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { splitOf } from "@/lib/paymentSplit";

export type DashPeriod = "today" | "month" | "year";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tsToDate = (t: any): Date | null => { try { return t?.toDate ? t.toDate() : (t ? new Date(t) : null); } catch { return null; } };
const isOrderCancelled = (o: any) => o?.status === "cancelled" || o?.status === "rejected";

export interface DashTrendPoint { label: string; value: number; }
export interface DashSlice { name: string; value: number; }

export interface DashboardAnalytics {
    loading: boolean;
    revenue: number;
    cash: number;
    upi: number;
    shakesServed: number;
    productsSold: number;
    newCustomers: number;
    membersTotal: number;
    virtualTotal: number;
    bySource: DashSlice[];
    trend: DashTrendPoint[];      // per-day (month) or per-month (year); empty for today
    topProducts: DashSlice[];
}

function rangeFor(period: DashPeriod): { start: Date; end: Date } {
    const now = new Date();
    if (period === "today") { const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return { start: s, end: s }; }
    if (period === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
    return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31) };
}

const SOURCE_LABEL: Record<string, string> = {
    plan_purchase: "Memberships", membership: "Memberships",
    oneday_shake: "One-Day Shakes", product_sale: "Products",
    guest_payment: "Guests", virtual_member: "Virtual",
};

export function useDashboardAnalytics(clubId: string | null, period: DashPeriod): DashboardAnalytics {
    const [state, setState] = useState<DashboardAnalytics>({
        loading: true, revenue: 0, cash: 0, upi: 0, shakesServed: 0, productsSold: 0,
        newCustomers: 0, membersTotal: 0, virtualTotal: 0, bySource: [], trend: [], topProducts: [],
    });

    useEffect(() => {
        if (!clubId) return;
        let cancelled = false;
        const { start, end } = rangeFor(period);
        const startStr = ymd(start), endStr = ymd(end);
        setState(s => ({ ...s, loading: true }));

        (async () => {
            try {
                const [ordersSnap, paymentsSnap, salesSnap, membersCount, virtualCount, newCount] = await Promise.all([
                    getDocs(query(collection(db, `clubs/${clubId}/orders`), where("date", ">=", startStr), where("date", "<=", endStr))),
                    getDocs(query(collection(db, `clubs/${clubId}/payments`), where("date", ">=", startStr), where("date", "<=", endStr))),
                    getDocs(query(collection(db, `clubs/${clubId}/productSales`), where("date", ">=", startStr), where("date", "<=", endStr))),
                    getCountFromServer(collection(db, `clubs/${clubId}/members`)).catch(() => null),
                    getCountFromServer(collection(db, `clubs/${clubId}/virtualMembers`)).catch(() => null),
                    getCountFromServer(query(
                        collection(db, `clubs/${clubId}/members`),
                        where("createdAt", ">=", Timestamp.fromDate(new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0))),
                        where("createdAt", "<=", Timestamp.fromDate(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59))),
                    )).catch(() => null),
                ]);
                if (cancelled) return;

                const orders = ordersSnap.docs.map(d => d.data() as any);
                const payments = paymentsSnap.docs.map(d => d.data() as any).filter(p => !p.deleted);
                const sales = salesSnap.docs.map(d => d.data() as any);

                let cash = 0, upi = 0, revenue = 0;
                const bySourceMap: Record<string, number> = {};
                for (const p of payments) {
                    const amt = Number(p.amount) || 0;
                    revenue += amt;
                    const s = splitOf(p);
                    cash += s.cash;
                    upi += s.upi;
                    const label = SOURCE_LABEL[p.type] || "Other";
                    bySourceMap[label] = (bySourceMap[label] || 0) + amt;
                }

                let shakesServed = 0;
                for (const o of orders) {
                    if (isOrderCancelled(o)) continue;
                    shakesServed += (o.items || []).reduce((s: number, it: any) => s + (Number(it.qty ?? it.quantity) || 1), 0);
                }

                let productsSold = 0;
                const prodMap: Record<string, number> = {};
                for (const s of sales) {
                    const q = Number(s.quantity) || 0;
                    productsSold += q;
                    const nm = s.productName || "Product";
                    prodMap[nm] = (prodMap[nm] || 0) + (Number(s.totalAmount) || 0);
                }

                // Trend
                let trend: DashTrendPoint[] = [];
                if (period === "month") {
                    const byDay: Record<string, number> = {};
                    for (const p of payments) byDay[p.date] = (byDay[p.date] || 0) + (Number(p.amount) || 0);
                    const days = end.getDate();
                    for (let d = 1; d <= days; d++) {
                        const ds = ymd(new Date(start.getFullYear(), start.getMonth(), d));
                        trend.push({ label: String(d), value: Math.round(byDay[ds] || 0) });
                    }
                } else if (period === "year") {
                    const byMonth: number[] = new Array(12).fill(0);
                    for (const p of payments) {
                        const dt = p.date ? new Date(p.date) : null;
                        if (dt && dt.getFullYear() === start.getFullYear()) byMonth[dt.getMonth()] += Number(p.amount) || 0;
                    }
                    const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    trend = byMonth.map((v, i) => ({ label: M[i], value: Math.round(v) }));
                }

                setState({
                    loading: false, revenue, cash, upi, shakesServed, productsSold,
                    newCustomers: newCount ? newCount.data().count : 0,
                    membersTotal: membersCount ? membersCount.data().count : 0,
                    virtualTotal: virtualCount ? virtualCount.data().count : 0,
                    bySource: Object.entries(bySourceMap).map(([name, value]) => ({ name, value: Math.round(value) })).filter(s => s.value > 0).sort((a, b) => b.value - a.value),
                    trend,
                    topProducts: Object.entries(prodMap).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 6),
                });
            } catch (e) {
                console.error("[dashboard analytics]", e);
                if (!cancelled) setState(s => ({ ...s, loading: false }));
            }
        })();

        return () => { cancelled = true; };
    }, [clubId, period]);

    return state;
}
