import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, query, where, getDocs, doc, addDoc, updateDoc,
    onSnapshot, Timestamp, orderBy, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Wallet, WalletTransaction, TopupRequest } from "@/types/firestore";
import { logInvoice } from "@/utils/invoice";
import { recordPayment } from "@/lib/recordPayment";

export function useWallets(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-wallets", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            // First fetch all members for this club
            const membersQ = query(collection(db, `clubs/${clubId}/members`));
            const memberSnap = await getDocs(membersQ);

            const wallets: (Wallet & { id: string })[] = [];
            for (const memberDoc of memberSnap.docs) {
                const walletSnap = await getDocs(collection(db, `clubs/${clubId}/members/${memberDoc.id}/wallet`));
                if (!walletSnap.empty) {
                    const data = walletSnap.docs[0].data() as Wallet;
                    // Always use the member doc ID as userId so top-up path is correct
                    wallets.push({ ...data, userId: memberDoc.id, id: walletSnap.docs[0].id });
                }
            }
            return wallets;
        },
    });
}

export function useWallet(clubId: string | null, memberId: string | null) {
    return useQuery({
        queryKey: ["owner-wallet", memberId],
        enabled: !!memberId && !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/members/${memberId}/wallet`));
            const snap = await getDocs(q);
            if (snap.empty) return null;
            return { ...snap.docs[0].data(), id: snap.docs[0].id } as Wallet & { id: string };
        },
    });
}

export function useTransactions(clubId: string | null, memberId?: string) {
    return useQuery({
        queryKey: ["owner-transactions", clubId, memberId],
        enabled: !!clubId,
        queryFn: async () => {
            if (memberId) {
                const q = query(
                    collection(db, `clubs/${clubId}/members/${memberId}/transactions`),
                    orderBy("createdAt", "desc")
                );
                const snap = await getDocs(q);
                return snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id } as WalletTransaction));
            } else {
                // If memberId is NOT provided, the owner wants to see ALL transactions across the club.
                // We fetch all members, then all their transactions, and combine & sort them.
                const membersQ = query(collection(db, `clubs/${clubId}/members`));
                const memberSnap = await getDocs(membersQ);
                let allTransactions: WalletTransaction[] = [];

                for (const memberDoc of memberSnap.docs) {
                    const txSnap = await getDocs(query(collection(db, `clubs/${clubId}/members/${memberDoc.id}/transactions`), orderBy("createdAt", "desc")));
                    for (const doc of txSnap.docs) {
                        allTransactions.push({ ...(doc.data() as Record<string, unknown>), id: doc.id } as WalletTransaction);
                    }
                }
                return allTransactions.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
            }
        },
    });
}

// ─── Real-time pending topup requests ───────────────────────────────────────

export function usePendingTopupRequests(clubId: string | null) {
    const [requests, setRequests] = useState<TopupRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/topupRequests`),
            where("status", "==", "pending"),
            orderBy("requestedAt", "desc")
        );
        const unsub = onSnapshot(q, (snap) => {
            setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as TopupRequest)));
            setLoading(false);
        }, () => setLoading(false));
        return () => unsub();
    }, [clubId]);

    return { requests, count: requests.length, loading };
}

// ─── Direct top-up (owner) ───────────────────────────────────────────────────

export function useTopUp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (data: {
            memberId: string;
            walletDocId: string;
            clubId: string;
            amount: number;
            paymentMethod: string;
            reference?: string;
            notes?: string;
            currentBalance: number;
        }) => {
            const now = Timestamp.now();
            const newBalance = data.currentBalance + data.amount;

            await updateDoc(doc(db, `clubs/${data.clubId}/members/${data.memberId}/wallet`, data.walletDocId), {
                balance: newBalance,
                lastUpdated: serverTimestamp(),
            });

            await addDoc(collection(db, `clubs/${data.clubId}/members/${data.memberId}/transactions`), {
                userId: data.memberId,
                clubId: data.clubId,
                type: "credit",
                amount: data.amount,
                reason: "topup",
                description: "Wallet Top-up by Owner",
                paymentMethod: data.paymentMethod,
                reference: data.reference ?? null,
                note: [data.paymentMethod, data.reference, data.notes].filter(Boolean).join(" | "),
                addedBy: "owner",
                balanceBefore: data.currentBalance,
                balanceAfter: newBalance,
                createdAt: now,
            });

            await updateDoc(doc(db, `clubs/${data.clubId}/members`, data.memberId), {
                hasPendingTopup: false,
            });

            // Record the money. This path collected cash at the owner's desk and
            // wrote no `payments` doc, so the top-up reached the member's balance
            // and showed as zero revenue everywhere. Safe from double-counting:
            // it creates no `topupRequests` doc, which is the collection Reports
            // tallies top-ups from (that is the member-request approval flow).
            await recordPayment({
                clubId: data.clubId,
                type: "wallet_topup",
                amount: data.amount,
                method: String(data.paymentMethod).toLowerCase() === "upi" ? "upi" : "cash",
                memberId: data.memberId,
                description: `Wallet top-up by owner${data.reference ? ` · ${data.reference}` : ""}`,
                source: "owner",
            });

            // ── Write invoice ─────────────────────────────────────────
            await logInvoice(data.clubId, data.memberId, {
                type: "wallet_topup",
                title: "Wallet Top-up",
                items: [{
                    description: `Wallet top-up (${data.paymentMethod || "—"})`,
                    qty: 1,
                    rate: data.amount,
                    amount: data.amount,
                }],
                paymentMethod: data.paymentMethod,
                paymentReference: data.reference,
                notes: data.notes,
            });

            return newBalance;
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["owner-wallet", vars.memberId] });
            qc.invalidateQueries({ queryKey: ["owner-wallets", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["owner-transactions"] });
        },
    });
}

// ─── Approve pending request ─────────────────────────────────────────────────

export function useApproveTopup() {
    return useMutation({
        mutationFn: async (data: {
            request: TopupRequest;
            approvedAmount: number;
            walletDocId: string;
            currentBalance: number;
        }) => {
            const { request, approvedAmount, walletDocId, currentBalance } = data;
            const now = Timestamp.now();
            const newBalance = currentBalance + approvedAmount;

            await updateDoc(doc(db, `clubs/${request.clubId}/members/${request.memberId}/wallet`, walletDocId), {
                balance: newBalance,
                lastUpdated: serverTimestamp(),
            });

            await addDoc(collection(db, `clubs/${request.clubId}/members/${request.memberId}/transactions`), {
                userId: request.memberId,
                clubId: request.clubId,
                type: "credit",
                amount: approvedAmount,
                reason: "topup",
                description: "Wallet Top-up via Member Request",
                paymentMethod: request.paymentMethod ?? "Cash",
                reference: request.reference ?? null,
                note: [request.paymentMethod, request.reference].filter(Boolean).join(" | "),
                addedBy: "owner",
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                createdAt: now,
            });

            await updateDoc(doc(db, `clubs/${request.clubId}/topupRequests`, request.id), {
                status: "approved",
                approvedAmount,
                resolvedAt: now,
                resolvedBy: "owner",
            });

            await updateDoc(doc(db, `clubs/${request.clubId}/members`, request.memberId), {
                hasPendingTopup: false,
            });

            // ── Write invoice ─────────────────────────────────────────
            await logInvoice(request.clubId, request.memberId, {
                type: "wallet_topup",
                title: "Wallet Top-up (Approved)",
                items: [{
                    description: `Wallet top-up (${request.paymentMethod || "—"})`,
                    qty: 1,
                    rate: approvedAmount,
                    amount: approvedAmount,
                }],
                paymentMethod: request.paymentMethod ?? "cash",
                paymentReference: request.reference,
            });

            return { newBalance, approvedAmount };
        },
    });
}

// ─── Reject pending request ──────────────────────────────────────────────────

export function useRejectTopup() {
    return useMutation({
        mutationFn: async (data: { clubId: string; requestId: string; reason?: string }) => {
            const requestRef = doc(db, `clubs/${data.clubId}/topupRequests`, data.requestId);
            const requestSnap = await import("firebase/firestore").then(({ getDoc }) => getDoc(requestRef));
            await updateDoc(doc(db, `clubs/${data.clubId}/topupRequests`, data.requestId), {
                status: "rejected",
                rejectionReason: data.reason ?? "",
                resolvedAt: Timestamp.now(),
                resolvedBy: "owner",
            });

            if (requestSnap.exists()) {
                const memberId = requestSnap.data().memberId as string | undefined;
                if (memberId) {
                    await updateDoc(doc(db, `clubs/${data.clubId}/members`, memberId), {
                        hasPendingTopup: false,
                    });
                }
            }
        },
    });
}

// ─── Re-export wallet lookup by userId for convenience ──────────────────────

export async function getWalletByUserId(clubId: string, memberId: string): Promise<(Wallet & { id: string }) | null> {
    const q = query(collection(db, `clubs/${clubId}/members/${memberId}/wallet`));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { ...snap.docs[0].data(), userId: memberId, id: snap.docs[0].id } as Wallet & { id: string };
}
