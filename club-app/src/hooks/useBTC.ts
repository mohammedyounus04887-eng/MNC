/**
 * Body Transformation Challenge — shared hooks.
 *
 * Single source of truth for everything BTC. The challenge config lives at
 * `clubs/{clubId}/btcConfig/current` and members are enrolled by setting
 * `isBTCParticipant: true` on their member doc. Weigh-ins continue to live
 * at `members/{id}/weighIns/*` regardless of BTC status — the BTC view
 * just filters them by the configured `startDate`.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BTCConfig, BTCMeal, WeighIn } from "@/types/firestore";

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

// ─── BTC config (the single current challenge per club) ─────────────────
export function useBTCConfig(clubId: string | null) {
    const [config, setConfig] = useState<BTCConfig | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setConfig(null); setLoading(false); return; }
        const ref = doc(db, `clubs/${clubId}/btcConfig`, "current");
        const u = onSnapshot(ref, snap => {
            setConfig(snap.exists() ? (snap.data() as BTCConfig) : null);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId]);
    return { config, loading };
}

// ─── List BTC participants (active + rejected) ──────────────────────────
export function useBTCParticipants(clubId: string | null) {
    const [participants, setParticipants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setParticipants([]); setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/members`),
            where("isBTCParticipant", "==", true),
        );
        const u = onSnapshot(q, snap => {
            setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId]);
    return { participants, loading };
}

// ─── A single member's weigh-ins (newest first) ─────────────────────────
export function useMemberWeighIns(clubId: string | null, memberId: string | null) {
    const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !memberId) { setWeighIns([]); setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/members/${memberId}/weighIns`),
            orderBy("createdAt", "desc"),
        );
        const u = onSnapshot(q, snap => {
            setWeighIns(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WeighIn));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, memberId]);
    return { weighIns, loading };
}

// ─── Weeks for a participant (1..config.weeks), each with its measurement
// ─── if any. Baseline is the first weigh-in on/after btcJoinedAt.
export interface BTCWeekRow {
    week: number;
    rangeStart: Date;
    rangeEnd: Date;
    weighIn: WeighIn | null;
    isPast: boolean;
    isCurrent: boolean;
    isFuture: boolean;
    weightDelta: number | null;     // vs baseline (negative = lost)
    weightPct: number | null;       // % loss vs baseline
}

export function buildBTCWeeks(
    config: BTCConfig | null,
    weighIns: WeighIn[],
    btcJoinedAt: Date | null,
): { weeks: BTCWeekRow[]; baseline: WeighIn | null; currentWeek: number } {
    if (!config) return { weeks: [], baseline: null, currentWeek: 0 };
    const start = tsToDate(config.startDate as any);
    if (!start) return { weeks: [], baseline: null, currentWeek: 0 };
    const N = config.weeks || 5;
    const now = new Date();

    // Baseline = first weigh-in on/after btcJoinedAt (fallback: earliest)
    const join = btcJoinedAt || start;
    const sortedAsc = [...weighIns].sort((a, b) => {
        const ta = tsToDate(a.createdAt)?.getTime() ?? 0;
        const tb = tsToDate(b.createdAt)?.getTime() ?? 0;
        return ta - tb;
    });
    const baseline = sortedAsc.find(w => {
        const t = tsToDate(w.createdAt);
        return t ? t.getTime() >= join.getTime() : false;
    }) || sortedAsc[0] || null;

    const weeks: BTCWeekRow[] = [];
    let currentWeek = 0;
    for (let i = 0; i < N; i++) {
        const rangeStart = new Date(start);
        rangeStart.setDate(rangeStart.getDate() + i * 7);
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + 7);
        const isCurrent = now >= rangeStart && now < rangeEnd;
        const isPast = now >= rangeEnd;
        const isFuture = now < rangeStart;
        if (isCurrent) currentWeek = i + 1;

        const weighIn = sortedAsc.find(w => {
            const t = tsToDate(w.createdAt);
            if (!t) return false;
            return t >= rangeStart && t < rangeEnd;
        }) || null;

        const weightDelta = (baseline && weighIn) ? +(weighIn.weight - baseline.weight).toFixed(1) : null;
        const weightPct = (baseline && weighIn && baseline.weight > 0)
            ? +(((baseline.weight - weighIn.weight) / baseline.weight) * 100).toFixed(2)
            : null;

        weeks.push({ week: i + 1, rangeStart, rangeEnd, weighIn, isPast, isCurrent, isFuture, weightDelta, weightPct });
    }
    return { weeks, baseline, currentWeek };
}

// ─── Elimination risk — informational only, never writes ─────────────
// Per the BTC agreement:
//   - Miss only ONE session allowed
//   - First and final session are compulsory
//   - Missing the final session = disqualified from rewards
//
// computeEliminationRisk() returns at-risk status + a human-readable reason.
// The UI uses this to paint participants RED but does NOT auto-set
// btcRejected — the admin reviews and decides manually.
export interface RiskAssessment {
    atRisk: boolean;
    reason: string;
}

export function computeEliminationRisk(
    config: BTCConfig | null,
    weighIns: WeighIn[],
    sessionsTotal: number = 5,
): RiskAssessment {
    if (!config) return { atRisk: false, reason: "" };

    // A session is "attended" if a weigh-in exists for that week (any day in
    // that week, not strictly the official day — to be lenient).
    // wasLate is informational; missing the session entirely is what counts.
    const attendedSessions = new Set<number>();
    for (const w of weighIns) {
        const wk = Number((w as any).btcWeek) || 0;
        if (wk >= 1 && wk <= sessionsTotal) attendedSessions.add(wk);
    }

    // Determine which sessions are past or current — only those count as
    // "missed" if not attended. Future sessions are ignored for risk.
    const start = tsToDate(config.startDate as any);
    if (!start) return { atRisk: false, reason: "" };
    const now = new Date();
    let pastOrCurrentSessions = 0;
    for (let i = 1; i <= sessionsTotal; i++) {
        const sessionDate = new Date(start);
        sessionDate.setDate(sessionDate.getDate() + (i - 1) * 7);
        if (sessionDate <= now) pastOrCurrentSessions++;
    }
    if (pastOrCurrentSessions === 0) return { atRisk: false, reason: "" };

    const missed: number[] = [];
    for (let i = 1; i <= pastOrCurrentSessions; i++) {
        if (!attendedSessions.has(i)) missed.push(i);
    }

    const finalNum = sessionsTotal;
    const isFinalPast = pastOrCurrentSessions >= finalNum;
    const firstMissed = missed.includes(1);
    const finalMissed = isFinalPast && missed.includes(finalNum);

    if (firstMissed) {
        return { atRisk: true, reason: "Missed Session 1 (compulsory)" };
    }
    if (finalMissed) {
        return { atRisk: true, reason: `Missed Session ${finalNum} (final — compulsory)` };
    }
    if (missed.length >= 2) {
        return { atRisk: true, reason: `Missed sessions ${missed.join(", ")} (max 1 allowed)` };
    }
    return { atRisk: false, reason: "" };
}

// ─── Build the gender-alternating top leaderboard ──────────────────────
// Per agreement, two winner categories are tracked:
//   1. Highest % weight loss
//   2. Highest body-fat % loss (this winner also receives the prize pot)
// `metric` selects which one to rank by.
export interface LeaderboardEntry {
    memberId: string;
    name: string;
    photo: string;
    gender: "male" | "female" | "unknown";
    pctLoss: number;         // for weight metric: weight % loss; for bodyFat: body-fat % loss
    kgLoss: number;          // absolute kg lost (only meaningful for weight metric)
    bodyFatPctLoss: number;  // absolute body-fat % loss (only meaningful for bodyFat metric)
    rejected: boolean;
    // Risk = "should-have-been-eliminated per rules" but informational only.
    // Painted red across the BTC views with the reason shown below.
    atRisk: boolean;
    riskReason: string;
}

export type LeaderboardMetric = "weight" | "bodyFat";

export function buildLeaderboard(
    participants: any[],
    weighInsByMember: Record<string, WeighIn[]>,
    config: BTCConfig | null,
    metric: LeaderboardMetric = "weight",
): LeaderboardEntry[] {
    if (!config) return [];
    const entries: LeaderboardEntry[] = [];
    const sessionsTotal = config.weeks ? config.weeks + 1 : 5;
    for (const p of participants) {
        const weighIns = weighInsByMember[p.id] || [];
        const risk = computeEliminationRisk(config, weighIns, sessionsTotal);

        if (p.btcRejected) {
            entries.push({
                memberId: p.id,
                name: p.name || "—",
                photo: p.photoUrl || p.photo || "",
                gender: (p.btcGender || (p.gender || "unknown")) as any,
                pctLoss: 0, kgLoss: 0, bodyFatPctLoss: 0, rejected: true,
                atRisk: risk.atRisk, riskReason: risk.reason,
            });
            continue;
        }
        if (weighIns.length === 0) {
            // Still include zero-weighIn at-risk participants so the leaderboard
            // shows them as "missed everything" in red.
            if (risk.atRisk) {
                entries.push({
                    memberId: p.id,
                    name: p.name || "—",
                    photo: p.photoUrl || p.photo || "",
                    gender: (p.btcGender || (p.gender || "unknown")) as any,
                    pctLoss: 0, kgLoss: 0, bodyFatPctLoss: 0, rejected: false,
                    atRisk: true, riskReason: risk.reason,
                });
            }
            continue;
        }
        // Absent entries are placeholders (weight=0, wasAbsent=true) used
        // to mark missed sessions in the calculation grid. They must NOT
        // be picked as baseline or latest, otherwise the % loss math
        // collapses to 0 / divides by zero.
        const sortedAsc = [...weighIns]
            .filter(w => !(w as any).wasAbsent && Number(w.weight) > 0)
            .sort((a, b) => {
                const ta = tsToDate(a.createdAt)?.getTime() ?? 0;
                const tb = tsToDate(b.createdAt)?.getTime() ?? 0;
                return ta - tb;
            });
        const join = tsToDate(p.btcJoinedAt) || tsToDate(config.startDate as any) || new Date();
        const baseline = sortedAsc.find(w => {
            const t = tsToDate(w.createdAt);
            return t ? t.getTime() >= join.getTime() : false;
        }) || sortedAsc[0];
        const latest = sortedAsc[sortedAsc.length - 1];
        if (!baseline || !latest || baseline.weight <= 0) continue;

        const weightPct = ((baseline.weight - latest.weight) / baseline.weight) * 100;
        const kg = baseline.weight - latest.weight;

        // Body-fat delta — absolute percentage-point drop (e.g. 28.0% → 24.5% = 3.5)
        const baseFat = Number((baseline as any).bodyFat) || 0;
        const latestFat = Number((latest as any).bodyFat) || 0;
        const bodyFatDelta = (baseFat > 0 && latestFat > 0) ? +(baseFat - latestFat).toFixed(2) : 0;

        const score = metric === "bodyFat" ? bodyFatDelta : weightPct;
        entries.push({
            memberId: p.id,
            name: p.name || "—",
            photo: p.photoUrl || p.photo || "",
            gender: (p.btcGender || (p.gender || "unknown")) as any,
            pctLoss: +score.toFixed(2),
            kgLoss: +kg.toFixed(1),
            bodyFatPctLoss: bodyFatDelta,
            rejected: false,
            atRisk: risk.atRisk, riskReason: risk.reason,
        });
    }
    // Sort alternating: 1M, 1F, 2M, 2F, …
    const live = entries.filter(e => !e.rejected).sort((a, b) => b.pctLoss - a.pctLoss);
    const males = live.filter(e => e.gender === "male");
    const females = live.filter(e => e.gender === "female");
    const others = live.filter(e => e.gender !== "male" && e.gender !== "female");
    const merged: LeaderboardEntry[] = [];
    const max = Math.max(males.length, females.length);
    for (let i = 0; i < max; i++) {
        if (males[i]) merged.push(males[i]);
        if (females[i]) merged.push(females[i]);
    }
    merged.push(...others);
    // Append rejected at the end
    merged.push(...entries.filter(e => e.rejected));
    return merged;
}

// ─── Hook: compose leaderboard from participants + their weigh-ins ──────
// Returns BOTH leaderboards in one call so the UI can show them side-by-
// side without firing two duplicate queries. `weight` ranks by % weight
// lost; `bodyFat` ranks by absolute body-fat % drop (this is the winner
// who gets the prize pot per the agreement).
export function useBTCLeaderboard(clubId: string | null) {
    const { config, loading: configLoading } = useBTCConfig(clubId);
    const { participants, loading: participantsLoading } = useBTCParticipants(clubId);
    const [weighInsByMember, setWeighInsByMember] = useState<Record<string, WeighIn[]>>({});
    const [weighInsLoading, setWeighInsLoading] = useState(true);

    useEffect(() => {
        // Wait until participants list itself has resolved — otherwise we
        // flip loading=false too early (during the first render where
        // participants is still []) and the UI shows "no participants" while
        // the data is actually still streaming in.
        if (participantsLoading) { setWeighInsLoading(true); return; }
        if (!clubId || participants.length === 0) {
            setWeighInsByMember({});
            setWeighInsLoading(false);
            return;
        }
        let cancelled = false;
        setWeighInsLoading(true);
        (async () => {
            // Fetch all participants in parallel — was sequential, which
            // made N participants take N round-trips. With the persistent
            // cache enabled, repeat opens hit local data and resolve in <100ms.
            const results = await Promise.all(
                participants.map(async (p) => {
                    try {
                        const snap = await getDocs(collection(db, `clubs/${clubId}/members/${p.id}/weighIns`));
                        return [p.id, snap.docs.map(d => ({ id: d.id, ...d.data() }) as WeighIn)] as const;
                    } catch {
                        return [p.id, [] as WeighIn[]] as const;
                    }
                }),
            );
            if (!cancelled) {
                const out: Record<string, WeighIn[]> = {};
                for (const [id, list] of results) out[id] = list;
                setWeighInsByMember(out);
                setWeighInsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [clubId, participants, participantsLoading]);

    // Aggregate loading: still loading until config, participants, AND
    // their weigh-ins have all resolved. Prevents "no participants" flash.
    const loading = configLoading || participantsLoading || weighInsLoading;

    const leaderboard = useMemo(
        () => buildLeaderboard(participants, weighInsByMember, config, "weight"),
        [participants, weighInsByMember, config],
    );
    const leaderboardBodyFat = useMemo(
        () => buildLeaderboard(participants, weighInsByMember, config, "bodyFat"),
        [participants, weighInsByMember, config],
    );
    return { leaderboard, leaderboardBodyFat, loading, config, weighInsByMember };
}

// ─── Meals for a single member ─────────────────────────────────────────
export function useMemberMeals(clubId: string | null, memberId: string | null, max = 30) {
    const [meals, setMeals] = useState<BTCMeal[]>([]);
    useEffect(() => {
        if (!clubId || !memberId) { setMeals([]); return; }
        const q = query(
            collection(db, `clubs/${clubId}/btcMeals`),
            where("memberId", "==", memberId),
            orderBy("uploadedAt", "desc"),
            limit(max),
        );
        const u = onSnapshot(q, snap => setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BTCMeal)));
        return () => u();
    }, [clubId, memberId, max]);
    return meals;
}

// ─── Daily meal slot status ─────────────────────────────────────────────
// Per the BTC agreement, each day requires three time-bound uploads:
//   morning  → Morning Shake
//   afternoon → Afternoon Sensible Meal (NOT a shake)
//   evening  → Evening Shake
// We map the existing `mealType` enum (which is broader) onto these slots
// so the participant grid can render "3/3 done · 0 rejected" per day.
export type BTCSlot = "morning" | "afternoon" | "evening";

export function mealTypeToSlot(mealType: string): BTCSlot | null {
    switch (mealType) {
        case "shake":            return "morning";    // first shake of the day
        case "breakfast":        return "morning";
        case "lunch":            return "afternoon";
        case "refreshment":      return "evening";    // evening shake/refresh
        case "dinner":           return "evening";
        case "snack":            return null;          // not part of the 3-slot rule
        case "other":            return null;
        default:                 return null;
    }
}

export interface MealSlotStatus {
    slot: BTCSlot;
    meal: BTCMeal | null;
    status: "pending" | "approved" | "rejected" | "missing";
}

export interface DailyMealSummary {
    date: string;                  // YYYY-MM-DD
    slots: Record<BTCSlot, MealSlotStatus>;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    isComplete: boolean;           // all three slots approved
}

const ymdLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

export function summarizeMealsByDay(meals: BTCMeal[]): Record<string, DailyMealSummary> {
    const byDate: Record<string, DailyMealSummary> = {};
    for (const m of meals) {
        const slot = mealTypeToSlot(m.mealType);
        if (!slot) continue;
        const d = tsToDate(m.uploadedAt);
        if (!d) continue;
        const key = ymdLocal(d);
        if (!byDate[key]) {
            byDate[key] = {
                date: key,
                slots: {
                    morning:   { slot: "morning",   meal: null, status: "missing" },
                    afternoon: { slot: "afternoon", meal: null, status: "missing" },
                    evening:   { slot: "evening",   meal: null, status: "missing" },
                },
                approvedCount: 0, pendingCount: 0, rejectedCount: 0,
                isComplete: false,
            };
        }
        const entry = byDate[key];
        // If the slot already has a meal, prefer the approved one (the rule
        // requires one valid photo per slot; coordinator rejections shouldn't
        // overwrite an approval).
        const existing = entry.slots[slot].meal;
        if (!existing || (existing.status !== "approved" && m.status === "approved")) {
            entry.slots[slot] = { slot, meal: m, status: m.status as any };
        }
    }
    // Roll up counts + completeness
    for (const day of Object.values(byDate)) {
        day.approvedCount = 0;
        day.pendingCount = 0;
        day.rejectedCount = 0;
        for (const s of Object.values(day.slots)) {
            if (s.status === "approved") day.approvedCount++;
            else if (s.status === "pending") day.pendingCount++;
            else if (s.status === "rejected") day.rejectedCount++;
        }
        day.isComplete = day.approvedCount === 3;
    }
    return byDate;
}

// ─── Pending meals (coordinator inbox) ─────────────────────────────────
export function usePendingMeals(clubId: string | null) {
    const [meals, setMeals] = useState<BTCMeal[]>([]);
    useEffect(() => {
        if (!clubId) { setMeals([]); return; }
        const q = query(
            collection(db, `clubs/${clubId}/btcMeals`),
            where("status", "==", "pending"),
            orderBy("uploadedAt", "desc"),
        );
        const u = onSnapshot(q, snap => setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BTCMeal)));
        return () => u();
    }, [clubId]);
    return meals;
}
