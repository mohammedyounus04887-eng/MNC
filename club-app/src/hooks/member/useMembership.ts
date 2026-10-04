import { toDateSafe } from "@/lib/toDateSafe";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
    collection, doc, getDocs, updateDoc, addDoc,
    query, Timestamp, serverTimestamp, increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useMyMemberId } from "@/lib/memberKey";
import { useClubContext } from "@/lib/clubDetection";
import type { MembershipPlan } from "@/types/firestore";
import { logInvoice } from "@/utils/invoice";
import { planCreditsOf } from "@/utils/planCredits";

// Fallback plans if the club has no sub-collection
const ts0 = null as any;
const FALLBACK_PLANS: MembershipPlan[] = [
    // Universal Membership
    { id: "universal-1day", name: "1 Shake Credit", durationDays: 1, visits: 1, price: 240, category: "Universal Membership", benefits: ["1 shake credit"], color: "#2d9653", isActive: true, clubId: "", createdAt: ts0 },
    { id: "universal-5visits", name: "5 Shake Credits", durationDays: 30, visits: 5, price: 1150, perShakePrice: 230, category: "Universal Membership", benefits: ["5 shake credits", "₹230 per shake"], color: "#3b82f6", isActive: true, clubId: "", createdAt: ts0 },
    { id: "universal-15visits", name: "15 Shake Credits", durationDays: 90, visits: 15, price: 3500, perShakePrice: 233, category: "Universal Membership", benefits: ["15 shake credits", "₹233 per shake"], color: "#8b5cf6", isActive: true, clubId: "", createdAt: ts0 },
    { id: "universal-25visits", name: "25 Shake Credits", durationDays: 150, visits: 25, price: 5250, perShakePrice: 210, category: "Universal Membership", benefits: ["25 shake credits", "₹210 per shake"], color: "#f59e0b", isActive: true, clubId: "", createdAt: ts0 },
    // Digestive Health
    { id: "digestive-5visits", name: "5 Shake Credits", durationDays: 30, visits: 5, price: 1150, category: "Digestive Health", benefits: ["5 shake credits", "Digestive health program"], color: "#06b6d4", isActive: true, clubId: "", createdAt: ts0 },
    { id: "digestive-15visits", name: "15 Shake Credits", durationDays: 90, visits: 15, price: 3500, category: "Digestive Health", benefits: ["15 shake credits", "Digestive health program"], color: "#14b8a6", isActive: true, clubId: "", createdAt: ts0 },
    { id: "digestive-25visits", name: "25 Shake Credits", durationDays: 150, visits: 25, price: 5250, category: "Digestive Health", benefits: ["25 shake credits", "Digestive health program"], color: "#10b981", isActive: true, clubId: "", createdAt: ts0 },
];


// ─── useClubMembershipPlans ───────────────────────────────────────────────────

export function useClubMembershipPlans(clubId: string | null) {
    const [plans, setPlans] = useState<MembershipPlan[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setLoading(false); return; }
        const fetch = async () => {
            try {
                const snap = await getDocs(query(collection(db, "clubs", clubId, "memberships")));
                if (snap.empty) {
                    setPlans(FALLBACK_PLANS);
                } else {
                    const active = snap.docs
                        .map(d => ({ id: d.id, ...d.data() } as MembershipPlan))
                        .filter(p => p.isActive !== false)
                        .sort((a, b) => a.price - b.price);
                    setPlans(active.length ? active : FALLBACK_PLANS);
                }
            } catch {
                setPlans(FALLBACK_PLANS);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [clubId]);

    return { plans, loading };
}

// ─── useRenewMembership ───────────────────────────────────────────────────────

export function useRenewMembership() {
    const { userProfile } = useAuth();
    // Every write below addresses clubs/{club}/members/{id}. That id is the
    // member DOCUMENT id; the auth uid only matches it for members who signed
    // themselves up, so renewing from the app used to throw "No document to
    // update" for everyone the club had created. See lib/memberKey.
    const memberKey = useMyMemberId();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (data: {
            plan: MembershipPlan;
            walletDocId: string;
            currentBalance: number;
            currentMembershipEnd: Timestamp | null;
        }) => {
            if (!memberKey || !userProfile || !club) throw new Error("Not ready");
            const { plan, walletDocId, currentBalance, currentMembershipEnd } = data;

            if (currentBalance < plan.price) {
                throw new Error(`Insufficient balance. You need ₹${plan.price - currentBalance} more.`);
            }

            const newBalance = currentBalance - plan.price;

            // Membership date calculation
            const now = new Date();
            let startDate: Date;
            // Through toDateSafe: the expiry is the field this app has two names
            // and several writers for (see lib/membership), so it is exactly the
            // one most likely to hold something that is not a Timestamp. Calling
            // .toDate() on it directly turned a renewal into a crash.
            const end = toDateSafe(currentMembershipEnd);
            if (end) {
                // Extend from current expiry if still active, else from today
                startDate = end > now ? end : now;
            } else {
                startDate = now;
            }
            const endDate = new Date(startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

            const nowTs = Timestamp.now();

            // 1. Deduct wallet
            await updateDoc(doc(db, `clubs/${club.id}/members/${memberKey}/wallet`, "data"), {
                balance: newBalance,
                lastUpdated: serverTimestamp(),
            });

            // 2. Update member profile — credit denominator is CAPPED at the
            // new total. We don't accumulate "lifetime granted" anymore;
            // shakeCreditsPlanTotal = (current credits) + (new plan visits),
            // so the on-screen ratio reads "X/Y" where Y matches each new
            // plan rather than growing forever.
            const planVisits = planCreditsOf(plan);
            const currentCredits = Number((userProfile as any)?.shakeCredits) || 0;
            const newPlanTotal = currentCredits + planVisits;
            await updateDoc(doc(db, `clubs/${club.id}/members`, memberKey), {
                shakeCredits: newPlanTotal,
                shakeCreditsPlanTotal: newPlanTotal,
                // The renewal window was calculated above and then written only
                // into the transaction record — never onto the member. A member
                // renewing from the app came away with credits and an unchanged
                // expiry, so they read as "15 credits" and "Expired" at the same
                // time. Both expiry field names, since the app reads both.
                status: "active",
                isActiveMember: true,
                membershipPlanId: plan.id,
                membershipPlanName: plan.name,
                membershipStartDate: Timestamp.fromDate(startDate),
                membershipEndDate: Timestamp.fromDate(endDate),
                membershipEnd: Timestamp.fromDate(endDate),
                updatedAt: Timestamp.now(),
            });

            // 3. Write transaction
            await addDoc(collection(db, `clubs/${club.id}/members/${memberKey}/transactions`), {
                userId: memberKey,
                clubId: club.id,
                type: "debit",
                amount: plan.price,
                reason: "membership",
                description: `${plan.name} Membership Renewal`,
                planName: plan.name,
                membershipFrom: Timestamp.fromDate(startDate),
                membershipTo: Timestamp.fromDate(endDate),
                note: `${plan.name} — ${plan.durationDays} days`,
                addedBy: "member",
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                createdAt: nowTs,
            });

            // 4. Write invoice
            await logInvoice(club.id, memberKey, {
                type: "membership_renewal",
                title: `${plan.name} Membership Renewal`,
                items: [{
                    description: `${plan.name} — ${plan.durationDays} days${plan.visits || plan.totalVisits ? ` · ${plan.visits || plan.totalVisits} shake credits` : ""}`,
                    qty: 1,
                    rate: plan.price,
                    amount: plan.price,
                }],
                paymentMethod: "wallet",
                notes: `Valid: ${startDate.toLocaleDateString()} – ${endDate.toLocaleDateString()}`,
            });

            return { newBalance, startDate, endDate, plan };
        },
    });
}
