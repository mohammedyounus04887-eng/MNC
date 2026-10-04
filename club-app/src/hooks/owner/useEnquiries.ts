import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, query, where, getDocs, doc, updateDoc, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Enquiry } from "@/types/firestore";

export function useEnquiries(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-enquiries", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/enquiries`));
            const snap = await getDocs(q);
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Enquiry));
            return data.sort((a, b) => {
                const timeA = a.createdAt?.toMillis?.() || 0;
                const timeB = b.createdAt?.toMillis?.() || 0;
                return timeB - timeA;
            });
        },
    });
}

export function useUnreadEnquiryCount(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-enquiries-unread", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/enquiries`), where("status", "==", "new"));
            const snap = await getDocs(q);
            return snap.size;
        },
        refetchInterval: 30000,
    });
}

export function useUpdateEnquiryStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, enquiryId, status, notes }: { clubId: string; enquiryId: string; status: Enquiry["status"]; notes?: string }) => {
            const updates: Record<string, unknown> = { status };
            if (notes !== undefined) updates.notes = notes;
            await updateDoc(doc(db, `clubs/${clubId}/enquiries`, enquiryId), updates);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-enquiries"] });
            qc.invalidateQueries({ queryKey: ["owner-enquiries-unread"] });
        },
    });
}
