/**
 * Virtual Members (a.k.a. Virtual Numbers) — shared admin hook.
 *
 * Virtual members live at clubs/{clubId}/virtualMembers/{id}, with a
 * `renewals` subcollection that the Reception renew flows already append to
 * on every renewal. This hook exposes that data (which was previously written
 * but never read) plus add / bulk-add, and a human expiry helper.
 */

import { mergeRenewals } from "@/lib/virtualRenewals";
import { todayLocal } from "@/lib/clubDay";
import { useEffect, useState } from "react";
import {
    collection, onSnapshot, addDoc, doc, orderBy, query, where,
    serverTimestamp, Timestamp, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface VirtualMemberLite {
    id: string;
    memberId?: string;
    name?: string;
    phone?: string;
    planName?: string;
    membershipStart?: Timestamp | null;
    membershipEnd?: Timestamp | null;
    lastRenewalAt?: Timestamp | null;
    collectionDate?: Timestamp | null;
    createdAt?: Timestamp | null;
}

export interface VirtualMemberRenewal {
    id: string;
    amount?: number;
    paymentMethod?: string;
    planId?: string;
    planName?: string;
    collectionDate?: Timestamp | null;
    date?: string;
    createdAt?: Timestamp | null;
    backdated?: boolean;
    bulkRenewal?: boolean;
    extendedTo?: string;
    durationDays?: number;
}

export function useVirtualMembers(clubId: string | null) {
    const [members, setMembers] = useState<VirtualMemberLite[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setMembers([]); setLoading(false); return; }
        return onSnapshot(collection(db, `clubs/${clubId}/virtualMembers`), snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as VirtualMemberLite);
            rows.sort((a, b) => (a.memberId || "").localeCompare(b.memberId || ""));
            setMembers(rows);
            setLoading(false);
        }, () => setLoading(false));
    }, [clubId]);
    return { members, loading };
}

/**
 * Full renewal history for one virtual member, newest first.
 *
 * Merges TWO sources so NO history is lost:
 *   1. The `renewals` subcollection (added 2026-06; only newer renewals have it).
 *   2. clubs/{clubId}/payments where virtualMemberId == this member's doc id —
 *      EVERY virtual renewal (current + legacy Settings-modal + bulk flows) has
 *      always written one of these, so this recovers historical renewals that
 *      pre-date the subcollection (which is why History showed zero before).
 * Entries present in both are de-duped by date + amount (the subcollection copy,
 * being richer, wins).
 */
export function useVirtualMemberRenewals(clubId: string | null, memberId: string | null) {
    const [renewals, setRenewals] = useState<VirtualMemberRenewal[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !memberId) { setRenewals([]); setLoading(false); return; }

        let sub: VirtualMemberRenewal[] = [];
        let pay: VirtualMemberRenewal[] = [];
        let gotSub = false, gotPay = false;
        // The de-dupe rule lives in lib/virtualRenewals, so this panel and the
        // complete export cannot drift apart on what counts as one renewal.
        const publish = () => {
            setRenewals(mergeRenewals(sub as any[], pay as any[]) as VirtualMemberRenewal[]);
            if (gotSub && gotPay) setLoading(false);
        };

        // Renewal history lives one level below the club. It used to be read
        // from clubs/{id}/virtualMembers/{id}/renewals, which no rule covers —
        // Firestore rules do not cascade — so this listener always errored and
        // the history showed only whatever could be reconstructed from
        // payments. See lib/virtualRenewals.
        const u1 = onSnapshot(
            query(
                collection(db, `clubs/${clubId}/virtualMemberRenewals`),
                where("virtualMemberId", "==", memberId),
            ),
            snap => {
                sub = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }) as VirtualMemberRenewal)
                    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
                gotSub = true; publish();
            },
            () => { gotSub = true; publish(); },
        );
        // Reconstruct from payments (the source that always recorded a renewal).
        const u2 = onSnapshot(
            query(collection(db, `clubs/${clubId}/payments`), where("virtualMemberId", "==", memberId)),
            snap => {
                pay = snap.docs.map(d => {
                    const p = d.data() as any;
                    // todayLocal, not toISOString: IST is UTC+5:30, so a
                    // renewal taken before 05:30 was being filed under the
                    // previous day — which also made this panel and the
                    // complete export disagree about the same renewal.
                    const date = p.date
                        || (p.createdAt?.toDate ? todayLocal(p.createdAt.toDate()) : undefined)
                        || (p.collectionDate?.toDate ? todayLocal(p.collectionDate.toDate()) : undefined);
                    return {
                        id: "pay_" + d.id,
                        amount: p.amount,
                        paymentMethod: p.paymentMethod,
                        planId: p.planId,
                        planName: p.planName,
                        collectionDate: p.collectionDate ?? null,
                        date,
                        createdAt: p.createdAt ?? null,
                    } as VirtualMemberRenewal;
                });
                gotPay = true; publish();
            },
            () => { gotPay = true; publish(); },
        );
        return () => { u1(); u2(); };
    }, [clubId, memberId]);
    return { renewals, loading };
}

// Next ID(s): max numeric suffix among existing memberIds (MNC-B-NNN) + 1.
// Computed from the live list so bulk adds don't collide.
function nextVirtualIds(existing: VirtualMemberLite[], count: number): string[] {
    let max = 0;
    for (const m of existing) {
        const mm = /(\d+)\s*$/.exec(m.memberId || "");
        if (mm) max = Math.max(max, parseInt(mm[1], 10));
    }
    const out: string[] = [];
    for (let i = 1; i <= count; i++) out.push(`MNC-B-${String(max + i).padStart(3, "0")}`);
    return out;
}

export async function addVirtualMember(clubId: string, existing: VirtualMemberLite[], data: { name: string; phone?: string }) {
    const [memberId] = nextVirtualIds(existing, 1);
    await addDoc(collection(db, `clubs/${clubId}/virtualMembers`), {
        memberId, name: data.name.trim(), phone: (data.phone || "").trim(), createdAt: serverTimestamp(),
    });
    return memberId;
}

export async function bulkAddVirtualMembers(clubId: string, existing: VirtualMemberLite[], rows: { name: string; phone?: string }[]) {
    const clean = rows.filter(r => r.name.trim());
    if (!clean.length) return [];
    const ids = nextVirtualIds(existing, clean.length);
    const batch = writeBatch(db);
    clean.forEach((r, i) => {
        const ref = doc(collection(db, `clubs/${clubId}/virtualMembers`));
        batch.set(ref, { memberId: ids[i], name: r.name.trim(), phone: (r.phone || "").trim(), createdAt: serverTimestamp() });
    });
    await batch.commit();
    return ids;
}

/**
 * Human-readable membership expiry status with colour + expired flag.
 * Always shows EXACT days (e.g. "Expired – 90 Days Ago", never "3 months").
 */
export function expiryStatus(end: Timestamp | null | undefined): { label: string; color: string; expired: boolean; set: boolean } {
    if (!end) return { label: "No plan / expiry set", color: "#94a3b8", expired: false, set: false };
    const endDate = (end as any).toDate ? (end as Timestamp).toDate() : new Date(end as any);
    const diffDays = Math.round((endDate.getTime() - Date.now()) / 86400000);
    if (diffDays > 0) {
        const color = diffDays <= 5 ? "#dc2626" : diffDays <= 14 ? "#d97706" : "#16a34a";
        return { label: `Active – ${diffDays} Day${diffDays === 1 ? "" : "s"} Left`, color, expired: false, set: true };
    }
    if (diffDays === 0) return { label: "Expires Today", color: "#dc2626", expired: false, set: true };
    const ago = -diffDays;
    return { label: `Expired – ${ago} Day${ago === 1 ? "" : "s"} Ago`, color: "#b91c1c", expired: true, set: true };
}
