/**
 * BTC Challenges v2 — simplified, baseline-aware.
 *
 * Each challenge lives at `clubs/{clubId}/btcChallenges/{challengeId}` with
 * three subcollections: participants / weighIns / meals. There is no
 * start-date / end-date / weeks config — the volunteer schedules each
 * weigh-in session manually, and members upload meal photos whenever.
 *
 * Baseline-aware loss calculation:
 *   - "new" participants: baseline = their first recorded weigh-in
 *   - "old" participants: baseline is set manually at enrolment (their
 *     prior best weight before any in-between weight gain)
 *   - Counted loss = baseline − latest weight. If latest > baseline, the
 *     loss is negative (shown in red); the leaderboard still ranks them
 *     but their pct loss is negative.
 *   - Once the challenge closes, the participant's *new best* (their
 *     lowest weigh-in in this challenge) becomes the baseline for any
 *     future challenge (handled at challenge-close time, not here).
 */

import { useEffect, useMemo, useState } from "react";
import {
    addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDocs, onSnapshot,
    orderBy, query, serverTimestamp, setDoc, updateDoc, where,
    Timestamp, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
    BtcChallenge, BtcChallengeMeal, BtcChallengeParticipant,
    BtcChallengeWeighIn, BtcMealCoachComment, BtcWeighInSession,
} from "@/types/firestore";
export type { BtcChallenge } from "@/types/firestore";

// ─── helpers ──────────────────────────────────────────────────────────
export const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

export const ymdLocal = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const challengesCol = (clubId: string) => collection(db, `clubs/${clubId}/btcChallenges`);
const challengeDoc = (clubId: string, id: string) => doc(db, `clubs/${clubId}/btcChallenges/${id}`);
const participantsCol = (clubId: string, cid: string) => collection(db, `clubs/${clubId}/btcChallenges/${cid}/participants`);
const participantDoc = (clubId: string, cid: string, memberId: string) => doc(db, `clubs/${clubId}/btcChallenges/${cid}/participants/${memberId}`);
const weighInsCol = (clubId: string, cid: string) => collection(db, `clubs/${clubId}/btcChallenges/${cid}/weighIns`);
const weighInDoc = (clubId: string, cid: string, memberId: string, sessionIndex: number) =>
    doc(db, `clubs/${clubId}/btcChallenges/${cid}/weighIns/${memberId}_${sessionIndex}`);
const mealsCol = (clubId: string, cid: string) => collection(db, `clubs/${clubId}/btcChallenges/${cid}/meals`);
const mealDoc = (clubId: string, cid: string, memberId: string, date: string, slot: string) =>
    doc(db, `clubs/${clubId}/btcChallenges/${cid}/meals/${memberId}_${date}_${slot}`);

// ─── list all challenges (newest first) ─────────────────────────────
export function useBtcChallenges(clubId: string | null) {
    const [challenges, setChallenges] = useState<BtcChallenge[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setChallenges([]); setLoading(false); return; }
        const q = query(challengesCol(clubId), orderBy("createdAt", "desc"));
        const u = onSnapshot(q, snap => {
            setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallenge));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId]);
    return { challenges, loading };
}

// ─── one challenge ────────────────────────────────────────────────────
export function useBtcChallenge(clubId: string | null, challengeId: string | null) {
    const [challenge, setChallenge] = useState<BtcChallenge | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId) { setChallenge(null); setLoading(false); return; }
        const u = onSnapshot(challengeDoc(clubId, challengeId), snap => {
            setChallenge(snap.exists() ? ({ id: snap.id, ...snap.data() } as BtcChallenge) : null);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId]);
    return { challenge, loading };
}

// ─── active challenge (most recent isActive=true) ──────────────────
export function useActiveBtcChallenge(clubId: string | null) {
    const [active, setActive] = useState<BtcChallenge | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setActive(null); setLoading(false); return; }
        const q = query(challengesCol(clubId), where("isActive", "==", true));
        const u = onSnapshot(q, snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallenge);
            rows.sort((a, b) => (tsToDate(b.createdAt)?.getTime() ?? 0) - (tsToDate(a.createdAt)?.getTime() ?? 0));
            setActive(rows[0] || null);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId]);
    return { challenge: active, loading };
}

// ─── participants in a challenge ───────────────────────────────────────
export function useBtcChallengeParticipants(clubId: string | null, challengeId: string | null) {
    const [participants, setParticipants] = useState<BtcChallengeParticipant[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId) { setParticipants([]); setLoading(false); return; }
        const u = onSnapshot(participantsCol(clubId, challengeId), snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeParticipant);
            rows.sort((a, b) => (a.memberName || "").localeCompare(b.memberName || ""));
            setParticipants(rows);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId]);
    return { participants, loading };
}

// ─── one participant (for member view) ────────────────────────────────
export function useMyChallengeParticipant(clubId: string | null, challengeId: string | null, memberId: string | null) {
    const [participant, setParticipant] = useState<BtcChallengeParticipant | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId || !memberId) { setParticipant(null); setLoading(false); return; }
        const u = onSnapshot(participantDoc(clubId, challengeId, memberId), snap => {
            setParticipant(snap.exists() ? ({ id: snap.id, ...snap.data() } as BtcChallengeParticipant) : null);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId, memberId]);
    return { participant, loading };
}

// ─── find the active challenge a member belongs to ────────────────────
// Live-streams the active challenge and the participant doc inside it so
// the member view reflects volunteer changes instantly.
export function useMyActiveBtcChallenge(clubId: string | null, memberId: string | null) {
    const { challenge, loading: challengeLoading } = useActiveBtcChallenge(clubId);
    const challengeId = challenge?.id || null;
    const { participant, loading: participantLoading } = useMyChallengeParticipant(clubId, challengeId, memberId);
    const isParticipant = !!participant;
    return {
        challenge: isParticipant ? challenge : null,
        participant,
        isParticipant,
        loading: challengeLoading || (challengeId ? participantLoading : false),
    };
}

// ─── weigh-ins for a challenge ────────────────────────────────────────
export function useBtcChallengeWeighIns(clubId: string | null, challengeId: string | null) {
    const [weighIns, setWeighIns] = useState<BtcChallengeWeighIn[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId) { setWeighIns([]); setLoading(false); return; }
        const u = onSnapshot(weighInsCol(clubId, challengeId), snap => {
            setWeighIns(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeWeighIn));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId]);
    return { weighIns, loading };
}

// ─── meals for a challenge ────────────────────────────────────────────
export function useBtcChallengeMeals(clubId: string | null, challengeId: string | null) {
    const [meals, setMeals] = useState<BtcChallengeMeal[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId) { setMeals([]); setLoading(false); return; }
        const u = onSnapshot(mealsCol(clubId, challengeId), snap => {
            setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeMeal));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId]);
    return { meals, loading };
}

// ─── mutations ────────────────────────────────────────────────────────
export async function createBtcChallenge(clubId: string, data: {
    name: string;
    instructions: string;
    weighInSessions: BtcWeighInSession[];
    activate?: boolean;
}): Promise<string> {
    if (data.activate) {
        // Mark all existing challenges inactive in one batch so there's
        // only ever one active challenge per club.
        const snap = await getDocs(query(challengesCol(clubId), where("isActive", "==", true)));
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.update(d.ref, { isActive: false }));
        await batch.commit();
    }
    const ref = await addDoc(challengesCol(clubId), {
        name: data.name.trim(),
        instructions: data.instructions || "",
        weighInSessions: data.weighInSessions || [],
        isActive: !!data.activate,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

export async function updateBtcChallenge(clubId: string, challengeId: string, patch: Partial<BtcChallenge>) {
    await updateDoc(challengeDoc(clubId, challengeId), patch as any);
}

export async function setBtcChallengeActive(clubId: string, challengeId: string, active: boolean) {
    if (active) {
        const snap = await getDocs(query(challengesCol(clubId), where("isActive", "==", true)));
        const batch = writeBatch(db);
        snap.docs.forEach(d => { if (d.id !== challengeId) batch.update(d.ref, { isActive: false }); });
        batch.update(challengeDoc(clubId, challengeId), { isActive: true });
        await batch.commit();
    } else {
        await updateDoc(challengeDoc(clubId, challengeId), { isActive: false, archivedAt: serverTimestamp() });
        // Archiving = challenge over. Wipe any remaining (rejected) meal
        // photos so they don't sit in storage forever.
        try { await cleanupChallengeMealPhotos(clubId, challengeId); } catch (e) { console.warn("[btc cleanup]", e); }
    }
}

export async function deleteBtcChallenge(clubId: string, challengeId: string) {
    // Delete storage photos first so we don't orphan storage objects.
    try { await cleanupChallengeMealPhotos(clubId, challengeId); } catch (e) { console.warn("[btc cleanup]", e); }

    // Best-effort cascade — for a fresh-start product the subcollections
    // are usually small. Loop in batches.
    const subs = ["participants", "weighIns", "meals"];
    for (const sub of subs) {
        const snap = await getDocs(collection(db, `clubs/${clubId}/btcChallenges/${challengeId}/${sub}`));
        if (snap.empty) continue;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    await deleteDoc(challengeDoc(clubId, challengeId));
}

export interface AddParticipantInput {
    memberId: string;
    memberName: string;
    memberPhone: string;
    memberPhoto: string;
    participantType: "new" | "old";
    gender?: "male" | "female" | null;
    baselineWeight: number;        // 0 if "new" — set automatically from first weigh-in
    baselineBodyFat?: number | null;
    paid?: boolean;
}

export async function addBtcParticipant(clubId: string, challengeId: string, input: AddParticipantInput) {
    await setDoc(participantDoc(clubId, challengeId, input.memberId), {
        memberId: input.memberId,
        memberName: input.memberName,
        memberPhone: input.memberPhone || "",
        memberPhoto: input.memberPhoto || "",
        participantType: input.participantType,
        gender: input.gender ?? null,
        baselineWeight: input.participantType === "new" ? 0 : (input.baselineWeight || 0),
        baselineBodyFat: input.baselineBodyFat ?? null,
        paid: !!input.paid,
        disqualified: false,
        disqualifiedReason: "",
        disqualifiedAt: null,
        disqualifiedBy: "",
        enrolledAt: serverTimestamp(),
    });
}

export async function updateBtcParticipant(clubId: string, challengeId: string, memberId: string, patch: Partial<BtcChallengeParticipant>) {
    await updateDoc(participantDoc(clubId, challengeId, memberId), patch as any);
}

/**
 * Mark a participant as disqualified with a mandatory reason. The participant
 * can still upload meals and have weigh-ins recorded; they are simply moved
 * into the "Disqualified" section of the leaderboard and excluded from the
 * main ranking.
 */
export async function disqualifyBtcParticipant(
    clubId: string, challengeId: string, memberId: string,
    reason: string, by: string,
) {
    const trimmed = (reason || "").trim();
    if (!trimmed) throw new Error("A reason is required to disqualify a participant.");
    await updateDoc(participantDoc(clubId, challengeId, memberId), {
        disqualified: true,
        disqualifiedReason: trimmed,
        disqualifiedAt: serverTimestamp(),
        disqualifiedBy: by || "",
    } as any);
}

export async function reinstateBtcParticipant(clubId: string, challengeId: string, memberId: string) {
    await updateDoc(participantDoc(clubId, challengeId, memberId), {
        disqualified: false,
        disqualifiedReason: "",
        disqualifiedAt: null,
        disqualifiedBy: "",
    } as any);
}

export async function removeBtcParticipant(clubId: string, challengeId: string, memberId: string) {
    // Storage photos go first so we don't orphan them when the docs vanish.
    try {
        await deleteMealPhotosForQuery(
            query(mealsCol(clubId, challengeId), where("memberId", "==", memberId)),
        );
    } catch (e) { console.warn("[btc cleanup]", e); }

    // Wipe their weigh-ins and meals first so the leaderboard recomputes cleanly.
    const wis = await getDocs(query(weighInsCol(clubId, challengeId), where("memberId", "==", memberId)));
    const meals = await getDocs(query(mealsCol(clubId, challengeId), where("memberId", "==", memberId)));
    const batch = writeBatch(db);
    wis.docs.forEach(d => batch.delete(d.ref));
    meals.docs.forEach(d => batch.delete(d.ref));
    batch.delete(participantDoc(clubId, challengeId, memberId));
    await batch.commit();
}

export interface BtcWeighInInput {
    weight: number;
    bodyFat?: number | null;
    bmi?: number | null;
    muscleMass?: number | null;
    skeletalMuscle?: number | null;
    bmr?: number | null;
    visceralFat?: number | null;
    waterPct?: number | null;
    proteinPct?: number | null;
    boneMass?: number | null;
    metabolicAge?: number | null;
    leanBodyMass?: number | null;
    fatFreeBodyWeight?: number | null;
    subcutaneousFat?: number | null;
    bodyAge?: number | null;
    calories?: number | null;
    height?: number | null;
    recordedAtTime?: string;
    autoFilledFromAttendance?: boolean;
    notes?: string;
}

const num = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

export async function saveBtcWeighIn(
    clubId: string, challengeId: string, memberId: string, sessionIndex: number,
    data: BtcWeighInInput,
) {
    await setDoc(weighInDoc(clubId, challengeId, memberId, sessionIndex), {
        memberId,
        sessionIndex,
        weight: data.weight,
        bodyFat: num(data.bodyFat),
        bmi: num(data.bmi),
        muscleMass: num(data.muscleMass),
        skeletalMuscle: num(data.skeletalMuscle),
        bmr: num(data.bmr),
        visceralFat: num(data.visceralFat),
        waterPct: num(data.waterPct),
        proteinPct: num(data.proteinPct),
        boneMass: num(data.boneMass),
        metabolicAge: num(data.metabolicAge),
        leanBodyMass: num(data.leanBodyMass),
        fatFreeBodyWeight: num(data.fatFreeBodyWeight),
        subcutaneousFat: num(data.subcutaneousFat),
        bodyAge: num(data.bodyAge),
        calories: num(data.calories),
        height: num(data.height),
        notes: data.notes || "",
        recordedAtTime: data.recordedAtTime || "",
        autoFilledFromAttendance: !!data.autoFilledFromAttendance,
        recordedAt: serverTimestamp(),
    }, { merge: true });

    // For "new" participants whose baseline is still 0, the first weigh-in
    // sets the baseline so all subsequent loss calculations have an anchor.
    const pSnap = await getDocs(query(participantsCol(clubId, challengeId), where("memberId", "==", memberId)));
    const p = pSnap.docs[0];
    if (p) {
        const pdata = p.data() as BtcChallengeParticipant;
        if (pdata.participantType === "new" && (!pdata.baselineWeight || pdata.baselineWeight <= 0)) {
            await updateDoc(p.ref, {
                baselineWeight: data.weight,
                baselineBodyFat: num(data.bodyFat),
            });
        }
    }
}

// ─── Reception attendance lookup ────────────────────────────────────
// Returns the member's check-in time for a specific date (YYYY-MM-DD).
// Used to auto-fill the weigh-in arrival time without manual entry.
export async function fetchMemberCheckInTime(
    clubId: string, memberId: string, date: string,
): Promise<{ time: string; timestamp: Date } | null> {
    if (!clubId || !memberId || !date) return null;
    try {
        const snap = await getDocs(query(
            collection(db, `clubs/${clubId}/members/${memberId}/attendance`),
            where("date", "==", date),
        ));
        if (snap.empty) return null;
        // Earliest check-in wins (member may have multiple punches in a day).
        let earliest: Date | null = null;
        for (const d of snap.docs) {
            const t = tsToDate((d.data() as any).checkInTime);
            if (t && (!earliest || t < earliest)) earliest = t;
        }
        if (!earliest) return null;
        const hh = String(earliest.getHours()).padStart(2, "0");
        const mm = String(earliest.getMinutes()).padStart(2, "0");
        return { time: `${hh}:${mm}`, timestamp: earliest };
    } catch {
        return null;
    }
}

export async function deleteBtcWeighIn(clubId: string, challengeId: string, memberId: string, sessionIndex: number) {
    await deleteDoc(weighInDoc(clubId, challengeId, memberId, sessionIndex));
}

/**
 * Compress an image client-side before uploading. Resizes to fit inside
 * `maxDim` pixels (longest edge) and re-encodes to JPEG at `quality`.
 * Returns a Blob ready to upload. If the input isn't an image or anything
 * fails we fall back to the original File untouched.
 *
 * Cuts upload size by 5-10× for typical phone photos, which is the single
 * biggest factor in how slow the upload feels on a member's data plan.
 */
async function compressImage(file: File, maxDim = 1280, quality = 0.82): Promise<Blob> {
    if (!file.type.startsWith("image/")) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * ratio));
        const h = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob: Blob | null = await new Promise(resolve =>
            canvas.toBlob(b => resolve(b), "image/jpeg", quality),
        );
        // If compression somehow produces something bigger than the original,
        // keep the original.
        if (!blob || blob.size >= file.size) return file;
        return blob;
    } catch {
        return file;
    }
}

export async function uploadBtcMeal(
    clubId: string, challengeId: string,
    member: { id: string; name: string },
    date: string, slot: "breakfast" | "lunch" | "dinner",
    file: File,
): Promise<string> {
    const { ref, uploadBytes, getDownloadURL, deleteObject } = await import("firebase/storage");
    const { storage } = await import("@/lib/firebase");
    const compressed = await compressImage(file);
    const ext = compressed.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg");
    const path = `btc/${clubId}/${challengeId}/${member.id}/${date}_${slot}_${Date.now()}.${ext}`;
    const r = ref(storage, path);
    await uploadBytes(r, compressed, { contentType: compressed.type || file.type || "image/jpeg" });
    const url = await getDownloadURL(r);

    // If a prior pending/rejected photo exists for this same slot, delete it
    // from storage to avoid orphaned files when the member re-uploads.
    const existingSnap = await getDocs(query(
        mealsCol(clubId, challengeId),
        where("memberId", "==", member.id),
        where("date", "==", date),
        where("slot", "==", slot),
    ));
    for (const d of existingSnap.docs) {
        const prev = d.data() as any;
        if (prev.storagePath && prev.storagePath !== path) {
            try { await deleteObject(ref(storage, prev.storagePath)); } catch { /* ignore */ }
        }
    }

    await setDoc(mealDoc(clubId, challengeId, member.id, date, slot), {
        memberId: member.id,
        memberName: member.name,
        date,
        slot,
        photoUrl: url,
        storagePath: path,
        photoDeleted: false,
        status: "pending",
        rejectionReason: "",
        uploadedAt: serverTimestamp(),
    }, { merge: true });
    return url;
}

export async function reviewBtcMeal(
    clubId: string, challengeId: string, mealId: string,
    decision: "approved" | "rejected", reviewedBy: string, rejectionReason?: string,
) {
    const ref0 = doc(db, `clubs/${clubId}/btcChallenges/${challengeId}/meals/${mealId}`);

    // Both approved and rejected meals keep their photo until the challenge is
    // archived. The end-of-challenge sweep (cleanupChallengeMealPhotos, fired
    // on archive/delete) wipes every photo in one go.
    if (decision === "approved") {
        await updateDoc(ref0, {
            status: "approved",
            reviewedBy,
            reviewedAt: serverTimestamp(),
            rejectionReason: "",
        });
        return;
    }

    // Rejection MUST have a reason — caller validates, but enforce here too.
    const reason = (rejectionReason || "").trim();
    if (!reason) {
        throw new Error("A reason is required to reject a meal.");
    }
    await updateDoc(ref0, {
        status: "rejected",
        reviewedBy,
        reviewedAt: serverTimestamp(),
        rejectionReason: reason,
    });
}

// ─── photo cleanup ─────────────────────────────────────────────────
// Best-effort: delete every storage object referenced by a challenge's
// meals. Called when the challenge is archived/deleted or a participant
// is removed.
async function deleteMealPhotosForQuery(metaQ: ReturnType<typeof query>) {
    const { deleteObject, ref: storageRef } = await import("firebase/storage");
    const { storage } = await import("@/lib/firebase");
    const snap = await getDocs(metaQ);
    const updates: Promise<unknown>[] = [];
    for (const d of snap.docs) {
        const data = d.data() as any;
        if (data.storagePath) {
            updates.push(
                deleteObject(storageRef(storage, data.storagePath))
                    .catch(() => undefined),
            );
            updates.push(updateDoc(d.ref, {
                storagePath: "",
                photoUrl: "",
                photoDeleted: true,
            }));
        }
    }
    await Promise.all(updates);
}

export async function cleanupChallengeMealPhotos(clubId: string, challengeId: string) {
    await deleteMealPhotosForQuery(query(mealsCol(clubId, challengeId)));
}

// ─── baseline-aware calculation ────────────────────────────────────
export interface BtcMemberStats {
    memberId: string;
    baselineWeight: number;
    baselineBodyFat: number | null;
    week1Weight: number | null;        // first recorded weigh-in (sessionIndex 0)
    week1BodyFat: number | null;
    latestWeight: number | null;
    latestBodyFat: number | null;
    latestSessionIndex: number | null;
    // From baseline (the "counted" loss — used for ranking)
    kgLossFromBaseline: number | null;     // baseline - latest (positive = loss)
    pctLossFromBaseline: number | null;
    fatLossFromBaseline: number | null;    // percentage-point drop
    // From week-1 (challenge-only progress, may be larger if regained then lost)
    kgLossFromWeek1: number | null;
    pctLossFromWeek1: number | null;
    fatLossFromWeek1: number | null;
    // Weekly weigh-in rows keyed by sessionIndex
    weighInsBySession: Record<number, BtcChallengeWeighIn>;
}

export function computeMemberStats(
    participant: BtcChallengeParticipant,
    weighIns: BtcChallengeWeighIn[],
): BtcMemberStats {
    const sorted = [...weighIns].sort((a, b) => a.sessionIndex - b.sessionIndex);
    const week1 = sorted[0] || null;
    const latest = sorted[sorted.length - 1] || null;
    const bySession: Record<number, BtcChallengeWeighIn> = {};
    for (const w of sorted) bySession[w.sessionIndex] = w;

    const baseline = participant.baselineWeight || 0;
    const baselineFat = participant.baselineBodyFat ?? null;

    const kgFromBaseline = (baseline > 0 && latest) ? +(baseline - latest.weight).toFixed(1) : null;
    const pctFromBaseline = (baseline > 0 && latest) ? +(((baseline - latest.weight) / baseline) * 100).toFixed(2) : null;
    const fatFromBaseline = (baselineFat != null && latest?.bodyFat != null) ? +(baselineFat - latest.bodyFat).toFixed(2) : null;

    const w1w = week1?.weight || 0;
    const kgFromWeek1 = (w1w > 0 && latest && week1) ? +(w1w - latest.weight).toFixed(1) : null;
    const pctFromWeek1 = (w1w > 0 && latest && week1) ? +(((w1w - latest.weight) / w1w) * 100).toFixed(2) : null;
    const w1f = week1?.bodyFat ?? null;
    const fatFromWeek1 = (w1f != null && latest?.bodyFat != null) ? +(w1f - latest.bodyFat).toFixed(2) : null;

    return {
        memberId: participant.memberId,
        baselineWeight: baseline,
        baselineBodyFat: baselineFat,
        week1Weight: week1?.weight ?? null,
        week1BodyFat: week1?.bodyFat ?? null,
        latestWeight: latest?.weight ?? null,
        latestBodyFat: latest?.bodyFat ?? null,
        latestSessionIndex: latest?.sessionIndex ?? null,
        kgLossFromBaseline: kgFromBaseline,
        pctLossFromBaseline: pctFromBaseline,
        fatLossFromBaseline: fatFromBaseline,
        kgLossFromWeek1: kgFromWeek1,
        pctLossFromWeek1: pctFromWeek1,
        fatLossFromWeek1: fatFromWeek1,
        weighInsBySession: bySession,
    };
}

// ─── discipline metrics (meals + attendance) ────────────────────────
export interface BtcDisciplineStats {
    mealsUploaded: number;
    mealsApproved: number;
    mealsRejected: number;
    mealsPending: number;
    approvalPct: number | null;     // approved / reviewed (excludes pending)
    rejectionPct: number | null;
    // Weekly metric deltas (counted from baseline)
    weightLossPct: number | null;   // (baseline - latest) / baseline * 100
    fatLossPct: number | null;      // body-fat pp drop / baseline fat * 100
    muscleGainPct: number | null;   // muscle change vs first recorded
    skeletalMuscleGainPct: number | null;
    // Attendance: weigh-ins recorded / sessions due (past+today only)
    sessionsAttended: number;
    sessionsDue: number;
    attendancePct: number | null;
}

export function computeDisciplineStats(
    participant: BtcChallengeParticipant,
    weighIns: BtcChallengeWeighIn[],
    meals: BtcChallengeMeal[],
    sessions: import("@/types/firestore").BtcWeighInSession[],
): BtcDisciplineStats {
    // Meals
    const myMeals = meals.filter(m => m.memberId === participant.memberId);
    const approved = myMeals.filter(m => m.status === "approved").length;
    const rejected = myMeals.filter(m => m.status === "rejected").length;
    const pending = myMeals.filter(m => m.status === "pending").length;
    const reviewed = approved + rejected;
    const approvalPct = reviewed > 0 ? +((approved / reviewed) * 100).toFixed(1) : null;
    const rejectionPct = reviewed > 0 ? +((rejected / reviewed) * 100).toFixed(1) : null;

    // Body-comp deltas from baseline (and first recorded muscle for muscle gain)
    const stats = computeMemberStats(participant, weighIns);
    const baselineFat = participant.baselineBodyFat ?? null;
    const fatLossPct = (baselineFat && baselineFat > 0 && stats.latestBodyFat != null)
        ? +(((baselineFat - stats.latestBodyFat) / baselineFat) * 100).toFixed(2)
        : null;

    const sortedAsc = [...weighIns].filter(w => w.memberId === participant.memberId).sort((a, b) => a.sessionIndex - b.sessionIndex);
    const firstMuscle = sortedAsc.find(w => w.muscleMass != null)?.muscleMass ?? null;
    const latestMuscle = [...sortedAsc].reverse().find(w => w.muscleMass != null)?.muscleMass ?? null;
    const muscleGainPct = (firstMuscle && firstMuscle > 0 && latestMuscle != null)
        ? +(((latestMuscle - firstMuscle) / firstMuscle) * 100).toFixed(2)
        : null;
    const firstSkel = sortedAsc.find(w => w.skeletalMuscle != null)?.skeletalMuscle ?? null;
    const latestSkel = [...sortedAsc].reverse().find(w => w.skeletalMuscle != null)?.skeletalMuscle ?? null;
    const skeletalMuscleGainPct = (firstSkel && firstSkel > 0 && latestSkel != null)
        ? +(((latestSkel - firstSkel) / firstSkel) * 100).toFixed(2)
        : null;

    // Attendance — only sessions on/before today are "due"
    const today = ymdLocal(new Date());
    const dueSessions = sessions.filter(s => s.date && s.date <= today);
    const attendedIdx = new Set(sortedAsc.map(w => w.sessionIndex));
    const sessionsAttended = dueSessions.filter(s => attendedIdx.has(s.index)).length;
    const sessionsDue = dueSessions.length;
    const attendancePct = sessionsDue > 0 ? +((sessionsAttended / sessionsDue) * 100).toFixed(1) : null;

    return {
        mealsUploaded: myMeals.length,
        mealsApproved: approved,
        mealsRejected: rejected,
        mealsPending: pending,
        approvalPct,
        rejectionPct,
        weightLossPct: stats.pctLossFromBaseline,
        fatLossPct,
        muscleGainPct,
        skeletalMuscleGainPct,
        sessionsAttended,
        sessionsDue,
        attendancePct,
    };
}

// ─── leaderboard (admin / coordinator only) ────────────────────────
export interface BtcLeaderboardRow extends BtcMemberStats {
    memberName: string;
    memberPhoto: string;
    memberPhone: string;
    participantType: "new" | "old";
    gender: "male" | "female" | null;
    paid: boolean;
    disqualified: boolean;
    disqualifiedReason: string;
    // muscle gain (from first recorded muscleMass to latest)
    muscleGainKg: number | null;
    muscleGainPct: number | null;
}

export type BtcMetric = "weight" | "bodyFat" | "muscle";

function computeMuscleGain(weighIns: BtcChallengeWeighIn[]): { kg: number | null; pct: number | null } {
    const sorted = [...weighIns].sort((a, b) => a.sessionIndex - b.sessionIndex);
    const first = sorted.find(w => w.muscleMass != null)?.muscleMass ?? null;
    const latest = [...sorted].reverse().find(w => w.muscleMass != null)?.muscleMass ?? null;
    if (first == null || latest == null || first <= 0) return { kg: null, pct: null };
    return {
        kg: +(latest - first).toFixed(2),
        pct: +(((latest - first) / first) * 100).toFixed(2),
    };
}

export function buildBtcLeaderboard(
    participants: BtcChallengeParticipant[],
    weighIns: BtcChallengeWeighIn[],
    metric: BtcMetric = "weight",
): BtcLeaderboardRow[] {
    const byMember: Record<string, BtcChallengeWeighIn[]> = {};
    for (const w of weighIns) {
        (byMember[w.memberId] ||= []).push(w);
    }
    const rows: BtcLeaderboardRow[] = participants.map(p => {
        const wis = byMember[p.memberId] || [];
        const stats = computeMemberStats(p, wis);
        const muscle = computeMuscleGain(wis);
        return {
            ...stats,
            memberName: p.memberName,
            memberPhoto: p.memberPhoto,
            memberPhone: p.memberPhone || "",
            participantType: p.participantType,
            gender: (p.gender as any) ?? null,
            paid: !!p.paid,
            disqualified: !!p.disqualified,
            disqualifiedReason: p.disqualifiedReason || "",
            muscleGainKg: muscle.kg,
            muscleGainPct: muscle.pct,
        };
    });
    rows.sort((a, b) => {
        let av: number, bv: number;
        if (metric === "bodyFat") {
            // Body-fat percentage-point drop is already comparable across people.
            av = a.fatLossFromBaseline ?? -Infinity;
            bv = b.fatLossFromBaseline ?? -Infinity;
        } else if (metric === "muscle") {
            // Higher muscle gain % = better.
            av = a.muscleGainPct ?? -Infinity;
            bv = b.muscleGainPct ?? -Infinity;
        } else {
            // % weight loss (positive = lost more)
            av = a.pctLossFromBaseline ?? -Infinity;
            bv = b.pctLossFromBaseline ?? -Infinity;
        }
        return bv - av;
    });
    return rows;
}

// ─── hook: full leaderboard data in one call ────────────────────────
export function useBtcLeaderboard(clubId: string | null, challengeId: string | null) {
    const { participants, loading: pl } = useBtcChallengeParticipants(clubId, challengeId);
    const { weighIns, loading: wl } = useBtcChallengeWeighIns(clubId, challengeId);
    const weight = useMemo(() => buildBtcLeaderboard(participants, weighIns, "weight"), [participants, weighIns]);
    const bodyFat = useMemo(() => buildBtcLeaderboard(participants, weighIns, "bodyFat"), [participants, weighIns]);
    const muscle = useMemo(() => buildBtcLeaderboard(participants, weighIns, "muscle"), [participants, weighIns]);
    return { weight, bodyFat, muscle, loading: pl || wl, participants, weighIns };
}

// ─── default session helper ────────────────────────────────────────
export function defaultWeighInSessions(startDate?: Date, count = 5): BtcWeighInSession[] {
    const base = startDate || new Date();
    const out: BtcWeighInSession[] = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i * 7);
        out.push({ index: i, date: ymdLocal(d), time: "07:00", notes: "" });
    }
    return out;
}

// ─── club members search (for add-by-phone) ────────────────────────
export interface MemberLite {
    id: string;
    name: string;
    phone: string;
    photo: string;
    hasPriorBtc: boolean;          // true if any prior btcChallenges contained them
}

export async function searchClubMembers(clubId: string, term: string): Promise<MemberLite[]> {
    if (!term || term.trim().length < 2) return [];
    const t = term.trim().toLowerCase();
    const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const hits = all.filter(m =>
        (m.name || "").toLowerCase().includes(t) ||
        (m.phone || "").includes(t.replace(/\s+/g, "")),
    ).slice(0, 25);
    // Best-effort prior-BTC detection: check the first 3 challenges only,
    // to avoid an N×N read storm. Owner can still override the toggle.
    const challSnap = await getDocs(query(challengesCol(clubId), orderBy("createdAt", "desc")));
    const recentChalls = challSnap.docs.slice(0, 5);
    const priorIds = new Set<string>();
    for (const ch of recentChalls) {
        const ps = await getDocs(participantsCol(clubId, ch.id));
        ps.docs.forEach(d => priorIds.add(d.id));
    }
    return hits.map(m => ({
        id: m.id,
        name: m.name || "(unnamed)",
        phone: m.phone || "",
        photo: m.photoUrl || m.photo || "",
        hasPriorBtc: priorIds.has(m.id),
    }));
}

export async function getMemberByPhone(clubId: string, phone: string): Promise<MemberLite | null> {
    const clean = (phone || "").replace(/\s+/g, "");
    if (!clean) return null;
    const snap = await getDocs(query(collection(db, `clubs/${clubId}/members`), where("phone", "==", clean)));
    const m = snap.docs[0];
    if (!m) return null;
    const data = m.data() as any;
    return {
        id: m.id,
        name: data.name || "(unnamed)",
        phone: data.phone || "",
        photo: data.photoUrl || data.photo || "",
        hasPriorBtc: false,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// ─── BTC COACH ROLE & ASSIGNMENT ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
//
// A coach is a club member with `isBTCCoach: true` on their member doc.
// Coaches are assigned to specific participants per-challenge via the
// `coachId` field on the participant doc. A coach can:
//   - see meal photos of customers assigned to them (only)
//   - leave comments on those photos (subcollection `coachComments`)
//   - NOT approve / reject meals (owner + coordinator only)
//   - NOT see weigh-ins, attendance, leaderboard, or other participants
//
// All hooks below filter by clubId so a coach in one club never sees data
// from another club.

const memberDoc = (clubId: string, memberId: string) =>
    doc(db, `clubs/${clubId}/members/${memberId}`);
const coachCommentsCol = (clubId: string, challengeId: string, mealId: string) =>
    collection(db, `clubs/${clubId}/btcChallenges/${challengeId}/meals/${mealId}/coachComments`);

// ─── Coach lite shape (used by Coaches tab + assignment modal) ─────
export interface BtcCoachLite {
    id: string;
    name: string;
    phone: string;
    photo: string;
    btcCoachSince?: Date | null;
}

/**
 * Promote / demote a member as a BTC coach. Idempotent — flipping the flag
 * off does NOT clear existing assignments (so an accidental toggle doesn't
 * orphan all their customers). Use `removeBtcCoach` for the full teardown.
 */
export async function setMemberIsBtcCoach(
    clubId: string, memberId: string, isCoach: boolean,
) {
    const patch: any = { isBTCCoach: isCoach };
    if (isCoach) patch.btcCoachSince = serverTimestamp();
    await updateDoc(memberDoc(clubId, memberId), patch);
}

/**
 * Full teardown of a coach: clears the `isBTCCoach` flag AND unassigns
 * every participant currently pointing to them in the given challenge.
 * Pass `challengeId=null` to only flip the role flag without touching any
 * assignments (e.g. if you're cleaning up an archived challenge already).
 */
export async function removeBtcCoach(
    clubId: string, coachMemberId: string, challengeId: string | null,
) {
    if (challengeId) {
        // Pull this coach off every participant they coach — both the new
        // `coachIds` array and any legacy `coachId` scalar. Two queries are
        // merged by doc id (a participant might match either field).
        const [byArray, byLegacy] = await Promise.all([
            getDocs(query(participantsCol(clubId, challengeId), where("coachIds", "array-contains", coachMemberId))),
            getDocs(query(participantsCol(clubId, challengeId), where("coachId", "==", coachMemberId))),
        ]);
        const refs = new Map<string, any>();
        [...byArray.docs, ...byLegacy.docs].forEach(d => refs.set(d.id, d));
        if (refs.size) {
            const batch = writeBatch(db);
            refs.forEach(d => {
                const patch: any = { coachIds: arrayRemove(coachMemberId) };
                // Clear the legacy single-coach fields if they point here.
                if ((d.data() as any).coachId === coachMemberId) {
                    patch.coachId = null;
                    patch.coachName = "";
                    patch.coachAssignedAt = null;
                }
                batch.update(d.ref, patch);
            });
            await batch.commit();
        }
    }
    await updateDoc(memberDoc(clubId, coachMemberId), {
        isBTCCoach: false,
    });
}

/**
 * Live list of BTC coaches in a club.
 *
 * Uses a `where("isBTCCoach", "==", true)` query so a club with thousands
 * of members doesn't pull every doc. Sorting happens client-side because
 * the dataset is tiny (coaches are typically a handful).
 */
export function useBtcCoaches(clubId: string | null) {
    const [coaches, setCoaches] = useState<BtcCoachLite[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setCoaches([]); setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/members`),
            where("isBTCCoach", "==", true),
        );
        const u = onSnapshot(q, snap => {
            const rows: BtcCoachLite[] = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    name: data.name || "(unnamed)",
                    phone: data.phone || "",
                    photo: data.photoUrl || data.photo || "",
                    btcCoachSince: tsToDate(data.btcCoachSince),
                };
            });
            rows.sort((a, b) => a.name.localeCompare(b.name));
            setCoaches(rows);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId]);
    return { coaches, loading };
}

/**
 * The coaches assigned to a participant. `coachIds` is authoritative; the
 * legacy single `coachId` is folded in so pre-migration docs still resolve.
 */
export function coachIdsOf(p: { coachIds?: string[] | null; coachId?: string | null }): string[] {
    if (Array.isArray(p.coachIds) && p.coachIds.length) return p.coachIds;
    return p.coachId ? [p.coachId] : [];
}

/**
 * Add a coach to a participant (many-to-many). Idempotent via arrayUnion —
 * a participant can have any number of coaches.
 */
export async function addCoachToParticipant(
    clubId: string, challengeId: string, memberId: string, coachId: string,
) {
    await updateDoc(participantDoc(clubId, challengeId, memberId), {
        coachIds: arrayUnion(coachId),
        coachAssignedAt: serverTimestamp(),
    } as any);
}

/** Remove one coach from a participant (leaves any other coaches intact). */
export async function removeCoachFromParticipant(
    clubId: string, challengeId: string, memberId: string, coachId: string,
) {
    const patch: any = { coachIds: arrayRemove(coachId) };
    // If the legacy single-coach field points at this coach, clear it too.
    patch.coachId = null;
    patch.coachName = "";
    await updateDoc(participantDoc(clubId, challengeId, memberId), patch);
}

/**
 * Bulk-add a coach to many participants in one batch (arrayUnion, so it adds
 * the coach without removing any coach already assigned). Used by the
 * "Manage customers" modal.
 */
export async function bulkAssignCoach(
    clubId: string, challengeId: string,
    memberIds: string[], coach: { id: string; name: string },
) {
    if (!memberIds.length) return;
    const batch = writeBatch(db);
    memberIds.forEach(mid => batch.update(
        participantDoc(clubId, challengeId, mid),
        { coachIds: arrayUnion(coach.id), coachAssignedAt: serverTimestamp() } as any,
    ));
    await batch.commit();
}

/** Bulk-remove a coach from many participants (arrayRemove). */
export async function bulkRemoveCoach(
    clubId: string, challengeId: string,
    memberIds: string[], coachId: string,
) {
    if (!memberIds.length) return;
    const batch = writeBatch(db);
    memberIds.forEach(mid => batch.update(
        participantDoc(clubId, challengeId, mid),
        { coachIds: arrayRemove(coachId), coachId: null, coachName: "" } as any,
    ));
    await batch.commit();
}

/**
 * One-time migration: copy legacy single `coachId` into the `coachIds` array
 * for any participant that has a coach but no array yet. Safe to call on every
 * Coaches-tab load — it only writes docs that actually need it, and no-ops
 * once everything is migrated.
 */
export async function migrateParticipantCoachIds(
    clubId: string, challengeId: string, participants: BtcChallengeParticipant[],
) {
    const need = participants.filter(p => p.coachId && !(Array.isArray(p.coachIds) && p.coachIds.length));
    if (!need.length) return;
    const batch = writeBatch(db);
    need.forEach(p => batch.update(
        participantDoc(clubId, challengeId, p.memberId),
        { coachIds: arrayUnion(p.coachId) } as any,
    ));
    await batch.commit();
}

/**
 * Live list of customers assigned to a coach in a given challenge.
 *
 * Returns participant docs where `coachIds` contains `coachMemberId` (a
 * participant can have several coaches). Empty array if `coachMemberId` is
 * null/empty — useful when the same BtcMemberView is rendered for a non-coach
 * (no extra query fired).
 */
export function useCoachAssignedCustomers(
    clubId: string | null, challengeId: string | null, coachMemberId: string | null,
) {
    const [customers, setCustomers] = useState<BtcChallengeParticipant[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId || !coachMemberId) {
            setCustomers([]); setLoading(false); return;
        }
        const col = participantsCol(clubId, challengeId);
        // Merge the new `coachIds` array query with the legacy `coachId`
        // scalar query, so assignments made before the migration still show
        // for the coach (deduped by participant id).
        let fromArray: BtcChallengeParticipant[] = [];
        let fromLegacy: BtcChallengeParticipant[] = [];
        const publish = () => {
            const byId = new Map<string, BtcChallengeParticipant>();
            for (const p of [...fromArray, ...fromLegacy]) byId.set(p.id, p);
            const rows = Array.from(byId.values());
            rows.sort((a, b) => (a.memberName || "").localeCompare(b.memberName || ""));
            setCustomers(rows);
            setLoading(false);
        };
        const u1 = onSnapshot(
            query(col, where("coachIds", "array-contains", coachMemberId)),
            snap => { fromArray = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeParticipant); publish(); },
            () => setLoading(false),
        );
        const u2 = onSnapshot(
            query(col, where("coachId", "==", coachMemberId)),
            snap => { fromLegacy = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeParticipant); publish(); },
            () => setLoading(false),
        );
        return () => { u1(); u2(); };
    }, [clubId, challengeId, coachMemberId]);
    return { customers, loading };
}

/**
 * Live meal photos for a single customer in a single challenge.
 * Used inside the coach's "drill into one customer" view. Sorted newest
 * date first, then breakfast → lunch → dinner per day.
 */
const SLOT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 };

export function useCustomerMeals(
    clubId: string | null, challengeId: string | null, customerMemberId: string | null,
) {
    const [meals, setMeals] = useState<BtcChallengeMeal[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId || !customerMemberId) {
            setMeals([]); setLoading(false); return;
        }
        const q = query(
            mealsCol(clubId, challengeId),
            where("memberId", "==", customerMemberId),
        );
        const u = onSnapshot(q, snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcChallengeMeal);
            rows.sort((a, b) => {
                if (a.date !== b.date) return a.date < b.date ? 1 : -1;     // newest day first
                return (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9);
            });
            setMeals(rows);
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId, customerMemberId]);
    return { meals, loading };
}

/**
 * Add a comment from the coach onto a meal photo. Does NOT change the
 * meal status (approval/rejection stays with owner + coordinator).
 *
 * The `coachId` written here must equal the signed-in user's uid — Firestore
 * rules enforce this so a coach can't impersonate another coach.
 */
export async function addCoachComment(
    clubId: string, challengeId: string, mealId: string,
    coach: { id: string; name: string }, text: string,
) {
    const trimmed = (text || "").trim();
    if (!trimmed) throw new Error("Comment cannot be empty.");
    if (!coach?.id) throw new Error("Coach id is required.");
    await addDoc(coachCommentsCol(clubId, challengeId, mealId), {
        coachId: coach.id,
        coachName: coach.name || "",
        text: trimmed,
        createdAt: serverTimestamp(),
    });
}

/**
 * Live comments on a single meal photo, oldest first. Empty array until
 * Firestore returns the first snapshot. Returns `null` for `mealId` is
 * common (e.g. the user hasn't expanded a photo yet) so we short-circuit.
 */
export function useMealCoachComments(
    clubId: string | null, challengeId: string | null, mealId: string | null,
) {
    const [comments, setComments] = useState<BtcMealCoachComment[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId || !challengeId || !mealId) {
            setComments([]); setLoading(false); return;
        }
        const q = query(
            coachCommentsCol(clubId, challengeId, mealId),
            orderBy("createdAt", "asc"),
        );
        const u = onSnapshot(q, snap => {
            setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BtcMealCoachComment));
            setLoading(false);
        }, () => setLoading(false));
        return () => u();
    }, [clubId, challengeId, mealId]);
    return { comments, loading };
}

/**
 * Delete a comment. Allowed for the comment's author (Firestore rules
 * enforce that too) or any owner. Used for typo fixes / moderation.
 */
export async function deleteCoachComment(
    clubId: string, challengeId: string, mealId: string, commentId: string,
) {
    await deleteDoc(doc(
        db,
        `clubs/${clubId}/btcChallenges/${challengeId}/meals/${mealId}/coachComments/${commentId}`,
    ));
}
