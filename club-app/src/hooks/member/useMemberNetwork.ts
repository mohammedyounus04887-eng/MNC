import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "@/types/firestore";

interface NetworkNode {
    member: User;
    children: NetworkNode[];
}

async function fetchReferrals(memberId: string, clubId: string): Promise<NetworkNode[]> {
    const q = query(collection(db, `clubs/${clubId}/members`), where("referredBy", "==", memberId));
    const snap = await getDocs(q);
    const members = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
    const nodes = await Promise.all(members.map(async (m) => {
        const children = await fetchReferrals(m.id, clubId);
        return { member: m, children };
    }));
    return nodes;
}

export function useMyNetwork(memberId: string | null, clubId: string | null) {
    return useQuery({
        queryKey: ["member-network", memberId],
        enabled: !!memberId && !!clubId,
        queryFn: async () => {
            const tree = await fetchReferrals(memberId!, clubId!);
            // Count totals
            function count(nodes: NetworkNode[]): number {
                return nodes.reduce((sum, n) => sum + 1 + count(n.children), 0);
            }
            const directCount = tree.length;
            const totalCount = count(tree);
            const activeCount = tree.filter(n => n.member.status === "active").length;
            return { tree, directCount, totalCount, activeCount };
        },
        staleTime: 5 * 60 * 1000,
    });
}

export type { NetworkNode };
