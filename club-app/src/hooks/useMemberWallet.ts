import { useEffect, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, onSnapshot, getDocs, setDoc, updateDoc,
    query, where, orderBy, limit, startAfter, Timestamp, serverTimestamp,
    QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import type { Wallet, WalletTransaction, TopupRequest } from "@/types/firestore";

// ─── useMyWallet (real-time) ────────────────────────────────────────────

export function useMyWallet() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club) return;
        const unsub = onSnapshot(
            doc(db, `clubs/${club.id}/members/${memberId}/wallet`, "data"),
            (snap) => {
                if (snap.exists()) setWallet(snap.data() as Wallet);
                else setWallet(null);
                setLoading(false);
            },
            (err) => { setError(err.message); setLoading(false); }
        );
        return () => unsub();
    }, [firebaseUser, userProfile?.id, club]);

    return { wallet, loading, error };
}

// ─── useMyTransactions (paginated) ──────────────────────────────────────

const PAGE_SIZE = 50;

export function useMyTransactions() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Initial load
    useEffect(() => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club) return;
        const fetchFirst = async () => {
            try {
                const q = query(
                    collection(db, `clubs/${club.id}/members/${memberId}/transactions`),
                    orderBy("createdAt", "desc"),
                    limit(PAGE_SIZE)
                );
                const snap = await getDocs(q);
                const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WalletTransaction);
                setTransactions(docs);
                setLastDoc(snap.docs[snap.docs.length - 1] || null);
                setHasMore(snap.docs.length === PAGE_SIZE);
            } catch (err: any) { setError(err.message); }
            setLoading(false);
        };
        fetchFirst();
    }, [firebaseUser, userProfile?.id, club]);

    const loadMore = useCallback(async () => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club || !lastDoc || !hasMore) return;
        try {
            const q = query(
                collection(db, `clubs/${club.id}/members/${memberId}/transactions`),
                orderBy("createdAt", "desc"),
                startAfter(lastDoc),
                limit(PAGE_SIZE)
            );
            const snap = await getDocs(q);
            const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WalletTransaction);
            setTransactions((prev) => [...prev, ...docs]);
            setLastDoc(snap.docs[snap.docs.length - 1] || null);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err: any) { setError(err.message); }
    }, [firebaseUser, userProfile?.id, club, lastDoc, hasMore]);

    return { transactions, loadMore, hasMore, loading, error };
}

// ─── useMyTopupRequests ─────────────────────────────────────────────────

export function useMyTopupRequests() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["member", "topupRequests", club?.id, userProfile?.id ?? firebaseUser?.uid],
        queryFn: async () => {
            const memberId = userProfile?.id ?? firebaseUser?.uid;
            if (!club) return [];
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/topupRequests`),
                    where("memberId", "==", memberId),
                    orderBy("requestedAt", "desc")
                )
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TopupRequest);
        },
        enabled: !!club && !!(userProfile?.id ?? firebaseUser?.uid),
    });
}

// ─── useMyPendingRequest ────────────────────────────────────────────────

export function useMyPendingRequest() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [pendingRequest, setPendingRequest] = useState<TopupRequest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club) return;
        const q = query(
            collection(db, `clubs/${club.id}/topupRequests`),
            where("memberId", "==", memberId),
            where("status", "==", "pending")
        );
        const unsub = onSnapshot(q, (snap) => {
            setPendingRequest(snap.docs.length > 0 ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as TopupRequest) : null);
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser, userProfile?.id, club]);

    return { pendingRequest, hasPending: !!pendingRequest, loading };
}

// ─── useMyLatestRequest (real-time — for showing approved/rejected banners) ──

export function useMyLatestRequest() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [latestRequest, setLatestRequest] = useState<TopupRequest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club) return;
        const q = query(
            collection(db, `clubs/${club.id}/topupRequests`),
            where("memberId", "==", memberId),
            orderBy("requestedAt", "desc"),
            limit(1)
        );
        const unsub = onSnapshot(q, (snap) => {
            setLatestRequest(snap.docs.length > 0
                ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as TopupRequest)
                : null);
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser, userProfile?.id, club]);

    return { latestRequest, loading };
}


// ─── useRaiseTopupRequest ───────────────────────────────────────────────

export function useRaiseTopupRequest() {
    const qc = useQueryClient();
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (data: { amount: number; paymentMethod?: string; reference?: string }): Promise<{ requestId: string; amount: number; method: string; memberName: string; memberId: string; }> => {
            if (!firebaseUser || !userProfile || !club) throw new Error("Not ready");
            if (data.amount <= 0) throw new Error("Amount must be greater than 0");
            const memberId = userProfile.id ?? firebaseUser.uid;

            // Double-check no pending
            const q = query(
                collection(db, `clubs/${club.id}/topupRequests`),
                where("memberId", "==", memberId),
                where("status", "==", "pending")
            );
            const existing = await getDocs(q);
            if (existing.size > 0) throw new Error("You already have a pending request");

            const id = "topup_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            await setDoc(doc(db, `clubs/${club.id}/topupRequests`, id), {
                id,
                memberId,
                memberName: userProfile.name,
                memberPhoto: userProfile.photo || "",
                memberPhone: userProfile.phone || "",
                clubId: club.id,
                amount: data.amount,
                requestedAmount: data.amount,
                approvedAmount: null,
                paymentMethod: data.paymentMethod ?? "Cash",
                reference: data.reference ?? null,
                note: data.reference ?? "",
                status: "pending",
                createdAt: serverTimestamp(),
                requestedAt: serverTimestamp(),
                resolvedAt: null,
                resolvedBy: null,
            });

            await updateDoc(doc(db, `clubs/${club.id}/members`, memberId), {
                hasPendingTopup: true,
                lastTopupRequest: serverTimestamp(),
            });

            return {
                requestId: id,
                amount: data.amount,
                method: data.paymentMethod ?? "Cash",
                memberName: userProfile.name,
                memberId: (userProfile as any).memberId || memberId,
            };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["member", "topupRequests"] });
            qc.invalidateQueries({ queryKey: ["member-wallet"] });
        },
    });
}
