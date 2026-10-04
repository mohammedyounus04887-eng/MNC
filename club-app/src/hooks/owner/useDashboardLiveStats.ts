/**
 * Dashboard top-stats — computed from the SAME live sources as the Today's
 * Report (Reception → Settings → Today's Report), so the homepage numbers
 * always agree with that report:
 *   - Today's Check-ins  = members whose lastVisit === today (member visits)
 *   - Today's Shakes      = served orders today, summed by shake quantity
 *   - Today's Revenue     = today's payment amounts (+ today's wallet top-ups)
 *   - Active Members      = members with status "active"
 *   - Low Stock           = simpleProducts currently out of stock (Inventory's
 *                           red condition), returned as a list for the click-through
 */

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toYmd = (v: any): string => {
    if (!v) return "";
    if (typeof v === "string") return v.slice(0, 10);
    try { const d = (v as any).toDate ? (v as any).toDate() : new Date(v); return ymd(d); } catch { return ""; }
};

export interface DashLiveStats {
    memberVisits: number;
    shakesServed: number;
    revenue: number;
    activeMembers: number;
    lowStock: { id: string; name: string; stock: number }[];
    loading: boolean;
}

export function useDashboardLiveStats(clubId: string | null): DashLiveStats {
    const [s, setS] = useState<DashLiveStats>({ memberVisits: 0, shakesServed: 0, revenue: 0, activeMembers: 0, lowStock: [], loading: true });

    useEffect(() => {
        if (!clubId) { setS(x => ({ ...x, loading: false })); return; }
        let cancelled = false;
        const today = ymd(new Date());
        const startOfDay = Timestamp.fromDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0));

        (async () => {
            try {
                const [ordersSnap, paymentsSnap, membersSnap, productsSnap, topupsSnap] = await Promise.all([
                    getDocs(query(collection(db, `clubs/${clubId}/orders`), where("date", "==", today))),
                    getDocs(query(collection(db, `clubs/${clubId}/payments`), where("date", "==", today))),
                    getDocs(collection(db, `clubs/${clubId}/members`)),
                    getDocs(collection(db, `clubs/${clubId}/simpleProducts`)).catch(() => null),
                    getDocs(query(collection(db, `clubs/${clubId}/topupRequests`), where("status", "==", "approved"), where("createdAt", ">=", startOfDay))).catch(() => null),
                ]);
                if (cancelled) return;

                let shakesServed = 0;
                for (const d of ordersSnap.docs) {
                    const o = d.data() as any;
                    if (o.status !== "served") continue;
                    for (const it of (o.items || [])) shakesServed += Number(it.quantity ?? it.qty ?? 1) || 1;
                }

                let revenue = 0;
                for (const d of paymentsSnap.docs) {
                    const p = d.data() as any;
                    if (p.deleted) continue;
                    revenue += Number(p.amount) || 0;
                }
                for (const d of (topupsSnap?.docs || [])) {
                    const t = d.data() as any;
                    if (toYmd(t.resolvedAt) !== today) continue;     // approved today
                    revenue += Number(t.approvedAmount ?? t.requestedAmount) || 0;
                }

                let memberVisits = 0, activeMembers = 0;
                for (const d of membersSnap.docs) {
                    const m = d.data() as any;
                    if (toYmd(m.lastVisit) === today) memberVisits++;
                    if ((m.status ?? "active") === "active") activeMembers++;
                }

                const lowStock = (productsSnap?.docs || [])
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter((p: any) => (Number(p.currentStock) || 0) <= 0)
                    .map((p: any) => ({ id: p.id, name: p.name || "Product", stock: Number(p.currentStock) || 0 }));

                setS({ memberVisits, shakesServed, revenue, activeMembers, lowStock, loading: false });
            } catch (e) {
                console.error("[dashboard live stats]", e);
                if (!cancelled) setS(x => ({ ...x, loading: false }));
            }
        })();

        return () => { cancelled = true; };
    }, [clubId]);

    return s;
}
