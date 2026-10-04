import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, query, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "@/types/firestore";
import { generateMemberId, generatePrefixFromName } from "@/utils/generateMemberId";

export function useMembers(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-members", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            // Fetch ALL members — no orderBy to avoid missing docs without joinedAt field.
            // Members created via Reception have createdAt but not joinedAt.
            // Sort client-side using createdAt (falling back to joinedAt).
            const q = query(
                collection(db, `clubs/${clubId}/members`)
            );
            const snap = await getDocs(q);
            // Spread data first, then override id with the Firestore doc ID.
            // Some member docs have their own `id` field (legacy) that must NOT
            // overwrite d.id — otherwise navigation / lookups break.
            const members = snap.docs.map(d => ({ ...d.data(), id: d.id } as User));
            // Sort newest first: prefer createdAt, fall back to joinedAt (some legacy members)
            members.sort((a, b) => {
                const aTime = (a.createdAt?.toMillis?.() || (a as any).joinedAt?.toMillis?.() || 0);
                const bTime = (b.createdAt?.toMillis?.() || (b as any).joinedAt?.toMillis?.() || 0);
                return bTime - aTime;
            });
            return members;
        },
    });
}

export function useMember(clubId: string | null, memberId: string | null) {
    return useQuery({
        queryKey: ["owner-member", clubId, memberId],
        enabled: !!clubId && !!memberId,
        queryFn: async () => {
            const snap = await getDoc(doc(db, `clubs/${clubId}/members`, memberId!));
            if (!snap.exists()) return null;
            return { id: snap.id, ...snap.data() } as User;
        },
    });
}

export function useAddMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (data: { clubId: string; member: Partial<User>; clubName?: string; uid?: string }) => {
            // Fetch club name for prefix if not provided
            let clubName = data.clubName || "";
            if (!clubName) {
                const clubSnap = await getDoc(doc(db, "clubs", data.clubId));
                clubName = clubSnap.data()?.name || "MNC";
            }
            const prefix = generatePrefixFromName(clubName);
            const memberId = await generateMemberId(data.clubId, prefix);

            const now = Timestamp.now();
            const memberDoc = {
                ...data.member,
                clubId: data.clubId,
                originalClubId: data.clubId,
                role: "member" as const,
                status: "active" as const,
                isPermanent: true,
                isActiveMember: true,
                memberType: "permanent",
                activatedAt: now,
                shakeCredits: 0,
                shakeCreditsPlanTotal: 0,
                memberId,
                qrCode: memberId,
                isClubOwner: false,
                ownedClubId: null,
                parentUserId: data.member.referredBy || null,
                treePath: memberId,
                joinedAt: now,
                createdAt: now,
                updatedAt: now,
            };

            let docId: string;
            if (data.uid) {
                await setDoc(doc(db, `clubs/${data.clubId}/members`, data.uid), { ...memberDoc, id: data.uid });
                docId = data.uid;
            } else {
                const ref = await addDoc(collection(db, `clubs/${data.clubId}/members`), memberDoc);
                docId = ref.id;
            }

            // Create empty wallet
            await setDoc(doc(db, `clubs/${data.clubId}/members/${docId}/wallet`, "data"), {
                userId: docId,
                clubId: data.clubId,
                currencyName: "MNC Currency",
                balance: 0,
                lastUpdated: now,
            });

            return { id: docId, memberId };
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["owner-members", vars.clubId] });
        },
    });
}

export function useUpdateMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, memberId, data }: { clubId: string; memberId: string; data: Partial<User> }) => {
            await updateDoc(doc(db, `clubs/${clubId}/members`, memberId), { ...data, updatedAt: Timestamp.now() } as any);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-member"] });
            qc.invalidateQueries({ queryKey: ["owner-members"] });
        },
    });
}
