/**
 * Awards — club-day recognition queries.
 *
 * The owner uses an "Awards" page on club day to find members who qualify
 * for one of three prizes:
 *
 *   1. Lucky Dip          — renewed their plan in the selected month while
 *                           still holding ≥1 shake credit (the "early renewer"
 *                           bonus). Driven by the `wasLuckyDipEligible` flag
 *                           written at plan-purchase time.
 *
 *   2. 100% Attendance    — present on every non-Sunday day in the selected
 *                           calendar month (or 3/6/12 consecutive months for
 *                           the bigger awards). Read from the
 *                           members/{id}/attendance/{YYYY-MM-DD} subcollection.
 *
 *   3. Couple Attendance  — both partners of a linked couple were marked
 *                           present every non-Sunday day in the window.
 *
 * Sundays are excluded from the count because the club is closed on Sundays.
 * If you later need an explicit holiday calendar, plumb it through the
 * `excludedDates` argument.
 */

import { useEffect, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Date helpers ───────────────────────────────────────────────────────
const ymd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

export function daysInMonth(year: number, monthZeroIndexed: number): Date[] {
    const out: Date[] = [];
    const d = new Date(year, monthZeroIndexed, 1);
    while (d.getMonth() === monthZeroIndexed) {
        out.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return out;
}

/** Working days in the month — Sundays excluded by default. */
export function workingDays(year: number, monthZeroIndexed: number, excludedDates: Set<string> = new Set()): Date[] {
    return daysInMonth(year, monthZeroIndexed).filter(d => {
        if (d.getDay() === 0) return false; // Sunday
        if (excludedDates.has(ymd(d))) return false;
        return true;
    });
}

// ─── Lucky Dip ──────────────────────────────────────────────────────────
// Members who renewed their plan in the selected month while their existing
// shakeCredits was ≥1 at the moment of purchase. We read the `payments`
// collection (type='plan_purchase') and filter by the `wasLuckyDipEligible`
// flag we now write at every plan-purchase site.
export interface LuckyDipEntry {
    memberId: string;
    memberName: string;
    memberPhoto?: string;
    purchaseDate: string;          // YYYY-MM-DD
    planName: string;
    creditsBefore: number;
    amountPaid: number;
}

export function useLuckyDip(clubId: string | null, year: number, monthZeroIndexed: number) {
    const [entries, setEntries] = useState<LuckyDipEntry[]>([]);
    const [allRenewals, setAllRenewals] = useState<any[]>([]); // for "why didn't X qualify" search
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setEntries([]); setAllRenewals([]); setLoading(false); return; }
        const monthStr = `${year}-${String(monthZeroIndexed + 1).padStart(2, "0")}`;

        const q = query(
            collection(db, `clubs/${clubId}/payments`),
            where("type", "==", "plan_purchase"),
        );
        const unsub = onSnapshot(q, (snap) => {
            const all: any[] = [];
            const elig: LuckyDipEntry[] = [];
            for (const d of snap.docs) {
                const data: any = d.data();
                const date: string = data.date || "";
                if (!date.startsWith(monthStr)) continue;
                all.push({ id: d.id, ...data });
                if (data.wasLuckyDipEligible !== true) continue;
                elig.push({
                    memberId: data.memberId,
                    memberName: data.memberName || "—",
                    purchaseDate: date,
                    planName: data.planName || "Plan",
                    creditsBefore: Number(data.creditsBeforeRenewal) || 0,
                    amountPaid: Number(data.amount) || 0,
                });
            }
            // Newest first
            elig.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
            setAllRenewals(all);
            setEntries(elig);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsub();
    }, [clubId, year, monthZeroIndexed]);

    return { entries, allRenewals, loading };
}

// ─── Attendance (100%) ──────────────────────────────────────────────────
// For each member, we read their attendance subcollection for the relevant
// dates and check completeness against working days. This is computed
// client-side so we get live updates from one snapshot subscription per
// member — fine for clubs in the low-hundreds of members; if it scales past
// that we can switch to a server function aggregate.
export interface AttendanceEntry {
    memberId: string;
    memberName: string;
    memberPhoto?: string;
    presentDays: number;
    requiredDays: number;
    missedDates: string[];        // YYYY-MM-DD of days that should have had attendance but didn't
    qualifies: boolean;
}

// Load each member's attendance for one month from the SAME source the Member
// App and the Reception member-profile read: the per-member subcollection
// clubs/{clubId}/members/{id}/attendance, keyed by document id (= the date).
//
// IMPORTANT — why not a collectionGroup query: attendance docs written by some
// check-in paths (and older historical docs) don't all carry a `clubId` or a
// `date` field. A collectionGroup query filtered by where(clubId)/where(date)
// silently DROPPED those docs, so the Awards page under-counted (members showed
// absent / zero) even though the Member App showed the correct attendance.
// Reading each member's own subcollection by document id is robust to those
// missing fields and matches the member-facing source exactly.
//
// Bounded to the month with a documentId() range, run in concurrency-capped
// batches so it stays fast even for large clubs.
async function loadClubAttendanceForMonth(
    clubId: string,
    members: any[],
    year: number,
    monthZeroIndexed: number,
): Promise<Map<string, Set<string>>> {
    const monthStr = `${year}-${String(monthZeroIndexed + 1).padStart(2, "0")}`;
    const startId = `${monthStr}-01`;
    const endId = `${monthStr}-32`;   // dates are YYYY-MM-DD; "-32" is a safe upper bound for the month
    const byMember = new Map<string, Set<string>>();

    const readOne = async (memberId: string) => {
        const collRef = collection(db, `clubs/${clubId}/members/${memberId}/attendance`);
        const set = new Set<string>();
        const collect = (docs: any[]) => {
            for (const d of docs) {
                // Authoritative source = the `date` field (this is exactly what
                // the Member App's orderBy("date") uses). Fall back to the doc
                // id only if the field is somehow missing.
                const raw = (d.data() as any)?.date;
                const dateStr = String(raw || d.id).slice(0, 10);
                if (dateStr.startsWith(monthStr)) set.add(dateStr);
            }
        };
        try {
            // Bound to the month by the `date` field — matches the Member App's
            // source AND mechanism, and catches docs that use auto-generated doc
            // ids (date only in the field). Single-field index, no clubId needed.
            const snap = await getDocs(query(collRef, where("date", ">=", startId), where("date", "<=", endId)));
            collect(snap.docs);
            // Safety net: if the date-field query returned nothing (e.g. a member
            // whose docs predate the `date` field), read the whole subcollection
            // and filter by doc id so we never under-count.
            if (set.size === 0) {
                const all = await getDocs(collRef);
                collect(all.docs);
            }
        } catch {
            const all = await getDocs(collRef);
            collect(all.docs);
        }
        if (set.size) byMember.set(memberId, set);
    };

    const ids = members.map(m => m.id);
    const BATCH = 30;
    for (let i = 0; i < ids.length; i += BATCH) {
        await Promise.all(ids.slice(i, i + BATCH).map(readOne));
    }
    return byMember;
}

/** Compute per-member completeness for a single calendar month. */
export async function computeMonthAttendance(
    clubId: string,
    members: any[],
    year: number,
    monthZeroIndexed: number,
    excludedDates: Set<string> = new Set(),
): Promise<AttendanceEntry[]> {
    const required = workingDays(year, monthZeroIndexed, excludedDates).map(ymd);
    const presentByMember = await loadClubAttendanceForMonth(clubId, members, year, monthZeroIndexed);
    const results: AttendanceEntry[] = [];

    for (const m of members) {
        const present = presentByMember.get(m.id) ?? new Set<string>();

        // Filter the required range to "after the member joined". If the
        // member joined mid-month, only days from their join onward count.
        const joinDate = (m.createdAt?.toDate?.() ?? m.joinedAt?.toDate?.() ?? null) as Date | null;
        const joinYmd = joinDate ? ymd(joinDate) : null;
        const actualRequired = joinYmd ? required.filter(d => d >= joinYmd) : required;
        const actualMissed = actualRequired.filter(d => !present.has(d));
        const count = actualRequired.length - actualMissed.length;

        results.push({
            memberId: m.id,
            memberName: m.name || "—",
            memberPhoto: m.photoUrl || m.photo || "",
            presentDays: count,
            requiredDays: actualRequired.length,
            missedDates: actualMissed,
            qualifies: actualRequired.length > 0 && actualMissed.length === 0,
        });
    }

    return results.sort((a, b) => b.presentDays - a.presentDays);
}

/** Compute consecutive-month attendance — member qualified for the trailing N months. */
export async function computeConsecutiveMonths(
    clubId: string,
    members: any[],
    anchorYear: number,
    anchorMonthZeroIndexed: number,
    monthsBack: number,            // 1, 3, 6, 12
    excludedDates: Set<string> = new Set(),
): Promise<AttendanceEntry[]> {
    // Compute for each month in the window IN PARALLEL, then intersect.
    // Each month is now a single collection-group query, so the whole window
    // is monthsBack parallel queries instead of monthsBack × N sequential reads.
    const perMonth: AttendanceEntry[][] = await Promise.all(
        Array.from({ length: monthsBack }, (_, i) => {
            const d = new Date(anchorYear, anchorMonthZeroIndexed - i, 1);
            return computeMonthAttendance(clubId, members, d.getFullYear(), d.getMonth(), excludedDates);
        }),
    );
    // Build merged per-member entry
    const memberMap: Record<string, AttendanceEntry> = {};
    for (const monthRows of perMonth) {
        for (const r of monthRows) {
            if (!memberMap[r.memberId]) {
                memberMap[r.memberId] = {
                    memberId: r.memberId,
                    memberName: r.memberName,
                    memberPhoto: r.memberPhoto,
                    presentDays: 0,
                    requiredDays: 0,
                    missedDates: [],
                    qualifies: true,
                };
            }
            const acc = memberMap[r.memberId];
            acc.presentDays += r.presentDays;
            acc.requiredDays += r.requiredDays;
            acc.missedDates.push(...r.missedDates);
            if (!r.qualifies) acc.qualifies = false;
        }
    }
    return Object.values(memberMap).sort((a, b) => b.presentDays - a.presentDays);
}

// ─── Couple attendance ──────────────────────────────────────────────────
// Returns one row per linked couple. Both partners must have attendance
// records for every working day in the window for the couple to qualify.
export interface CoupleEntry {
    coupleId: string;
    memberA: { id: string; name: string; photo?: string };
    memberB: { id: string; name: string; photo?: string };
    monthlyA: AttendanceEntry;     // partner A's per-window data
    monthlyB: AttendanceEntry;     // partner B's per-window data
    qualifies: boolean;            // both A.qualifies AND B.qualifies
}

export function computeCouples(
    members: any[],
    monthly: AttendanceEntry[],
): CoupleEntry[] {
    const byId: Record<string, AttendanceEntry> = {};
    for (const e of monthly) byId[e.memberId] = e;
    const seen = new Set<string>();
    const out: CoupleEntry[] = [];
    for (const m of members) {
        if (!m.couplePartnerId) continue;
        if (seen.has(m.id)) continue;
        const partner = members.find(x => x.id === m.couplePartnerId);
        if (!partner) continue;
        seen.add(m.id); seen.add(partner.id);
        const a = byId[m.id];
        const b = byId[partner.id];
        if (!a || !b) continue;
        const coupleId = m.coupleId || [m.id, partner.id].sort().join("__");
        out.push({
            coupleId,
            memberA: { id: m.id, name: m.name || "—", photo: m.photoUrl || m.photo || "" },
            memberB: { id: partner.id, name: partner.name || "—", photo: partner.photoUrl || partner.photo || "" },
            monthlyA: a,
            monthlyB: b,
            qualifies: a.qualifies && b.qualifies,
        });
    }
    return out;
}
