/**
 * The one place member attendance is written.
 *
 * Attendance had split into two incompatible halves:
 *
 *   - Reception and the voice assistant wrote `attendance/{YYYY-MM-DD}` AND set
 *     `members.lastVisit`.
 *   - The member app's own check-in and the manual check-in wrote
 *     `attendance/att_<timestamp>_<random>` and set no `lastVisit` at all.
 *
 * Almost every screen that answers "who is here today" — the owner dashboard,
 * the TV, Today's Report, the reception drawer — reads `members.lastVisit`, not
 * the attendance records. So a member who checked in from their own phone was
 * present on the register and absent everywhere else. That is one half of the
 * register mismatch.
 *
 * The Attendance Register reads the subcollection by date, so a record filed
 * under `att_...` never lines up with the day it belongs to either.
 *
 * Everything now goes through `markMemberAttendance`:
 *   - doc id is the local date, so one member has exactly one record per day
 *   - `lastVisit` and `lastVisitAt` are always set together
 *   - it is idempotent: checking in twice refreshes rather than erroring, and
 *     never blocks a correction
 */

import { doc, getDoc, setDoc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";

export type CheckInMethod = "qr" | "manual" | "mobile" | "voice" | "face_recognition" | "card";

export interface MarkAttendanceInput {
    clubId: string;
    memberId: string;
    memberName?: string;
    memberPhoto?: string;
    method: CheckInMethod;
    /** Single-account couples: who actually came today. */
    couplePresence?: "both" | "husband" | "wife";
    /** Defaults to today. Pass a date to correct a past day. */
    date?: string;
}

export interface MarkAttendanceResult {
    date: string;
    alreadyPresent: boolean;
    checkInTime: Timestamp;
}

/**
 * Mark a member present. Safe to call more than once for the same day.
 *
 * Returns `alreadyPresent` so a caller can tell a repeat scan from a first
 * one — but the write still happens, so a record that was damaged or partly
 * removed repairs itself instead of silently doing nothing.
 */
export async function markMemberAttendance(input: MarkAttendanceInput): Promise<MarkAttendanceResult> {
    const date = input.date || todayLocal();
    const attRef = doc(db, "clubs", input.clubId, "members", input.memberId, "attendance", date);

    const existing = await getDoc(attRef);
    const alreadyPresent = existing.exists();
    const checkInTime: Timestamp = alreadyPresent
        ? ((existing.data() as any)?.checkInTime ?? Timestamp.now())
        : Timestamp.now();

    await setDoc(
        attRef,
        {
            id: date,
            userId: input.memberId,
            userName: input.memberName ?? "",
            userPhoto: input.memberPhoto ?? "",
            clubId: input.clubId,
            type: "member",
            checkInTime,
            checkOutTime: null,
            hoursWorked: null,
            checkInMethod: input.method,
            date,
            ...(input.couplePresence ? { couplePresence: input.couplePresence } : {}),
        },
        { merge: true },
    );

    // The field almost every "who is here today" screen actually reads.
    // `lastVisitAt` was read in several places and written by nobody, which is
    // why check-in times showed as whenever the page happened to load.
    await updateDoc(doc(db, "clubs", input.clubId, "members", input.memberId), {
        lastVisit: date,
        lastVisitAt: checkInTime,
        updatedAt: serverTimestamp(),
    }).catch(() => {
        /* member doc missing — the attendance record still stands */
    });

    return { date, alreadyPresent, checkInTime };
}

/**
 * Remove a member's attendance for one day.
 *
 * Deletes the record for that date and only clears `lastVisit` if it points at
 * the day being removed — correcting last Tuesday used to wipe the check-in of
 * someone who was standing in the club this morning.
 */
export async function removeMemberAttendance(clubId: string, memberId: string, date: string): Promise<void> {
    await deleteDoc(doc(db, "clubs", clubId, "members", memberId, "attendance", date)).catch(() => {});

    const memberRef = doc(db, "clubs", clubId, "members", memberId);
    const snap = await getDoc(memberRef);
    if (snap.exists() && (snap.data() as any)?.lastVisit === date) {
        await updateDoc(memberRef, { lastVisit: null, lastVisitAt: null }).catch(() => {});
    }
}
