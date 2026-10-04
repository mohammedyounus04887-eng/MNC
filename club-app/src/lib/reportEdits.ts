/**
 * Per-date report corrections — write REAL backdated entries so the daily /
 * monthly reports, revenue, and member history all update (not just displayed
 * numbers). Used by the Edit button on the Reports monthly breakdown.
 *
 * Each entry appends to the same collections the reports read by `date`:
 *   - Shake     → a served order (+ a payment if it was paid)
 *   - Membership→ a plan_purchase payment + a member transaction record
 *   - Product   → a productSale (+ a payment)
 *
 * SAFETY: the membership correction does NOT mutate the member's live
 * shakeCredits / membershipEndDate. Back-dating those can wrongly expire an
 * active member or double-grant credits; the correction records the money +
 * history. (A "also grant credits" option can be added if needed.)
 */

import { collection, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { planCreditsOf } from "@/utils/planCredits";

export type PayMethod = "cash" | "upi";

function methodFields(amount: number, method: PayMethod) {
    return {
        paymentMethod: method,
        cashAmount: method === "cash" ? amount : 0,
        upiAmount: method === "upi" ? amount : 0,
    };
}

export interface EditMemberLite { id: string; name: string }

/** Add a backdated served shake order (+ payment if amount > 0). */
export async function addBackdatedShake(
    clubId: string, date: string, member: EditMemberLite,
    flavor: string, qty: number, amount: number, method: PayMethod,
) {
    if (!flavor.trim()) throw new Error("Pick a shake.");
    if (qty <= 0) throw new Error("Quantity must be at least 1.");
    const batch = writeBatch(db);
    const unit = qty > 0 ? amount / qty : 0;

    const orderRef = doc(collection(db, `clubs/${clubId}/orders`));
    batch.set(orderRef, {
        memberId: member.id, memberName: member.name,
        items: [{ productName: flavor.trim(), itemName: flavor.trim(), quantity: qty, pricePerUnit: unit, price: unit }],
        status: "served",
        date,
        totalAmount: amount,
        source: "manual_correction",
        manualCorrection: true,
        createdAt: serverTimestamp(),
        servedAt: serverTimestamp(),
    });

    if (amount > 0) {
        const payRef = doc(collection(db, `clubs/${clubId}/payments`));
        batch.set(payRef, {
            type: "oneday_shake",
            memberId: member.id, memberName: member.name,
            amount,
            ...methodFields(amount, method),
            description: `Correction: ${qty} × ${flavor.trim()} for ${member.name}`,
            date,
            manualCorrection: true,
            createdAt: serverTimestamp(),
        });
    }
    await batch.commit();
}

/**
 * Add a backdated membership purchase (payment + member transaction).
 * When `grantCredits` is true it ALSO updates the member's live record:
 * carries credits forward (+plan visits) and extends the expiry — but NEVER
 * shortens an already-later expiry (so an active member can't be wrongly
 * expired by a back-dated correction).
 */
export async function addBackdatedMembership(
    clubId: string, date: string, member: EditMemberLite,
    plan: { id: string; name: string; price: number; visits?: number; durationDays?: number },
    method: PayMethod,
    grantCredits = false,
) {
    const amount = Number(plan.price) || 0;
    const planVisits = planCreditsOf(plan);
    const durationDays = Number(plan.durationDays) || 30;

    // Read current member state up-front (needed for safe credit/expiry math).
    let currentCredits = 0;
    let currentEnd: Date | null = null;
    if (grantCredits) {
        const snap = await getDoc(doc(db, `clubs/${clubId}/members/${member.id}`));
        const md = snap.exists() ? (snap.data() as any) : {};
        currentCredits = Number(md.shakeCredits) || 0;
        const raw = md.membershipEndDate;
        currentEnd = raw ? (raw.toDate ? raw.toDate() : new Date(raw)) : null;
    }

    const batch = writeBatch(db);

    const payRef = doc(collection(db, `clubs/${clubId}/payments`));
    batch.set(payRef, {
        type: "plan_purchase",
        memberId: member.id, memberName: member.name,
        amount,
        ...methodFields(amount, method),
        description: `Correction: ${plan.name} for ${member.name}`,
        planName: plan.name,
        date,
        creditsBeforeRenewal: currentCredits,
        manualCorrection: true,
        createdAt: serverTimestamp(),
    });

    const txnRef = doc(collection(db, `clubs/${clubId}/members/${member.id}/transactions`));
    batch.set(txnRef, {
        type: "credit",
        amount,
        reason: "plan_purchase",
        description: `Correction: ${plan.name}`,
        planId: plan.id,
        planName: plan.name,
        ...methodFields(amount, method),
        ...(grantCredits ? { creditsAdded: planVisits, creditsBeforeRenewal: currentCredits } : {}),
        manualCorrection: true,
        createdAt: serverTimestamp(),
    });

    if (grantCredits) {
        const newTotal = currentCredits + planVisits;
        // expiry = entry date + plan duration, but never earlier than the
        // member's existing expiry (don't expire an active member).
        const [y, m, d] = date.split("-").map(Number);
        const entryEnd = new Date(y, m - 1, d);
        entryEnd.setDate(entryEnd.getDate() + durationDays);
        const newEnd = currentEnd && currentEnd.getTime() > entryEnd.getTime() ? currentEnd : entryEnd;
        batch.update(doc(db, `clubs/${clubId}/members/${member.id}`), {
            status: "active",
            isActiveMember: true,
            isPermanent: true,
            shakeCredits: newTotal,
            shakeCreditsPlanTotal: newTotal,
            membershipPlanId: plan.id,
            membershipEndDate: Timestamp.fromDate(newEnd),
            updatedAt: serverTimestamp(),
        });
    }
    await batch.commit();
}

/** Add a backdated product sale (+ payment if amount > 0). */
export async function addBackdatedProduct(
    clubId: string, date: string,
    productName: string, qty: number, amount: number, method: PayMethod,
    member?: EditMemberLite,
) {
    if (!productName.trim()) throw new Error("Pick a product.");
    if (qty <= 0) throw new Error("Quantity must be at least 1.");
    const batch = writeBatch(db);

    const saleRef = doc(collection(db, `clubs/${clubId}/productSales`));
    batch.set(saleRef, {
        productName: productName.trim(),
        quantity: qty,
        totalAmount: amount,
        ...methodFields(amount, method),
        buyerId: member?.id ?? "",
        buyerName: member?.name ?? "Correction",
        date,
        manualCorrection: true,
        createdAt: serverTimestamp(),
    });

    if (amount > 0) {
        const payRef = doc(collection(db, `clubs/${clubId}/payments`));
        batch.set(payRef, {
            type: "product_sale",
            ...(member ? { memberId: member.id, memberName: member.name } : {}),
            amount,
            ...methodFields(amount, method),
            description: `Correction: ${qty} × ${productName.trim()}`,
            date,
            manualCorrection: true,
            createdAt: serverTimestamp(),
        });
    }
    await batch.commit();
}
