/**
 * Hand-awarded loyalty points — one writer.
 *
 * Six of the eleven loyalty rules describe things the app has no record of:
 * a Life Style Day, a home visit, a PPV. Those are awarded here, by a person,
 * and stored as their own documents rather than as a running total on the
 * member. A total can only be wrong; a list of awards can be read back, argued
 * with and corrected — which matters when the prize is a product.
 *
 *   clubs/{clubId}/loyaltyAwards/{awardId}
 *
 * Removing an award soft-deletes it, like every other reversal in this app, so
 * "who took those points off and when" is still answerable afterwards.
 */

import {
    addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp,
    updateDoc, where, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";
import { LOYALTY_RULES_BY_ID } from "@/lib/loyaltyProgram";

export interface LoyaltyAward {
    id: string;
    clubId: string;
    memberId: string;
    memberName: string;
    /** Which of the eleven rules this is. See LOYALTY_RULES. */
    ruleId: string;
    ruleLabel: string;
    points: number;
    note?: string;
    /** Club day the activity happened on — LOCAL YYYY-MM-DD, never UTC. */
    date: string;
    awardedBy?: string;
    deleted?: boolean;
    deletedAt?: Timestamp | null;
    createdAt?: Timestamp;
}

export interface AwardPointsInput {
    clubId: string;
    memberId: string;
    memberName: string;
    ruleId: string;
    /** Only needed for PPV, where the rule carries no fixed value. */
    points?: number;
    note?: string;
    /** Defaults to today. Pass a date to record something from last week. */
    date?: string;
    awardedBy?: string;
}

const awardsCol = (clubId: string) => collection(db, "clubs", clubId, "loyaltyAwards");

/** Award points to one member. Returns the new document id. */
export async function awardLoyaltyPoints(input: AwardPointsInput): Promise<string> {
    const rule = LOYALTY_RULES_BY_ID[input.ruleId];
    if (!rule) throw new Error(`Unknown loyalty rule: ${input.ruleId}`);

    // The rule's own value wins where it has one, so a typo in the form cannot
    // quietly hand somebody 100 points for a health talk. PPV is the exception:
    // its points are the PPV, which only the person awarding it knows.
    const points = rule.points ?? Math.round(Number(input.points) || 0);
    if (!Number.isFinite(points) || points === 0) {
        throw new Error("Enter the points to award.");
    }
    // An adjustment exists to take points off as well as put them on; nothing
    // else may be negative, or a mistyped minus becomes a punishment.
    if (points < 0 && rule.id !== "adjustment") {
        throw new Error(`${rule.label} cannot be negative — use a manual adjustment.`);
    }

    const ref = await addDoc(awardsCol(input.clubId), {
        clubId: input.clubId,
        memberId: input.memberId,
        memberName: input.memberName || "",
        ruleId: rule.id,
        ruleLabel: rule.label,
        points,
        note: input.note || "",
        date: input.date || todayLocal(),
        awardedBy: input.awardedBy || "admin",
        deleted: false,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

/** Take an award back. Soft — the record stays, the points stop counting. */
export async function removeLoyaltyAward(clubId: string, awardId: string): Promise<void> {
    await updateDoc(doc(db, "clubs", clubId, "loyaltyAwards", awardId), {
        deleted: true,
        deletedAt: serverTimestamp(),
    });
}

/**
 * Every live award in a date range.
 *
 * Soft-deleted ones are filtered here rather than in the query, because
 * `deleted != true` would exclude the older documents that have no such field
 * at all — the same trap that made guest deletions look like they did nothing.
 */
export async function fetchLoyaltyAwards(
    clubId: string,
    from: string,
    to: string,
): Promise<LoyaltyAward[]> {
    const snap = await getDocs(query(
        awardsCol(clubId),
        where("date", ">=", from),
        where("date", "<=", to),
        orderBy("date", "desc"),
    ));
    return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<LoyaltyAward, "id">) }))
        .filter((a) => !a.deleted);
}
