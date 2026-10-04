import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, query, where, getDocs, doc, addDoc, updateDoc, Timestamp, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { Product } from "@/types/firestore";

function getTodayString() {
    return new Date().toISOString().split("T")[0];
}

export function useMenuItems(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-menu", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${clubId}/menu`),
                where("isDeleted", "!=", true)
            );
            const snap = await getDocs(q);
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
            // Firestore inequality filter on isDeleted means we can't easily orderBy on different fields in the query itself unless we add composite indexes.
            // Sorting in-memory is safer and totally fine for menu size.
            return items.sort((a, b) => {
                if (a.category < b.category) return -1;
                if (a.category > b.category) return 1;
                return (a.name || "").localeCompare(b.name || "");
            });
        },
    });
}

export function useAvailableTodayItems(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-menu-available", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const todayStr = getTodayString();
            const q = query(
                collection(db, `clubs/${clubId}/menu`),
                where("isAvailableToday", "==", true),
                where("availableDate", "==", todayStr)
            );
            const snap = await getDocs(q);
            const items = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as Product))
                .filter(item => !item.isDeleted);

            return items.sort((a, b) => {
                if (a.category < b.category) return -1;
                if (a.category > b.category) return 1;
                return (a.name || "").localeCompare(b.name || "");
            });
        },
    });
}

export function useAddMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (data: { clubId: string; item: Partial<Product>, photoFile?: File | null }) => {
            const now = Timestamp.now();
            const todayStr = getTodayString();

            let photoUrl = data.item.photo || "";

            // If a file is provided, create the document first to get an ID, then upload the file using the ID
            const docRef = await addDoc(collection(db, `clubs/${data.clubId}/menu`), {
                clubId: data.clubId,
                name: data.item.name || "",
                category: data.item.category || "other",
                description: data.item.description || null,
                price: data.item.price || 0,
                stock: data.item.stock ?? 100,
                lowStockThreshold: data.item.lowStockThreshold ?? 10,
                expiryDate: null,
                photo: photoUrl,
                isAvailableToday: data.item.isAvailableToday ?? false,
                availableDate: data.item.isAvailableToday ? todayStr : null,
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
            });

            if (data.photoFile) {
                const storageRef = ref(storage, `clubs/${data.clubId}/menu/${docRef.id}`);
                await uploadBytes(storageRef, data.photoFile);
                photoUrl = await getDownloadURL(storageRef);
                await updateDoc(docRef, { photo: photoUrl });
            }
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["owner-menu", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["owner-menu-available", vars.clubId] });
        },
    });
}

export function useUpdateMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ itemId, clubId, data, photoFile }: { itemId: string; clubId: string, data: Partial<Product>, photoFile?: File | null }) => {
            const updatePayload: any = { ...data, updatedAt: Timestamp.now() };

            if (data.isAvailableToday !== undefined) {
                updatePayload.availableDate = data.isAvailableToday ? getTodayString() : null;
            }

            if (photoFile) {
                const storageRef = ref(storage, `clubs/${clubId}/menu/${itemId}`);
                await uploadBytes(storageRef, photoFile);
                updatePayload.photo = await getDownloadURL(storageRef);
            }

            await updateDoc(doc(db, `clubs/${clubId}/menu`, itemId), updatePayload);
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["owner-menu"] });
            qc.invalidateQueries({ queryKey: ["owner-menu-available"] });
        },
    });
}

export function useDeleteMenuItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, itemId }: { clubId: string; itemId: string }) => {
            await updateDoc(doc(db, `clubs/${clubId}/menu`, itemId), { isDeleted: true, isAvailableToday: false, updatedAt: Timestamp.now() });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-menu"] });
            qc.invalidateQueries({ queryKey: ["owner-menu-available"] });
        },
    });
}

export function useToggleAvailability() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, itemId, available }: { clubId: string; itemId: string; available: boolean }) => {
            await updateDoc(doc(db, `clubs/${clubId}/menu`, itemId), {
                isAvailableToday: available,
                availableDate: available ? getTodayString() : null,
                updatedAt: Timestamp.now()
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-menu"] });
            qc.invalidateQueries({ queryKey: ["owner-menu-available"] });
        },
    });
}
