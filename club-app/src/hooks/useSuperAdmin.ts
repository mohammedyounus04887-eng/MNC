import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    writeBatch,
    Timestamp,
    serverTimestamp,
    onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Club, User, Wallet } from "@/types/firestore";

// ─── useAllClubs ────────────────────────────────────────────────────────

export function useAllClubs() {
    return useQuery({
        queryKey: ["superadmin", "clubs"],
        queryFn: async () => {
            const snap = await getDocs(collection(db, "clubs"));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Club);
        },
    });
}

// ─── useClubById ────────────────────────────────────────────────────────

export function useClubById(clubId: string) {
    return useQuery({
        queryKey: ["superadmin", "club", clubId],
        queryFn: async () => {
            const snap = await getDoc(doc(db, "clubs", clubId));
            if (!snap.exists()) throw new Error("Club not found");
            return { id: snap.id, ...snap.data() } as Club;
        },
        enabled: !!clubId,
    });
}

// ─── usePlatformStats ───────────────────────────────────────────────────

export function usePlatformStats() {
    const [data, setData] = useState<{
        totalClubs: number;
        activeClubs: number;
        disabledClubs: number;
        totalMembers: number;
        totalActiveMembers: number;
        totalFeedbacks: number;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const unsubscribe = onSnapshot(collection(db, "clubs"), async (snap) => {
            if (cancelled) return;
            const clubs = snap.docs;
            const totalClubs = clubs.length;
            const activeClubs = clubs.filter(d => d.data().status === "active").length;
            const disabledClubs = clubs.filter(d => d.data().status === "disabled").length;

            let totalMembers = 0;
            let totalActiveMembers = 0;
            let totalFeedbacks = 0;

            await Promise.all(clubs.map(async (clubDoc) => {
                const [membersSnap, feedbackSnap] = await Promise.all([
                    getDocs(collection(db, "clubs", clubDoc.id, "members")),
                    getDocs(collection(db, "clubs", clubDoc.id, "feedback")),
                ]);
                totalMembers += membersSnap.size;
                totalActiveMembers += membersSnap.docs.filter(
                    m => m.data().isPermanent === true
                ).length;
                totalFeedbacks += feedbackSnap.size;
            }));

            if (!cancelled) {
                setData({ totalClubs, activeClubs, disabledClubs, totalMembers, totalActiveMembers, totalFeedbacks });
                setIsLoading(false);
            }
        });

        return () => { cancelled = true; unsubscribe(); };
    }, []);

    return { data, isLoading };
}

// ─── useMemberCountByClub ───────────────────────────────────────────────

export function useMemberCountByClub(clubId: string) {
    return useQuery({
        queryKey: ["superadmin", "memberCount", clubId],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${clubId}/members`)
                )
            );
            return snap.size;
        },
        enabled: !!clubId,
    });
}

// ─── useCreateClub ──────────────────────────────────────────────────────

interface CreateClubInput {
    club: Omit<Club, "id" | "createdAt" | "createdBy" | "status" | "maintenancePaid" | "maintenanceDueDate">;
    ownerEmail: string;
    ownerPassword?: string;
    createdBy: string;
}

export function useCreateClub() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: CreateClubInput) => {
            const batch = writeBatch(db);
            const clubId = input.club.domain.replace(/[^a-z0-9]/g, "_") + "_" + Date.now();
            const now = Timestamp.now();

            // Determine treePath
            let treePath = clubId;
            if (input.club.parentClubId) {
                const parentSnap = await getDoc(doc(db, "clubs", input.club.parentClubId));
                if (parentSnap.exists()) {
                    treePath = (parentSnap.data() as Club).treePath + "/" + clubId;
                }
            }

            // Create club document
            const clubData: any = {
                ...input.club,
                id: clubId,
                domains: [input.club.domain],
                treePath,
                status: "active",
                maintenancePaid: true,
                maintenanceDueDate: Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)),
                createdAt: now,
                createdBy: input.createdBy,
            };
            batch.set(doc(db, "clubs", clubId), clubData);

            // Create owner user document
            const ownerId = "owner_" + clubId;
            const ownerData: any = {
                id: ownerId,
                name: input.club.ownerName,
                phone: input.club.ownerPhone,
                email: input.ownerEmail,
                photo: "",
                role: "clubOwner",
                clubId,
                parentUserId: null,
                treePath: ownerId,
                shakeCredits: 0,
                shakeCreditsPlanTotal: 0,
                status: "active",
                dob: null,
                anniversary: null,
                qrCode: "",
                isClubOwner: true,
                ownedClubId: clubId,
                originalClubId: clubId,
                referredBy: null,
                createdAt: now,
                updatedAt: now,
            };
            batch.set(doc(db, `clubs/${clubId}/members`, ownerId), ownerData);

            // Update club with ownerUserId
            batch.update(doc(db, "clubs", clubId), { ownerUserId: ownerId });

            // Create wallet
            batch.set(doc(db, `clubs/${clubId}/members/${ownerId}/wallet`, "data"), {
                userId: ownerId,
                clubId,
                currencyName: input.club.currencyName,
                balance: 0,
                lastUpdated: now,
            } as Wallet);

            // Update platform stats
            try {
                const platformSnap = await getDoc(doc(db, "platform", "config"));
                if (platformSnap.exists()) {
                    const data = platformSnap.data();
                    batch.update(doc(db, "platform", "config"), {
                        totalClubs: (data.totalClubs || 0) + 1,
                        lastUpdated: now,
                    });
                }
            } catch { }

            await batch.commit();
            return clubId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin"] });
        },
    });
}

// ─── useUpdateClub ──────────────────────────────────────────────────────

export function useUpdateClub() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ clubId, data }: { clubId: string; data: Partial<Club> }) => {
            await updateDoc(doc(db, "clubs", clubId), data as any);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin"] });
        },
    });
}

// ─── useToggleClubStatus ────────────────────────────────────────────────

export function useToggleClubStatus() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ clubId, currentStatus }: { clubId: string; currentStatus: string }) => {
            const newStatus = currentStatus === "active" ? "disabled" : "active";
            await updateDoc(doc(db, "clubs", clubId), { status: newStatus });
            return newStatus;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin"] });
        },
    });
}

// ─── useToggleMaintenancePaid ───────────────────────────────────────────

export function useToggleMaintenancePaid() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ clubId, currentPaid }: { clubId: string; currentPaid: boolean }) => {
            const updates: any = { maintenancePaid: !currentPaid };
            if (!currentPaid) {
                // marking as paid → set due date 30 days from now
                updates.maintenanceDueDate = Timestamp.fromDate(new Date(Date.now() + 30 * 86400000));
            }
            await updateDoc(doc(db, "clubs", clubId), updates);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin"] });
        },
    });
}

// ─── useAllMembersOfClub ────────────────────────────────────────────────

export function useAllMembersOfClub(clubId: string) {
    return useQuery({
        queryKey: ["superadmin", "clubMembers", clubId],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${clubId}/members`))
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as User);
        },
        enabled: !!clubId,
    });
}

// ─── useConvertMemberToClubOwner ────────────────────────────────────────

interface ConvertInput {
    memberId: string;
    clubDetails: {
        name: string;
        currencyName: string;
        domain: string;
        tagline: string;
        kitchenPin: string;
        theme: string;
        primaryColor: string;
        parentClubId: string;
    };
    createdBy: string;
}

export function useConvertMemberToClubOwner() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: ConvertInput) => {
            const batch = writeBatch(db);
            const now = Timestamp.now();
            const newClubId = input.clubDetails.domain.replace(/[^a-z0-9]/g, "_") + "_" + Date.now();

            // Fetch member using collectionGroup
            const mSnap = await getDocs(query(collectionGroup(db, "members"), where("id", "==", input.memberId)));
            if (mSnap.empty) throw new Error("Member not found");
            const memberDoc = mSnap.docs[0];
            const member = memberDoc.data() as User;
            const oldClubId = member.clubId;

            // Fetch parent club treePath
            let clubTreePath = newClubId;
            if (input.clubDetails.parentClubId) {
                const parentSnap = await getDoc(doc(db, "clubs", input.clubDetails.parentClubId));
                if (parentSnap.exists()) {
                    clubTreePath = (parentSnap.data() as Club).treePath + "/" + newClubId;
                }
            }

            // Create new club
            batch.set(doc(db, "clubs", newClubId), {
                id: newClubId,
                name: input.clubDetails.name,
                currencyName: input.clubDetails.currencyName,
                domain: input.clubDetails.domain,
                domains: [input.clubDetails.domain],
                parentClubId: input.clubDetails.parentClubId,
                treePath: clubTreePath,
                theme: input.clubDetails.theme,
                primaryColor: input.clubDetails.primaryColor,
                logo: "",
                heroImage: "",
                tagline: input.clubDetails.tagline,
                ownerName: member.name,
                ownerPhone: member.phone,
                ownerUserId: input.memberId,
                status: "active",
                maintenancePaid: true,
                maintenanceDueDate: Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)),
                kitchenPin: input.clubDetails.kitchenPin,
                createdAt: now,
                createdBy: input.createdBy,
            });

            // Update member → clubOwner by moving document
            batch.set(doc(db, `clubs/${newClubId}/members`, input.memberId), {
                ...member,
                role: "clubOwner",
                isClubOwner: true,
                ownedClubId: newClubId,
                clubId: newClubId,
                updatedAt: now,
            });
            batch.delete(memberDoc.ref);

            // Move downline
            const allUsersSnap = await getDocs(collection(db, `clubs/${oldClubId}/members`));
            const memberTreePath = member.treePath;

            allUsersSnap.docs.forEach((userDoc) => {
                const userData = userDoc.data() as User;
                if (userDoc.id === input.memberId) return;

                // User is in downline if their treePath starts with member's treePath
                if (userData.treePath && userData.treePath.startsWith(memberTreePath + "/")) {
                    batch.set(doc(db, `clubs/${newClubId}/members`, userDoc.id), {
                        ...userData,
                        clubId: newClubId,
                        updatedAt: now,
                    });
                    batch.delete(userDoc.ref);
                }
            });

            // Create wallet for new club owner in new club
            const oldWalletRef = doc(db, `clubs/${oldClubId}/members/${input.memberId}/wallet`, "data");
            const walletSnap = await getDoc(oldWalletRef);
            if (!walletSnap.exists()) {
                batch.set(doc(db, `clubs/${newClubId}/members/${input.memberId}/wallet`, "data"), {
                    userId: input.memberId,
                    clubId: newClubId,
                    currencyName: input.clubDetails.currencyName,
                    balance: 0,
                    lastUpdated: now,
                });
            } else {
                batch.set(doc(db, `clubs/${newClubId}/members/${input.memberId}/wallet`, "data"), {
                    ...walletSnap.data(),
                    clubId: newClubId,
                    currencyName: input.clubDetails.currencyName,
                    lastUpdated: now,
                });
                batch.delete(oldWalletRef);
            }

            await batch.commit();
            return newClubId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin"] });
        },
    });
}

// ─── useDownlineCount ───────────────────────────────────────────────────

export function useDownlineCount(treePath: string) {
    return useQuery({
        queryKey: ["superadmin", "downlineCount", treePath],
        queryFn: async () => {
            const snap = await getDocs(collectionGroup(db, "members"));
            return snap.docs.filter(
                (d) => (d.data() as User).treePath?.startsWith(treePath + "/")
            ).length;
        },
        enabled: !!treePath,
    });
}
