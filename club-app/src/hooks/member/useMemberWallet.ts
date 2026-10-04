import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, doc, query, getDoc, getDocs, addDoc, Timestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Wallet, WalletTransaction } from "@/types/firestore";

export function useMyWallet(memberId: string | null, clubId: string | null) {
    return useQuery({
        queryKey: ["member-wallet", clubId, memberId],
        enabled: !!memberId && !!clubId,
        queryFn: async () => {
            const snap = await getDoc(doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data"));
            if (!snap.exists()) return null;
            return { id: snap.id, ...snap.data() } as Wallet & { id: string };
        },
    });
}

export function useMyTransactions(memberId: string | null, clubId: string | null) {
    return useQuery({
        queryKey: ["member-transactions", clubId, memberId],
        enabled: !!memberId && !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/members/${memberId}/transactions`), orderBy("createdAt", "desc"));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as WalletTransaction));
        },
    });
}

export function useRequestTopUp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (data: { memberId: string; memberName: string; memberPhoto: string; clubId: string; amount: number; paymentMethod?: string; reference?: string; notes?: string }) => {
            await addDoc(collection(db, `clubs/${data.clubId}/topupRequests`), {
                memberId: data.memberId,
                memberName: data.memberName,
                memberPhoto: data.memberPhoto || "",
                clubId: data.clubId,
                requestedAmount: data.amount,
                approvedAmount: null,
                status: "pending",
                requestedAt: Timestamp.now(),
                resolvedAt: null,
                resolvedBy: null,
            });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["member-wallet"] }),
    });
}
