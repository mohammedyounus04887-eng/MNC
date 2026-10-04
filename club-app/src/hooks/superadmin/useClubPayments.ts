import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection,
    doc,
    addDoc,
    getDocs,
    orderBy,
    query,
    Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Club, PaymentRecord } from "@/types/firestore";

// ─── useClubPayments ────────────────────────────────────────────────────

export function useClubPayments(clubId: string) {
    return useQuery({
        queryKey: ["superadmin", "payments", clubId],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collection(db, "clubs", clubId, "payments"),
                    orderBy("date", "desc")
                )
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PaymentRecord);
        },
        enabled: !!clubId,
    });
}

// ─── useAddPayment ──────────────────────────────────────────────────────

interface AddPaymentInput {
    clubId: string;
    amount: number;
    date: Timestamp;
    notes: string;
    recordedBy: string;
}

export function useAddPayment() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: AddPaymentInput) => {
            const { clubId, ...paymentData } = input;
            const docRef = await addDoc(
                collection(db, "clubs", clubId, "payments"),
                {
                    ...paymentData,
                    clubId,
                    createdAt: Timestamp.now(),
                }
            );
            return docRef.id;
        },
        onSuccess: (_data, variables) => {
            qc.invalidateQueries({ queryKey: ["superadmin", "payments", variables.clubId] });
            qc.invalidateQueries({ queryKey: ["superadmin", "clubs"] });
        },
    });
}

// ─── usePaymentStatus ───────────────────────────────────────────────────

export type PaymentStatus = "paid" | "due-soon" | "overdue";

export function usePaymentStatus(club: Club | undefined): PaymentStatus {
    if (!club) return "overdue";

    const dueDate = club.maintenanceDueDate?.toDate?.();
    if (!dueDate) return "overdue";

    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 0) return "overdue";
    if (diffDays <= 7) return "due-soon";
    return "paid";
}
