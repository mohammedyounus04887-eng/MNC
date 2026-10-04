import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, addDoc, Timestamp, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface WeightEntry {
    id: string;
    weight: number;
    date: Timestamp;
    notes: string;
}

export function useWeightEntries(memberId: string | null) {
    return useQuery({
        queryKey: ["member-weight", memberId],
        enabled: !!memberId,
        queryFn: async () => {
            const q = query(collection(db, "users", memberId!, "weightLog"), orderBy("date", "asc"));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as WeightEntry));
        },
    });
}

export function useAddWeightEntry() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ memberId, weight, notes }: { memberId: string; weight: number; notes?: string }) => {
            await addDoc(collection(db, "users", memberId, "weightLog"), {
                weight,
                date: Timestamp.now(),
                notes: notes || "",
            });
        },
        onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["member-weight", vars.memberId] }),
    });
}

export type { WeightEntry };
