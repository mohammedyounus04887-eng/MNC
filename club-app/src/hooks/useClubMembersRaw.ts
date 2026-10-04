/**
 * The club's member list — read once, shared by everyone who needs all of it.
 *
 * Several screens need every member document rather than one: the leaderboard
 * ranks the club, the birthday popup looks for today's dates. Each was doing
 * its own `getDocs` on the whole collection, so opening the member home read
 * the entire club **twice**, a few milliseconds apart, for two different
 * reasons — and again on the next navigation.
 *
 * One query key means React Query fetches it once and hands the same array to
 * every caller, and holds it long enough that moving between screens does not
 * pay for it again. The club's roster does not change minute to minute; a
 * birthday that lands during a session can wait half an hour to be noticed.
 *
 * This is the same shape of problem the reception screen had (see
 * REBUILD_NOTES): member documents are large — they carry photos and, on older
 * records, a 128-number face descriptor — so reading them twice over a phone
 * connection is expensive in a way the code does not look expensive.
 */

import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "@/types/firestore";

/** Every member of the club, as stored. */
export async function fetchClubMembers(clubId: string): Promise<User[]> {
    const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
    return snap.docs.map((d) => ({ ...(d.data() as User), id: d.id }));
}

export const CLUB_MEMBERS_KEY = (clubId: string | null | undefined) =>
    ["clubMembersRaw", clubId] as const;

export interface UseClubMembersOptions {
    /**
     * Hold the read back — for a caller that is not needed to draw the screen.
     * The home page paints first, then this fills in.
     */
    enabled?: boolean;
}

export function useClubMembersRaw(
    clubId: string | null | undefined,
    options: UseClubMembersOptions = {},
) {
    const { enabled = true } = options;
    return useQuery({
        queryKey: CLUB_MEMBERS_KEY(clubId),
        queryFn: () => fetchClubMembers(clubId as string),
        enabled: !!clubId && enabled,
        staleTime: 30 * 60_000,
        gcTime: 60 * 60_000,
        refetchOnWindowFocus: false,
    });
}
