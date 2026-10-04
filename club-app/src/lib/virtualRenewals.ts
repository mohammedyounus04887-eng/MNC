/**
 * Virtual member renewal history — one collection, one that is actually writable.
 *
 * THE BUG THIS FIXES. Renewal history was written to
 *
 *     clubs/{clubId}/virtualMembers/{vmId}/renewals/{id}
 *
 * which is two levels below the club. `firestore.rules` covers one level with
 *
 *     match /{subcollection}/{docId} { allow write: if canManageClub(clubId); }
 *
 * and Firestore rules do **not** cascade to deeper paths — every nested
 * subcollection that works (`members/{id}/transactions`, `/wallet`,
 * `/attendance`, `btcParticipants/{id}/measurements`) has its own explicit
 * rule. `virtualMembers/{id}/renewals` never got one, so every write there was
 * denied. That broke both virtual-member renewal flows:
 *
 *   - Back-dated expiry: the member document updated fine, then the history
 *     write was refused and threw, so the receptionist saw "Failed to update
 *     expiry" even though the dates had already changed — a half-applied save.
 *   - Bulk renewal: the history write sat in the same batch as the member
 *     updates and the payments, and one refused write rejects the WHOLE batch,
 *     so every member in the run failed at once.
 *
 * The fix is deliberately code-only. Correcting the rules would also work, but
 * a rules deploy can take the club offline mid-service and must not happen
 * without the owner watching. Writing one level below the club instead lands
 * inside the existing catch-all, so it works against the rules already live.
 */

import {
    addDoc, collection, getDocs, getDocsFromServer, query, serverTimestamp, where,
    type WriteBatch, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";

/** One level below the club, so the existing catch-all rule covers it. */
export const virtualRenewalsPath = (clubId: string) =>
    `clubs/${clubId}/virtualMemberRenewals`;

export interface VirtualRenewalInput {
    virtualMemberId: string;      // the virtualMembers document id
    virtualMemberDocId?: string;  // the human-readable member code, e.g. VM-014
    memberName?: string;
    memberPhone?: string;
    amount?: number;
    paymentMethod?: string;
    planId?: string;
    planName?: string;
    collectionDate?: unknown;     // Timestamp
    date: string;                 // club-local yyyy-mm-dd
    backdated?: boolean;
    paidOnDate?: string;
    extendedTo?: string;
    durationDays?: number;
    note?: string;
    bulkRenewal?: boolean;
}

function clean(input: VirtualRenewalInput): Record<string, unknown> {
    const out: Record<string, unknown> = { createdAt: serverTimestamp() };
    for (const [k, v] of Object.entries(input)) {
        if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
    return out;
}

/** Record one renewal. */
export async function addVirtualRenewal(clubId: string, input: VirtualRenewalInput): Promise<void> {
    await addDoc(collection(db, virtualRenewalsPath(clubId)), clean(input));
}

/**
 * Batch form — used by bulk renewal, which writes the payment, the member
 * update and this history line together so a run either lands or does not.
 */
export function addVirtualRenewalToBatch(
    batch: WriteBatch,
    clubId: string,
    input: VirtualRenewalInput,
): void {
    batch.set(doc(collection(db, virtualRenewalsPath(clubId))), clean(input));
}

/**
 * Which virtual members already have a renewal recorded on this date.
 *
 * This is what makes a bulk run restartable. A bulk renewal writes one history
 * row per member per run, so the presence of a row for (member, date) is proof
 * that member's renewal already landed — payment, dates and all, because they
 * commit in the same batch. Re-running the same date therefore skips them
 * rather than charging twice.
 */
export async function getRenewedMemberIdsOn(clubId: string, date: string): Promise<Set<string>> {
    if (!clubId || !date) return new Set();
    // getDocsFromServer, NOT getDocs. The app runs with persistentLocalCache,
    // and a plain getDocs falls back to that cache when the server cannot be
    // reached — returning an EMPTY snapshot and no error on a tablet that has
    // never read this collection. The guard would then say "nobody has been
    // renewed", skip nobody, and charge everyone a second time, which is the
    // exact failure it exists to prevent. From the server it throws instead,
    // and the caller abandons the run.
    const snap = await getDocsFromServer(query(
        collection(db, virtualRenewalsPath(clubId)),
        where("date", "==", date),
    ));
    const out = new Set<string>();
    for (const d of snap.docs) {
        const r = d.data() as any;
        // Only a real renewal proves money was taken. A back-dated expiry fix
        // writes into this same collection stamped with the day of the
        // correction and deliberately records NO payment — counting it would
        // skip a member who then never gets charged, while the screen reports
        // them as "already renewed, not charged again".
        if (r?.backdated === true) continue;
        if (r?.virtualMemberId) out.add(r.virtualMemberId);
    }
    return out;
}

/** Every renewal recorded for one virtual member, newest first. */
export async function getVirtualRenewals(clubId: string, virtualMemberId: string): Promise<any[]> {
    const snap = await getDocs(query(
        collection(db, virtualRenewalsPath(clubId)),
        where("virtualMemberId", "==", virtualMemberId),
    ));
    return snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

/**
 * Renewals in a date range — what the reception report actually needs.
 *
 * `date` is a single field held as `YYYY-MM-DD`, so a >= / <= pair sorts and
 * filters on the server with no composite index. Passing no range reads the
 * whole collection, which is fine at this club's size (a few thousand rows a
 * year) but pointless when the report always has a From and a To.
 */
export async function getAllVirtualRenewals(
    clubId: string,
    fromDate?: string,
    toDate?: string,
): Promise<any[]> {
    const base = collection(db, virtualRenewalsPath(clubId));
    const q = fromDate && toDate
        ? query(base, where("date", ">=", fromDate), where("date", "<=", toDate))
        : query(base);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

// ─── Merging the two sources ─────────────────────────────────────────────
//
// Renewal history lives in two places and always will: this collection, added
// when the rules bug above was fixed, and clubs/{clubId}/payments, which every
// virtual renewal has written since the beginning. A member who has been with
// the club a year has their older renewals ONLY in payments.
//
// The per-member History panel already merged the two. The complete export has
// to produce the same answer for every member at once, so the rule for what
// counts as "the same renewal seen twice" lives here and is used by both — a
// second copy of it would be a fifth way to answer one question, which is the
// thing this rebuild exists to stop.

export interface RenewalLike {
    id?: string;
    date?: string;
    amount?: number;
    backdated?: boolean;
    [k: string]: unknown;
}

/**
 * What makes two records the same renewal.
 *
 * Real renewals key on date + amount, so the history row and the payment row
 * for one renewal collapse into one. Back-dated expiry corrections deliberately
 * carry no amount, so keying them the same way made every correction for a
 * member on one day collapse to "YYYY-MM-DD|0" — two corrections showed as one,
 * and which survived was arbitrary. They key on their own id instead.
 */
export function renewalDedupeKey(r: RenewalLike): string {
    return r.backdated
        ? `backdated|${r.id ?? ""}`
        : `${r.date ?? ""}|${Math.round(Number(r.amount) || 0)}`;
}

/** History rows win over payment rows: they carry more fields. Newest first. */
export function mergeRenewals<T extends RenewalLike>(history: T[], payments: T[]): T[] {
    const byKey = new Map<string, T>();
    for (const r of history) byKey.set(renewalDedupeKey(r), r);
    for (const r of payments) {
        const k = renewalDedupeKey(r);
        if (!byKey.has(k)) byKey.set(k, r);
    }
    return Array.from(byKey.values())
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

/** A renewal as the export needs it, whichever source it came from. */
export interface MergedRenewal extends RenewalLike {
    virtualMemberId: string;
    paymentMethod?: string;
    planName?: string;
    note?: string;
    source: "history" | "payment";
}

/**
 * Every renewal in the club, merged and grouped by virtual member.
 *
 * Two queries for the whole club rather than two per member: at a few hundred
 * members that is the difference between a report that returns and one that
 * hammers Firestore several hundred times.
 */
export async function getAllRenewalsByMember(
    clubId: string,
): Promise<Map<string, MergedRenewal[]>> {
    const [historySnap, paySnap] = await Promise.all([
        getDocs(collection(db, virtualRenewalsPath(clubId))),
        getDocs(query(
            collection(db, `clubs/${clubId}/payments`),
            where("type", "==", "virtual_member"),
        )),
    ]);

    const history = new Map<string, MergedRenewal[]>();
    for (const d of historySnap.docs) {
        const r = d.data() as any;
        const id = r?.virtualMemberId;
        if (!id) continue;
        const list = history.get(id) ?? [];
        list.push({ ...r, id: d.id, source: "history", virtualMemberId: id });
        history.set(id, list);
    }

    const payments = new Map<string, MergedRenewal[]>();
    for (const d of paySnap.docs) {
        const p = d.data() as any;
        const id = p?.virtualMemberId;
        if (!id) continue;
        if (p.deleted) continue;
        // Older payments were written without a `date`; fall back the same way
        // the History panel does so those renewals still carry a day.
        const date = p.date
            || (p.createdAt?.toDate ? todayLocal(p.createdAt.toDate()) : undefined)
            || (p.collectionDate?.toDate ? todayLocal(p.collectionDate.toDate()) : undefined);
        const list = payments.get(id) ?? [];
        list.push({ ...p, id: "pay_" + d.id, date, source: "payment", virtualMemberId: id });
        payments.set(id, list);
    }

    const out = new Map<string, MergedRenewal[]>();
    for (const id of new Set([...history.keys(), ...payments.keys()])) {
        out.set(id, mergeRenewals(history.get(id) ?? [], payments.get(id) ?? []));
    }
    return out;
}

