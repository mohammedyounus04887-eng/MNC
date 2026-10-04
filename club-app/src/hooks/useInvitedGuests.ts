import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GuestEntry } from "@/types/firestore";

// ─── useInvitedGuests ──────────────────────────────────────────────────
// Returns every guest entry that was tagged with this member as the
// `invitedBy` referrer. invitedBy.memberId is written by Reception as
// `fdInviter.memberId || fdInviter.id` — i.e. the human code "MNC-001"
// if it exists, else the Firestore doc id. We query for BOTH values
// in parallel and dedupe so we don't miss any historical entries.

export interface UseInvitedGuestsResult {
    entries: GuestEntry[];
    loading: boolean;
    error: string | null;
}

export function useInvitedGuests(
    clubId: string | null,
    memberDocId: string | null,
    memberCode: string | null | undefined,
): UseInvitedGuestsResult {
    const [byDocId, setByDocId] = useState<GuestEntry[]>([]);
    const [byCode, setByCode] = useState<GuestEntry[]>([]);
    const [loadingDoc, setLoadingDoc] = useState(true);
    const [loadingCode, setLoadingCode] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!clubId || !memberDocId) { setByDocId([]); setLoadingDoc(false); return; }
        setLoadingDoc(true);
        const unsub = onSnapshot(
            query(
                collection(db, `clubs/${clubId}/guestEntries`),
                where("invitedBy.memberId", "==", memberDocId),
            ),
            (snap) => {
                setByDocId(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GuestEntry));
                setLoadingDoc(false);
            },
            (err) => { setError(err.message); setLoadingDoc(false); },
        );
        return () => unsub();
    }, [clubId, memberDocId]);

    useEffect(() => {
        if (!clubId || !memberCode || memberCode === memberDocId) {
            setByCode([]); setLoadingCode(false); return;
        }
        setLoadingCode(true);
        const unsub = onSnapshot(
            query(
                collection(db, `clubs/${clubId}/guestEntries`),
                where("invitedBy.memberId", "==", memberCode),
            ),
            (snap) => {
                setByCode(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GuestEntry));
                setLoadingCode(false);
            },
            (err) => { setError(err.message); setLoadingCode(false); },
        );
        return () => unsub();
    }, [clubId, memberCode, memberDocId]);

    // Dedupe by entry id (same doc can't match both queries, but be safe)
    const seen = new Set<string>();
    const merged: GuestEntry[] = [];
    for (const e of [...byDocId, ...byCode]) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        merged.push(e);
    }
    // Newest first
    merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return { entries: merged, loading: loadingDoc || loadingCode, error };
}
