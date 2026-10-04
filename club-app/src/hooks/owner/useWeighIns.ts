import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, query, where, orderBy, getDocs, addDoc, updateDoc,
    doc, serverTimestamp, increment, arrayUnion,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { checkMilestones, type MilestoneData } from "@/utils/checkMilestones";
import { CLUB_MEMBERS_KEY, fetchClubMembers } from "@/hooks/useClubMembersRaw";
import type { WeighIn, User } from "@/types/firestore";

// ─── Fetch weigh-ins for a club (optionally filtered by member) ──────────────

export function useWeighIns(clubId: string | null, memberId?: string) {
    return useQuery({
        queryKey: ["weighIns", clubId, memberId ?? "all"],
        enabled: !!clubId,
        queryFn: async () => {
            if (memberId) {
                const q = query(
                    collection(db, `clubs/${clubId}/members/${memberId}/weighIns`),
                    orderBy("createdAt", "desc")
                );
                const snap = await getDocs(q);
                return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WeighIn));
            } else {
                // Fetch all members, then all weigh-ins
                const membersQ = query(collection(db, `clubs/${clubId}/members`));
                const memberSnap = await getDocs(membersQ);
                let allWeighIns: WeighIn[] = [];

                // Fetch every member's weigh-ins in PARALLEL (was N sequential
                // round-trips — a major cause of slow leaderboard / awards loads).
                const wSnaps = await Promise.all(
                    memberSnap.docs.map((memberDoc) =>
                        getDocs(query(collection(db, `clubs/${clubId}/members/${memberDoc.id}/weighIns`), orderBy("createdAt", "desc")))
                    )
                );
                for (const wSnap of wSnaps) {
                    for (const d of wSnap.docs) {
                        allWeighIns.push({ id: d.id, ...d.data() } as WeighIn);
                    }
                }
                return allWeighIns.sort((a, b) => {
                    const tA = a.createdAt?.toMillis?.() || 0;
                    const tB = b.createdAt?.toMillis?.() || 0;
                    return tB - tA;
                });
            }
        },
    });
}

// ─── Record a weigh-in ──────────────────────────────────────────────────────

interface RecordWeighInInput {
    memberId: string;
    clubId: string;
    weight: number;
    notes?: string;
    recordedBy: "owner" | "member";
    previousWeight: number | null;
    startingWeight: number;
    targetWeight: number;
    existingBadges: string[];
    totalWeighIns: number;
    date?: string;                      // override date (for historical entries)
    // Body composition
    height?: number;
    bodyFat?: number;
    visceralFat?: number;
    bmr?: number;
    bodyAge?: number;
    trunkSubcutaneousFat?: number;
    skeletalMuscle?: number;
    previousBodyFat?: number | null;
    previousSkeletalMuscle?: number | null;
    startingBodyFat?: number;
    startingSkeletalMuscle?: number;
}

interface RecordWeighInResult {
    change: number | null;
    newBadges: string[];
    bodyFatChange?: number | null;
    skeletalMuscleChange?: number | null;
}

export function useRecordWeighIn() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: RecordWeighInInput): Promise<RecordWeighInResult> => {
            const {
                memberId, clubId, weight, notes, recordedBy,
                previousWeight, startingWeight, targetWeight,
                existingBadges, totalWeighIns, date,
                height, bodyFat, visceralFat, bmr, bodyAge,
                trunkSubcutaneousFat, skeletalMuscle,
                previousBodyFat, previousSkeletalMuscle,
                startingBodyFat, startingSkeletalMuscle,
            } = input;

            const change = previousWeight !== null ? +(previousWeight - weight).toFixed(1) : null;
            const entryDate = date ?? new Date().toISOString().split("T")[0];

            // Auto-calculate BMI if height is provided
            const bmi = height && height > 0
                ? +((weight / Math.pow(height / 100, 2)).toFixed(1))
                : undefined;

            // Body composition changes
            const bodyFatChange = bodyFat != null && previousBodyFat != null
                ? +(previousBodyFat - bodyFat).toFixed(1)
                : null;
            const skeletalMuscleChange = skeletalMuscle != null && previousSkeletalMuscle != null
                ? +(skeletalMuscle - previousSkeletalMuscle).toFixed(2)
                : null;

            // 1. Write weigh-in document
            const weighInDoc: Record<string, unknown> = {
                memberId,
                clubId,
                weight,
                date: entryDate,
                previousWeight: previousWeight ?? null,
                change,
                notes: notes || "",
                recordedBy,
                createdAt: serverTimestamp(),
            };
            if (height != null) weighInDoc.height = height;
            if (bmi != null) weighInDoc.bmi = bmi;
            if (bodyFat != null) weighInDoc.bodyFat = bodyFat;
            if (previousBodyFat != null) weighInDoc.previousBodyFat = previousBodyFat;
            if (bodyFatChange != null) weighInDoc.bodyFatChange = bodyFatChange;
            if (visceralFat != null) weighInDoc.visceralFat = visceralFat;
            if (bmr != null) weighInDoc.bmr = bmr;
            if (bodyAge != null) weighInDoc.bodyAge = bodyAge;
            if (trunkSubcutaneousFat != null) weighInDoc.trunkSubcutaneousFat = trunkSubcutaneousFat;
            if (skeletalMuscle != null) weighInDoc.skeletalMuscle = skeletalMuscle;
            if (previousSkeletalMuscle != null) weighInDoc.previousSkeletalMuscle = previousSkeletalMuscle;
            if (skeletalMuscleChange != null) weighInDoc.skeletalMuscleChange = skeletalMuscleChange;

            await addDoc(collection(db, `clubs/${clubId}/members/${memberId}/weighIns`), weighInDoc);

            // 2. Update member profile
            const memberUpdate: Record<string, unknown> = {
                currentWeight: weight,
                lastWeighIn: serverTimestamp(),
                totalWeighIns: increment(1),
            };
            if (!startingWeight && totalWeighIns === 0) memberUpdate.startingWeight = weight;
            if (height != null) memberUpdate.height = height;
            if (bodyFat != null) memberUpdate.currentBodyFat = bodyFat;
            if (skeletalMuscle != null) memberUpdate.currentSkeletalMuscle = skeletalMuscle;
            // Set starting body composition on first weigh-in
            if (totalWeighIns === 0) {
                if (bodyFat != null && !startingBodyFat) memberUpdate.startingBodyFat = bodyFat;
                if (skeletalMuscle != null && !startingSkeletalMuscle) memberUpdate.startingSkeletalMuscle = skeletalMuscle;
            }
            await updateDoc(doc(db, `clubs/${clubId}/members`, memberId), memberUpdate);

            // 3. Check milestones
            const totalLost = (startingWeight || weight) - weight;
            const milestoneData: MilestoneData = {
                weighInCount: totalWeighIns + 1,
                totalLost,
                currentWeight: weight,
                targetWeight: targetWeight || 0,
            };
            const newBadges = checkMilestones(milestoneData, existingBadges);

            if (newBadges.length > 0) {
                await updateDoc(doc(db, `clubs/${clubId}/members`, memberId), {
                    badges: arrayUnion(...newBadges),
                });
            }

            return { change, newBadges, bodyFatChange, skeletalMuscleChange };
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["weighIns", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["member-weighIns", vars.memberId] });
            qc.invalidateQueries({ queryKey: ["leaderboard", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["drastic-changes", vars.clubId] });
        },
    });
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
    memberId: string;
    memberName: string;
    memberPhoto: string;
    weightLost: number;
    fatLost?: number;      // body fat % points lost (primary ranking metric)
    muscleGained?: number; // skeletal muscle kg gained
    badges: string[];
}

/**
 * The club ranked by fat lost.
 *
 * `defer` exists for the member home screen. That page needs exactly one thing
 * from here — `[0]`, the week's top performer — and getting it costs a read of
 * every member document plus one weigh-in query **per member**: about two
 * hundred round trips before the home screen could finish. Deferred, the page
 * paints on its own data and the top performer arrives a moment later.
 *
 * The member list comes from the shared cache, so this no longer re-reads a
 * collection the birthday check has usually just read.
 */
export function useLeaderboard(
    clubId: string | null,
    period: "week" | "alltime",
    options: { defer?: boolean } = {},
) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: ["leaderboard", clubId, period],
        enabled: !!clubId && !options.defer,
        // Ranking the whole club is expensive and does not change between two
        // glances at the same screen.
        staleTime: 10 * 60_000,
        queryFn: async () => {
            // Through the shared cache, so this reuses the member list the
            // birthday check has usually already read rather than fetching the
            // same collection a second time.
            const members = await qc.fetchQuery({
                queryKey: CLUB_MEMBERS_KEY(clubId),
                queryFn: () => fetchClubMembers(clubId as string),
                staleTime: 30 * 60_000,
            });
            const memberMap: Record<string, User> = {};
            for (const m of members) memberMap[m.id] = m;

            const entries: LeaderboardEntry[] = [];

            if (period === "alltime") {
                // All-time: startingBodyFat vs currentBodyFat (fat loss primary metric)
                // Fallback to weight if no body fat data
                for (const mem of members) {
                    const m = mem;
                    const fatLost = (m.startingBodyFat != null && m.currentBodyFat != null)
                        ? +(m.startingBodyFat - m.currentBodyFat).toFixed(1)
                        : null;
                    const weightLost = (m.startingWeight != null && m.currentWeight != null)
                        ? +(m.startingWeight - m.currentWeight).toFixed(1)
                        : 0;
                    const muscleGained = (m.startingSkeletalMuscle != null && m.currentSkeletalMuscle != null)
                        ? +(m.currentSkeletalMuscle - m.startingSkeletalMuscle).toFixed(2)
                        : undefined;

                    const rankScore = fatLost ?? (weightLost > 0 ? weightLost : null);
                    if (!rankScore || rankScore <= 0) continue;

                    entries.push({
                        memberId: mem.id,
                        memberName: m.name,
                        memberPhoto: m.photo || "",
                        weightLost: weightLost > 0 ? weightLost : 0,
                        fatLost: fatLost ?? undefined,
                        muscleGained,
                        badges: m.badges || [],
                    });
                }
                // Sort by fat lost first, then weight lost
                return entries
                    .sort((a, b) => (b.fatLost ?? b.weightLost) - (a.fatLost ?? a.weightLost))
                    .slice(0, 10);
            } else {
                // This week: first weigh-in in past 7 days vs latest
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                const weekStart = weekAgo.toISOString().split("T")[0];

                // Pre-fetch every member's week weigh-ins in PARALLEL, then the
                // loop reads from the map (was N sequential round-trips).
                const weekSnaps = await Promise.all(
                    members.map((mem) =>
                        getDocs(query(
                            collection(db, `clubs/${clubId}/members/${mem.id}/weighIns`),
                            where("date", ">=", weekStart),
                            orderBy("date", "asc")
                        ))
                    )
                );
                const weekByMember = new Map(members.map((mem, i) => [mem.id, weekSnaps[i]] as const));

                for (const mem of members) {
                    const wSnap = weekByMember.get(mem.id)!;

                    if (wSnap.empty) continue;

                    const weighIns = wSnap.docs.map(doc => doc.data() as WeighIn);
                    const first = weighIns[0];
                    const last = weighIns[weighIns.length - 1];

                    const weightLost = +(first.weight - last.weight).toFixed(1);
                    const fatLost = (first.bodyFat != null && last.bodyFat != null)
                        ? +(first.bodyFat - last.bodyFat).toFixed(1)
                        : null;
                    const muscleGained = (first.skeletalMuscle != null && last.skeletalMuscle != null)
                        ? +(last.skeletalMuscle - first.skeletalMuscle).toFixed(2)
                        : undefined;

                    const rankScore = fatLost ?? weightLost;
                    if (rankScore <= 0) continue;

                    const m = memberMap[mem.id];
                    entries.push({
                        memberId: mem.id,
                        memberName: m?.name ?? "Unknown",
                        memberPhoto: m?.photo ?? "",
                        weightLost: weightLost > 0 ? weightLost : 0,
                        fatLost: fatLost ?? undefined,
                        muscleGained,
                        badges: m?.badges || [],
                    });
                }
                return entries
                    .sort((a, b) => (b.fatLost ?? b.weightLost) - (a.fatLost ?? a.weightLost))
                    .slice(0, 10);
            }
        },
    });
}

// ─── Drastic Change Alerts ──────────────────────────────────────────────────

export interface DrasticChangeAlert {
    memberId: string;
    memberName: string;
    memberPhoto: string;
    change: number;          // positive = lost, negative = gained
    type: "gained" | "lost_fast";
}

export function useDrasticChanges(clubId: string | null) {
    return useQuery({
        queryKey: ["drastic-changes", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekAgoStr = weekAgo.toISOString().split("T")[0];

            const membersSnap = await getDocs(query(collection(db, `clubs/${clubId}/members`)));
            const alerts: DrasticChangeAlert[] = [];

            // Pre-fetch every member's recent weigh-ins in PARALLEL (was N
            // sequential round-trips).
            const changeSnaps = await Promise.all(
                membersSnap.docs.map((d) =>
                    getDocs(query(
                        collection(db, `clubs/${clubId}/members/${d.id}/weighIns`),
                        where("date", ">=", weekAgoStr),
                        orderBy("date", "asc")
                    ))
                )
            );
            const changeByMember = new Map(membersSnap.docs.map((d, i) => [d.id, changeSnaps[i]] as const));

            for (const d of membersSnap.docs) {
                const wSnap = changeByMember.get(d.id)!;

                if (wSnap.size < 2) continue;

                const weighIns = wSnap.docs.map(doc => doc.data() as WeighIn);
                const first = weighIns[0].weight;
                const last = weighIns[weighIns.length - 1].weight;
                const change = +(first - last).toFixed(1); // positive = lost

                const m = d.data() as User;

                if (change < -2) {
                    // Gained more than 2kg
                    alerts.push({
                        memberId: d.id,
                        memberName: m?.name ?? "Unknown",
                        memberPhoto: m?.photo ?? "",
                        change,
                        type: "gained",
                    });
                } else if (change > 3) {
                    // Lost more than 3kg (too fast)
                    alerts.push({
                        memberId: d.id,
                        memberName: m?.name ?? "Unknown",
                        memberPhoto: m?.photo ?? "",
                        change,
                        type: "lost_fast",
                    });
                }
            }
            return alerts;
        },
    });
}

