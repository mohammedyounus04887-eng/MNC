/**
 * Reading the loyalty standings.
 *
 * The calculation itself lives in `lib/loyaltyPoints.ts` — this only decides
 * which stretch of days to run it over, and holds the answer still for a while
 * afterwards. It is a summary of a month of records, not a live feed: putting
 * it on a listener would re-read every attendance document each time anybody
 * checked in, on a screen nobody is watching for a one-point change.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";
import { computeLoyaltyStandings, type LoyaltyStandings } from "@/lib/loyaltyPoints";

export type LoyaltyPeriod = "month" | "all";

/** First day of the month a date falls in. */
export function monthStart(date = new Date()): string {
    return todayLocal(new Date(date.getFullYear(), date.getMonth(), 1));
}

/**
 * When the club started counting.
 *
 * Stored on the club document as `loyaltyStartDate`. Until somebody sets it,
 * All Time means this month — which is true, because the programme has not been
 * running any longer than that. It also keeps the very first load cheap: no
 * club is asked to read a year of attendance to draw a leaderboard of a
 * fortnight's points.
 */
export async function fetchLoyaltyStartDate(clubId: string): Promise<string> {
    try {
        const snap = await getDoc(doc(db, "clubs", clubId));
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>).loyaltyStartDate : null;
        if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    } catch {
        // Offline, or the field was never set — this month is the safe answer.
    }
    return monthStart();
}

export function useLoyaltyStartDate(clubId: string | null) {
    return useQuery({
        queryKey: ["loyaltyStartDate", clubId],
        queryFn: () => fetchLoyaltyStartDate(clubId as string),
        enabled: !!clubId,
        staleTime: 5 * 60_000,
    });
}

export function useLoyaltyStandings(clubId: string | null, period: LoyaltyPeriod) {
    const { data: startDate } = useLoyaltyStartDate(clubId);
    const to = todayLocal();
    const from = period === "month" ? monthStart() : (startDate ?? monthStart());

    return useQuery<LoyaltyStandings>({
        queryKey: ["loyaltyStandings", clubId, from, to],
        queryFn: () => computeLoyaltyStandings({ clubId: clubId as string, from, to }),
        // All Time cannot resolve until we know when the club started counting,
        // or the first load would silently rank one month and call it all time.
        enabled: !!clubId && (period === "month" || !!startDate),
        // Points move at the speed of a club day. Re-reading a month of
        // attendance more often than this buys nothing and costs reads.
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
    });
}

/** Drop the cached standings so the next read is fresh — used after awarding. */
export function useInvalidateLoyalty() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: ["loyaltyStandings"] });
}
