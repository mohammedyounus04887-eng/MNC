import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    deleteDoc,
    doc,
    updateDoc,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Announcement } from "@/types/firestore";

export function useAnnouncements(clubId: string | null) {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!clubId) {
            setAnnouncements([]);
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, `clubs/${clubId}/announcements`),
            orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(
            q,
            (snap) => {
                const results = snap.docs.map(
                    (d) => ({ id: d.id, ...d.data() } as Announcement)
                );
                setAnnouncements(results);
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsub();
    }, [clubId]);

    return { announcements, loading, error };
}

export function useSendAnnouncement(clubId: string | null) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (data: Omit<Announcement, "id" | "clubId" | "createdAt" | "createdBy">) => {
            if (!clubId) throw new Error("No club ID");

            await addDoc(collection(db, `clubs/${clubId}/announcements`), {
                ...data,
                clubId,
                createdBy: "owner",
                createdAt: serverTimestamp(),
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-announcements"] });
        },
    });
}

export function useUpdateAnnouncement() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({
            clubId,
            announcementId,
            data,
        }: {
            clubId: string;
            announcementId: string;
            data: Partial<Omit<Announcement, "id" | "clubId" | "createdAt" | "createdBy">>;
        }) => {
            if (!clubId || !announcementId) throw new Error("Missing IDs");
            await updateDoc(doc(db, `clubs/${clubId}/announcements`, announcementId), data);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner-announcements"] });
        },
    });
}

export function useDeleteAnnouncement() {
    return useMutation({
        mutationFn: async ({ clubId, announcementId }: { clubId: string; announcementId: string }) => {
            if (!announcementId || !clubId) throw new Error("No announcement ID or club ID");
            await deleteDoc(doc(db, `clubs/${clubId}/announcements`, announcementId));
        },
    });
}
