import {
    addDoc, collection, doc, getDoc, increment, serverTimestamp,
    Timestamp, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNextOrderNumber } from "@/utils/orderNumber";
import { generateTxnId } from "@/utils/printReceipt";
import { logInvoice } from "@/utils/invoice";
import { planCreditsOf } from "@/utils/planCredits";
import { recordPayment } from "@/lib/recordPayment";
import type {
    PaymentIntent, PaymentSelectionShape, UpiAccount,
} from "./types";
import { printPaymentIntent } from "./print";

// ─── Magician paid-intent handlers ─────────────────────────────────────
// Each handler mirrors the EXACT Firestore writes the manual Reception
// flow does after accountant verify. Keep this file in lockstep with the
// corresponding `complete*` functions in src/pages/Reception.tsx — if a
// field is added/renamed there, do the same here.
//
// Reference lines in Reception.tsx (as of 2026-05-23):
//   completeOneDayShake     : 1546-1759
//   redeemOneDayShake       : 1767-1877
//   completeTopup           : 1340-1410
//   completePlanPurchase    : 1415-1545

const todayStr = () => new Date().toISOString().slice(0, 10);

interface HandlerContext {
    clubId: string;
    verifierName: string;
    upiAccounts: UpiAccount[];
}

// Compute cash/upi/UPI account from selection + amount
function resolvePayment(selection: PaymentSelectionShape, total: number, upiAccounts: UpiAccount[]) {
    const method = selection.method;
    const cashAmount = method === "cash" ? total
        : method === "split" ? (selection.cashAmount ?? 0)
        : 0;
    const upiAmount = method === "upi" ? total
        : method === "split" ? (selection.upiAmount ?? 0)
        : 0;
    const upiAccount = (method === "upi" || method === "split") && selection.upiAccountId
        ? upiAccounts.find((u) => u.id === selection.upiAccountId) || null
        : null;
    return { method, cashAmount, upiAmount, upiAccount };
}

// ─── one-day shake purchase ────────────────────────────────────────────
async function handleOneDayShake(intent: PaymentIntent, ctx: HandlerContext, ids: { tokenNumber: string; receiptNumber: string }): Promise<void> {
    const p = intent.payload;
    if (p.kind !== "oneday_shake") return;
    const { member, item, days, unitPrice } = p;
    const total = unitPrice * days;
    const extraDays = days - 1;
    const { method, cashAmount, upiAmount, upiAccount } = resolvePayment(intent.selection, total, ctx.upiAccounts);
    const td = todayStr();
    const tokenNumber = ids.tokenNumber;
    const receiptNumber = ids.receiptNumber;
    const shakeName = (item as any).itemName || item.name || "Shake";
    const daysSuffix = days > 1 ? ` × ${days} days (₹${total})` : "";
    const payDesc = method === "split"
        ? `One-day shake (Magician): ${shakeName}${daysSuffix} (Split: Cash ₹${cashAmount} + UPI ₹${upiAmount}) — verified by ${ctx.verifierName}`
        : upiAccount
            ? `One-day shake (Magician): ${shakeName}${daysSuffix} (UPI: ${upiAccount.app} ${upiAccount.number}) — verified by ${ctx.verifierName}`
            : `One-day shake (Magician): ${shakeName}${daysSuffix} (Cash) — verified by ${ctx.verifierName}`;

    // 1. payment doc
    await addDoc(collection(db, "clubs", ctx.clubId, "payments"), {
        type: "oneday_shake",
        memberId: member.id, memberName: member.name || "",
        amount: total, daysPaid: days, unitPrice,
        paymentMethod: method, cashAmount, upiAmount,
        ...(upiAccount ? {
            upiAccountId: upiAccount.id, upiApp: upiAccount.app,
            upiNumber: upiAccount.number, upiHolderName: upiAccount.holderName,
        } : {}),
        description: payDesc, shakeName,
        receiptNumber, tokenNumber,
        date: td, createdAt: serverTimestamp(),
    });

    // 2. order (kitchen display picks this up via existing useKitchenOrders)
    await addDoc(collection(db, "clubs", ctx.clubId, "orders"), {
        memberId: member.id, memberName: member.name || "",
        memberPhoto: (member as any).photoUrl || (member as any).photo || "",
        items: [{
            productId: item.id, itemName: shakeName, productName: shakeName,
            qty: 1, quantity: 1, price: unitPrice, pricePerUnit: unitPrice, notes: "",
        }],
        totalAmount: unitPrice, totalCost: unitPrice,
        status: "pending", source: "reception_magician",
        paymentMethod: `oneday_${method}`,
        tokenNumber, verifiedBy: ctx.verifierName,
        date: td, clubId: ctx.clubId, createdAt: serverTimestamp(),
    });

    // 3. limited stock decrement
    if ((item as any).stockType === "limited") {
        await updateDoc(doc(db, "clubs", ctx.clubId, "todaysSpecial", item.id), {
            remainingStock: increment(-1),
        });
    }

    // 4. member-level: transaction + counters + banked extra days
    await addDoc(collection(db, "clubs", ctx.clubId, "members", member.id, "transactions"), {
        type: "debit", amount: total, reason: "oneday_shake",
        daysPaid: days, description: payDesc, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "clubs", ctx.clubId, "members", member.id), {
        lastOneDayShakeAt: serverTimestamp(),
        oneDayShakeCount: increment(1),
        ...(extraDays > 0 ? { oneDayShakeCredits: increment(extraDays) } : {}),
    });

    // 5. invoice (non-fatal)
    try {
        await logInvoice(ctx.clubId, member.id, {
            type: "shake_order",
            title: days > 1
                ? `One-Day Shake × ${days} days — ${shakeName}`
                : `One-Day Shake — ${shakeName}`,
            items: [{
                description: days > 1
                    ? `${shakeName} (1 served today + ${extraDays} prepaid)`
                    : shakeName,
                qty: days, rate: unitPrice, amount: total,
            }],
            paymentMethod: method,
            paymentReference: upiAccount ? `UPI · ${upiAccount.app} · ${upiAccount.number}` : undefined,
            notes: `Verified by ${ctx.verifierName}`,
        } as any);
    } catch (e) { console.warn("[magician] oneday invoice failed", e); }
}

// ─── day shake redeem (free) ──────────────────────────────────────────
async function handleDayRedeem(intent: PaymentIntent, ctx: HandlerContext, ids: { tokenNumber: string }): Promise<void> {
    const p = intent.payload;
    if (p.kind !== "day_redeem") return;
    const { member, item } = p;
    const td = todayStr();
    const tokenNumber = ids.tokenNumber;
    const shakeName = (item as any).itemName || item.name || "Shake";

    // Re-read member's current credits to avoid a stale-state over-redeem
    const memberSnap = await getDoc(doc(db, "clubs", ctx.clubId, "members", member.id));
    const credits: number = ((memberSnap.data() as any)?.oneDayShakeCredits ?? 0);
    if (credits <= 0) {
        throw new Error(`${member.name}: no day-shake credits available`);
    }

    await addDoc(collection(db, "clubs", ctx.clubId, "orders"), {
        memberId: member.id, memberName: member.name || "",
        memberPhoto: (member as any).photoUrl || (member as any).photo || "",
        items: [{
            productId: item.id, itemName: shakeName, productName: shakeName,
            qty: 1, quantity: 1, price: 0, pricePerUnit: 0, notes: "",
        }],
        totalAmount: 0, totalCost: 0,
        status: "pending", source: "reception_magician",
        paymentMethod: "oneday_prepaid",
        oneDayShakeRedemption: true,
        tokenNumber,
        date: td, clubId: ctx.clubId, createdAt: serverTimestamp(),
    });

    if ((item as any).stockType === "limited") {
        await updateDoc(doc(db, "clubs", ctx.clubId, "todaysSpecial", item.id), {
            remainingStock: increment(-1),
        });
    }

    await addDoc(collection(db, "clubs", ctx.clubId, "members", member.id, "transactions"), {
        type: "shake_redemption", amount: 0, reason: "oneday_prepaid",
        description: `Day shake redeem (Magician): ${shakeName}`,
        createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "clubs", ctx.clubId, "members", member.id), {
        oneDayShakeCredits: increment(-1),
        oneDayShakeCount: increment(1),
    });
}

// ─── wallet top-up ─────────────────────────────────────────────────────
async function handleTopup(intent: PaymentIntent, ctx: HandlerContext): Promise<void> {
    const p = intent.payload;
    if (p.kind !== "topup") return;
    const { member, amount } = p;
    const { method, cashAmount, upiAmount, upiAccount } = resolvePayment(intent.selection, amount, ctx.upiAccounts);

    const walletRef = doc(db, "clubs", ctx.clubId, "members", member.id, "wallet", "data");
    const walletSnap = await getDoc(walletRef);
    const current = (walletSnap.data() as any)?.balance ?? 0;
    await updateDoc(walletRef, {
        balance: current + amount,
        updatedAt: serverTimestamp(),
    });

    const methodLabel = method === "split"
        ? `Split: Cash Rs.${cashAmount} + UPI Rs.${upiAmount}`
        : method === "upi"
            ? `UPI${upiAccount ? ` (${upiAccount.app})` : ""}`
            : "Cash";

    await addDoc(collection(db, "clubs", ctx.clubId, "members", member.id, "transactions"), {
        type: "credit", amount, reason: "manual_topup",
        description: `Magician top-up (${methodLabel}) — verified by ${ctx.verifierName}`,
        balanceAfter: current + amount,
        approvedBy: ctx.verifierName,
        paymentMethod: method, cashAmount, upiAmount,
        ...(upiAccount ? {
            upiAccountId: upiAccount.id, upiAccountName: upiAccount.app,
            upiNumber: upiAccount.number,
        } : {}),
        createdAt: serverTimestamp(),
    });

    // First-topup → flip permanent (mirrors Reception line 1376)
    if (!(member as any).isPermanent) {
        await updateDoc(doc(db, "clubs", ctx.clubId, "members", member.id), {
            isPermanent: true, isActiveMember: true,
            memberType: "permanent", status: "active",
            activatedAt: serverTimestamp(), activatedBy: "magician_topup",
        });
    }

    // Record the money — this path wrote no `payments` doc, so a voice top-up
    // credited the wallet and showed as zero revenue. No `topupRequests` doc is
    // created here, so it cannot double-count against the Reports top-up tally.
    await recordPayment({
        clubId: ctx.clubId,
        type: "wallet_topup",
        amount,
        method,
        cashAmount,
        upiAmount,
        upiAccount: upiAccount ?? null,
        memberId: member.id,
        memberName: (member as any).name ?? "",
        description: `Wallet top-up (${methodLabel}) — verified by ${ctx.verifierName}`,
        source: "magician",
    });

    try {
        await logInvoice(ctx.clubId, member.id, {
            type: "wallet_topup",
            title: "Wallet Top-up",
            items: [{ description: `Wallet top-up (${methodLabel})`, qty: 1, rate: amount, amount }],
            paymentMethod: method,
            paymentReference: method === "split"
                ? `Cash Rs.${cashAmount} + UPI Rs.${upiAmount}${upiAccount ? ` (${upiAccount.app})` : ""}`
                : method === "upi" && upiAccount
                    ? `UPI · ${upiAccount.app} · ${upiAccount.number}`
                    : undefined,
            notes: `Verified by ${ctx.verifierName}`,
        } as any);
    } catch (e) { console.warn("[magician] topup invoice failed", e); }
}

// ─── plan renewal ──────────────────────────────────────────────────────
async function handlePlanRenewal(intent: PaymentIntent, ctx: HandlerContext): Promise<void> {
    const p = intent.payload;
    if (p.kind !== "plan_renewal") return;
    const { member, plan } = p;
    const planPrice = (plan as any).price ?? 0;
    const planVisits = planCreditsOf(plan);
    const planDays = (plan as any).durationDays ?? 30;
    const { method, cashAmount, upiAmount, upiAccount } = resolvePayment(intent.selection, planPrice, ctx.upiAccounts);
    const td = todayStr();

    // Capped denominator pattern from Reception line 1449
    const memberSnap = await getDoc(doc(db, "clubs", ctx.clubId, "members", member.id));
    const currentCredits = ((memberSnap.data() as any)?.shakeCredits ?? 0) as number;
    const newPlanTotal = currentCredits + planVisits;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + planDays);

    await updateDoc(doc(db, "clubs", ctx.clubId, "members", member.id), {
        status: "active",
        shakeCredits: newPlanTotal,
        shakeCreditsPlanTotal: newPlanTotal,
        membershipPlanId: plan.id,
        membershipStartDate: Timestamp.fromDate(start),
        membershipEndDate: Timestamp.fromDate(end),
        // Same value under the other expiry field name — see lib/membership.ts.
        membershipEnd: Timestamp.fromDate(end),
        updatedAt: serverTimestamp(),
    });

    const methodLabel = method === "split"
        ? `Split Cash Rs.${cashAmount} + UPI Rs.${upiAmount}`
        : method === "upi"
            ? `UPI${upiAccount ? ` (${upiAccount.app})` : ""}`
            : "Cash";

    await addDoc(collection(db, "clubs", ctx.clubId, "members", member.id, "transactions"), {
        type: "credit", amount: planPrice, reason: "plan_purchase",
        description: `${plan.name} plan (${methodLabel}) — verified by ${ctx.verifierName} via Magician`,
        approvedBy: ctx.verifierName,
        paymentMethod: method, cashAmount, upiAmount,
        ...(upiAccount ? {
            upiAccountId: upiAccount.id, upiAccountName: upiAccount.app,
            upiNumber: upiAccount.number,
        } : {}),
        createdAt: serverTimestamp(),
    });

    await addDoc(collection(db, "clubs", ctx.clubId, "payments"), {
        type: "plan_purchase",
        memberId: member.id, memberName: member.name || "",
        amount: planPrice, paymentMethod: method, cashAmount, upiAmount,
        ...(upiAccount ? {
            upiAccountId: upiAccount.id, upiApp: upiAccount.app,
            upiNumber: upiAccount.number, upiHolderName: upiAccount.holderName,
        } : {}),
        planId: plan.id, planName: plan.name,
        description: `${plan.name} plan via Magician (${methodLabel}) — verified by ${ctx.verifierName}`,
        date: td, createdAt: serverTimestamp(),
    });

    try {
        await logInvoice(ctx.clubId, member.id, {
            type: "membership",
            title: `${plan.name} Membership Plan`,
            items: [{ description: `${plan.name} (${planDays} days · ${planVisits} credits)`,
                qty: 1, rate: planPrice, amount: planPrice }],
            paymentMethod: method,
            paymentReference: method === "split"
                ? `Cash Rs.${cashAmount} + UPI Rs.${upiAmount}${upiAccount ? ` (${upiAccount.app})` : ""}`
                : method === "upi" && upiAccount
                    ? `UPI · ${upiAccount.app} · ${upiAccount.number}`
                    : undefined,
            notes: `Verified by ${ctx.verifierName}`,
        } as any);
    } catch (e) { console.warn("[magician] plan invoice failed", e); }
}

// ─── product sale ──────────────────────────────────────────────────────
// Mirrors useSaveProductSale in src/hooks/useInventoryManagement.ts
// (lines 233-367). Magician carries a SECOND verifier (inventory mgr)
// so both names land on the payment + sale + log records.
async function handleProductSale(
    intent: PaymentIntent, ctx: HandlerContext,
    inventoryVerifier: { id: string; name: string },
): Promise<void> {
    const p = intent.payload;
    if (p.kind !== "product_sale") return;
    const { buyer, product, quantity, unitPrice, isGift } = p;
    const totalAmount = unitPrice * quantity;
    const { method, cashAmount, upiAmount, upiAccount } = resolvePayment(intent.selection, totalAmount, ctx.upiAccounts);
    const td = todayStr();
    const saleId = "ps_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const now = Timestamp.now();

    // Read current inventory qty so the log captures before+after
    const prodRef = doc(db, `clubs/${ctx.clubId}/inventory`, product.id);
    const prodSnap = await getDoc(prodRef);
    const currentQty = (prodSnap.data() as any)?.quantity ?? 0;
    const newQty = Math.max(0, currentQty - quantity);

    // 1. Sale record
    await addDoc(collection(db, `clubs/${ctx.clubId}/productSales`), {
        id: saleId,
        clubId: ctx.clubId,
        productId: product.id, productName: product.name, unit: product.unit,
        quantity, price: unitPrice, totalAmount,
        buyerId: buyer.id, buyerName: buyer.name || "", isGift,
        paymentMethod: isGift ? "cash" : method,
        ...(method === "cash" || isGift ? { cashAmount: isGift ? 0 : totalAmount, upiAmount: 0 } : {}),
        ...(method === "upi" && !isGift ? { cashAmount: 0, upiAmount: totalAmount } : {}),
        ...(method === "split" && !isGift ? { cashAmount, upiAmount } : {}),
        ...(upiAccount && !isGift ? {
            upiAccountId: upiAccount.id, upiAccountName: upiAccount.app, upiNumber: upiAccount.number,
        } : {}),
        accountantVerifiedBy: ctx.verifierName, accountantVerifiedById: "magician",
        inventoryVerifiedBy: inventoryVerifier.name, inventoryVerifiedById: inventoryVerifier.id,
        date: td, createdAt: now,
    });

    // 2. Inventory deduct + log
    if (prodSnap.exists()) {
        await updateDoc(prodRef, { quantity: newQty, updatedAt: now });
        await addDoc(collection(db, `clubs/${ctx.clubId}/inventoryLogs`), {
            clubId: ctx.clubId, type: "product_sale",
            productId: product.id, productName: product.name,
            quantityChange: -quantity, quantityBefore: currentQty, quantityAfter: newQty,
            referenceId: saleId, performedBy: inventoryVerifier.name,
            date: td, createdAt: now,
        });
    }

    // 3. Payment record (skip for gifts since no money)
    if (!isGift && totalAmount > 0) {
        await addDoc(collection(db, `clubs/${ctx.clubId}/payments`), {
            type: "product_sale",
            memberId: buyer.id, memberName: buyer.name || "",
            amount: totalAmount, paymentMethod: method,
            cashAmount, upiAmount,
            ...(upiAccount ? {
                upiAccountId: upiAccount.id, upiAccountName: upiAccount.app,
                upiNumber: upiAccount.number,
            } : {}),
            productName: product.name, productId: product.id, quantity,
            isGift: false,
            description: `Sold via Magician: ${product.name} ×${quantity} to ${buyer.name} — verified by ${ctx.verifierName}`,
            date: td, createdAt: now,
        });
    }

    // 4. Member transaction
    await addDoc(collection(db, `clubs/${ctx.clubId}/members/${buyer.id}/transactions`), {
        type: "debit",
        amount: totalAmount,
        reason: "product",
        description: isGift
            ? `Gift received via Magician: ${product.name} ×${quantity}`
            : `Purchased via Magician: ${product.name} ×${quantity}`,
        productSaleId: saleId, productName: product.name,
        paymentMethod: isGift ? "cash" : method,
        createdAt: now,
    });

    // 5. Invoice (paid only)
    if (!isGift && totalAmount > 0) {
        try {
            await logInvoice(ctx.clubId, buyer.id, {
                type: "product_sale",
                title: `Product Sale — ${product.name}`,
                items: [{ description: `${product.name} (${quantity} ${product.unit})`,
                    qty: quantity, rate: unitPrice, amount: totalAmount }],
                paymentMethod: method,
                notes: `Verified by ${ctx.verifierName}; inventory by ${inventoryVerifier.name}`,
            } as any);
        } catch (e) { console.warn("[magician] product sale invoice failed", e); }
    }
}

// ─── dispatcher ────────────────────────────────────────────────────────

export async function executePaymentIntent(
    intent: PaymentIntent, ctx: HandlerContext,
    inventoryVerifier?: { id: string; name: string },
): Promise<void> {
    const tokenNumber = await getNextOrderNumber(ctx.clubId);
    const receiptNumber = generateTxnId();
    const printCtx = {
        clubId: ctx.clubId, verifierName: ctx.verifierName,
        upiAccounts: ctx.upiAccounts, receiptNumber, tokenNumber,
    };

    switch (intent.payload.kind) {
        case "oneday_shake":
            await handleOneDayShake(intent, ctx, { tokenNumber, receiptNumber });
            printPaymentIntent(intent, printCtx);
            return;
        case "day_redeem":
            await handleDayRedeem(intent, ctx, { tokenNumber });
            printPaymentIntent(intent, printCtx);
            return;
        case "topup":
            await handleTopup(intent, ctx);
            printPaymentIntent(intent, printCtx);
            return;
        case "plan_renewal":
            await handlePlanRenewal(intent, ctx);
            printPaymentIntent(intent, printCtx);
            return;
        case "product_sale":
            if (!inventoryVerifier) throw new Error("Product sale needs inventory-manager verify");
            await handleProductSale(intent, ctx, inventoryVerifier);
            return;
    }
}
