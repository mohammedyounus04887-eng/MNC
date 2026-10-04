/**
 * Check-in auto-order — the one pipe that turns a card scan into a kitchen order.
 *
 * Scanning a member's card at the door marks them present AND puts their shake
 * in front of the kitchen, so nobody has to repeat at a desk what the scan
 * already knows. The Serve Station then scans the same card to hand it over.
 *
 * The credit is NOT taken here. It is taken at serving, which is the decision
 * locked in REBUILD_NOTES: a member who scans in and leaves without collecting
 * has not had a shake and should not be charged for one. The order therefore
 * carries `creditsCharged: false`, and two other places must respect it:
 *
 *   - serving  (hooks/useOrders → useUpdateOrderStatus) deducts the credit and
 *     flips the flag, exactly once, inside the existing transaction.
 *   - rejecting (hooks/useOrders → useRejectOrder) must NOT refund a credit
 *     that was never charged.
 *
 * Everything is one batch, so a failure leaves nothing half-written.
 */

import {
    collection, doc, getDoc, increment, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";
import { getNextOrderNumber } from "@/utils/orderNumber";

export interface CheckinOrderItem {
    /** Display name of the shake. */
    name: string;
    /** todaysSpecial doc id, when the pick came from the day's menu. */
    itemId?: string;
    price?: number;
    /** "limited" specials have their remainingStock decremented. */
    stockType?: string;
    qty?: number;
}

export interface CheckinOrderResult {
    ok: boolean;
    /** Set when an order already existed for today — we never double-order. */
    duplicate?: boolean;
    tokenNumber?: string | number;
    shakes?: number;
}

/**
 * Create the kitchen order for a member who has just scanned in.
 *
 * `existingTodayOrders` is the caller's live view of today's orders for this
 * member. Passing it lets us refuse a second order on a re-scan without an
 * extra read — the readers commonly double-fire, and the member walking back
 * past the door should not silently order another shake.
 */
export async function createCheckinOrder(
    clubId: string,
    member: { id: string; name?: string; photoUrl?: string; photo?: string },
    items: CheckinOrderItem[],
    existingTodayOrders: Array<{ status?: string }> = [],
): Promise<CheckinOrderResult> {
    if (!clubId || !member?.id || items.length === 0) return { ok: false };

    // Already has an order today that hasn't been rejected — don't make another.
    const live = existingTodayOrders.filter(o => o.status !== "rejected" && o.status !== "cancelled");
    if (live.length > 0) return { ok: true, duplicate: true };

    const shakes = items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
    const total = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    const tokenNumber = await getNextOrderNumber(clubId);
    const date = todayLocal();

    const batch = writeBatch(db);

    batch.set(doc(collection(db, "clubs", clubId, "orders")), {
        memberId: member.id,
        memberName: member.name || "",
        memberPhoto: member.photoUrl || member.photo || "",
        items: items.map(i => ({
            itemName: i.name,
            productName: i.name,
            qty: Number(i.qty) || 1,
            quantity: Number(i.qty) || 1,
            price: Number(i.price) || 0,
            pricePerUnit: Number(i.price) || 0,
            notes: "",
            itemId: i.itemId || "",
            productId: i.itemId || "",
        })),
        totalAmount: total,
        totalCost: total,
        status: "pending",
        source: "checkin_scan",
        paymentMethod: "shake_credits",
        creditsUsed: shakes,
        // The credit is taken at serving, not now. Serving flips this to true.
        creditsCharged: false,
        tokenNumber,
        date,
        clubId,
        createdAt: serverTimestamp(),
    });

    // Limited specials only. `update` on a missing doc rejects the whole batch,
    // and the midnight reset deletes stale specials — skip rather than lose the
    // order.
    for (const i of items) {
        if (i.stockType !== "limited" || !i.itemId) continue;
        const ref = doc(db, "clubs", clubId, "todaysSpecial", i.itemId);
        const exists = await getDoc(ref);
        if (exists.exists()) {
            batch.update(ref, { remainingStock: increment(-(Number(i.qty) || 1)) });
        }
    }

    await batch.commit();
    return { ok: true, tokenNumber, shakes };
}
