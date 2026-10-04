/**
 * Today's shakes served — total + per-shake breakdown from served orders.
 *
 * Used by the Daily Club Usage modal so the inventory manager can see what
 * was actually served today while recording box usage. Informational only —
 * the simple-inventory SKUs aren't linked to kitchen recipes, so we don't
 * auto-deduct; we just surface the served counts for a sanity check.
 */

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface TodayShakes {
    total: number;
    byShake: { name: string; qty: number }[];
    loading: boolean;
}

export function useTodayShakes(clubId: string | null): TodayShakes {
    const [state, setState] = useState<TodayShakes>({ total: 0, byShake: [], loading: true });
    useEffect(() => {
        if (!clubId) { setState({ total: 0, byShake: [], loading: false }); return; }
        let cancelled = false;
        const today = ymd(new Date());
        getDocs(query(collection(db, `clubs/${clubId}/orders`), where("date", "==", today)))
            .then(snap => {
                if (cancelled) return;
                const counts: Record<string, number> = {};
                let total = 0;
                for (const d of snap.docs) {
                    const o = d.data() as any;
                    if (o.status !== "served") continue;
                    for (const it of (o.items || [])) {
                        const name = it.productName || it.itemName || it.name || "Shake";
                        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
                        counts[name] = (counts[name] || 0) + qty;
                        total += qty;
                    }
                }
                setState({
                    total,
                    byShake: Object.entries(counts).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
                    loading: false,
                });
            })
            .catch(() => { if (!cancelled) setState(s => ({ ...s, loading: false })); });
        return () => { cancelled = true; };
    }, [clubId]);
    return state;
}
