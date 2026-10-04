import { toDateSafe } from "@/lib/toDateSafe";
import { useEffect, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, collectionGroup, doc, getDocs, setDoc, updateDoc,
    query, where, onSnapshot, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { markMemberAttendance } from "@/lib/attendance";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import type { Attendance } from "@/types/firestore";
import { todayLocal } from "@/lib/clubDay";

// The club's day, not UTC. IST is UTC+5:30, so toISOString() filed everything
// before 05:30 under the previous day — and Today's Report, which queries on
// todayLocal(), then disagreed with this hook about which day it was.
function today() {
    return todayLocal();
}

// ─── useTodayAttendance (real-time) ─────────────────────────────────────
//
// Source of truth (NOT collectionGroup("attendance") — that needs a deployed
// composite index that wasn't reliably available, and was silently returning
// empty results, which is why every attendance card was showing 0):
//
//   members    → clubs/{clubId}/members where lastVisit === today
//                (Reception.markAttendance() updates this on every face match)
//   volunteers → clubs/{clubId}/volunteerAttendance where date === today
//                (Reception writes a session doc here on every volunteer login)
//
// We synthesize Attendance-shaped records so existing consumers don't have
// to change.

export function useTodayAttendance(type?: "member" | "volunteer") {
    const { club } = useClubContext();
    const [records, setRecords] = useState<Attendance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!club) {
            setRecords([]); setLoading(false); return;
        }
        setLoading(true);
        const td = today();

        // Member attendance from members.lastVisit === today
        const subscribeMembers = (onData: (recs: Attendance[]) => void) =>
            onSnapshot(
                collection(db, `clubs/${club.id}/members`),
                (snap) => {
                    const recs: Attendance[] = snap.docs
                        .filter((d) => (d.data() as any).lastVisit === td)
                        .map((d) => {
                            const m: any = d.data();
                            return {
                                id: d.id,
                                userId: d.id,
                                userName: m.name || "",
                                userPhoto: m.photo || m.photoUrl || "",
                                clubId: club.id,
                                type: "member",
                                checkInTime: m.lastVisitAt || Timestamp.now(),
                                checkOutTime: null,
                                hoursWorked: null,
                                checkInMethod: "face_recognition" as any,
                                date: td,
                            } as Attendance;
                        });
                    onData(recs);
                },
                // A failed listener has to finish too. This used to record the
                // error and stop, but setLoading(false) lives only in emit(),
                // which never runs without a snapshot — so one permission error
                // or dropped connection left Today's Report on "Loading
                // report…" for ever, with Save and Export disabled, in the
                // middle of service. Reporting an empty result lets the screen
                // render and show the error instead of hanging on it.
                (err) => { setError(err.message); onData([]); }
            );

        // Volunteer attendance from clubs/{clubId}/volunteerAttendance
        const subscribeVolunteers = (onData: (recs: Attendance[]) => void) =>
            onSnapshot(
                query(
                    collection(db, `clubs/${club.id}/volunteerAttendance`),
                    where("date", "==", td)
                ),
                (snap) => {
                    const recs: Attendance[] = snap.docs.map((d) => {
                        const v: any = d.data();
                        return {
                            id: d.id,
                            userId: v.memberId || "",
                            userName: v.memberName || "",
                            userPhoto: v.memberPhoto || "",
                            clubId: club.id,
                            type: "volunteer",
                            checkInTime: v.loginTime || Timestamp.now(),
                            checkOutTime: v.logoutTime ?? null,
                            hoursWorked: v.totalMinutes ? v.totalMinutes / 60 : null,
                            checkInMethod: "face_recognition" as any,
                            date: td,
                        } as Attendance;
                    });
                    onData(recs);
                },
                // Same rule as the member listener above: finish, do not hang.
                (err) => { setError(err.message); onData([]); }
            );

        let memberRecs: Attendance[] = [];
        let volRecs: Attendance[] = [];
        const emit = () => {
            if (type === "member") setRecords(memberRecs);
            else if (type === "volunteer") setRecords(volRecs);
            else setRecords([...memberRecs, ...volRecs]);
            setLoading(false);
        };

        const unsubM = (type !== "volunteer")
            ? subscribeMembers((r) => { memberRecs = r; emit(); })
            : null;
        const unsubV = (type !== "member")
            ? subscribeVolunteers((r) => { volRecs = r; emit(); })
            : null;

        // If we only requested one side, mark loading=false once that side reports
        if (type === "member" && unsubM) {/* emit() will run */}
        if (type === "volunteer" && unsubV) {/* emit() will run */}

        return () => { unsubM?.(); unsubV?.(); };
    }, [club, type]);

    return { records, loading, error };
}

// ─── useAttendanceHistory ───────────────────────────────────────────────

export function useAttendanceHistory(startDate: string, endDate: string) {
    const { club } = useClubContext();
    const [records, setRecords] = useState<Attendance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!club || !startDate || !endDate) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                const snap = await getDocs(
                    query(
                        collectionGroup(db, "attendance"),
                        where("clubId", "==", club.id),
                        where("date", ">=", startDate),
                        where("date", "<=", endDate)
                    )
                );
                setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Attendance));
            } catch (err: any) { setError(err.message); }
            setLoading(false);
        };
        fetchData();
    }, [club, startDate, endDate]);

    return { records, loading, error };
}

// ─── useVolunteerHours ──────────────────────────────────────────────────

export function useVolunteerHours(volunteerId: string, month: string) {
    // month format: "2026-02"
    const { club } = useClubContext();
    const [records, setRecords] = useState<Attendance[]>([]);
    const [totalHours, setTotalHours] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club || !volunteerId || !month) return;
        const startDate = month + "-01";
        const [y, m] = month.split("-").map(Number);
        const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`;

        const fetchData = async () => {
            setLoading(true);
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/members/${volunteerId}/attendance`),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate)
                )
            );
            const recs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Attendance);
            setRecords(recs);
            setTotalHours(recs.reduce((sum, r) => sum + (r.hoursWorked || 0), 0));
            setLoading(false);
        };
        fetchData();
    }, [club, volunteerId, month]);

    return { records, totalHours, loading };
}

// ─── useCheckInVolunteer ────────────────────────────────────────────────

export function useCheckInVolunteer() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ userId, userName, userPhoto }: { userId: string; userName: string; userPhoto: string }) => {
            if (!club) throw new Error("Club not loaded");
            // Check for existing open check-in today
            const existing = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/members/${userId}/attendance`),
                    where("date", "==", today()),
                    where("type", "==", "volunteer")
                )
            );
            const openRecord = existing.docs.find((d) => !(d.data() as Attendance).checkOutTime);
            if (openRecord) throw new Error("Already checked in");

            const id = "att_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            await setDoc(doc(db, `clubs/${club.id}/members/${userId}/attendance`, id), {
                id, userId, userName, userPhoto,
                clubId: club.id, type: "volunteer",
                checkInTime: Timestamp.now(), checkOutTime: null,
                hoursWorked: null, checkInMethod: "face",
                date: today(),
            } as Attendance);
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    });
}

// ─── useCheckOutVolunteer ───────────────────────────────────────────────

export function useCheckOutVolunteer() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (volunteerId: string) => {
            if (!club) throw new Error("Club not loaded");
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/members/${volunteerId}/attendance`),
                    where("date", "==", today()),
                    where("type", "==", "volunteer")
                )
            );
            const openRecord = snap.docs.find((d) => !(d.data() as Attendance).checkOutTime);
            if (!openRecord) throw new Error("No open check-in found");

            // A volunteer whose check-in time was not a Timestamp could not be
            // checked out at all — the throw happened before any write. Falling
            // back to now means zero hours recorded rather than a stuck session.
            const checkInTime = toDateSafe((openRecord.data() as Attendance).checkInTime) ?? new Date();
            const now = new Date();
            const hoursWorked = Math.round(((now.getTime() - checkInTime.getTime()) / 3600000) * 100) / 100;

            await updateDoc(doc(db, `clubs/${club.id}/members/${volunteerId}/attendance`, openRecord.id), {
                checkOutTime: Timestamp.now(),
                hoursWorked,
            });
            return hoursWorked;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    });
}

// ─── useCheckInMember ───────────────────────────────────────────────────

export function useCheckInMember() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ userId, userName, userPhoto, method }: {
            userId: string; userName: string; userPhoto: string;
            method: "qr" | "manual" | "mobile" | "voice";
        }) => {
            if (!club) throw new Error("Club not loaded");

            // Single shared writer: one record per member per day, keyed by the
            // local date, and `lastVisit` always set. This used to write an
            // `att_<random>` record with no `lastVisit`, so a member checking in
            // from their own phone appeared on the Attendance Register and was
            // missing from the dashboard, the TV and Today's Report.
            const res = await markMemberAttendance({
                clubId: club.id,
                memberId: userId,
                memberName: userName,
                memberPhoto: userPhoto,
                method,
            });

            // Idempotent either way — safe on a repeat check-in.
            try {
                const { autoCheckInVolunteerIfNeeded } = await import("@/hooks/useVolunteerRoles");
                await autoCheckInVolunteerIfNeeded({
                    clubId: club.id, memberId: userId, memberName: userName, memberPhoto: userPhoto,
                });
            } catch (e) { console.warn("[volunteer auto-checkin]", e); }

            return { alreadyCheckedIn: res.alreadyPresent, checkInTime: res.checkInTime };
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    });
}

// ─── useIsVolunteerCheckedIn ────────────────────────────────────────────

export function useIsVolunteerCheckedIn(volunteerId: string) {
    const { club } = useClubContext();
    const [isCheckedIn, setIsCheckedIn] = useState(false);
    const [attendanceRecord, setAttendanceRecord] = useState<Attendance | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club || !volunteerId) { setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${club.id}/members/${volunteerId}/attendance`),
            where("date", "==", today()),
            where("type", "==", "volunteer")
        );
        const unsub = onSnapshot(q, (snap) => {
            const openRec = snap.docs.find((d) => !(d.data() as Attendance).checkOutTime);
            if (openRec) {
                setIsCheckedIn(true);
                setAttendanceRecord({ id: openRec.id, ...openRec.data() } as Attendance);
            } else {
                setIsCheckedIn(false);
                setAttendanceRecord(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [club, volunteerId]);

    return { isCheckedIn, attendanceRecord, loading };
}

// ─── useAllVolunteersStatus (for reception grid) ────────────────────────

export function useAllVolunteersStatus() {
    const { club } = useClubContext();
    const [statusMap, setStatusMap] = useState<Record<string, Attendance | null>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collectionGroup(db, "attendance"),
            where("clubId", "==", club.id),
            where("date", "==", today()),
            where("type", "==", "volunteer")
        );
        const unsub = onSnapshot(q, (snap) => {
            const map: Record<string, Attendance | null> = {};
            snap.docs.forEach((d) => {
                const rec = { id: d.id, ...d.data() } as Attendance;
                // Only track open (not checked out) records
                if (!rec.checkOutTime) {
                    map[rec.userId] = rec;
                }
            });
            setStatusMap(map);
            setLoading(false);
        });
        return () => unsub();
    }, [club]);

    return { statusMap, loading };
}

// ─── useManualCheckIn (owner/staff manually checks in a member) ─────────

export function useManualCheckIn() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ userId, userName, userPhoto }: {
            userId: string; userName: string; userPhoto: string;
        }) => {
            if (!club) throw new Error("Club not loaded");

            const res = await markMemberAttendance({
                clubId: club.id,
                memberId: userId,
                memberName: userName,
                memberPhoto: userPhoto,
                method: "manual",
            });
            if (res.alreadyPresent) throw new Error("Already checked in today");
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    });
}
