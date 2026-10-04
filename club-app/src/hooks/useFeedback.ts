import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, addDoc, getDocs,
    query, where, orderBy, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { Feedback } from "@/types/firestore";

// ─── useSubmitFeedback ───────────────────────────────────────────────────

export function useSubmitFeedback() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: Omit<Feedback, "id" | "createdAt">) => {
            const ref = await addDoc(collection(db, `clubs/${input.clubId}/feedback`), {
                ...input,
                createdAt: Timestamp.now(),
            });
            return ref.id;
        },
        onSuccess: (_id, vars) => qc.invalidateQueries({ queryKey: ["feedback", vars.clubId] }),
    });
}

// ─── useClubFeedback ─────────────────────────────────────────────────────

export function useClubFeedback() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["feedback", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club!.id}/feedback`),
                    orderBy("createdAt", "desc")
                )
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Feedback);
        },
        enabled: !!club?.id,
    });
}
