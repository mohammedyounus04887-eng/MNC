import { useQuery } from "@tanstack/react-query";
import { collectionGroup, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types/firestore";

export function useMyOrders(memberId: string | null) {
    return useQuery({
        queryKey: ["member-orders", memberId],
        enabled: !!memberId,
        queryFn: async () => {
            const q = query(
                collectionGroup(db, "orders"),
                where("memberId", "==", memberId),
                orderBy("createdAt", "desc")
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        },
    });
}
