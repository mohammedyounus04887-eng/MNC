/**
 * Membership dates — one calculation, both field names.
 *
 * The app grew two names for the same thing on the member doc:
 *
 *   membershipEndDate — written by Add Credits, the voice assistant and
 *                       backdated corrections; read by the reception member
 *                       panel.
 *   membershipEnd     — written by member-app purchase requests and the admin
 *                       member editor; read by the admin member list and the
 *                       referral cards.
 *
 * So a renewal made through one path was invisible to screens reading the
 * other, and a member with a paid, active plan could sit in the admin list
 * marked Expired. Worse, the main Reception renewal wrote NO dates at all — it
 * set credits and status and stopped — so renewing at the desk left the expiry
 * blank or stale while the same plan bought via Add Credits worked correctly.
 *
 * `membershipUpdate()` returns both names from a single calculation. Writers
 * use it and every reader is satisfied; the duplicate can be retired later
 * without a migration.
 */

import { Timestamp } from "firebase/firestore";

/** Anything that has a duration. Plans disagree on the field name too. */
export interface PlanLike {
    id?: string;
    name?: string;
    durationDays?: number | string | null;
    days?: number | string | null;
}

export function planDurationDays(plan: PlanLike | null | undefined, fallback = 30): number {
    const n = Number(plan?.durationDays ?? plan?.days);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const toDate = (v: any): Date | null => {
    if (!v) return null;
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        return isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
};

/**
 * When a renewal should end.
 *
 * Extends from the current expiry when it is still in the future, so renewing
 * early adds to the remaining days instead of throwing them away. Otherwise it
 * runs from today.
 */
export function computeMembershipEnd(
    durationDays: number,
    currentEnd?: Timestamp | Date | string | null,
    from: Date = new Date(),
): { start: Date; end: Date } {
    const existing = toDate(currentEnd);
    const start = existing && existing.getTime() > from.getTime() ? existing : from;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + durationDays);
    return { start: from, end };
}

/**
 * The membership fields to merge into a member doc on renewal.
 * Writes BOTH expiry field names so no reader misses the renewal.
 */
export function membershipUpdate(
    plan: PlanLike | null | undefined,
    currentEnd?: Timestamp | Date | string | null,
    from: Date = new Date(),
): Record<string, any> {
    const { start, end } = computeMembershipEnd(planDurationDays(plan), currentEnd, from);
    const endTs = Timestamp.fromDate(end);
    return {
        ...(plan?.id ? { membershipPlanId: plan.id } : {}),
        ...(plan?.name ? { membershipPlanName: plan.name } : {}),
        membershipStartDate: Timestamp.fromDate(start),
        // Both names, one value — see the note at the top of this file.
        membershipEndDate: endTs,
        membershipEnd: endTs,
    };
}
