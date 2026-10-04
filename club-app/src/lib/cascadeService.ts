/**
 * Cascade service — reverses or applies member-state changes when a
 * past Report record is edited / deleted.
 *
 * Per owner spec (Q1=A, Q2=B):
 *   - Delete payment → soft-delete the doc + cascade-REVERSE every side
 *     effect (wallet credits, shake credits, membership extension,
 *     inventory stock, BTC enrolment state, etc.). The doc stays in
 *     Firestore with `deleted: true` so it's hidden from sums but
 *     recoverable from the audit log.
 *   - Add a backdated record → cascade-FORWARD (same effects as if it
 *     happened on the original date).
 *
 * Every cascade writes an auditLog entry at
 * `clubs/{clubId}/auditLog/{auto}` so the owner can review what was
 * changed and (later) undo from a single source of truth.
 *
 * Cascade logic per payment.type:
 *   topup / wallet_topup     → revert wallet balance
 *   plan_purchase            → revert shake credits + denominator
 *   oneday_shake             → revert extra prepaid days + count
 *   product_sale             → restock product
 *   guest_payment            → no member state
 *   btc_enrolment            → unenroll member + clear deposit/fee fields
 *
 * Orders cascade: cancel an order → refund shake credits used.
 * Attendance removal: just remove the attendance doc; visit counter not
 * decremented (visit counts are derived, not stored).
 *
 * Author note: every cascade is best-effort. If a sibling field needed
 * for reversal is missing (e.g. payment didn't store `creditsBeforeRenewal`)
 * we still soft-delete the payment but skip the impossible reversal —
 * the audit log records what we couldn't reverse so the admin can fix
 * manually.
 */

import {
    addDoc, collection, doc, getDoc, getDocs, increment, query,
    serverTimestamp, Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { withAuthRefresh } from "@/lib/firestoreSafe";
import { normalizeTender } from "@/lib/paymentSplit";

// ─── Types ───────────────────────────────────────────────────────────────

export type CascadeAction =
    | "payment_deleted"
    | "payment_edited"
    | "topup_deleted"
    | "topup_edited"
    | "order_cancelled"
    | "guest_deleted"
    | "attendance_removed"
    | "expense_deleted"
    // updateExpense has always written this action; it was just missing from
    // the union, so that audit call never typechecked.
    | "expense_updated";

export interface CascadeResult {
    ok: boolean;
    reversed: string[];    // human-readable list of side-effects reversed
    skipped: string[];     // side-effects we couldn't safely reverse + why
    errorMessage?: string;
}

// ─── Audit log writer ────────────────────────────────────────────────────

async function writeAuditLog(
    clubId: string,
    action: CascadeAction,
    entityType: string,
    entityId: string,
    before: any,
    summary: string,
    reversedItems: string[],
    skippedItems: string[],
) {
    try {
        await addDoc(collection(db, `clubs/${clubId}/auditLog`), {
            action,
            entityType,
            entityId,
            before,
            summary,
            reversedItems,
            skippedItems,
            doneBy: "owner_admin",   // owner-side actions for now
            doneAt: serverTimestamp(),
        });
    } catch (e) {
        // Don't fail the whole cascade just because audit log fails.
        // The reversal already happened; audit is best-effort.
        console.warn("[cascade] audit log write failed", e);
    }
}

// ─── Helper: read member wallet doc ──────────────────────────────────────

async function getWalletBalance(clubId: string, memberId: string): Promise<number | null> {
    try {
        const snap = await getDoc(doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data"));
        if (!snap.exists()) return null;
        return Number((snap.data() as any).balance) || 0;
    } catch { return null; }
}

// ─── Delete a payment with full cascade reversal ────────────────────────
// Soft-delete approach: the payment doc stays in Firestore with
// `deleted: true`, so revenue sums in the Reports page (which filter on
// `!p.deleted`) drop it. The audit log keeps full provenance.
export async function deletePaymentCascade(
    clubId: string,
    payment: any,
): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            const paymentRef = doc(db, `clubs/${clubId}/payments`, payment.id);

            // Refuse to reverse the same payment twice.
            //
            // Every branch below is an increment: credits, stock, a wallet
            // balance. Running it again takes the money out a second time, and
            // a double-click or a retry after a timeout that actually
            // succeeded is enough to do it. Read the stored copy rather than
            // trusting the object the screen handed us, which may be a moment
            // out of date — that staleness is exactly the gap a double-click
            // fits through.
            const current = await getDoc(paymentRef);
            if (!current.exists()) {
                skipped.push("Payment no longer exists — nothing to reverse");
                return;
            }
            if ((current.data() as any)?.deleted) {
                skipped.push("Already deleted — not reversed a second time");
                return;
            }

            const memberId: string | undefined = payment.memberId;
            const amount = Number(payment.amount) || 0;

            // ── Branch on payment type for the cascade reversal ────────
            switch (payment.type) {
                case "topup":
                case "wallet_topup": {
                    if (memberId) {
                        const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                        await updateDoc(walletRef, {
                            balance: increment(-amount),
                            lastUpdated: serverTimestamp(),
                        });
                        reversed.push(`Reversed ₹${amount} from member's wallet`);
                    } else skipped.push("No memberId on payment — can't reverse wallet");
                    break;
                }

                case "plan_purchase": {
                    if (!memberId) {
                        skipped.push("No memberId on payment — can't reverse credits");
                        break;
                    }
                    const memberRef = doc(db, `clubs/${clubId}/members`, memberId);
                    // creditsAdded is written by the new code path; fall back
                    // to looking up the plan if a very old payment doesn't have it.
                    const planVisits = Number(payment.creditsAdded) || 0;
                    if (planVisits > 0) {
                        await updateDoc(memberRef, {
                            shakeCredits: increment(-planVisits),
                            shakeCreditsPlanTotal: increment(-planVisits),
                            updatedAt: serverTimestamp(),
                        });
                        reversed.push(`Subtracted ${planVisits} shake credits from member`);
                    } else {
                        skipped.push("Payment doesn't record creditsAdded — credits left as-is");
                    }
                    break;
                }

                case "oneday_shake": {
                    if (memberId) {
                        const memberRef = doc(db, `clubs/${clubId}/members`, memberId);
                        const daysPaid = Number(payment.daysPaid) || 1;
                        const extraDays = Math.max(0, daysPaid - 1);
                        const update: any = {
                            oneDayShakeCount: increment(-1),
                            updatedAt: serverTimestamp(),
                        };
                        if (extraDays > 0) update.oneDayShakeCredits = increment(-extraDays);
                        await updateDoc(memberRef, update);
                        reversed.push(`Decremented one-day shake count${extraDays ? ` + reversed ${extraDays} prepaid days` : ""}`);
                    } else skipped.push("Walk-in one-day shake — no member to reverse");
                    break;
                }

                case "product_sale": {
                    // Try to restock the product. Different schemas — try a
                    // couple of likely fields.
                    const productId = payment.productId;
                    const quantity = Number(payment.quantity) || 0;
                    if (productId && quantity > 0) {
                        try {
                            await updateDoc(doc(db, `clubs/${clubId}/inventoryProducts`, productId), {
                                stock: increment(quantity),
                                updatedAt: serverTimestamp(),
                            });
                            reversed.push(`Restocked ${quantity} unit(s) of product`);
                        } catch (e) {
                            skipped.push("Could not restock product (item may have been deleted)");
                        }
                    } else skipped.push("Product sale missing productId/quantity — skipped stock reversal");

                    // If the sale was charged to wallet, refund the wallet too.
                    if (memberId && payment.paymentMethod === "wallet" && amount > 0) {
                        try {
                            const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                            await updateDoc(walletRef, {
                                balance: increment(amount),
                                lastUpdated: serverTimestamp(),
                            });
                            reversed.push(`Refunded ₹${amount} to member's wallet`);
                        } catch (e) { skipped.push("Wallet refund failed"); }
                    }
                    break;
                }

                case "guest_payment": {
                    // No member state to revert — just a cash receipt.
                    reversed.push("Cash/UPI receipt removed from revenue");
                    break;
                }

                case "btc_enrolment": {
                    if (memberId) {
                        const memberRef = doc(db, `clubs/${clubId}/members`, memberId);
                        await updateDoc(memberRef, {
                            isBTCParticipant: false,
                            btcParticipationFeePaid: 0,
                            btcCautionDepositPaid: 0,
                            btcDepositStatus: null,
                            btcEnrolmentPaymentId: null,
                            updatedAt: serverTimestamp(),
                        });
                        reversed.push("Unenrolled member from BTC + cleared deposit/fee fields");
                    }
                    break;
                }

                default: {
                    skipped.push(`Unknown payment type "${payment.type}" — only soft-deleted`);
                }
            }

            // ── Soft-delete the payment doc itself ─────────────────────
            await updateDoc(paymentRef, {
                deleted: true,
                deletedAt: serverTimestamp(),
                deletedBy: "owner_admin",
            });
            reversed.push("Payment marked deleted (hidden from revenue sums)");
        });

        await writeAuditLog(
            clubId,
            "payment_deleted",
            "payment",
            payment.id,
            payment,
            `Deleted ${payment.type} payment of ₹${payment.amount} (${payment.memberName || payment.guestName || "—"})`,
            reversed,
            skipped,
        );

        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] deletePayment", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Edit a payment's amount/mode + cascade the delta ───────────────────
// For now supports: amount, paymentMethod, cashAmount, upiAmount fields.
// Only the AMOUNT delta cascades to wallet (for wallet-impacting types).
export async function updatePaymentCascade(
    clubId: string,
    payment: any,
    changes: Partial<{
        amount: number;
        paymentMethod: "cash" | "upi" | "split";
        cashAmount: number;
        upiAmount: number;
        description: string;
        // Which UPI account took the money. Carried here so a correction has
        // one write path: the report used to set these itself alongside the
        // cascade, which is the second writer this file exists to prevent.
        upiAccountId: string | null;
        upiAccountName: string | null;
        upiNumber: string | null;
        upiHolderName: string | null;
    }>,
): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            const paymentRef = doc(db, `clubs/${clubId}/payments`, payment.id);
            const memberId: string | undefined = payment.memberId;
            const oldAmount = Number(payment.amount) || 0;
            const newAmount = changes.amount != null ? Number(changes.amount) : oldAmount;
            const delta = newAmount - oldAmount;

            // ── Apply the delta to member state for amount-sensitive types
            if (delta !== 0 && memberId) {
                switch (payment.type) {
                    case "topup":
                    case "wallet_topup": {
                        const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                        await updateDoc(walletRef, {
                            balance: increment(delta),
                            lastUpdated: serverTimestamp(),
                        });
                        reversed.push(`Wallet adjusted by ₹${delta > 0 ? "+" : ""}${delta}`);
                        break;
                    }
                    case "product_sale": {
                        if (payment.paymentMethod === "wallet") {
                            const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                            await updateDoc(walletRef, {
                                balance: increment(-delta), // sale increase → wallet decrease
                                lastUpdated: serverTimestamp(),
                            });
                            reversed.push(`Wallet charged ₹${delta > 0 ? "+" : ""}${-delta}`);
                        }
                        break;
                    }
                    default:
                        skipped.push(`Amount change for ${payment.type} — no wallet cascade (cash/UPI cycled outside the app)`);
                }
            }

            // ── Update the payment doc itself ──────────────────────────
            const update: any = { editedAt: serverTimestamp(), editedBy: "owner_admin" };
            // Always rewrite the tender as a set, never field by field. Editing
            // a SPLIT payment's amount used to send only `amount`, leaving
            // cashAmount and upiAmount describing the old figure — ₹1,000 split
            // 400/600, edited to ₹2,000, stored as 2,000 with 400+600. The
            // document was then permanently inconsistent, and every report had
            // to guess at the ₹1,000 difference.
            const tender = normalizeTender(
                changes.amount != null ? newAmount : Number(payment.amount) || 0,
                changes.paymentMethod ?? payment.paymentMethod,
                changes.cashAmount ?? payment.cashAmount,
                changes.upiAmount ?? payment.upiAmount,
            );
            update.amount = tender.amount;
            update.paymentMethod = tender.paymentMethod;
            update.cashAmount = tender.cashAmount;
            update.upiAmount = tender.upiAmount;
            if (changes.description != null) update.description = changes.description;
            // Cleared to null when a payment is corrected to cash, so an old
            // UPI account cannot stay attached to a cash row.
            for (const k of ["upiAccountId", "upiAccountName", "upiNumber", "upiHolderName"] as const) {
                if (k in changes) update[k] = (changes as any)[k];
            }
            await updateDoc(paymentRef, update);
            reversed.push(`Payment record updated`);
        });

        await writeAuditLog(
            clubId,
            "payment_edited",
            "payment",
            payment.id,
            payment,
            `Edited ${payment.type} payment for ${payment.memberName || payment.guestName || "—"}`,
            reversed,
            skipped,
        );

        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] updatePayment", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Approved top-ups: delete / edit with the wallet kept honest ────────
//
// An approved top-up is not just a row. useApproveTopup adds the money to the
// member's wallet, writes a credit line to their transaction ledger, marks the
// request approved and clears hasPendingTopup. Today's Report used to delete
// the request document and nothing else, so the money stayed in the wallet
// with no record of where it came from — the member kept a balance the club
// had decided was wrong.
//
// The wallet is corrected here, and the ledger gets a reversing entry rather
// than losing its history: you do not delete a line from a ledger, you post
// the opposite one. The request is soft-deleted so it can still be read back.

/** Reverse an approved top-up: take the money back out, post the reversal. */
export async function deleteTopupRequestCascade(
    clubId: string,
    request: any,
): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            const reqRef = doc(db, `clubs/${clubId}/topupRequests`, request.id);

            // Same guard as deletePaymentCascade: taking money back out of a
            // wallet is an increment, and doing it twice is somebody's balance
            // wrong by the size of their top-up.
            const current = await getDoc(reqRef);
            if (!current.exists()) {
                skipped.push("Top-up request no longer exists — nothing to reverse");
                return;
            }
            const stored = current.data() as any;
            if (stored?.deleted) {
                skipped.push("Already deleted — not reversed a second time");
                return;
            }

            const memberId: string | undefined = request.memberId;
            // What was actually credited, read from the stored document rather
            // than the screen's copy, and the approved figure rather than what
            // the member asked for.
            const credited = Number(stored.approvedAmount ?? stored.amount) || 0;
            const wasApproved = stored.status === "approved";

            if (!wasApproved) {
                skipped.push("Request was never approved — no wallet money to reverse");
            } else if (!memberId) {
                skipped.push("No memberId on request — can't reverse the wallet");
            } else if (credited <= 0) {
                skipped.push("No approved amount recorded — can't reverse the wallet");
            } else {
                const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                await updateDoc(walletRef, {
                    balance: increment(-credited),
                    lastUpdated: serverTimestamp(),
                });
                reversed.push(`Took ₹${credited} back out of the member's wallet`);

                // The ledger keeps both lines: the original credit and this
                // reversal. A member looking at their history sees what
                // happened rather than money quietly disappearing.
                try {
                    await addDoc(collection(db, `clubs/${clubId}/members/${memberId}/transactions`), {
                        userId: memberId,
                        clubId,
                        type: "debit",
                        amount: credited,
                        reason: "topup_reversed",
                        description: "Top-up reversed from Today's Report",
                        reference: request.id,
                        addedBy: "owner",
                        createdAt: serverTimestamp(),
                    });
                    reversed.push("Posted a reversing entry on the member's ledger");
                } catch {
                    skipped.push("Could not post the reversing ledger entry — wallet was still corrected");
                }
            }

            // Soft delete, like every other reversal in this file, so the row
            // stays readable in the audit trail.
            await updateDoc(reqRef, {
                deleted: true,
                deletedAt: serverTimestamp(),
                deletedBy: "owner_admin",
            });
            reversed.push("Top-up request marked deleted");
        });

        await writeAuditLog(
            clubId,
            "topup_deleted",
            "topupRequest",
            request.id,
            request,
            `Deleted approved top-up for ${request.memberName || "—"}`,
            reversed,
            skipped,
        );
        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] deleteTopupRequest", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

/** Change an approved top-up's amount or method, moving the wallet by the delta. */
export async function updateTopupRequestCascade(
    clubId: string,
    request: any,
    changes: Partial<{
        approvedAmount: number;
        paymentMethod: "cash" | "upi" | "split";
        upiAccountId: string | null;
        upiAccountName: string | null;
        upiNumber: string | null;
        upiHolderName: string | null;
    }>,
): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            const reqRef = doc(db, `clubs/${clubId}/topupRequests`, request.id);
            const memberId: string | undefined = request.memberId;
            const oldAmount = Number(request.approvedAmount ?? request.amount) || 0;
            const newAmount = changes.approvedAmount != null
                ? Number(changes.approvedAmount)
                : oldAmount;
            const delta = newAmount - oldAmount;

            // Correcting the figure has to move the wallet with it. Writing the
            // new number alone left the member holding the old amount.
            if (delta !== 0 && request.status === "approved") {
                if (!memberId) {
                    skipped.push("No memberId on request — wallet not adjusted");
                } else {
                    await updateDoc(doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data"), {
                        balance: increment(delta),
                        lastUpdated: serverTimestamp(),
                    });
                    reversed.push(`Wallet adjusted by ₹${delta > 0 ? "+" : ""}${delta}`);
                }
            }

            const update: any = { editedAt: serverTimestamp(), editedBy: "owner_admin" };
            if (changes.approvedAmount != null) update.approvedAmount = newAmount;
            if (changes.paymentMethod != null) update.paymentMethod = changes.paymentMethod;
            for (const k of ["upiAccountId", "upiAccountName", "upiNumber", "upiHolderName"] as const) {
                if (k in changes) update[k] = (changes as any)[k];
            }
            await updateDoc(reqRef, update);
            reversed.push("Top-up request updated");
        });

        await writeAuditLog(
            clubId,
            "topup_edited",
            "topupRequest",
            request.id,
            request,
            `Edited approved top-up for ${request.memberName || "—"}`,
            reversed,
            skipped,
        );
        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] updateTopupRequest", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Cancel an order — refund shake credits used + mark cancelled ───────
export async function cancelOrderCascade(clubId: string, order: any): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            const orderRef = doc(db, `clubs/${clubId}/orders`, order.id);
            const memberId = order.memberId;
            const creditsUsed = Number(order.creditsUsed) || 0;
            const totalAmount = Number(order.totalAmount) || 0;

            // ── Refund credits if a member order ──────────────────────
            if (memberId && memberId !== "walk-in") {
                const memberRef = doc(db, `clubs/${clubId}/members`, memberId);
                if (creditsUsed > 0) {
                    await updateDoc(memberRef, {
                        shakeCredits: increment(creditsUsed),
                        updatedAt: serverTimestamp(),
                    });
                    reversed.push(`Refunded ${creditsUsed} shake credit(s) to member`);
                } else if (totalAmount > 0 && String(order.paymentMethod || "").includes("wallet")) {
                    const walletBefore = await getWalletBalance(clubId, memberId);
                    const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
                    await updateDoc(walletRef, {
                        balance: increment(totalAmount),
                        lastUpdated: serverTimestamp(),
                    });
                    reversed.push(`Refunded ₹${totalAmount} to wallet (was ₹${walletBefore ?? "?"})`);
                }
            }

            // ── Mark order cancelled ─────────────────────────────────
            await updateDoc(orderRef, {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledBy: "owner_admin",
                rejectReason: "Cancelled from Reports page",
            });
            reversed.push("Order marked cancelled (excluded from sums)");
        });

        await writeAuditLog(
            clubId,
            "order_cancelled",
            "order",
            order.id,
            order,
            `Cancelled order for ${order.memberName || "Walk-in"}`,
            reversed,
            skipped,
        );

        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] cancelOrder", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Delete a guest entry ────────────────────────────────────────────────
export async function deleteGuestCascade(clubId: string, guest: any): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            // A guest entry is not one document. `useAddGuestEntry` writes, in
            // one batch: a kitchen order per shake, a stock decrement on
            // todaysSpecial / menu / inventory (plus an inventoryLog), and a
            // payments doc for a paid guest. This used to soft-delete only the
            // entry, so a mistyped guest left the shake on the kitchen screen,
            // the money in the day's revenue and the stock gone. Each of those
            // is now put back.

            // ── 1. Kitchen orders ────────────────────────────────────────
            // Entries written before the multi-item guest wizard carry a single
            // `orderId` instead of an `orderIds` array. Both shapes are live.
            const orderIds: string[] = Array.isArray(guest.orderIds) && guest.orderIds.length > 0
                ? guest.orderIds
                : (guest.orderId ? [guest.orderId] : []);
            for (const orderId of orderIds) {
                try {
                    await updateDoc(doc(db, `clubs/${clubId}/orders`, orderId), {
                        status: "cancelled",
                        deleted: true,
                        deletedAt: serverTimestamp(),
                        deletedBy: "owner_admin",
                    });
                } catch {
                    skipped.push(`Order ${orderId} could not be cancelled (already removed?)`);
                }
            }
            if (orderIds.length) reversed.push(`Cancelled ${orderIds.length} kitchen order(s)`);

            // ── 2. Stock ─────────────────────────────────────────────────
            // Same story as the orders: pre-wizard entries describe their one
            // item with flat fields instead of an `items` array.
            const items: any[] = Array.isArray(guest.items) && guest.items.length > 0
                ? guest.items
                : guest.itemType === "shake" && guest.shakeProductId
                    ? [{ type: "shake", productId: guest.shakeProductId, productName: guest.shakeProductName || "", qty: 1 }]
                    : guest.itemType === "inventory_product" && guest.inventoryProductId
                        ? [{ type: "inventory_product", productId: guest.inventoryProductId, productName: guest.inventoryProductName || "", qty: guest.inventoryQuantity || 1 }]
                        : [];
            for (const it of items) {
                const productId = it.productId;
                const qty = Number(it.qty) || 0;
                if (!productId || qty <= 0) continue;

                if (it.type === "inventory_product") {
                    const invRef = doc(db, `clubs/${clubId}/inventory`, productId);
                    try {
                        const invSnap = await getDoc(invRef);
                        if (!invSnap.exists()) {
                            skipped.push(`${it.productName}: inventory item no longer exists — not restocked`);
                            continue;
                        }
                        const before = Number(invSnap.data().quantity) || 0;
                        await updateDoc(invRef, { quantity: before + qty, lastUpdated: serverTimestamp() });
                        // Mirror the sale log so the inventory history reads as
                        // a pair rather than a stock jump with no explanation.
                        await addDoc(collection(db, `clubs/${clubId}/inventoryLogs`), {
                            clubId,
                            type: "guest_deletion_reversal",
                            productId,
                            productName: it.productName,
                            quantityChange: qty,
                            quantityBefore: before,
                            quantityAfter: before + qty,
                            referenceId: guest.id,
                            performedBy: "owner_admin",
                            date: guest.date || new Date().toISOString().slice(0, 10),
                            createdAt: Timestamp.now(),
                        });
                        reversed.push(`Restocked ${qty} × ${it.productName}`);
                    } catch {
                        skipped.push(`${it.productName}: restock failed`);
                    }
                    continue;
                }

                if (it.type !== "shake") continue;

                // Limited specials only. The entry doesn't record whether the
                // item was limited, so read the special back: a non-limited one
                // was never decremented and must not be inflated now.
                try {
                    const specialRef = doc(db, `clubs/${clubId}/todaysSpecial`, productId);
                    const specialSnap = await getDoc(specialRef);
                    if (specialSnap.exists()) {
                        const sd = specialSnap.data() as any;
                        if (sd.stockType === "limited") {
                            const before = Number(sd.remainingStock) || 0;
                            // Give back only what was actually taken. The
                            // forward path clamps at zero — `Math.max(0, 3 - 5)`
                            // for a qty of 5 against 3 in stock — so restoring
                            // the full qty invented stock that never existed.
                            // `initialStock` bounds it where the special
                            // records one; otherwise the clamp cannot be undone
                            // beyond what is plausible.
                            const cap = Number(sd.initialStock ?? sd.totalStock ?? NaN);
                            const restored = Number.isFinite(cap)
                                ? Math.min(before + qty, cap)
                                : before + qty;
                            const update: any = { remainingStock: restored, updatedAt: serverTimestamp() };
                            // The forward path switches a special off when its
                            // stock reaches zero. Only that automatic switch-off
                            // is undone — a special the owner turned off by hand
                            // stays off.
                            if (sd.isActive === false && before === 0) update.isActive = true;
                            await updateDoc(specialRef, update);
                            reversed.push(`Returned ${qty} × ${it.productName} to today's special stock`);
                        }
                    }
                } catch {
                    skipped.push(`${it.productName}: special stock not returned`);
                }

                // Back-compat: the forward path also decremented menu.stock.
                try {
                    const menuRef = doc(db, `clubs/${clubId}/menu`, productId);
                    const menuSnap = await getDoc(menuRef);
                    if (menuSnap.exists()) {
                        const cur = Number(menuSnap.data().stock) || 0;
                        await updateDoc(menuRef, { stock: cur + qty, updatedAt: serverTimestamp() });
                    }
                } catch { /* menu doc is optional — nothing to put back */ }
            }

            // ── 3. Money ─────────────────────────────────────────────────
            // Payments are linked by referenceId, not held on the entry, so
            // query rather than trusting a stored id.
            try {
                const paySnap = await getDocs(query(
                    collection(db, `clubs/${clubId}/payments`),
                    where("referenceId", "==", guest.id),
                ));
                let total = 0;
                for (const p of paySnap.docs) {
                    if ((p.data() as any).deleted) continue;
                    total += Number((p.data() as any).amount) || 0;
                    await updateDoc(p.ref, {
                        deleted: true,
                        deletedAt: serverTimestamp(),
                        deletedBy: "owner_admin",
                    });
                }
                if (paySnap.size > 0) {
                    reversed.push(`Removed ₹${total} from the day's revenue`);
                } else if (guest.type === "paid" && (guest.amountPaid ?? 0) > 0) {
                    // Older entries pre-date the referenceId link.
                    skipped.push(`No payment doc found for this guest — ₹${guest.amountPaid} may still be counted, check the Payments tab`);
                }
            } catch {
                skipped.push("Could not reverse the guest payment");
            }

            // ── 4. The entry itself ──────────────────────────────────────
            const ref = doc(db, `clubs/${clubId}/guestEntries`, guest.id);
            await updateDoc(ref, {
                deleted: true,
                deletedAt: serverTimestamp(),
                deletedBy: "owner_admin",
            });
            reversed.push("Guest entry marked deleted");
        });

        await writeAuditLog(
            clubId,
            "guest_deleted",
            "guest",
            guest.id,
            guest,
            `Deleted guest entry for ${guest.guestName || "—"}`,
            reversed,
            skipped,
        );

        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] deleteGuest", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Remove an attendance record ─────────────────────────────────────────
export async function removeAttendanceCascade(
    clubId: string,
    memberId: string,
    dateStr: string,           // YYYY-MM-DD
    memberName: string,
): Promise<CascadeResult> {
    const reversed: string[] = [];
    const skipped: string[] = [];

    try {
        await withAuthRefresh(async () => {
            // Use writeBatch to do both deletes in one go
            const batch = writeBatch(db);
            batch.delete(doc(db, `clubs/${clubId}/members/${memberId}/attendance`, dateStr));
            batch.update(doc(db, `clubs/${clubId}/members`, memberId), {
                lastVisit: null,    // clear today's marker if it was today
                updatedAt: serverTimestamp(),
            });
            await batch.commit();
            reversed.push(`Attendance record for ${dateStr} removed`);
        });

        await writeAuditLog(
            clubId,
            "attendance_removed",
            "attendance",
            `${memberId}_${dateStr}`,
            { memberId, dateStr, memberName },
            `Removed attendance for ${memberName} on ${dateStr}`,
            reversed,
            skipped,
        );

        return { ok: true, reversed, skipped };
    } catch (e: any) {
        console.error("[cascade] removeAttendance", e);
        return { ok: false, reversed, skipped, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Delete an expense ───────────────────────────────────────────────────
// Expenses don't affect member state (informational only per owner spec),
// so this is a straight delete with audit log only.
export async function deleteExpenseCascade(clubId: string, expense: any): Promise<CascadeResult> {
    try {
        await withAuthRefresh(async () => {
            await updateDoc(doc(db, `clubs/${clubId}/expenses`, expense.id), {
                deleted: true,
                deletedAt: serverTimestamp(),
                deletedBy: "owner_admin",
            });
        });

        await writeAuditLog(
            clubId,
            "expense_deleted",
            "expense",
            expense.id,
            expense,
            `Deleted expense "${expense.description || "—"}" (₹${expense.amount})`,
            ["Expense marked deleted"],
            [],
        );

        return { ok: true, reversed: ["Expense marked deleted"], skipped: [] };
    } catch (e: any) {
        console.error("[cascade] deleteExpense", e);
        return { ok: false, reversed: [], skipped: [], errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Add a backdated expense for ANY date ────────────────────────────────
// Used by the new "Add Expense" button on the Reports page so admin can
// log an expense against a date other than today.
export async function addExpenseForDate(
    clubId: string,
    description: string,
    amount: number,
    dateStr: string,
    name = "",
): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
        await withAuthRefresh(async () => {
            await addDoc(collection(db, `clubs/${clubId}/expenses`), {
                name: name.trim(),
                description,
                amount,
                date: dateStr,
                createdAt: serverTimestamp(),
                createdBy: "owner_admin",
                ...(dateStr !== new Date().toISOString().slice(0, 10) ? { backdated: true } : {}),
            });
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[cascade] addExpense", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

// ─── Edit an existing expense (description / amount) ─────────────────────
// Expenses are standalone ledger rows — no wallet / stock / credit cascade —
// so editing is a plain field update plus an audit log.
export async function updateExpense(
    clubId: string,
    expense: any,
    patch: { name?: string; description?: string; amount?: number },
): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
        await withAuthRefresh(async () => {
            await updateDoc(doc(db, `clubs/${clubId}/expenses`, expense.id), {
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
                ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
                updatedAt: serverTimestamp(),
                updatedBy: "owner_admin",
            });
        });
        await writeAuditLog(
            clubId,
            "expense_updated",
            "expense",
            expense.id,
            expense,
            `Edited expense "${(patch.description ?? expense.description) || "—"}" (₹${patch.amount ?? expense.amount})`,
            ["Expense updated"],
            [],
        );
        return { ok: true };
    } catch (e: any) {
        console.error("[cascade] updateExpense", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

// Silence unused-imports until the next slice plugs them in.
void Timestamp;
