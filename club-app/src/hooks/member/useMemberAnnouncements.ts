import { useEffect, useState } from "react";
import {
    collection,
    query,
    orderBy,
    onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { Announcement } from "@/types/firestore";
import { toDateSafe } from "@/lib/toDateSafe";

function isAnnouncementForMember(
    announcement: Announcement,
    memberType?: string | null,
    _membershipTier?: string | null
): boolean {
    const target = announcement.sentTo;

    // Dates come through `toDateSafe` because these two lines used to call
    // `.toDate()` straight on the field. One announcement whose date was not a
    // Timestamp — written by an older path, or edited by hand in the console —
    // threw out of render and took the whole member screen down to "Something
    // went wrong". A date the app cannot read now means "no date", which is the
    // same as the field never having been set.
    const now = Date.now();
    const scheduledFor = toDateSafe(announcement.scheduledFor);
    if (scheduledFor && scheduledFor.getTime() > now) return false;

    const expiresAt = toDateSafe(announcement.expiresAt);
    if (expiresAt && expiresAt.getTime() < now) return false;

    if (target === "All Members") return true;

    const isVisiting = memberType === "visiting";
    const isPaid = !isVisiting;

    if (target === "Visiting Members Only") return isVisiting;
    if (target === "All Paid Members") return isPaid;

    // Legacy tier-based targets — show to all paid members as fallback
    if (target === "Bronze Members" || target === "Silver Members" || target === "Gold Members" || target === "Platinum Members") {
        return isPaid;
    }

    return true;
}

export function useMyAnnouncements(
    clubId: string | null,
    memberId: string | null,
    memberType?: string | null,
    membershipTier?: string | null
) {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { club } = useClubContext();

    useEffect(() => {
        if (!clubId || !memberId || !club?.id) {
            setAnnouncements([]);
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, `clubs/${clubId}/announcements`),
            orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(
            q,
            (snap) => {
                const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Announcement));

                // Filter for this member
                const filtered = results.filter((a) => isAnnouncementForMember(a, memberType, membershipTier));

                // Sort pinned first, then by date descending
                filtered.sort((a, b) => {
                    if (a.isPinned !== b.isPinned) {
                        return a.isPinned ? -1 : 1;
                    }
                    const aTime = a.createdAt?.toMillis() ?? 0;
                    const bTime = b.createdAt?.toMillis() ?? 0;
                    return bTime - aTime;
                });

                setAnnouncements(filtered);
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsub();
    }, [clubId, memberId, memberType, membershipTier, club?.id]);

    return { announcements, loading, error };
}
