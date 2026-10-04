import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, query, where, getDocs, doc, addDoc,
    updateDoc, deleteDoc, Timestamp, orderBy, setDoc, getDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// ─── Types ────────────────────────────────────────────────────────────────

export interface GlobalMenuItem {
    id: string;
    name: string;
    category: "shake" | "tea" | "drink" | "other";
    description: string;
    nutritionInfo?: string;
    ingredients?: string;
    isVeg: boolean;
    isActive: boolean;
    imageUrl?: string | null;
    price?: number;
    sortOrder: number;
    source: "global";
    createdAt?: any;
    updatedAt?: any;
}

export interface ClubMenuitem {
    id: string;
    name: string;
    category: string;
    description?: string;
    nutritionInfo?: string;
    isVeg?: boolean;
    isActive?: boolean;
    isAvailableToday?: boolean;
    imageUrl?: string | null;
    photo?: string;
    price?: number;
    sortOrder?: number;
    source: "club";
}

export interface CombinedMenuItem {
    id: string;
    name: string;
    category: string;
    description?: string;
    nutritionInfo?: string;
    isVeg?: boolean;
    isActive?: boolean;
    isAvailableToday?: boolean;
    imageUrl?: string | null;
    photo?: string;
    price?: number;
    sortOrder?: number;
    source: "global" | "club";
    isHiddenForClub?: boolean; // from menuPreferences
}

// ─── Super Admin: Manage Global Menu ─────────────────────────────────────

export function useGlobalMenuItems() {
    return useQuery({
        queryKey: ["global-menu"],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, "globalMenu"), orderBy("sortOrder", "asc"))
            );
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalMenuItem));
        },
    });
}

export function useAddGlobalMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ item, imageFile }: { item: Omit<GlobalMenuItem, "id" | "createdAt" | "updatedAt">; imageFile?: File | null }) => {
            const now = Timestamp.now();
            const docRef = await addDoc(collection(db, "globalMenu"), {
                ...item,
                imageUrl: (item as any).imageUrl ?? null,
                source: "global",
                createdAt: now,
                updatedAt: now,
            });
            if (imageFile) {
                const storageRef = ref(storage, `globalMenu/images/${docRef.id}_${Date.now()}`);
                await uploadBytes(storageRef, imageFile);
                const url = await getDownloadURL(storageRef);
                await updateDoc(docRef, { imageUrl: url });
            }
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["global-menu"] }),
    });
}

export function useUpdateGlobalMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ itemId, data, imageFile }: { itemId: string; data: Partial<GlobalMenuItem>; imageFile?: File | null }) => {
            const payload: any = { ...data, updatedAt: Timestamp.now() };
            if (imageFile) {
                const storageRef = ref(storage, `globalMenu/images/${itemId}_${Date.now()}`);
                await uploadBytes(storageRef, imageFile);
                payload.imageUrl = await getDownloadURL(storageRef);
            }
            await updateDoc(doc(db, "globalMenu", itemId), payload);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["global-menu"] }),
    });
}

export function useDeleteGlobalMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (itemId: string) => {
            await deleteDoc(doc(db, "globalMenu", itemId));
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["global-menu"] }),
    });
}

// ─── Club: Toggle Global Item Visibility ──────────────────────────────────

export function useSetGlobalItemHidden() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, itemId, isHidden }: { clubId: string; itemId: string; isHidden: boolean }) => {
            await setDoc(doc(db, `clubs/${clubId}/menuPreferences`, itemId), { isHidden }, { merge: true });
        },
        onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["combined-menu", vars.clubId] }),
    });
}

export function useToggleGlobalItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, itemId, isAvailableToday }: { clubId: string; itemId: string; isAvailableToday: boolean }) => {
            const id = itemId.startsWith("global_") ? itemId.replace("global_", "") : itemId;
            await setDoc(doc(db, `clubs/${clubId}/menuPreferences`, id), { isAvailableToday }, { merge: true });
        },
        onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["combined-menu", vars.clubId] }),
    });
}

// ─── Combined menu for Kitchen / Owner ────────────────────────────────────

export function useCombinedMenu(clubId: string | null) {
    return useQuery({
        queryKey: ["combined-menu", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            // 1. Fetch club's hidden prefs and availability
            const prefsSnap = await getDocs(collection(db, `clubs/${clubId}/menuPreferences`));
            const hiddenIds = new Set();
            const availableIds = new Set();
            prefsSnap.docs.forEach(d => {
                const data = d.data();
                if (data.isHidden) hiddenIds.add(`global_${d.id}`);
                if (data.isAvailableToday) availableIds.add(`global_${d.id}`);
            });

            // 2. Fetch global menu (active only)
            const globalSnap = await getDocs(
                query(collection(db, "globalMenu"), where("isActive", "==", true), orderBy("sortOrder", "asc"))
            );
            const globalItems: CombinedMenuItem[] = globalSnap.docs.map(d => ({
                id: `global_${d.id}`,
                ...(d.data() as Omit<GlobalMenuItem, "id">),
                source: "global" as const,
                isAvailableToday: availableIds.has(`global_${d.id}`),
            }));

            // 3. Fetch club's own menu items
            const clubSnap = await getDocs(
                query(collection(db, `clubs/${clubId}/menu`), where("isDeleted", "!=", true))
            );
            const clubItems: CombinedMenuItem[] = clubSnap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    imageUrl: data.imageUrl || data.photo || null,
                    source: "club" as const,
                } as CombinedMenuItem;
            });

            // 4. Combine: global first (excluding hidden), then club additions
            const combined = [
                ...globalItems.map(i => ({ ...i, isHiddenForClub: hiddenIds.has(i.id) })),
                ...clubItems,
            ];

            return combined.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        },
    });
}
