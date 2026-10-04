import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, addDoc, updateDoc, onSnapshot,
    query, where, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { VolunteerSession } from "@/types/firestore";

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

function volunteersPath(clubId: string) {
    return `clubs/${clubId}/volunteers`;
}

function attendancePath(clubId: string) {
    return `clubs/${clubId}/volunteerAttendance`;
}

// ─── useActiveVolunteers (real-time) ────────────────────────────────────

export function useActiveVolunteers() {
    const { club } = useClubContext();
    const [sessions, setSessions] = useState<VolunteerSession[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club?.id) return;
        const q = query(
            collection(db, volunteersPath(club.id)),
            where("date", "==", todayStr()),
            where("status", "==", "active")
        );
        const unsub = onSnapshot(q, (snap) => {
            setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession));
            setLoading(false);
        });
        return () => unsub();
    }, [club?.id]);

    return { sessions, loading };
}

// ─── useVolunteerLog (for admin) ─────────────────────────────────────────

// Pass a YYYY-MM-DD string for a specific day, or "__all__" to fetch all sessions.
export function useVolunteerLog(date: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["volunteerAttendance", "log", club?.id, date],
        queryFn: async () => {
            const { getDocs } = await import("firebase/firestore");
            if (date === "__all__") {
                const snap = await getDocs(collection(db, attendancePath(club!.id)));
                return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession);
            }
            const snap = await getDocs(
                query(
                    collection(db, attendancePath(club!.id)),
                    where("date", "==", date)
                )
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession);
        },
        enabled: !!club?.id,
    });
}

// ─── useCreateVolunteerSession ───────────────────────────────────────────

export function useCreateVolunteerSession() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (input: {
            memberId: string;
            memberName: string;
            memberPhoto: string;
        }) => {
            if (!club?.id) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const ref = await addDoc(collection(db, volunteersPath(club.id)), {
                memberId: input.memberId,
                memberName: input.memberName,
                memberPhoto: input.memberPhoto,
                clubId: club.id,
                loginTime: now,
                logoutTime: null,
                totalMinutes: null,
                date: todayStr(),
                status: "active",
            } satisfies Omit<VolunteerSession, "id">);
            return ref.id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["volunteers"] }),
    });
}

// ─── useCompleteVolunteerSession ─────────────────────────────────────────

export function useCompleteVolunteerSession() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async ({ sessionId, loginTime }: { sessionId: string; loginTime: Timestamp }) => {
            if (!club?.id) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const totalMinutes = Math.round((now.toMillis() - loginTime.toMillis()) / 60000);
            await updateDoc(doc(db, volunteersPath(club.id), sessionId), {
                logoutTime: now,
                totalMinutes,
                status: "completed",
            });
            return totalMinutes;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["volunteers"] }),
    });
}
