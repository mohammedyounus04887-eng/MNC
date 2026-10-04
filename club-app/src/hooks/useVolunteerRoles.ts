import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    addDoc, collection, doc, getDoc, getDocs, onSnapshot,
    query, serverTimestamp, Timestamp, updateDoc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { User } from "@/types/firestore";
import { toDateSafe } from "@/lib/toDateSafe";

// ─── useVolunteerMembers (real-time list of users marked as volunteers) ──

export function useVolunteerMembers() {
    const { club } = useClubContext();
    const [members, setMembers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club?.id) { setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${club.id}/members`),
            where("isVolunteer", "==", true),
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as User));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [club?.id]);

    return { members, loading };
}

// ─── useSetMemberVolunteerStatus ────────────────────────────────────────

export function useSetMemberVolunteerStatus() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async ({ memberId, isVolunteer }: { memberId: string; isVolunteer: boolean }) => {
            if (!club?.id) throw new Error("Club not loaded");
            await updateDoc(doc(db, `clubs/${club.id}/members`, memberId), {
                isVolunteer,
                updatedAt: Timestamp.now(),
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner", "members"] });
            qc.invalidateQueries({ queryKey: ["volunteers"] });
        },
    });
}

// ─── autoCheckInVolunteerIfNeeded (helper for member-checkin call sites) ─
//
// Idempotent. Reads the member doc; if `isVolunteer` is true and there's no
// active volunteer session for them today, creates one in the same shape
// the existing VolunteerModal writes (clubs/{clubId}/volunteers).

export async function autoCheckInVolunteerIfNeeded(args: {
    clubId: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
}): Promise<{ created: boolean; sessionId?: string }> {
    const { clubId, memberId, memberName, memberPhoto } = args;
    const today = new Date().toISOString().slice(0, 10);

    // 1. Confirm member is flagged as volunteer
    const memberSnap = await getDoc(doc(db, `clubs/${clubId}/members`, memberId));
    if (!memberSnap.exists()) return { created: false };
    if (!memberSnap.data()?.isVolunteer) return { created: false };

    // 2. Skip if there's already an active session today
    const existing = await getDocs(
        query(
            collection(db, `clubs/${clubId}/volunteers`),
            where("memberId", "==", memberId),
            where("date", "==", today),
            where("status", "==", "active"),
        ),
    );
    if (!existing.empty) return { created: false };

    // 3. Create the session — shape matches useCreateVolunteerSession
    const ref = await addDoc(collection(db, `clubs/${clubId}/volunteers`), {
        memberId,
        memberName,
        memberPhoto,
        clubId,
        loginTime: Timestamp.now(),
        logoutTime: null,
        totalMinutes: null,
        date: today,
        status: "active",
        autoCheckedIn: true,
    });

    // Also write to volunteerAttendance so admin reports pick it up.
    // Both collections currently store session shapes — see useVolunteers.ts
    // for the parallel pattern.
    try {
        await addDoc(collection(db, `clubs/${clubId}/volunteerAttendance`), {
            memberId,
            memberName,
            memberPhoto,
            clubId,
            loginTime: Timestamp.now(),
            logoutTime: null,
            totalMinutes: null,
            date: today,
            status: "active",
            autoCheckedIn: true,
            mirroredFrom: ref.id,
        });
    } catch (e) {
        console.warn("[volunteer auto-checkin] mirror to volunteerAttendance failed", e);
    }

    return { created: true, sessionId: ref.id };
}

// ─── backfillVolunteerSessionsFromAttendance ────────────────────────────
//
// Marking somebody a volunteer only affects what happens NEXT time they check
// in. Somebody added halfway through the month has no sessions for the days
// they were already here, so the volunteer list shows them with no times at
// all — which reads as "they never came", when the club knows they did.
//
// The days are not lost, though: the member checked in, so their attendance
// record holds the time. This copies that time across, one volunteer session
// per day already attended.
//
// Idempotent, and deliberately so — it runs whenever somebody is marked as a
// volunteer, and marking the same person twice must not double their days.
// A day that already has a session is left exactly as it is; nothing here
// edits a session the club recorded properly.

export interface BackfillResult {
    created: number;
    /** Days already covered by a session — left untouched. */
    skipped: number;
    /** Days attended but with no usable check-in time to copy. */
    noTime: number;
}

export async function backfillVolunteerSessionsFromAttendance(args: {
    clubId: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
    /** Inclusive, club-local YYYY-MM-DD. */
    from: string;
    to: string;
}): Promise<BackfillResult> {
    const { clubId, memberId, memberName, memberPhoto, from, to } = args;

    const [attSnap, volSnap, mirrorSnap] = await Promise.all([
        getDocs(query(
            collection(db, `clubs/${clubId}/members/${memberId}/attendance`),
            where("date", ">=", from),
            where("date", "<=", to),
        )),
        getDocs(query(
            collection(db, `clubs/${clubId}/volunteers`),
            where("memberId", "==", memberId),
        )),
        getDocs(query(
            collection(db, `clubs/${clubId}/volunteerAttendance`),
            where("memberId", "==", memberId),
        )),
    ]);

    // Every day this member already has a volunteer session on, from either
    // collection. Both are checked because the two are written together and a
    // half-written pair should still count as covered rather than be doubled.
    const covered = new Set<string>();
    for (const d of [...volSnap.docs, ...mirrorSnap.docs]) {
        const date = (d.data() as any)?.date;
        if (typeof date === "string") covered.add(date);
    }

    let created = 0, skipped = 0, noTime = 0;

    for (const d of attSnap.docs) {
        const a = d.data() as any;
        const date: string = typeof a?.date === "string" ? a.date : d.id;
        if (!date) continue;
        if (covered.has(date)) { skipped++; continue; }

        // The whole point of the exercise: the volunteer's login time is the
        // time they checked in as a member that day.
        const checkIn = toDateSafe(a?.checkInTime);
        if (!checkIn) { noTime++; continue; }

        // Use the real check-out when the day has one; otherwise leave the
        // session open-ended rather than inventing an hour count. A made-up
        // number here would end up in the club's volunteer-hours totals.
        const checkOut = toDateSafe(a?.checkOutTime);
        const totalMinutes = checkOut
            ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000))
            : null;

        const session = {
            memberId,
            memberName,
            memberPhoto,
            clubId,
            loginTime: Timestamp.fromDate(checkIn),
            logoutTime: checkOut ? Timestamp.fromDate(checkOut) : null,
            totalMinutes,
            date,
            // Not "active": these are past days, and an open session would show
            // the member as currently volunteering.
            status: "completed" as const,
            // Marked so the club can tell a copied time from one recorded at
            // the desk, and so a later correction knows what it is looking at.
            backfilledFromAttendance: true,
            createdAt: serverTimestamp(),
        };

        const ref = await addDoc(collection(db, `clubs/${clubId}/volunteers`), session);
        // The admin volunteer screens read the mirror, so a session that only
        // landed in one collection would still show nothing.
        await addDoc(collection(db, `clubs/${clubId}/volunteerAttendance`), {
            ...session,
            mirroredFrom: ref.id,
        });

        covered.add(date);
        created++;
    }

    return { created, skipped, noTime };
}
