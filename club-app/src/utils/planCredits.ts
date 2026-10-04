/**
 * Single source of truth for how many shake credits a membership plan grants,
 * and how a renewal/purchase combines with a member's existing balance.
 *
 * Every place that sells or renews a plan (Reception buy-plan, face enrollment,
 * Add-Shake-Credits modal, owner manual entry, Magician, member self-renew)
 * MUST use these helpers so the behaviour is identical everywhere.
 *
 * Credits per plan:  totalVisits → visits → durationDays (a "25-day plan" with
 * no explicit credit count grants 25 credits). Falsy/zero fields fall through.
 *
 * New balance:  ALWAYS net-added to the current balance, including negatives.
 *   -3 existing + 25 plan  = 22
 *    5 existing + 25 plan  = 30
 *    0 existing + 25 plan  = 25
 */
export function planCreditsOf(plan: any): number {
    if (!plan) return 0;
    // Some memberships are access-only and must grant NO shake credits.
    // Until this flag there was no way to say "zero": a plan with 0 credits
    // fell through to durationDays, so a 30-day access plan quietly handed out
    // 30 shakes. Setting `grantsCredits: false` on the plan stops the fall-through.
    if (plan.grantsCredits === false) return 0;
    return Number(plan.totalVisits) || Number(plan.visits) || Number(plan.durationDays) || 0;
}

/**
 * Is this plan *meant* to grant no credits, as opposed to being misconfigured?
 * Sellers use this to tell "access-only plan, sell it" apart from "somebody
 * forgot to fill in the credit count, stop and ask".
 */
export function planGrantsNoCredits(plan: any): boolean {
    return !!plan && plan.grantsCredits === false;
}

/**
 * Where the credit number came from.
 *
 * This matters because every screen used to *display* credits as
 * `visits ?? totalVisits ?? 0` while the sale *granted* `planCreditsOf`, which
 * falls back to `durationDays`. A plan with no credit count set therefore
 * showed "0 credits" in the picker and then handed over one credit per day of
 * its duration. That is the "credits get added randomly and do not match the
 * record" complaint: the screen and the sale were reading different rules.
 *
 * Displays now call `planCreditsOf` like the sale does, and use this to warn
 * when the number is inferred rather than configured — so the club can go and
 * set it properly instead of the guess being invisible.
 */
export function planCreditsSource(plan: any): "explicit" | "duration" | "none" {
    if (!plan) return "none";
    if (plan.grantsCredits === false) return "none";
    if (Number(plan.totalVisits) || Number(plan.visits)) return "explicit";
    if (Number(plan.durationDays)) return "duration";
    return "none";
}

/** One label for what a plan grants, used everywhere a plan is shown. */
export function planCreditsLabel(plan: any): string {
    const n = planCreditsOf(plan);
    const src = planCreditsSource(plan);
    if (src === "none") return "No shake credits";
    const base = `${n} credit${n === 1 ? "" : "s"}`;
    return src === "duration" ? `${base} (from duration — set this in Admin → Memberships)` : base;
}

/** Net-add plan credits to an existing (possibly negative) balance. */
export function newCreditBalance(currentCredits: any, plan: any): number {
    return (Number(currentCredits) || 0) + planCreditsOf(plan);
}
