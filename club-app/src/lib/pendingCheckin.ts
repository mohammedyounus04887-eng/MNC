/**
 * Accepting a member's pre-order — one pipe.
 *
 * A member orders from their phone, which creates a `pendingCheckins` doc.
 * Reception confirms it, and that single act has to deduct credits, create the
 * kitchen order, reserve a token and decrement the special's stock — all
 * together, or not at all.
 *
 * This logic used to live inside Reception's 8,000-line component, so the new
 * queue screen would have had to reimplement it, which is exactly how the app
 * ended up with the same job done several different ways. Both screens call
 * this instead.
 *
 * Credits are read live from Firestore rather than from anything held on
 * screen, and the whole thing is one batch, so a failure leaves nothing
 * half-done.
 */

import { collection, doc, getDoc, increment, serverTimestamp, writeBatch, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNextOrderNumber } from "@/utils/orderNumber";
import { todayLocal } from "@/lib/clubDay";

/** Members may go this far below zero before being refused. */
export const GRACE_LIMIT = -5;

export interface AcceptResult {
    ok: boolean;
    /** Set when refused: the member is out of credits. */
    refused?: boolean;
    creditsAfter: number;
    tokenNumber?: string | number;
    shakes: number;
}

export async function acceptPendingCheckin(
    clubId: string,
    member: { id: string; name?: string; photoUrl?: string; photo?: string },
    pending: { id: string; items?: any[]; totalAmount?: number },
): Promise<AcceptResult> {
    const items: any[] = pending.items || [];

    // Nothing ordered — just close the queue card.
    if (items.length === 0) {
        await updateDoc(doc(db, "clubs", clubId, "pendingCheckins", pending.id), {
            status: "completed",
            completedAt: serverTimestamp(),
        });
        return { ok: true, creditsAfter: 0, shakes: 0 };
    }

    const [memberSnap, tokenNumber] = await Promise.all([
        getDoc(doc(db, "clubs", clubId, "members", member.id)),
        getNextOrderNumber(clubId),
    ]);
    const currentCredits = Number(memberSnap.data()?.shakeCredits ?? 0);
    const shakes = items.reduce((s, i) => s + (Number(i.qty ?? i.quantity) || 1), 0);

    if (currentCredits - shakes < GRACE_LIMIT) {
        await updateDoc(doc(db, "clubs", clubId, "pendingCheckins", pending.id), {
            status: "rejected",
            rejectedAt: serverTimestamp(),
            reason: "no_credits",
        });
        return { ok: false, refused: true, creditsAfter: currentCredits, shakes };
    }

    const date = todayLocal();
    const batch = writeBatch(db);

    batch.update(doc(db, "clubs", clubId, "members", member.id), {
        shakeCredits: increment(-shakes),
    });

    batch.set(doc(collection(db, "clubs", clubId, "members", member.id, "transactions")), {
        type: "shake_credit",
        amount: shakes,
        reason: "shake_order",
        description: `Pre-order: ${items.map(i => i.name || i.productName || i.itemName).join(", ")}`,
        creditsAfter: currentCredits - shakes,
        createdAt: serverTimestamp(),
    });

    batch.set(doc(collection(db, "clubs", clubId, "orders")), {
        memberId: member.id,
        memberName: member.name || "",
        memberPhoto: member.photoUrl || member.photo || "",
        items: items.map(i => ({
            itemName: i.name || i.itemName || i.productName,
            productName: i.name || i.productName || i.itemName,
            qty: Number(i.qty ?? i.quantity) || 1,
            quantity: Number(i.qty ?? i.quantity) || 1,
            price: Number(i.price) || 0,
            pricePerUnit: Number(i.price) || 0,
            notes: i.notes || "",
            itemId: i.itemId || "",
            productId: i.itemId || i.productId || "",
        })),
        totalAmount: Number(pending.totalAmount) || 0,
        totalCost: Number(pending.totalAmount) || 0,
        status: "pending",
        source: "member_app",
        paymentMethod: "shake_credits",
        creditsUsed: shakes,
        tokenNumber,
        date,
        clubId,
        createdAt: serverTimestamp(),
    });

    // Limited specials only. `update` on a missing doc rejects the whole batch,
    // and the midnight reset deletes stale specials — so a pre-order placed
    // just before midnight and confirmed just after would take the order down
    // with it. Skip the decrement rather than lose the order.
    for (const i of items) {
        if (i.stockType !== "limited" || !i.itemId) continue;
        const specialRef = doc(db, "clubs", clubId, "todaysSpecial", i.itemId);
        const exists = await getDoc(specialRef);
        if (exists.exists()) {
            batch.update(specialRef, { remainingStock: increment(-(Number(i.qty ?? i.quantity) || 1)) });
        }
    }

    batch.update(doc(db, "clubs", clubId, "pendingCheckins", pending.id), {
        status: "completed",
        completedAt: serverTimestamp(),
    });

    await batch.commit();
    return { ok: true, creditsAfter: currentCredits - shakes, tokenNumber, shakes };
}

/** Turn a queue card away without touching credits. */
export async function rejectPendingCheckin(clubId: string, pendingId: string, reason = "rejected_by_reception") {
    await updateDoc(doc(db, "clubs", clubId, "pendingCheckins", pendingId), {
        status: "rejected",
        rejectedAt: serverTimestamp(),
        reason,
    });
}
