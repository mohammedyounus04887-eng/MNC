/**
 * Night Shake — the club's evening operation.
 *
 * It runs alongside the day club and shares its members, but nothing else:
 * its own passes, its own plans, its own takings. A night shake must never
 * touch a member's normal shake credits, and the day's report must not quietly
 * absorb the night's money — the two are reported separately and only combined
 * deliberately.
 *
 * UMS is the night-shake pass. A member buys a bundle up front and each night
 * shake spends one. Three ways to be served, and the desk sees all three:
 *
 *   Pay now      cash / UPI / split, no pass involved
 *   Use a pass   one UMS comes off the balance, no money changes hands
 *   Buy passes   a plan is sold, the balance goes up, money is recorded
 *
 * WHERE THINGS LIVE. Everything sits ONE level below the club, because that is
 * what the live security rules permit — a deeper path is silently refused, and
 * this codebase has been bitten by that twice.
 *
 *   clubs/{clubId}/nightShakePlans/{id}   the pass bundles on sale
 *   clubs/{clubId}/nightShakeOrders/{id}  one row per shake served
 *   clubs/{clubId}/payments/{id}          money, tagged type: 'night_shake'
 *   members/{id}.umsBalance               passes in hand
 *
 * Money goes through the same normalizeTender rule as everything else, so the
 * cash and UPI parts always add up to the amount.
 */

import {
    addDoc, collection, doc, getDocs, increment, query, serverTimestamp,
    updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";
import { normalizeTender } from "@/lib/paymentSplit";
import { getNextOrderNumber } from "@/utils/orderNumber";

export type NightPayMethod = "cash" | "upi" | "split";

/** A bundle of passes on sale. */
export interface NightShakePlan {
    id: string;
    name: string;
    /** What the member pays. */
    price: number;
    /** How many night shakes the bundle is worth. 0 = unlimited for a period. */
    umsCount: number;
    /** Optional validity. 0 or absent = passes never expire. */
    durationDays?: number;
    isActive?: boolean;
    createdAt?: unknown;
}

export const nightPlansPath = (clubId: string) => `clubs/${clubId}/nightShakePlans`;
export const nightOrdersPath = (clubId: string) => `clubs/${clubId}/nightShakeOrders`;

/** Passes a member currently holds. */
export function umsBalanceOf(member: any): number {
    return Number(member?.umsBalance) || 0;
}

// ─── Plans ───────────────────────────────────────────────────────────────

export async function listNightPlans(clubId: string): Promise<NightShakePlan[]> {
    const snap = await getDocs(collection(db, nightPlansPath(clubId)));
    return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((p) => p.isActive !== false)
        .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
}

export async function saveNightPlan(clubId: string, plan: Partial<NightShakePlan> & { id?: string }) {
    const body = {
        name: String(plan.name || "").trim(),
        price: Number(plan.price) || 0,
        umsCount: Number(plan.umsCount) || 0,
        durationDays: Number(plan.durationDays) || 0,
        isActive: plan.isActive !== false,
        updatedAt: serverTimestamp(),
    };
    if (plan.id) {
        await updateDoc(doc(db, nightPlansPath(clubId), plan.id), body);
        return plan.id;
    }
    const ref = await addDoc(collection(db, nightPlansPath(clubId)), { ...body, createdAt: serverTimestamp() });
    return ref.id;
}

/** Soft-remove, so a plan already sold still resolves in old records. */
export async function deactivateNightPlan(clubId: string, planId: string) {
    await updateDoc(doc(db, nightPlansPath(clubId), planId), { isActive: false, updatedAt: serverTimestamp() });
}

// ─── Serving a night shake ───────────────────────────────────────────────

interface ServeInput {
    clubId: string;
    member: { id: string; name?: string; memberId?: string; photo?: string };
    itemName: string;
    /** Present when paying now. Omitted when a pass is spent. */
    payment?: { amount: number; method: NightPayMethod; cashAmount?: number; upiAmount?: number; upiAccount?: any };
    /** True when one UMS pass is being spent instead of money. */
    useUms?: boolean;
    servedBy?: string;
    /** Also raise a kitchen ticket, so someone knows to make it. */
    sendToKitchen?: boolean;
}

export interface ServeResult { tokenNumber?: string; }

/**
 * Serve one night shake. Everything lands in a single batch, so a member is
 * never charged without the shake being recorded, and a pass is never spent
 * without the order existing.
 */
export async function serveNightShake(input: ServeInput): Promise<ServeResult> {
    const { clubId, member, itemName, payment, useUms, servedBy, sendToKitchen } = input;
    if (!clubId || !member?.id) throw new Error("Missing club or member");
    if (!payment && !useUms) throw new Error("A night shake must either be paid for or spend a pass");

    const date = todayLocal();
    const tokenNumber = sendToKitchen ? await getNextOrderNumber(clubId) : undefined;
    const batch = writeBatch(db);

    const tender = payment
        ? normalizeTender(payment.amount, payment.method, payment.cashAmount, payment.upiAmount)
        : null;

    // 1. The night-shake record — the night's own book.
    batch.set(doc(collection(db, nightOrdersPath(clubId))), {
        memberId: member.id,
        memberName: member.name || "",
        humanMemberId: member.memberId || "",
        memberPhoto: member.photo || "",
        itemName,
        paidWith: useUms ? "ums" : "money",
        amount: tender ? tender.amount : 0,
        paymentMethod: tender ? tender.paymentMethod : "ums",
        cashAmount: tender ? tender.cashAmount : 0,
        upiAmount: tender ? tender.upiAmount : 0,
        umsUsed: useUms ? 1 : 0,
        ...(tokenNumber ? { tokenNumber } : {}),
        servedBy: servedBy || "",
        date,
        clubId,
        createdAt: serverTimestamp(),
    });

    // 2. Money, only when money changed hands — tagged so the day's revenue can
    //    include or exclude the night deliberately rather than by accident.
    if (tender && tender.amount > 0) {
        const u = payment?.upiAccount;
        batch.set(doc(collection(db, "clubs", clubId, "payments")), {
            type: "night_shake",
            memberId: member.id,
            memberName: member.name || "",
            humanMemberId: member.memberId || "",
            amount: tender.amount,
            paymentMethod: tender.paymentMethod,
            cashAmount: tender.cashAmount,
            upiAmount: tender.upiAmount,
            ...(tender.upiAmount > 0 && u ? {
                upiAccountId: u.id ?? null,
                upiAccountName: u.accountName ?? u.name ?? u.app ?? null,
                upiNumber: u.number ?? null,
            } : {}),
            description: `Night shake — ${itemName}${servedBy ? ` (served by ${servedBy})` : ""}`,
            source: "night_shake",
            date,
            deleted: false,
            createdAt: serverTimestamp(),
        });
    }

    // 3. Spend the pass.
    if (useUms) {
        batch.update(doc(db, "clubs", clubId, "members", member.id), {
            umsBalance: increment(-1),
            umsLastUsedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    }

    // 4. Kitchen ticket, if someone is making it.
    if (sendToKitchen) {
        batch.set(doc(collection(db, "clubs", clubId, "orders")), {
            memberId: member.id,
            memberName: member.name || "",
            memberPhoto: member.photo || "",
            items: [{ itemName, productName: itemName, qty: 1, quantity: 1, price: tender ? tender.amount : 0, pricePerUnit: tender ? tender.amount : 0, notes: "Night shake" }],
            totalAmount: tender ? tender.amount : 0,
            totalCost: tender ? tender.amount : 0,
            status: "pending",
            source: "night_shake",
            orderedFrom: "night_shake",
            paymentMethod: useUms ? "ums" : (tender?.paymentMethod ?? "cash"),
            creditsUsed: 0,
            tokenNumber,
            date,
            clubId,
            createdAt: serverTimestamp(),
        });
    }

    await batch.commit();
    return { tokenNumber };
}

// ─── Selling passes ──────────────────────────────────────────────────────

/**
 * Sell a bundle of passes. Money and balance move together, so a member cannot
 * be charged without receiving the passes.
 */
export async function sellUmsPlan(input: {
    clubId: string;
    member: { id: string; name?: string; memberId?: string };
    plan: NightShakePlan;
    method: NightPayMethod;
    cashAmount?: number;
    upiAmount?: number;
    upiAccount?: any;
    soldBy?: string;
}): Promise<void> {
    const { clubId, member, plan, method, cashAmount, upiAmount, upiAccount, soldBy } = input;
    if (!clubId || !member?.id || !plan?.id) throw new Error("Missing club, member or plan");

    const tender = normalizeTender(Number(plan.price) || 0, method, cashAmount, upiAmount);
    const passes = Number(plan.umsCount) || 0;
    const date = todayLocal();
    const batch = writeBatch(db);

    batch.set(doc(collection(db, "clubs", clubId, "payments")), {
        type: "night_ums_purchase",
        memberId: member.id,
        memberName: member.name || "",
        humanMemberId: member.memberId || "",
        amount: tender.amount,
        paymentMethod: tender.paymentMethod,
        cashAmount: tender.cashAmount,
        upiAmount: tender.upiAmount,
        ...(tender.upiAmount > 0 && upiAccount ? {
            upiAccountId: upiAccount.id ?? null,
            upiAccountName: upiAccount.accountName ?? upiAccount.name ?? upiAccount.app ?? null,
            upiNumber: upiAccount.number ?? null,
        } : {}),
        planId: plan.id,
        planName: plan.name,
        // Recorded so a deletion can take the passes back, the same way a plan
        // purchase records the credits it granted.
        umsAdded: passes,
        description: `Night pass — ${plan.name} (${passes} shake${passes === 1 ? "" : "s"})${soldBy ? ` — ${soldBy}` : ""}`,
        source: "night_shake",
        date,
        deleted: false,
        createdAt: serverTimestamp(),
    });

    const memberUpdate: Record<string, any> = {
        umsBalance: increment(passes),
        umsLastPurchaseAt: serverTimestamp(),
        umsPlanName: plan.name,
        updatedAt: serverTimestamp(),
    };
    if (Number(plan.durationDays) > 0) {
        const end = new Date(Date.now() + Number(plan.durationDays) * 86400000);
        memberUpdate.umsExpiry = todayLocal(end);
    }
    batch.update(doc(db, "clubs", clubId, "members", member.id), memberUpdate);

    await batch.commit();
}

// ─── The night's takings ─────────────────────────────────────────────────

export interface NightDayTotals {
    date: string;
    shakes: number;
    paidShakes: number;
    passShakes: number;
    cash: number;
    upi: number;
    total: number;
    umsSold: number;
    umsRevenue: number;
    orders: any[];
}

/** Everything the night did on one club day. */
export async function getNightTotals(clubId: string, date: string): Promise<NightDayTotals> {
    const [orderSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, nightOrdersPath(clubId)), where("date", "==", date))),
        getDocs(query(collection(db, "clubs", clubId, "payments"), where("date", "==", date))),
    ]);

    const orders = orderSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((o) => !o.deleted);
    const payments = paySnap.docs.map((d) => d.data() as any).filter((p) => !p.deleted);

    let cash = 0, upi = 0, umsSold = 0, umsRevenue = 0;
    for (const p of payments) {
        if (p.type === "night_shake") {
            cash += Number(p.cashAmount) || 0;
            upi += Number(p.upiAmount) || 0;
        } else if (p.type === "night_ums_purchase") {
            cash += Number(p.cashAmount) || 0;
            upi += Number(p.upiAmount) || 0;
            umsSold += Number(p.umsAdded) || 0;
            umsRevenue += Number(p.amount) || 0;
        }
    }

    return {
        date,
        shakes: orders.length,
        paidShakes: orders.filter((o) => o.paidWith === "money").length,
        passShakes: orders.filter((o) => o.paidWith === "ums").length,
        cash, upi, total: cash + upi,
        umsSold, umsRevenue,
        orders,
    };
}
