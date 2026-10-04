/**
 * Selling a membership plan — one pipe.
 *
 * A renewal has to do four things together: take the money, add the credits,
 * move the expiry, and leave a record on the member. Doing them separately is
 * how the app ended up with members holding credits and an expired plan, or
 * cash in the drawer that no report ever saw.
 *
 * One batch, so a failure leaves nothing half-done. Credits are read live from
 * Firestore rather than from anything held on screen — reading them from a
 * cached copy is how a shake ordered mid-flow got silently overwritten.
 */

import { collection, doc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { planCreditsOf } from "@/utils/planCredits";
import { membershipUpdate } from "@/lib/membership";
import { addPaymentToBatch, type PayMethod, type UpiAccountRef } from "@/lib/recordPayment";

export interface SellPlanInput {
    clubId: string;
    member: { id: string; name?: string; memberId?: string };
    plan: { id: string; name?: string; price?: number; visits?: number; totalVisits?: number; durationDays?: number };
    method: PayMethod;
    cashAmount?: number;
    upiAmount?: number;
    upiAccount?: UpiAccountRef | null;
    /** Who took the money, for the record. */
    verifiedBy?: string;
}

export interface SellPlanResult {
    creditsBefore: number;
    creditsAfter: number;
    creditsAdded: number;
    amount: number;
}

export async function sellPlan(input: SellPlanInput): Promise<SellPlanResult> {
    const { clubId, member, plan } = input;
    const amount = Number(plan.price) || 0;
    const creditsAdded = planCreditsOf(plan as any);

    const memberRef = doc(db, "clubs", clubId, "members", member.id);
    return runTransaction(db, async transaction => {
        const snap = await transaction.get(memberRef);
        const data = snap.data() as { shakeCredits?: unknown; membershipEndDate?: unknown; membershipEnd?: unknown } | undefined;
        const creditsBefore = Number(data?.shakeCredits) || 0;
        const creditsAfter = creditsBefore + creditsAdded;
        transaction.update(memberRef, {
            status: "active", isActiveMember: true, isPermanent: true,
            shakeCredits: creditsAfter, shakeCreditsPlanTotal: creditsAfter,
            ...membershipUpdate(plan, data?.membershipEndDate as Timestamp | Date | string | null ?? data?.membershipEnd as Timestamp | Date | string | null),
            updatedAt: serverTimestamp(),
        });
        const label = `${plan.name || "Plan"} (${input.method})${input.verifiedBy ? ` — taken by ${input.verifiedBy}` : ""}`;
        transaction.set(doc(collection(db, "clubs", clubId, "members", member.id, "transactions")), {
            type: "credit", amount, reason: "plan_purchase", description: label,
            planId: plan.id, planName: plan.name ?? "", paymentMethod: input.method,
            creditsAdded, creditsBeforeRenewal: creditsBefore,
            ...(input.verifiedBy ? { approvedBy: input.verifiedBy } : {}), createdAt: serverTimestamp(),
        });
        addPaymentToBatch(transaction, {
            clubId, type: "plan_purchase", amount, method: input.method,
            cashAmount: input.cashAmount, upiAmount: input.upiAmount,
            upiAccount: input.upiAccount ?? null, memberId: member.id,
            memberName: member.name ?? "", humanMemberId: member.memberId ?? "",
            creditsAdded, planId: plan.id, planName: plan.name ?? "",
            description: label, source: "reception",
        });
        return { creditsBefore, creditsAfter, creditsAdded, amount };
    });
}
