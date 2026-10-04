import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection,
    doc,
    getDocs,
    updateDoc,
    query,
    where,
    orderBy,
    Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ClubFeedback } from "@/types/firestore";

// ─── useClubFeedback ─────────────────────────────────────────────────────
// Fetches messages/requests FROM club owners TO the super admin platform

export function useClubFeedback(clubId?: string) {
    return useQuery({
        queryKey: ["superadmin", "club-feedback", clubId ?? "all"],
        queryFn: async () => {
            let allFeedback: ClubFeedback[] = [];

            if (clubId) {
                const q = query(
                    collection(db, `clubs/${clubId}/feedback`),
                    orderBy("createdAt", "desc")
                );
                const snap = await getDocs(q);
                allFeedback = snap.docs.map(d => ({ ...d.data() as Omit<ClubFeedback, 'id'>, id: d.id, clubId } as ClubFeedback));
            } else {
                const clubsSnap = await getDocs(collection(db, "clubs"));
                for (const clubDoc of clubsSnap.docs) {
                    const q = query(collection(db, `clubs/${clubDoc.id}/feedback`), orderBy("createdAt", "desc"));
                    const snap = await getDocs(q);
                    allFeedback.push(...snap.docs.map(d => ({ ...d.data() as Omit<ClubFeedback, 'id'>, id: d.id, clubId: clubDoc.id } as ClubFeedback)));
                }
            }
            return allFeedback.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        },
    });
}

// ─── useUpdateClubFeedbackStatus ─────────────────────────────────────────

export function useUpdateClubFeedbackStatus() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({
            clubId,
            feedbackId,
            status,
            reply,
        }: {
            clubId: string;
            feedbackId: string;
            status: ClubFeedback["status"];
            reply?: string;
        }) => {
            const updates: Record<string, unknown> = { status };
            if (reply !== undefined) {
                updates.reply = reply;
                updates.repliedAt = Timestamp.now();
            }
            await updateDoc(doc(db, `clubs/${clubId}/feedback`, feedbackId), updates);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["superadmin", "club-feedback"] });
        },
    });
}

// ─── useUnreadClubFeedbackCount ──────────────────────────────────────────

export function useUnreadClubFeedbackCount() {
    return useQuery({
        queryKey: ["superadmin", "club-feedback", "unread-count"],
        queryFn: async () => {
            let count = 0;
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const q = query(collection(db, `clubs/${clubDoc.id}/feedback`), where("status", "==", "new"));
                const snap = await getDocs(q);
                count += snap.size;
            }
            return count;
        },
        refetchInterval: 60_000,
    });
}

// ─── exportClubFeedbackToCSV ─────────────────────────────────────────────

export function exportClubFeedbackToCSV(items: ClubFeedback[], filename = "club-feedback.csv") {
    const headers = [
        "Club", "Sender", "Email", "Category", "Subject", "Message",
        "Status", "Reply", "Date",
    ];

    const rows = items.map((e) => [
        e.clubName,
        e.senderName,
        e.senderEmail,
        e.category,
        e.subject,
        e.message,
        e.status,
        e.reply ?? "",
        e.createdAt instanceof Timestamp
            ? e.createdAt.toDate().toLocaleDateString("en-IN")
            : "",
    ]);

    const csvContent = [headers, ...rows]
        .map((row) =>
            row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        )
        .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
