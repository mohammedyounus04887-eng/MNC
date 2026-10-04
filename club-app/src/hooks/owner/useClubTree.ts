import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Club } from "@/types/firestore";

interface ClubTreeNode {
    club: Club;
    memberCount: number;
    children: ClubTreeNode[];
}

async function fetchChildren(parentId: string): Promise<ClubTreeNode[]> {
    const q = query(collection(db, "clubs"), where("parentClubId", "==", parentId));
    const snap = await getDocs(q);
    const clubs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Club));

    const nodes = await Promise.all(
        clubs.map(async (club) => {
            const membersQ = query(collection(db, `clubs/${club.id}/members`));
            const membersSnap = await getDocs(membersQ);
            const children = await fetchChildren(club.id);
            return { club, memberCount: membersSnap.size, children };
        })
    );

    return nodes;
}

export function useClubTree(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-club-tree", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const children = await fetchChildren(clubId!);
            return children;
        },
        staleTime: 5 * 60 * 1000,
    });
}
