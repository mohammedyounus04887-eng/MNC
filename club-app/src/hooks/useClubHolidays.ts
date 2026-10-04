/**
 * Club holidays / concession days.
 *
 * Stored at `/clubs/{clubId}/holidays/{YYYY-MM-DD}` with shape:
 *   { date: "YYYY-MM-DD", reason?: string, createdAt: Timestamp, createdBy?: string }
 *
 * Holidays are excluded from the "required days" count on the Awards page:
 * if a member was absent on a holiday they are still treated as having
 * 100% attendance (i.e. those days simply don't count for or against).
 *
 * Sundays remain excluded automatically (club is closed); holidays cover any
 * other day the owner wants to grant as concession — Diwali, Independence
 * Day, owner sick day, etc.
 */

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface ClubHoliday {
    id: string;          // === date (YYYY-MM-DD)
    date: string;
    reason?: string;
    createdAt?: any;
    createdBy?: string;
}

/**
 * Subscribe to all holidays. Returns the raw list (sorted ascending by date)
 * and a Set of YYYY-MM-DD strings ready to pass to attendance compute.
 *
 * One-snapshot subscription per club — these documents are tiny (~50 a year
 * at most) so we just load them all instead of paginating per-month.
 */
export function useClubHolidays(clubId: string | null) {
    const [holidays, setHolidays] = useState<ClubHoliday[]>([]);
    const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) {
            setHolidays([]);
            setHolidaySet(new Set());
            setLoading(false);
            return;
        }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/holidays`),
            (snap) => {
                const rows: ClubHoliday[] = snap.docs.map(d => {
                    const data = d.data() as any;
                    return { id: d.id, date: data.date || d.id, reason: data.reason || "", createdAt: data.createdAt, createdBy: data.createdBy };
                });
                rows.sort((a, b) => a.date.localeCompare(b.date));
                setHolidays(rows);
                setHolidaySet(new Set(rows.map(r => r.date)));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);

    return { holidays, holidaySet, loading };
}

/** Add (or overwrite) a holiday on the given date. */
export async function addClubHoliday(clubId: string, date: string, reason: string = "", createdBy: string = "owner") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date — expected YYYY-MM-DD.");
    await setDoc(doc(db, `clubs/${clubId}/holidays`, date), {
        date,
        reason: reason || "",
        createdAt: new Date(),
        createdBy,
    });
}

/** Remove a holiday. No-op if it doesn't exist. */
export async function removeClubHoliday(clubId: string, date: string) {
    await deleteDoc(doc(db, `clubs/${clubId}/holidays`, date));
}

// Helper: filter a holiday Set to only the dates inside a given calendar month.
// Useful for the per-month calendar overlay.
export function holidaysInMonth(all: Set<string>, year: number, monthZeroIndexed: number): Set<string> {
    const monthStr = `${year}-${String(monthZeroIndexed + 1).padStart(2, "0")}`;
    const out = new Set<string>();
    for (const d of all) {
        if (d.startsWith(monthStr)) out.add(d);
    }
    return out;
}

void query; void where;
