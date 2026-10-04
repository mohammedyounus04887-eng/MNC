/**
 * Today's product usage — sums the `club_usage` stock movements recorded today
 * (via Daily Club Usage), grouped by product. Feeds the Product Usage
 * Breakdown in Today's Report, the printed receipt, and saved reports.
 *
 * Live (onSnapshot) so the report reflects usage as it's entered. Bounded by
 * createdAt >= start-of-today (single-field range, no composite index); the
 * club_usage type is filtered client-side.
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface ProductUsageRow { name: string; qty: number; }

export function useTodayProductUsage(clubId: string | null): { usage: ProductUsageRow[]; total: number } {
    const [usage, setUsage] = useState<ProductUsageRow[]>([]);

    useEffect(() => {
        if (!clubId) { setUsage([]); return; }
        const now = new Date();
        const startOfDay = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
        const q = query(collection(db, `clubs/${clubId}/stockMovements`), where("createdAt", ">=", startOfDay));
        return onSnapshot(q, snap => {
            const map: Record<string, number> = {};
            for (const d of snap.docs) {
                const mv = d.data() as any;
                if (mv.type !== "club_usage") continue;
                const name = mv.productName || "Product";
                map[name] = (map[name] || 0) + Math.abs(Number(mv.delta) || 0);
            }
            setUsage(Object.entries(map).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty));
        }, () => setUsage([]));
    }, [clubId]);

    return { usage, total: usage.reduce((s, u) => s + u.qty, 0) };
}
