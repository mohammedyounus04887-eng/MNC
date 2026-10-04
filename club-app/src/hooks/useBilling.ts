import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, getDocs, setDoc,
    query, where, orderBy, limit, startAfter,
    Timestamp, QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import type { BillingPrint, BillItem } from "@/types/firestore";

// ─── useGenerateBill ────────────────────────────────────────────────────

export function useGenerateBill() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    const { firebaseUser } = useAuth();

    return useMutation({
        mutationFn: async ({ memberId, memberName, items, paidFrom }: {
            memberId: string;
            memberName: string;
            items: BillItem[];
            paidFrom: "wallet" | "cash";
        }) => {
            if (!club || !firebaseUser) throw new Error("Not ready");
            const subtotal = items.reduce((s, i) => s + i.total, 0);
            const id = "bill_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            const bill: BillingPrint = {
                id,
                memberId,
                memberName,
                clubId: club.id,
                items,
                subtotal,
                total: subtotal,
                paidFrom,
                printedAt: Timestamp.now(),
                printedBy: firebaseUser.uid,
            };
            await setDoc(doc(db, "billingPrints", id), bill);
            return bill;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
    });
}

// ─── useClubBills (paginated) ───────────────────────────────────────────

const PAGE_SIZE = 20;

export function useClubBills() {
    const { club } = useClubContext();
    const [bills, setBills] = useState<BillingPrint[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchFirst = useCallback(async () => {
        if (!club) return;
        try {
            const q = query(
                collection(db, "billingPrints"),
                where("clubId", "==", club.id),
                orderBy("printedAt", "desc"),
                limit(PAGE_SIZE)
            );
            const snap = await getDocs(q);
            setBills(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BillingPrint));
            setLastDoc(snap.docs[snap.docs.length - 1] || null);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err: any) { setError(err.message); }
        setLoading(false);
    }, [club]);

    // Auto-fetch on mount
    useState(() => { fetchFirst(); });

    const loadMore = useCallback(async () => {
        if (!club || !lastDoc || !hasMore) return;
        const q = query(
            collection(db, "billingPrints"),
            where("clubId", "==", club.id),
            orderBy("printedAt", "desc"),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
        );
        const snap = await getDocs(q);
        setBills((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BillingPrint)]);
        setLastDoc(snap.docs[snap.docs.length - 1] || null);
        setHasMore(snap.docs.length === PAGE_SIZE);
    }, [club, lastDoc, hasMore]);

    const refetch = useCallback(() => {
        setLoading(true);
        setBills([]);
        setLastDoc(null);
        setHasMore(true);
        fetchFirst();
    }, [fetchFirst]);

    return { bills, loadMore, hasMore, loading, error, refetch };
}

// ─── useMemberBills ─────────────────────────────────────────────────────

export function useMemberBills(memberId: string) {
    const [bills, setBills] = useState<BillingPrint[]>([]);
    const [loading, setLoading] = useState(true);

    useState(() => {
        if (!memberId) { setLoading(false); return; }
        const fetchData = async () => {
            const snap = await getDocs(
                query(
                    collection(db, "billingPrints"),
                    where("memberId", "==", memberId),
                    orderBy("printedAt", "desc")
                )
            );
            setBills(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BillingPrint));
            setLoading(false);
        };
        fetchData();
    });

    return { bills, loading };
}
