/**
 * Lucky Dip renewal nudge.
 *
 * Lucky Dip eligibility is earned by renewing a plan while still holding
 * ≥1 shake credit. A member who lets their credits hit 0 BEFORE renewing
 * loses that eligibility. So Reception wants to spot members whose remaining
 * credits are running low and nudge them to renew NOW, while they still
 * qualify for the pool.
 *
 * `shakeCredits` is a REMAINING balance that counts DOWN as shakes are
 * served, so "credits left" doubles as the urgency: 1 left = renew today.
 */

export const LUCKY_DIP_LOW_THRESHOLD = 3; // surface members with 1..3 credits left

export interface LuckyDipNudge {
    creditsLeft: number;
    state: "last" | "urgent" | "soon";
    label: string;       // "Last shake!" | "2 left" | "3 left"
    color: string;       // badge foreground
    bg: string;          // badge background
    border: string;
}

/**
 * Returns a renewal nudge for a member's remaining credits, or null when
 * there's nothing to nudge (already at 0 — too late to keep eligibility —
 * or comfortably above the threshold).
 */
export function luckyDipNudge(
    credits: number | null | undefined,
    threshold: number = LUCKY_DIP_LOW_THRESHOLD,
): LuckyDipNudge | null {
    const c = Math.floor(Number(credits) || 0);
    if (c <= 0 || c > threshold) return null;
    if (c === 1) return { creditsLeft: 1, state: "last", label: "Last shake!", color: "#b91c1c", bg: "#fee2e2", border: "#fecaca" };
    if (c === 2) return { creditsLeft: 2, state: "urgent", label: "2 left", color: "#c2410c", bg: "#ffedd5", border: "#fed7aa" };
    return { creditsLeft: c, state: "soon", label: `${c} left`, color: "#b45309", bg: "#fef3c7", border: "#fde68a" };
}

export interface LowCreditMember<T = any> {
    member: T;
    nudge: LuckyDipNudge;
}

/**
 * All members running low on credits (1..threshold left), most urgent first.
 * Reads `shakeCredits` off each member object — no Firestore reads.
 */
export function lowCreditMembers<T extends { shakeCredits?: number }>(
    members: T[],
    threshold: number = LUCKY_DIP_LOW_THRESHOLD,
): LowCreditMember<T>[] {
    const out: LowCreditMember<T>[] = [];
    for (const m of members) {
        const nudge = luckyDipNudge(m.shakeCredits, threshold);
        if (nudge) out.push({ member: m, nudge });
    }
    out.sort((a, b) => a.nudge.creditsLeft - b.nudge.creditsLeft);
    return out;
}
