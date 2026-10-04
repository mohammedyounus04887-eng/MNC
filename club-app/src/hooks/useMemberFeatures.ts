import { toDateSafe } from "@/lib/toDateSafe";
import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, getDocs, getDoc, doc, setDoc, Timestamp, writeBatch, where } from "firebase/firestore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubMembersRaw } from "@/hooks/useClubMembersRaw";
import type { WeightLog, Referral, User } from "@/types/firestore";

// ─── WEIGHT PROGRESS ────────────────────────────────────────────────────────

export function useWeightLogs() {
    const { userProfile } = useAuth();
    return useQuery({
        queryKey: ["weightLogs", userProfile?.id],
        queryFn: async () => {
            if (!userProfile) return [];
            const snap = await getDocs(
                query(collection(db, `clubs/${userProfile.clubId}/members/${userProfile.id}/weighIns`), orderBy("date", "desc"))
            );
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as WeightLog));
        },
        enabled: !!userProfile,
    });
}

export function useAddWeightLog() {
    const qc = useQueryClient();
    const { userProfile } = useAuth();

    return useMutation({
        mutationFn: async ({ weight, date, notes }: { weight: number, date: string, notes: string }) => {
            if (!userProfile) throw new Error("Not auth");
            const id = "wl_" + Date.now();
            const d = new Date(date);
            await setDoc(doc(db, `clubs/${userProfile.clubId}/members/${userProfile.id}/weighIns`, id), {
                id,
                weight,
                date: Timestamp.fromDate(d),
                notes,
            });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["weightLogs"] }),
    });
}

// ─── BIRTHDAY & ANNIVERSARY POPUP LOGIC ────────────────────────────────────────

// Shared query: today's birthdays + anniversaries for the current club.
// Used by both the inline banner and the once-per-session popup.
export function useTodaysCelebrations(clubId?: string) {
    // Shares the club's member list with everything else that needs all of it.
    // This used to run its own full read of the collection, milliseconds away
    // from the leaderboard's identical one.
    const { data: users, isLoading } = useClubMembersRaw(clubId);

    // Whose birthday it is, is a question about data already in hand — not a
    // second thing to fetch. It was a useQuery of its own, which made it look
    // like a network call and gave it a second cache to fall out of step with.
    const data = useMemo(() => {
        if (!users) return undefined;
        const today = new Date();
        const m = today.getMonth();
        const day = today.getDate();
        const onToday = (ts: unknown) => {
            const d = toDateSafe(ts);
            return !!d && d.getMonth() === m && d.getDate() === day;
        };
        return {
            birthdays: users.filter(u => onToday(u.dob)),
            anniversaries: users.filter(u => onToday(u.anniversary)),
        };
    }, [users]);

    return { data, isLoading };
}

/** Whether this browser session has already seen (and dismissed) the popup. */
function celebrationsAlreadyShown(): boolean {
    try {
        return sessionStorage.getItem("birthdaysShown") === "true";
    } catch {
        return false;
    }
}

/**
 * Whose birthday it is — asked once, and only of a signed-in person.
 *
 * This popup is mounted at the root of the app, so it runs on every route
 * there is, including the member login screen. It used to fall back to the
 * club resolved from the domain when nobody was signed in — which meant
 * opening the login page downloaded **every member document in the club**,
 * face descriptors and all, before the member had typed their email, purely
 * to find out whether anyone had a birthday. That is the same read that made
 * the reception screen crawl (see REBUILD_NOTES), on the one screen where the
 * person is least likely to tolerate a wait.
 *
 * Two gates now: somebody must actually be signed in, and the popup must not
 * already have been dismissed this session. On the login screen neither holds,
 * so nothing is read at all.
 */
export function useBirthdayAnniversaryCheck() {
    const { userProfile } = useAuth();
    const clubId = celebrationsAlreadyShown() ? undefined : userProfile?.clubId;
    const { data } = useTodaysCelebrations(clubId);
    const [peopleToCelebrate, setPeopleToCelebrate] = useState<{ birthdays: User[], anniversaries: User[] } | null>(null);

    useEffect(() => {
        if (!clubId || !data) return;
        if (celebrationsAlreadyShown()) return;
        if (data.birthdays.length > 0 || data.anniversaries.length > 0) {
            setPeopleToCelebrate(data);
        }
    }, [clubId, data]);

    const dismiss = () => {
        sessionStorage.setItem("birthdaysShown", "true");
        setPeopleToCelebrate(null);
    };

    return { peopleToCelebrate, dismiss };
}



// ─── REFERRALS ────────────────────────────────────────────────────────

export function useReferralsList() {
    const { userProfile } = useAuth();
    return useQuery({
        queryKey: ["referrals", userProfile?.id],
        queryFn: async () => {
            if (!userProfile) return [];
            const snap = await getDocs(
                query(collection(db, `clubs/${userProfile.clubId}/referrals`), where("referrerId", "==", userProfile.id))
            );

            const refs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Referral));

            // Fetch details of those users
            const detailed = [];
            for (const r of refs) {
                const uSnap = await getDoc(doc(db, `clubs/${userProfile.clubId}/members`, r.referredId));
                if (uSnap.exists()) {
                    detailed.push({
                        ...r,
                        referredUser: { id: uSnap.id, ...uSnap.data() } as User
                    });
                }
            }
            return detailed;
        },
        enabled: !!userProfile,
    });
}
