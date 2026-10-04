import { fetchClubAndPrint, getCachedShakeTokenToggles } from "@/utils/printReceipt";
import {
    buildShakeTokenReceipt, buildAfreshToken,
    buildGuestPaymentReceipt, buildTopupReceipt, buildMembershipReceipt,
} from "@/utils/receiptBuilder";
import type { PaymentIntent, PaymentSelectionShape, UpiAccount } from "./types";

// ─── Magician receipt printing ─────────────────────────────────────────
// Fire-and-forget receipt prints after each successful paid handler.
// Mirrors the inline print blocks in Reception.tsx:
//   one-day shake: lines 1681-1736
//   topup:         no inline print in current Reception (we add one here)
//   plan renewal:  uses buildMembershipReceipt
//
// All wrapped in try/catch — print failures NEVER block the data write
// that already committed.

interface PrintContext {
    clubId: string;
    verifierName: string;
    upiAccounts: UpiAccount[];
    receiptNumber: string;
    tokenNumber: string;
}

function resolveUpi(selection: PaymentSelectionShape, upiAccounts: UpiAccount[]) {
    return (selection.method === "upi" || selection.method === "split") && selection.upiAccountId
        ? upiAccounts.find((u) => u.id === selection.upiAccountId) || null
        : null;
}

export function printPaymentIntent(intent: PaymentIntent, ctx: PrintContext): void {
    const p = intent.payload;
    const sel = intent.selection;
    const upiAccount = resolveUpi(sel, ctx.upiAccounts);
    const cashAmount = sel.method === "cash" ? intent.totalAmount
        : sel.method === "split" ? (sel.cashAmount ?? 0)
        : 0;
    const upiAmount = sel.method === "upi" ? intent.totalAmount
        : sel.method === "split" ? (sel.upiAmount ?? 0)
        : 0;
    const upiAccountName = upiAccount ? `${upiAccount.app}${upiAccount.holderName ? ` (${upiAccount.holderName})` : ""}` : undefined;
    const now = new Date();

    try {
        if (p.kind === "oneday_shake") {
            const member = p.member;
            const shakeName = (p.item as any).itemName || p.item.name || "Shake";
            const printedName = member.name || "—";
            const printedPhone = (member as any).phone || "";
            const tokenToggles = getCachedShakeTokenToggles(ctx.clubId);

            fetchClubAndPrint(ctx.clubId, (freshClub) => {
                const lines: string[] = [];
                if (tokenToggles.printShakeToken) {
                    lines.push(...buildShakeTokenReceipt({
                        memberName: printedName,
                        items: [{ name: shakeName, qty: 1 }],
                        tokenNumber: ctx.tokenNumber,
                        timestamp: now,
                    } as any));
                }
                if (tokenToggles.printRefreshmentToken) {
                    lines.push(...buildAfreshToken({
                        memberName: printedName,
                        tokenNumber: ctx.tokenNumber,
                        timestamp: now,
                    } as any));
                }
                lines.push(...buildGuestPaymentReceipt({
                    club: freshClub,
                    guestName: printedName,
                    guestPhone: printedPhone,
                    items: [{
                        name: p.days > 1 ? `${shakeName} (1 today + ${p.days - 1} prepaid)` : shakeName,
                        qty: p.days, unitPrice: p.unitPrice, total: intent.totalAmount,
                    }],
                    totalAmount: intent.totalAmount,
                    amountPaid: intent.totalAmount,
                    paymentMethod: sel.method,
                    cashAmount, upiAmount,
                    upiAccountName, upiNumber: upiAccount?.number,
                    receiptNumber: ctx.receiptNumber,
                    tokenNumbers: [ctx.tokenNumber],
                    timestamp: now,
                } as any));
                return lines;
            });
            return;
        }

        if (p.kind === "day_redeem") {
            const member = p.member;
            const shakeName = (p.item as any).itemName || p.item.name || "Shake";
            const tokenToggles = getCachedShakeTokenToggles(ctx.clubId);
            fetchClubAndPrint(ctx.clubId, () => {
                const lines: string[] = [];
                if (tokenToggles.printShakeToken) {
                    lines.push(...buildShakeTokenReceipt({
                        memberName: member.name || "—",
                        items: [{ name: shakeName, qty: 1 }],
                        tokenNumber: ctx.tokenNumber,
                        timestamp: now,
                    } as any));
                }
                if (tokenToggles.printRefreshmentToken) {
                    lines.push(...buildAfreshToken({
                        memberName: member.name || "—",
                        tokenNumber: ctx.tokenNumber,
                        timestamp: now,
                    } as any));
                }
                return lines;
            });
            return;
        }

        if (p.kind === "topup") {
            const member = p.member;
            fetchClubAndPrint(ctx.clubId, (freshClub) => {
                return buildTopupReceipt({
                    club: freshClub,
                    memberName: member.name || "—",
                    memberPhone: (member as any).phone || "",
                    amount: intent.totalAmount,
                    paymentMethod: sel.method,
                    cashAmount, upiAmount,
                    upiAccountName, upiNumber: upiAccount?.number,
                    receiptNumber: ctx.receiptNumber,
                    timestamp: now,
                    verifiedBy: ctx.verifierName,
                } as any);
            });
            return;
        }

        if (p.kind === "plan_renewal") {
            const member = p.member;
            const plan = p.plan;
            fetchClubAndPrint(ctx.clubId, (freshClub) => {
                return buildMembershipReceipt({
                    club: freshClub,
                    memberName: member.name || "—",
                    memberPhone: (member as any).phone || "",
                    planName: plan.name || "",
                    planVisits: (plan as any).visits ?? (plan as any).totalVisits ?? 0,
                    planDurationDays: (plan as any).durationDays ?? 30,
                    amount: intent.totalAmount,
                    paymentMethod: sel.method,
                    cashAmount, upiAmount,
                    upiAccountName, upiNumber: upiAccount?.number,
                    receiptNumber: ctx.receiptNumber,
                    timestamp: now,
                    verifiedBy: ctx.verifierName,
                } as any);
            });
            return;
        }
    } catch (err) {
        console.error("[magician print]", err);
    }
}
