/**
 * The one place money is recorded.
 *
 * Every rupee the club takes should go through `recordPayment`. Ten separate
 * code paths used to move money without writing a payments doc at all — the
 * member's credits and expiry updated, the cash went in the drawer, and the
 * reports showed nothing. That is the single biggest cause of the report
 * mismatches.
 *
 * The shape below is what the readers actually consume
 * (owner/Reports.tsx `aggregate`, owner/TodayReportModal, the dashboard KPIs
 * and lib/cascadeService):
 *
 *   type            one of PaymentType — anything else lands in "Other"
 *   amount          total collected
 *   paymentMethod   LOWERCASE "cash" | "upi" | "split" — readers compare
 *                   against lowercase, so "Cash" silently scored zero
 *   cashAmount      always written, so the split breakdown is never guessed
 *   upiAmount       always written, for the same reason
 *   creditsAdded    lets a deletion reverse the credits it granted — the
 *                   cascade looks for this and no writer ever set it
 *   date            LOCAL YYYY-MM-DD, not UTC. Writers used toISOString(),
 *                   which files every sale before 05:30 IST under yesterday
 *                   while the reports query on the local date.
 */

import { addDoc, collection, serverTimestamp, type WriteBatch, type Transaction, type DocumentReference, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeTender } from "@/lib/paymentSplit";

export type PaymentType =
    | "plan_purchase"
    | "oneday_shake"
    | "product_sale"
    | "guest_payment"
    | "virtual_member"
    | "wallet_topup";

export type PayMethod = "cash" | "upi" | "split";

export interface UpiAccountRef {
    id?: string;
    app?: string;
    number?: string;
    holderName?: string;
    accountName?: string;
}

export interface RecordPaymentInput {
    clubId: string;
    type: PaymentType;
    amount: number;
    method: PayMethod;
    /** Required for split; ignored otherwise — derived from method + amount. */
    cashAmount?: number;
    upiAmount?: number;
    upiAccount?: UpiAccountRef | null;

    memberId?: string | null;
    memberName?: string;
    /** Human-readable club ID (MNC-A-183) — handy in exports. */
    humanMemberId?: string;

    /** Shake credits granted by this payment, so a deletion can reverse them. */
    creditsAdded?: number;
    planId?: string;
    planName?: string;

    description?: string;
    /** Where it came from, e.g. "reception" | "member_app" | "magician". */
    source?: string;
    /** Back-date a correction. Defaults to today, local. */
    date?: string;
    /** Ties the payment to the request/entry that produced it. */
    referenceId?: string;
}

/** Local YYYY-MM-DD. Never use toISOString() for a club-day. */
export function todayLocal(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Builds the document. Exported so callers can add it to their own batch. */
export function buildPaymentDoc(input: RecordPaymentInput): Record<string, any> {
    // The one rule, shared with every other writer — see lib/paymentSplit.
    // It used to live only here, which is why the writers that never adopted
    // recordPayment could store a split that did not equal its own amount.
    const { amount, paymentMethod: method, cashAmount: cash, upiAmount: upi } =
        normalizeTender(input.amount, input.method, input.cashAmount, input.upiAmount);

    const u = input.upiAccount;
    return {
        type: input.type,
        amount,
        paymentMethod: method,
        cashAmount: cash,
        upiAmount: upi,
        ...(upi > 0 && u
            ? {
                  upiAccountId: u.id ?? null,
                  upiAccountName: u.accountName ?? u.app ?? null,
                  upiApp: u.app ?? null,
                  upiNumber: u.number ?? null,
                  upiHolderName: u.holderName ?? null,
              }
            : {}),
        memberId: input.memberId ?? null,
        memberName: input.memberName ?? "",
        ...(input.humanMemberId ? { humanMemberId: input.humanMemberId } : {}),
        ...(input.creditsAdded != null ? { creditsAdded: Number(input.creditsAdded) || 0 } : {}),
        ...(input.planId ? { planId: input.planId } : {}),
        ...(input.planName ? { planName: input.planName } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.referenceId ? { referenceId: input.referenceId } : {}),
        date: input.date || todayLocal(),
        deleted: false,
        createdAt: serverTimestamp(),
    };
}

/** Write the payment on its own. Returns the new document id. */
export async function recordPayment(input: RecordPaymentInput): Promise<string> {
    const ref = await addDoc(collection(db, "clubs", input.clubId, "payments"), buildPaymentDoc(input));
    return ref.id;
}

/**
 * Add the payment to a batch the caller is already building, so the money and
 * whatever it paid for commit together — no state where credits were granted
 * but the payment vanished.
 */
type SetWriter = { set: (ref: DocumentReference, data: Record<string, unknown>) => unknown };
export function addPaymentToBatch(batch: SetWriter, input: RecordPaymentInput): string {
    const ref = doc(collection(db, "clubs", input.clubId, "payments"));
    batch.set(ref, buildPaymentDoc(input));
    return ref.id;
}
