import { useEffect, useState } from "react";
import { X, Download, Printer, Users, ShoppingBag, Wallet, CheckCircle2, UserCheck, Plus, Save, UserPlus, Pencil, Trash2, ChevronDown, ChevronUp, Search, Receipt } from "lucide-react";
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, serverTimestamp, deleteDoc, addDoc, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { removeMemberAttendance } from "@/lib/attendance";
import { useClubContext } from "@/lib/clubDetection";
import { fetchClubAndPrint, printViaRawBT } from "@/utils/printReceipt";
import { prepareDailyInvoice, buildDailyInvoiceThermal } from "@/utils/dailyTaxInvoice";
import { useRejectOrder } from "@/hooks/useOrders";
import {
    buildHeader, buildFooter, ClubPrintData,
    buildShiftSummarySlip, buildTopUpReceipt, buildMembershipReceipt, buildGuestPaymentReceipt, buildProductSaleReceipt,
} from "@/utils/receiptBuilder";
import { generateTxnId } from "@/utils/printReceipt";
import {
    BOLD_ON, BOLD_OFF, SIZE_LARGE, SIZE_MEDIUM, SIZE_NORMAL, ALIGN_CENTER, ALIGN_LEFT,
    LF, DIVIDER_THIN, PRINTER_RESET, CUT,
} from "@/utils/escpos";
import { splitOf, summarizeMoney, isWalletTopup } from "@/lib/paymentSplit";
import {
    deletePaymentCascade,
    updatePaymentCascade,
    deleteTopupRequestCascade,
    updateTopupRequestCascade,
} from "@/lib/cascadeService";
import { todayLocal } from "@/lib/clubDay";
import { useTodayAttendance } from "@/hooks/useAttendance";
import { useTodayProductUsage } from "@/hooks/owner/useTodayProductUsage";
import { useTodayGuestEntriesLive, useDeleteGuestEntry } from "@/hooks/useGuestEntries";
import ManualEntryModal from "@/components/owner/ManualEntryModal";
import GuestEntryModal from "@/components/owner/GuestEntryModal";
import ReceptionGuestWizard from "@/components/reception/ReceptionGuestWizard";
import type { Order, TopupRequest, Attendance, GuestEntry } from "@/types/firestore";

// The club day, local. This was toISOString, which is UTC — and with IST at
// UTC+5:30 it returned YESTERDAY between midnight and 05:30. It feeds the
// orders query, the printed report, the tax invoice and, worst, the saved
// report document, so a report opened early in the morning was built from and
// filed under the previous day.
function todayStr() {
    return todayLocal();
}

/**
 * Money is read through lib/paymentSplit — the same reader the Reports page,
 * the dashboard and the exports use.
 *
 * This file used to carry its own pair, and their rule for money with no
 * recorded method was the OPPOSITE of the shared one: cash here, UPI there. So
 * the till roll printed each evening and the Reports page for the same day
 * disagreed by however much had been taken without a method written down.
 */
function cashOf(rec: any): number {
    return splitOf({ ...rec, amount: rec?.amount ?? rec?.approvedAmount ?? 0 }).cash;
}
function upiOf(rec: any): number {
    return splitOf({ ...rec, amount: rec?.amount ?? rec?.approvedAmount ?? 0 }).upi;
}


// ─── Real-time orders for today ──────────────────────────────────────────

function useTodayOrdersLive(clubId: string | null) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) return;
        const q = query(collection(db, `clubs/${clubId}/orders`), where("date", "==", todayStr()));
        const unsub = onSnapshot(q, (snap) => { setOrders(snap.docs.map((d) => d.data() as Order)); setLoading(false); }, () => setLoading(false));
        return () => unsub();
    }, [clubId]);
    return { orders, loading };
}

// ─── Real-time wallet topup payments approved today ──────────────────────

function useTodayPaymentsLive(clubId: string | null) {
    const [topups, setTopups] = useState<TopupRequest[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) return;
        const todayStart = new Date(todayStr() + "T00:00:00").getTime();
        const todayEnd = todayStart + 86400000;
        // Bound the read: most recent 200 approved topups, newest first.
        // Without this we used to fetch the entire approved-topup history
        // (potentially thousands of docs) just to keep today's handful.
        // We still client-filter to today to handle the case where >200
        // resolved across ≥2 calendar days, but the fetch is now O(200)
        // instead of O(history). Composite index needed: status ASC + resolvedAt DESC.
        const q = query(
            collection(db, `clubs/${clubId}/topupRequests`),
            where("status", "==", "approved"),
            orderBy("resolvedAt", "desc"),
            limit(200),
        );
        const unsub = onSnapshot(q, (snap) => {
            const todayTopups = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TopupRequest))
                // Deleting a top-up soft-deletes it, like every other reversal
                // in this app. Nothing filtered that here, so a deleted top-up
                // would have stayed in the list and in the totals — the
                // deletion looking like it had done nothing, which is exactly
                // how the guest-deletion bug presented.
                .filter((t) => !(t as any).deleted)
                .filter((t) => {
                const ts = (t as any).resolvedAt;
                if (!ts) return false;
                const ms = ts.toMillis ? ts.toMillis() : Number(ts) * 1000;
                return ms >= todayStart && ms < todayEnd;
            });
            setTopups(todayTopups);
            setLoading(false);
        }, () => setLoading(false));
        return () => unsub();
    }, [clubId]);
    return { topups, loading };
}

// ─── Real-time plan purchase & virtual payments ──────────────────────────

interface PaymentRecord {
    id: string;
    type: 'plan_purchase' | 'virtual_member' | string;
    memberId?: string;
    memberName?: string;
    memberPhone?: string;
    virtualMemberId?: string;
    virtualMemberDocId?: string;
    amount: number;
    paymentMethod: string;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    upiHolderName?: string;
    planName?: string;
    description?: string;
    date: string;
    createdAt: any;
}

interface NormalizedEntry {
    id: string;
    source: 'topup' | 'payment';
    memberName: string;
    memberPhoto?: string;
    memberId?: string;
    amount: number;
    paymentMethod: 'cash' | 'upi' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    upiHolderName?: string;
    type: 'plan' | 'shake' | 'topup' | 'virtual' | 'product';
    label: string;
    description?: string;
    time: Date;
    isAudit: boolean;
    verifiedBy?: string;
    raw: any;
}

function methodOf(rec: { paymentMethod?: string }): 'cash' | 'upi' | 'split' {
    const m = (rec.paymentMethod ?? 'cash').toLowerCase();
    if (m === 'upi') return 'upi';
    if (m === 'split') return 'split';
    return 'cash';
}

/**
 * Dispatch the appropriate receipt builder for a given Today's Report row.
 * Used by the per-row "Reprint" button so cashiers can re-issue any
 * transaction's receipt during reconciliation.
 */
function reprintEntry(clubId: string, entry: NormalizedEntry): void {
    const raw: any = entry.raw;
    const ts = entry.time;
    fetchClubAndPrint(clubId, (freshClub) => {
        if (entry.type === 'topup') {
            return buildTopUpReceipt({
                club: freshClub,
                memberName: entry.memberName,
                memberId: raw.memberId || '',
                phone: raw.memberPhone || '',
                amount: entry.amount,
                previousBalance: 0,
                newBalance: 0,
                paymentMethod: entry.paymentMethod,
                cashAmount: entry.cashAmount,
                upiAmount: entry.upiAmount,
                upiAccountName: entry.upiAccountName,
                transactionId: `RP-${entry.id.slice(-6).toUpperCase()}`,
                timestamp: ts,
            });
        }
        if (entry.type === 'plan') {
            return buildMembershipReceipt({
                club: freshClub,
                memberName: entry.memberName,
                memberId: raw.memberId || '',
                planName: entry.label,
                amount: entry.amount,
                totalVisits: 0,
                paymentMethod: entry.paymentMethod,
                startDate: ts,
                endDate: ts,
                timestamp: ts,
                receiptNumber: `RP-${entry.id.slice(-6).toUpperCase()}`,
                walletBalanceAfter: 0,
            });
        }
        if (entry.type === 'product') {
            return buildProductSaleReceipt({
                club: freshClub,
                buyerName: entry.memberName,
                buyerId: raw.memberId,
                productName: raw.productName || entry.label,
                quantity: raw.quantity || 1,
                unit: raw.unit || '-',
                unitPrice: raw.quantity ? entry.amount / raw.quantity : entry.amount,
                totalAmount: entry.amount,
                isGift: !!raw.isGift,
                paymentMethod: entry.paymentMethod,
                cashAmount: entry.cashAmount,
                upiAmount: entry.upiAmount,
                upiAccountName: entry.upiAccountName,
                receiptNumber: `RP-${entry.id.slice(-6).toUpperCase()}`,
                timestamp: ts,
            });
        }
        // shake / virtual / other — fall back to a guest-style payment receipt
        return buildGuestPaymentReceipt({
            club: freshClub,
            guestName: entry.memberName,
            guestPhone: raw.memberPhone || raw.guestPhone || '',
            items: [{ name: entry.label, qty: 1, unitPrice: entry.amount, total: entry.amount }],
            totalAmount: entry.amount,
            amountPaid: entry.amount,
            paymentMethod: entry.paymentMethod,
            cashAmount: entry.cashAmount,
            upiAmount: entry.upiAmount,
            upiAccountName: entry.upiAccountName,
            receiptNumber: `RP-${entry.id.slice(-6).toUpperCase()}`,
            timestamp: ts,
        });
    });
}

function normalizeEntries(topups: TopupRequest[], payments: PaymentRecord[]): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];

    for (const t of topups) {
        const ts = (t as any).resolvedAt;
        let time: Date;
        try { time = ts?.toDate ? ts.toDate() : new Date(ts * 1000); } catch { time = new Date(); }
        entries.push({
            id: t.id,
            source: 'topup',
            memberName: t.memberName || 'Unknown',
            memberPhoto: t.memberPhoto,
            memberId: t.memberId,
            amount: t.approvedAmount ?? 0,
            paymentMethod: methodOf(t as any),
            cashAmount: (t as any).cashAmount,
            upiAmount: (t as any).upiAmount,
            upiAccountId: (t as any).upiAccountId,
            upiAccountName: (t as any).upiAccountName,
            upiNumber: (t as any).upiNumber,
            type: 'topup',
            label: 'Wallet Top-up',
            description: (t as any).reference || '',
            time,
            isAudit: false,
            verifiedBy: (t as any).resolvedBy || '',
            raw: t,
        });
    }

    for (const p of payments) {
        const ts = p.createdAt;
        let time: Date;
        try { time = ts?.toDate ? ts.toDate() : new Date(ts * 1000); } catch { time = new Date(); }

        let type: NormalizedEntry['type'] = 'plan';
        let label = p.planName || 'Payment';
        if (p.type === 'virtual_member') { type = 'virtual'; label = 'Virtual Member'; }
        else if (p.type === 'oneday_shake') { type = 'shake'; label = (p as any).shakeName || 'One-Day Shake'; }
        else if (p.type === 'plan_purchase') { type = 'plan'; label = p.planName || 'Plan Purchase'; }
        else { type = 'product'; label = p.description || 'Other'; }

        entries.push({
            id: p.id,
            source: 'payment',
            memberName: p.memberName || (p as any).guestName || 'Unknown',
            memberPhoto: (p as any).memberPhoto || (p as any).guestPhoto,
            memberId: p.memberId || (p as any).virtualMemberDocId,
            amount: p.amount ?? 0,
            paymentMethod: methodOf(p as any),
            cashAmount: (p as any).cashAmount,
            upiAmount: (p as any).upiAmount,
            upiAccountId: p.upiAccountId,
            upiAccountName: p.upiAccountName || p.upiHolderName,
            upiNumber: p.upiNumber,
            upiHolderName: p.upiHolderName,
            type,
            label,
            description: p.description || '',
            time,
            isAudit: (p as any).source === 'audit',
            verifiedBy: (p as any).verifiedBy || '',
            raw: p,
        });
    }

    entries.sort((a, b) => b.time.getTime() - a.time.getTime());
    return entries;
}

const TYPE_STYLES: Record<NormalizedEntry['type'], { bg: string; text: string; label: string }> = {
    plan: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Plan' },
    shake: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Shake' },
    topup: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Top-up' },
    virtual: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Virtual' },
    product: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Product' },
};

// ─── Expenses ────────────────────────────────────────────────────────────
// Manual expense entries (rent, supplies, etc). Tracked separately so the
// owner can see daily outgoings, but NOT subtracted from revenue totals —
// this is a tracker / reminder, not double-entry bookkeeping.
export interface ExpenseRecord {
    id: string;
    name?: string;                 // who it was paid to / spent by (e.g. "Vignesh")
    description: string;
    amount: number;
    date: string;                  // YYYY-MM-DD
    createdAt?: any;
    createdBy?: string;
}

function useTodayExpensesLive(clubId: string | null) {
    const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setExpenses([]); setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/expenses`),
            where("date", "==", todayStr()),
        );
        const unsub = onSnapshot(q, (snap) => {
            setExpenses(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
            setLoading(false);
        }, (err) => { console.error("[expenses live]", err); setLoading(false); });
        return () => unsub();
    }, [clubId]);

    return { expenses, loading };
}

function useTodayReceptionPaymentsLive(clubId: string | null) {
    const [payments, setPayments] = useState<PaymentRecord[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) return;
        const q = query(collection(db, `clubs/${clubId}/payments`), where("date", "==", todayStr()));
        const unsub = onSnapshot(q, (snap) => {
            // Skip soft-deleted payments. Deleting a wrong entry in Reports sets
            // `deleted: true` and Reports stops counting it — but this screen
            // counted it anyway, so the day's cash count and the monthly book
            // disagreed by exactly the amount that had been deleted. That is
            // the mismatch that sends people hunting for a stray ₹40.
            const rows = snap.docs
                .map((d) => ({ id: d.id, ...d.data() } as PaymentRecord))
                .filter((p) => !(p as any).deleted);
            setPayments(rows);
            setLoading(false);
        }, () => setLoading(false));
        return () => unsub();
    }, [clubId]);
    return { payments, loading };
}

// ─── Receipt builder ─────────────────────────────────────────────────────

// ── Section flags ────────────────────────────────────────────────────────
// Controls which blocks the daily-report receipt emits. Defaults are
// "everything on" so the legacy call-sites keep working unchanged.
export interface ReportPrintSections {
    core: boolean;      // Shakes + Payments + Attendance (the always-useful block)
    guests: boolean;    // Guests sub-section (only emitted if data + flag both)
    expenses: boolean;  // Expenses sub-section (only emitted if data + flag both)
    /** Club name, address, GST line at the top and the tagline at the bottom.
     *  Off saves roughly a third of the paper on a daily report the club only
     *  ever reads itself. */
    letterhead: boolean;
}

// Letterhead defaults OFF: the club prints this for itself every evening,
// and the address/GST block plus the tagline was most of the paper. Tick it
// on for a copy that leaves the building.
const DEFAULT_SECTIONS: ReportPrintSections = { core: true, guests: true, expenses: true, letterhead: false };

function buildTodayReportReceipt(
    club: ClubPrintData,
    orders: Order[],
    topups: TopupRequest[],
    receptionPayments: PaymentRecord[],
    memberCount: number,
    volunteerCount: number,
    date: string,
    guestEntries: GuestEntry[] = [],
    expenses: ExpenseRecord[] = [],
    sections: ReportPrintSections = DEFAULT_SECTIONS,
    productUsage: { name: string; qty: number }[] = [],
): string[] {
    const servedOrders = orders.filter((o) => o.status === "served");
    const isGuestSrv = (o: any) =>
        o?.memberId === "guest" || o?.source === "guest" || o?.orderedFrom === "guest";
    // Count SHAKES (sum of each order's item quantities), NOT orders — one
    // order can contain more than one shake. This matches the on-screen total
    // and the by-shake breakdown below. Previously this used
    // servedOrders.length (an order count), so a day with multi-shake orders
    // printed e.g. "Total Served: 104" while the shakes listed summed to 110.
    const shakeQty = (o: any) => (o.items || []).reduce((s: number, it: any) => s + (Number((it as any).quantity ?? (it as any).qty ?? 1) || 1), 0);
    const totalServedShakes = servedOrders.reduce((s, o) => s + shakeQty(o), 0);
    const guestServedCount = servedOrders.filter(isGuestSrv).reduce((s, o) => s + shakeQty(o), 0);
    const memberServedCount = totalServedShakes - guestServedCount;
    // Revenue only. Wallet top-ups are money moved into a balance, not money
    // earned, and Reports stopped counting them — both the desk's wallet_topup
    // payment docs and the member app's topupRequests. Counting them here made
    // the printed report and the Reports page differ by exactly that amount on
    // any day the club took one.
    // ONE summary, shared with the screen tiles, the Excel and the saved
    // report — see lib/paymentSplit. The drawer is counted against CASH IN
    // HAND (everything physically taken, top-ups included); REVENUE is what
    // the club earned. Printing only one of the two is what made the desk's
    // manual addition disagree with the printed total.
    const money = summarizeMoney(receptionPayments, topups);
    const virtualTotal = receptionPayments
        .filter(p => !(p as any).deleted && p.type === 'virtual_member')
        .reduce((s, p) => s + (p.amount ?? 0), 0);
    const fmt = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

    // Per-shake breakdown — count how many of each shake name were served
    // today. Only served orders count; rejected/cancelled are excluded.
    const shakeCounts: Record<string, number> = {};
    for (const o of servedOrders) {
        for (const it of (o.items || [])) {
            const name = (it as any).productName || (it as any).itemName || (it as any).name || "Shake";
            const qty = Number((it as any).quantity ?? (it as any).qty ?? 1) || 1;
            shakeCounts[name] = (shakeCounts[name] || 0) + qty;
        }
    }
    const shakeBreakdown = Object.entries(shakeCounts).sort(([, a], [, b]) => b - a);

    return [
        // Letterhead is optional. The club prints this daily for itself, and
        // the name/address/GST block at the top plus the tagline at the bottom
        // ate roughly a third of the paper. Switched off, it still prints the
        // club name so a sheet left on the desk is identifiable.
        // PRINTER_RESET must go out whether or not the letterhead does — it is
        // the only thing that puts the printer back to Font A, default spacing
        // and the right codepage. It used to ride along inside buildHeader, so
        // turning the letterhead off left every evening's report inheriting
        // whatever state the previous job ended in.
        ...(sections.letterhead
            ? [...buildHeader(club), LF]
            : [PRINTER_RESET, ALIGN_CENTER, BOLD_ON, club.name + "\n", BOLD_OFF, ALIGN_LEFT]),
        ALIGN_CENTER, BOLD_ON, SIZE_MEDIUM, "TODAY'S REPORT\n", SIZE_NORMAL, BOLD_OFF, ALIGN_LEFT,
        "Date: " + date + "\n",
        ...(sections.core ? [
            DIVIDER_THIN + "\n",
            // Total shakes served — printed large, bold & centered so it's the
            // most prominent number on the slip.
            ALIGN_CENTER, BOLD_ON, "TOTAL SHAKES SERVED\n",
            SIZE_LARGE, String(totalServedShakes) + "\n", SIZE_NORMAL,
            BOLD_OFF, ALIGN_LEFT,
            ...(guestServedCount > 0
                ? [memberServedCount + " members + " + guestServedCount + " guests\n"]
                : []),
            // The per-flavour split is what the report is FOR — it drives what
            // gets ordered — so it stays, without its own heading.
            ...(shakeBreakdown.length > 0 ? [
                ...shakeBreakdown.map(([name, qty]) => `${name} x ${qty}\n`),
            ] : []),
            // Boxes consumed today, from Daily Club Usage. This needs its own
            // label after all: it prints in the same "Name x N" form as the
            // flavour split directly above, and the names legitimately overlap,
            // so without it the two runs merge into one list that reads as
            // double-counted shakes.
            ...(productUsage.length > 0 ? [
                BOLD_ON, "Boxes used:\n", BOLD_OFF,
                ...productUsage.map(u => `${u.name} x ${u.qty}\n`),
            ] : []),
            DIVIDER_THIN + "\n",
            // Money — the two lines the desk actually reconciles with. CASH IN
            // HAND must equal the drawer, UPI must equal the bank, top-ups
            // included in both. Then revenue, with the subtraction VISIBLE so
            // adding the listed payments by hand always agrees with something
            // printed on the slip.
            BOLD_ON, "CASH IN HAND: " + fmt(money.cashCollected) + "\n", BOLD_OFF,
            BOLD_ON, "UPI RECEIVED: " + fmt(money.upiCollected) + "\n", BOLD_OFF,
            "Total collected: " + fmt(money.totalCollected) + "\n",
            ...(money.topupTotal > 0 ? [
                "Wallet top-ups: -" + fmt(money.topupTotal).replace("Rs. ", "Rs.") + "\n",
                "Revenue: " + fmt(money.revenue) + "\n",
            ] : []),
            ...(virtualTotal > 0 ? ["  incl. Virtual " + fmt(virtualTotal) + "\n"] : []),
            // Attendance is two counts, so it is one line.
            "Members " + String(memberCount) + "  ·  Volunteers " + String(volunteerCount) + "\n",
        ] : []),
        ...(sections.guests && guestEntries.length > 0 ? [
            DIVIDER_THIN + "\n",
            // Was five lines for what is really two facts: how many came, and
            // what they paid.
            BOLD_ON, "GUESTS: " + String(guestEntries.length) + "\n", BOLD_OFF,
            String(guestEntries.filter(g => g.type === 'paid').length) + " paid  ·  "
                + String(guestEntries.filter(g => g.type === 'unpaid').length) + " free  ·  "
                + fmt(guestEntries.filter(g => g.type === 'paid').reduce((s, g) => s + (g.amountPaid ?? 0), 0)) + "\n",
        ] : []),
        // EXPENSES — manual outgoings, NOT subtracted from the totals above;
        // a reminder, not double-entry bookkeeping. One line each: the
        // description belongs in the app, not on a till roll.
        ...(sections.expenses && expenses.length > 0 ? [
            DIVIDER_THIN + "\n",
            BOLD_ON, "EXPENSES: " + fmt(expenses.reduce((s, e) => s + (e.amount || 0), 0)) + "\n", BOLD_OFF,
            ...expenses.map(e =>
                ((e.name && e.name.trim()) ? e.name.trim() + " — " : "") + fmt(e.amount || 0) + "\n"),
        ] : []),
        LF,
        // Same for the CUT: it lived only in buildFooter, so with the
        // letterhead off the paper never got cut and the next job ran on
        // straight after this one.
        ...(sections.letterhead ? buildFooter() : [LF, CUT]),
    ];
}

// ─── Excel export ────────────────────────────────────────────────────────

async function exportToExcel(
    clubName: string,
    date: string,
    orders: Order[],
    topups: TopupRequest[],
    receptionPayments: PaymentRecord[],
    memberAttendance: Attendance[],
    volunteerAttendance: Attendance[],
    guestEntries: GuestEntry[] = [],
    expenses: ExpenseRecord[] = []
) {
    const XLSX = await import("xlsx");

    const fmtTime = (ts: any) => {
        if (!ts) return "";
        try { const d = ts.toDate ? ts.toDate() : new Date(ts * 1000); return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
    };

    const physicalPayments = receptionPayments.filter(p => p.type === 'plan_purchase');
    const virtualPayments = receptionPayments.filter(p => p.type === 'virtual_member');
    const virtualTotal = virtualPayments.reduce((s, p) => s + (p.amount ?? 0), 0);

    // Same summary as the screen and the print — see lib/paymentSplit.
    const excelMoney = summarizeMoney(receptionPayments, topups);

    // Per-UPI breakdown — split records bucket their upiAmount under the
    // selected upiAccount, plain UPI records contribute the full amount.
    const upiBreakdown: Record<string, { name: string; number: string; total: number }> = {};
    receptionPayments.forEach(p => {
        const u = upiOf(p as any);
        if (u <= 0) return;
        const key = p.upiAccountId || 'other';
        if (!upiBreakdown[key]) upiBreakdown[key] = { name: p.upiAccountName || p.upiHolderName || 'UPI', number: p.upiNumber || '', total: 0 };
        upiBreakdown[key].total += u;
    });
    topups.forEach(t => {
        const u = upiOf(t as any);
        if (u <= 0) return;
        const key = (t as any).upiAccountId || 'wallet_upi';
        if (!upiBreakdown[key]) upiBreakdown[key] = { name: (t as any).upiAccountName || 'Wallet UPI', number: (t as any).upiNumber || '', total: 0 };
        upiBreakdown[key].total += u;
    });

    // Sheet 1 — Summary
    const summaryData: any[][] = [
        ["DAILY REPORT — " + clubName.toUpperCase()],
        ["Date", date],
        ["Generated At", new Date().toLocaleString("en-IN")],
        [],
        ["━━━ SHAKES ━━━"],
        ["Total Orders", orders.length],
        ["Completed (Served)", orders.filter(o => o.status === "served").length],
        ["Pending / In Progress", orders.filter(o => o.status !== "served" && o.status !== "cancelled" && o.status !== "rejected").length],
        ["Cancelled", orders.filter(o => o.status === "cancelled" || o.status === "rejected").length],
        [],
        ["━━━ MONEY ━━━"],
        ["Cash in Hand (incl. top-ups)", excelMoney.cashCollected],
        ["UPI Received (incl. top-ups)", excelMoney.upiCollected],
        ["Total Collected", excelMoney.totalCollected],
        ["Wallet Top-ups (not revenue)", excelMoney.topupTotal],
        ["Revenue", excelMoney.revenue],
        [],
        ["Physical Member Payments", topups.reduce((s, t) => s + (t.approvedAmount ?? 0), 0) + physicalPayments.reduce((s, p) => s + (p.amount ?? 0), 0)],
        ["Virtual Member Payments", virtualTotal],
        ["Total Transactions", topups.length + receptionPayments.length],
        [],
        ["━━━ UPI ACCOUNT BREAKDOWN ━━━"],
        ...Object.entries(upiBreakdown).map(([, v]) => [`${v.name}${v.number ? ` (${v.number})` : ''}`, v.total]),
        ...(Object.keys(upiBreakdown).length === 0 ? [["No UPI payments today", 0]] : []),
        [],
        ["━━━ ATTENDANCE ━━━"],
        ["Members", memberAttendance.length],
        ["Volunteers", volunteerAttendance.length],
        [],
        ["━━━ GUESTS ━━━"],
        ["Total Guests", guestEntries.length],
        ["Paid", guestEntries.filter(g => g.type === 'paid').length],
        ["Unpaid", guestEntries.filter(g => g.type === 'unpaid').length],
        ["Guest Revenue", guestEntries.filter(g => g.type === 'paid').reduce((s, g) => s + (g.amountPaid ?? 0), 0)],
        [],
        ["━━━ EXPENSES ━━━"],
        ["Total Expense", expenses.reduce((s, e) => s + (e.amount || 0), 0)],
        ["Entries", expenses.length],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    ws1["!cols"] = [{ wch: 36 }, { wch: 20 }];

    // Sheet 2 — All Physical Payments
    const physicalRows = [
        ...topups.map(t => ({
            "#": "W",
            "Member": t.memberName,
            "Amount (₹)": t.approvedAmount ?? 0,
            "Method": (t.paymentMethod || "Cash").toUpperCase(),
            "UPI Account": (t as any).upiAccountName || "",
            "UPI Number": (t as any).upiNumber || "",
            "Reference": (t as any).reference || "",
            "Type": "Wallet Topup",
            "Time": fmtTime((t as any).resolvedAt),
        })),
        ...physicalPayments.map(p => ({
            "#": "P",
            "Member": p.memberName || "",
            "Amount (₹)": p.amount ?? 0,
            "Method": (p.paymentMethod || "Cash").toUpperCase(),
            "UPI Account": p.upiAccountName || p.upiHolderName || "",
            "UPI Number": p.upiNumber || "",
            "Reference": "",
            "Type": `Plan: ${p.planName || ""}`,
            "Time": fmtTime(p.createdAt),
        })),
    ];
    const ws2 = physicalRows.length
        ? XLSX.utils.json_to_sheet(physicalRows)
        : XLSX.utils.aoa_to_sheet([["No physical payments today"]]);
    ws2["!cols"] = [{ wch: 4 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 10 }];

    // Sheet 3 — Virtual Member Payments
    const virtualRows = virtualPayments.length
        ? virtualPayments.map(p => ({
            "Member ID": p.virtualMemberDocId || "",
            "Name": p.memberName || "",
            "Phone": p.memberPhone || "",
            "Amount (₹)": p.amount ?? 0,
            "Method": (p.paymentMethod || "Cash").toUpperCase(),
            "UPI Account": p.upiAccountName || p.upiHolderName || "",
            "UPI Number": p.upiNumber || "",
            "Time": fmtTime(p.createdAt),
        }))
        : [{ "Member ID": "No virtual payments today", "Name": "", "Phone": "", "Amount (₹)": 0, "Method": "", "UPI Account": "", "UPI Number": "", "Time": "" }];
    const ws3 = XLSX.utils.json_to_sheet(virtualRows);
    ws3["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 10 }];

    // Sheet 4 — Orders
    const orderRows = orders.length
        ? orders.map(o => ({
            "Member": o.memberName,
            "Items": o.items?.map(i => `${i.productName} x${i.quantity}`).join(", ") || "",
            "Credits Used": o.items?.reduce((s, i) => s + (i.quantity || 1), 0) || 0,
            "Status": o.status,
            "Time": fmtTime((o as any).createdAt),
        }))
        : [{ "Member": "No orders today", "Items": "", "Credits Used": 0, "Status": "", "Time": "" }];
    const ws4 = XLSX.utils.json_to_sheet(orderRows);
    ws4["!cols"] = [{ wch: 24 }, { wch: 36 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];

    // Sheet 5 — Attendance
    const attendRows = memberAttendance.length
        ? memberAttendance.map(a => ({
            "Member": a.userName,
            "Check-in Time": fmtTime((a as any).checkInTime),
            "Method": a.checkInMethod,
        }))
        : [{ "Member": "No attendance recorded today", "Check-in Time": "", "Method": "" }];
    const ws5 = XLSX.utils.json_to_sheet(attendRows);
    ws5["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }];

    // Sheet 6 — Volunteers
    const volunteerRows = volunteerAttendance.length
        ? volunteerAttendance.map(a => ({
            "Volunteer": a.userName,
            "Check-in Time": fmtTime((a as any).checkInTime),
            "Method": a.checkInMethod || "",
        }))
        : [{ "Volunteer": "No volunteers today", "Check-in Time": "", "Method": "" }];
    const ws6 = XLSX.utils.json_to_sheet(volunteerRows);
    ws6["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }];

    // Sheet 7 — Guests / Walk-ins
    const guestRows = guestEntries.length
        ? guestEntries.map(g => ({
            "Guest": g.guestName || "",
            "Phone": g.guestPhone || "",
            "Type": g.type === 'paid' ? 'Paid' : 'Unpaid',
            "Items": (g.items || []).map((i: any) => `${i.productName || i.itemName || 'item'} x${i.qty || i.quantity || 1}`).join(", "),
            "Amount (₹)": g.amountPaid ?? 0,
            "First Day": (g as any).firstDay ? "Yes" : "",
            "Time": fmtTime((g as any).createdAt),
        }))
        : [{ "Guest": "No guests today", "Phone": "", "Type": "", "Items": "", "Amount (₹)": 0, "First Day": "", "Time": "" }];
    const ws7 = XLSX.utils.json_to_sheet(guestRows);
    ws7["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];

    // Sheet 8 — Expenses
    const expenseRows: any[] = expenses.length
        ? expenses.map(e => ({
            "Name": (e as any).name || "",
            "Description": e.description || "",
            "Amount (₹)": e.amount ?? 0,
            "Time": fmtTime((e as any).createdAt),
        }))
        : [{ "Name": "No expenses today", "Description": "", "Amount (₹)": 0, "Time": "" }];
    if (expenses.length) expenseRows.push({ "Name": "TOTAL", "Description": "", "Amount (₹)": expenses.reduce((s, e) => s + (e.amount || 0), 0), "Time": "" });
    const ws8 = XLSX.utils.json_to_sheet(expenseRows);
    ws8["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 12 }, { wch: 10 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Summary");
    XLSX.utils.book_append_sheet(wb, ws2, "Physical Payments");
    XLSX.utils.book_append_sheet(wb, ws3, "Virtual Payments");
    XLSX.utils.book_append_sheet(wb, ws4, "Orders");
    XLSX.utils.book_append_sheet(wb, ws5, "Attendance");
    XLSX.utils.book_append_sheet(wb, ws6, "Volunteers");
    XLSX.utils.book_append_sheet(wb, ws7, "Guests");
    XLSX.utils.book_append_sheet(wb, ws8, "Expenses");

    XLSX.writeFile(wb, `daily-report-${date}.xlsx`);
}

// ─── Save report to Firestore for history ────────────────────────────────

async function saveReportToFirestore(
    clubId: string,
    date: string,
    orders: Order[],
    topups: TopupRequest[],
    receptionPayments: PaymentRecord[],
    memberAttendance: Attendance[],
    volunteerAttendance: Attendance[],
    productUsage: { name: string; qty: number }[] = [],
) {
    const physicalTotal =
        topups.reduce((s, t) => s + (t.approvedAmount ?? 0), 0) +
        receptionPayments.filter(p => p.type === 'plan_purchase').reduce((s, p) => s + (p.amount ?? 0), 0);
    const virtualTotal = receptionPayments.filter(p => p.type === 'virtual_member').reduce((s, p) => s + (p.amount ?? 0), 0);
    // Same summary the screen, the print and the Excel show. The saved report
    // is what Reports reads back later, so it must not be a fifth opinion.
    const savedMoney = summarizeMoney(receptionPayments, topups);

    const upiBreakdown: Record<string, { name: string; number: string; total: number }> = {};
    receptionPayments.forEach(p => {
        const u = upiOf(p as any);
        if (u <= 0) return;
        const key = p.upiAccountId || 'other';
        if (!upiBreakdown[key]) upiBreakdown[key] = { name: p.upiAccountName || p.upiHolderName || 'UPI', number: p.upiNumber || '', total: 0 };
        upiBreakdown[key].total += u;
    });
    topups.forEach(t => {
        const u = upiOf(t as any);
        if (u <= 0) return;
        const key = (t as any).upiAccountId || 'wallet_upi';
        if (!upiBreakdown[key]) upiBreakdown[key] = { name: (t as any).upiAccountName || 'Wallet UPI', number: (t as any).upiNumber || '', total: 0 };
        upiBreakdown[key].total += u;
    });

    await setDoc(doc(db, `clubs/${clubId}/dailyReports`, date), {
        clubId,
        date,
        savedAt: serverTimestamp(),
        productUsage,
        summary: {
            totalOrders: orders.length,
            completedOrders: orders.filter(o => o.status === 'served').length,
            pendingOrders: orders.filter(o => o.status !== 'served' && o.status !== 'cancelled' && o.status !== 'rejected').length,
            cancelledOrders: orders.filter(o => o.status === 'cancelled' || o.status === 'rejected').length,
            totalShakesServed: orders.filter(o => o.status === 'served').reduce((s, o) => s + (o.items?.reduce((si, i) => si + (i.quantity || 1), 0) || 0), 0),
            totalPayments: physicalTotal + virtualTotal,
            physicalMemberPayments: physicalTotal,
            virtualMemberPayments: virtualTotal,
            // Collected = drawer/bank truth (top-ups included). Revenue = earned.
            cashTotal: savedMoney.cashCollected,
            upiTotal: savedMoney.upiCollected,
            totalCollected: savedMoney.totalCollected,
            walletTopupTotal: savedMoney.topupTotal,
            revenue: savedMoney.revenue,
            upiBreakdown,
            memberAttendance: memberAttendance.length,
            volunteerAttendance: volunteerAttendance.length,
            walletTopups: topups.length,
            planPurchases: receptionPayments.filter(p => p.type === 'plan_purchase').length,
            virtualPayments: receptionPayments.filter(p => p.type === 'virtual_member').length,
        },
    }, { merge: true });
}

// ─── Stat card ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color = "bg-slate-50 border-slate-200", emphasize = false }: {
    icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string; emphasize?: boolean;
}) {
    return (
        <div className={`${emphasize ? "p-5" : "p-4"} rounded-2xl border ${color} flex flex-col gap-1`}>
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">{icon}{label}</div>
            <p className={`${emphasize ? "text-5xl" : "text-2xl"} font-black text-slate-900 mt-1 leading-none`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 font-medium">{sub}</p>}
        </div>
    );
}

// ─── New-model helpers (clean "New Model" toggle layout) ─────────────────
function rs(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }

function BigStat({ icon, label, value, accent, big }: {
    icon: string; label: string; value: React.ReactNode; accent: string; big?: boolean;
}) {
    return (
        <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${accent}`}>
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-70 flex items-center gap-1.5"><span>{icon}</span>{label}</div>
            <div className={`${big ? "text-4xl" : "text-2xl"} font-black leading-none`}>{value}</div>
        </div>
    );
}

function SectionCard({ title, count, right, children }: {
    title: string; count?: number; right?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-sm font-black text-slate-800">{title}{count != null ? ` · ${count}` : ""}</p>
                {right}
            </div>
            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">{children}</div>
        </div>
    );
}

// ─── Main modal ──────────────────────────────────────────────────────────

export default function TodayReportModal({ onClose }: { onClose: () => void }) {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const { orders, loading: ordersLoading } = useTodayOrdersLive(clubId);
    const { topups, loading: topupsLoading } = useTodayPaymentsLive(clubId);
    const { payments: receptionPayments, loading: paymentsLoading } = useTodayReceptionPaymentsLive(clubId);
    const { records: memberAttendance, loading: attendLoading } = useTodayAttendance("member");
    const { records: volunteerAttendance, loading: volLoading } = useTodayAttendance("volunteer");
    const { entries: guestEntries, loading: guestsLoading } = useTodayGuestEntriesLive(clubId);
    const { expenses, loading: expensesLoading } = useTodayExpensesLive(clubId);
    const { usage: productUsage } = useTodayProductUsage(clubId);

    const deleteGuestEntry = useDeleteGuestEntry();

    const [exporting, setExporting] = useState(false);
    // Old/New report layout toggle (persisted). Old = the existing dense view.
    const [reportModel, setReportModel] = useState<'old' | 'new'>(() => {
        try { return (localStorage.getItem('mnh_reportModel') as 'old' | 'new') || 'old'; } catch { return 'old'; }
    });
    useEffect(() => { try { localStorage.setItem('mnh_reportModel', reportModel); } catch {} }, [reportModel]);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showGuestEntry, setShowGuestEntry] = useState(false);
    const [editingGuest, setEditingGuest] = useState<GuestEntry | null>(null);
    const [deletingGuestId, setDeletingGuestId] = useState<string | null>(null);
    const [showVirtualDetail, setShowVirtualDetail] = useState(false);
    const [showGuestDetail, setShowGuestDetail] = useState(false);
    const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'upi'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [removingAttendanceId, setRemovingAttendanceId] = useState<string | null>(null);
    const [attendanceBusy, setAttendanceBusy] = useState(false);
    const [showAttendanceList, setShowAttendanceList] = useState(true);
    const [selectedEntry, setSelectedEntry] = useState<NormalizedEntry | null>(null);
    const [correctionMethod, setCorrectionMethod] = useState<'cash' | 'upi' | 'split'>('cash');
    const [correctionUpi, setCorrectionUpi] = useState<any>(null);
    const [correctionAmount, setCorrectionAmount] = useState<string>('');
    const [correctionSaving, setCorrectionSaving] = useState(false);
    const [correctionDeleting, setCorrectionDeleting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [orderDeleteId, setOrderDeleteId] = useState<string | null>(null);
    // Print picker — opens when user hits Print; lets them choose which
    // sections + whether to append the daily tax invoice. Defaults reflect
    // the legacy "print everything" behaviour.
    const [showPrintPicker, setShowPrintPicker] = useState(false);
    const [printSections, setPrintSections] = useState<ReportPrintSections>({
        core: true, guests: true, expenses: true, letterhead: false,
    });
    const [printIncludeInvoice, setPrintIncludeInvoice] = useState(true);
    const [printing, setPrinting] = useState(false);
    const [orderDeleting, setOrderDeleting] = useState(false);
    const rejectOrder = useRejectOrder();
    const [showOrderDetail, setShowOrderDetail] = useState(false);

    // ── Expenses form state ────────────────────────────────────────────
    // A simple "name + amount" form. Opens from the header "Expense"
    // button. Lives at the bottom of the modal so it doesn't disrupt the
    // existing scroll position of payments/attendance.
    const [showExpenseForm, setShowExpenseForm] = useState(false);
    const [expenseName, setExpenseName] = useState("");
    const [expenseDesc, setExpenseDesc] = useState("");
    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseSaving, setExpenseSaving] = useState(false);
    const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);

    const handleAddExpense = async () => {
        if (!clubId) return;
        const desc = expenseDesc.trim();
        const amt = Number(expenseAmount);
        if (!desc) { alert("Please describe the expense."); return; }
        if (!amt || amt <= 0) { alert("Please enter a valid amount."); return; }
        setExpenseSaving(true);
        try {
            await addDoc(collection(db, `clubs/${clubId}/expenses`), {
                name: expenseName.trim(),
                description: desc,
                amount: amt,
                date: todayStr(),
                createdAt: serverTimestamp(),
            });
            setExpenseName("");
            setExpenseDesc("");
            setExpenseAmount("");
            setShowExpenseForm(false);
        } catch (e: any) {
            console.error("[add expense]", e);
            alert("Could not save expense. Try again.");
        } finally {
            setExpenseSaving(false);
        }
    };

    const handleDeleteExpense = async (id: string) => {
        if (!clubId) return;
        try {
            await deleteDoc(doc(db, `clubs/${clubId}/expenses`, id));
            setDeletingExpenseId(null);
        } catch (e: any) {
            console.error("[delete expense]", e);
            alert("Could not delete expense. Try again.");
        }
    };

    const expensesTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    // ─── Never hang on one feed ──────────────────────────────────────────
    //
    // This screen waits on seven live listeners, and it used to block on all
    // of them together: if one never returned, the report sat on
    // "Loading report…" indefinitely with Save and Export disabled — during
    // service, when it is needed most.
    //
    // The attendance listener's error handler was the known offender and is
    // fixed at source. This is the general guard: after a few seconds the
    // report renders with whatever HAS arrived, and says plainly which feeds
    // are still missing so nobody mistakes a partial report for a complete
    // one. A report the owner can read and verify beats a spinner.
    const stillWaiting: string[] = [];
    if (ordersLoading) stillWaiting.push("shake orders");
    if (topupsLoading) stillWaiting.push("wallet top-ups");
    if (paymentsLoading) stillWaiting.push("payments");
    if (attendLoading) stillWaiting.push("member attendance");
    if (volLoading) stillWaiting.push("volunteer attendance");
    if (guestsLoading) stillWaiting.push("guests");
    if (expensesLoading) stillWaiting.push("expenses");

    const anyLoading = stillWaiting.length > 0;
    const [waitedTooLong, setWaitedTooLong] = useState(false);
    useEffect(() => {
        if (!anyLoading) { setWaitedTooLong(false); return; }
        const t = setTimeout(() => setWaitedTooLong(true), 8000);
        return () => clearTimeout(t);
    }, [anyLoading]);

    const isLoading = anyLoading && !waitedTooLong;
    // Shown on the report itself, so an incomplete total is never presented as
    // a finished one — including on the saved copy and the export.
    const incompleteFeeds = waitedTooLong ? stillWaiting : [];

    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.status === "served").length;
    const servedOrders = orders.filter(o => o.status === "served");
    const totalShakesServed = servedOrders.reduce((s, o) => s + (o.items?.reduce((si, i) => si + (i.quantity || 1), 0) || 0), 0);
    // Split the served count into member shakes vs. guest shakes. Guest
    // orders are tagged at creation by useGuestEntries with memberId/source
    // === "guest"; everything else is a real member order.
    const isGuestOrder = (o: any) =>
        o?.memberId === "guest" || o?.source === "guest" || o?.orderedFrom === "guest";
    const shakeQtySum = (o: any) =>
        o.items?.reduce((si: number, i: any) => si + (i.quantity || 1), 0) || 0;
    const guestShakesServed = servedOrders.filter(isGuestOrder).reduce((s, o) => s + shakeQtySum(o), 0);
    const memberShakesServed = totalShakesServed - guestShakesServed;

    const virtualPayments = receptionPayments.filter(p => p.type === 'virtual_member');
    const physicalReceptionPayments = receptionPayments.filter(p => p.type === 'plan_purchase');

    // The SAME summary the print, the Excel and the saved report use — one
    // pipe, so the screen can never again disagree with the paper. cashTotal
    // and upiTotal are COLLECTED figures (top-ups included): they are what the
    // drawer and the bank must match, and what the listed rows add up to.
    const money = summarizeMoney(receptionPayments, topups);
    const cashTotal = money.cashCollected;
    const upiTotal = money.upiCollected;
    const totalPayments = money.totalCollected;
    const virtualTotal = virtualPayments.reduce((s, p) => s + (p.amount ?? 0), 0);

    // Per-UPI-account breakdown — split records contribute their upiAmount,
    // pure UPI records contribute the full amount.
    const upiAccBreakdown: Record<string, { name: string; number: string; total: number }> = {};
    receptionPayments.forEach(p => {
        const u = upiOf(p as any);
        if (u <= 0) return;
        const key = p.upiAccountId || 'other';
        if (!upiAccBreakdown[key]) upiAccBreakdown[key] = { name: p.upiAccountName || p.upiHolderName || 'UPI', number: p.upiNumber || '', total: 0 };
        upiAccBreakdown[key].total += u;
    });
    topups.forEach(t => {
        const u = upiOf(t as any);
        if (u <= 0) return;
        const key = (t as any).upiAccountId || 'wallet_upi';
        if (!upiAccBreakdown[key]) upiAccBreakdown[key] = { name: (t as any).upiAccountName || 'Wallet UPI', number: (t as any).upiNumber || '', total: 0 };
        upiAccBreakdown[key].total += u;
    });

    // Normalized payment entries for detail list — split entries show in
    // both the cash-filter and UPI-filter buckets since they contributed to
    // both tenders.
    const allEntries = normalizeEntries(topups, receptionPayments);
    const q = searchQuery.trim().toLowerCase();
    const matchesEntry = (e: NormalizedEntry) => {
        if (!q) return true;
        const raw = e.raw || {};
        const hay = [
            e.memberName, e.label, e.description, e.paymentMethod,
            raw.memberPhone, raw.guestPhone, raw.memberId, raw.virtualMemberDocId,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    };
    const filteredEntries = allEntries
        .filter(e => paymentFilter === 'all' ? true : (e.paymentMethod === paymentFilter || e.paymentMethod === 'split'))
        .filter(matchesEntry);

    // Filtered attendance / orders / guests for search
    const filteredMemberAttendance = !q ? memberAttendance : memberAttendance.filter((r: any) =>
        ((r.userName || '') + ' ' + (r.userId || '')).toLowerCase().includes(q)
    );
    const filteredVolunteerAttendance = !q ? volunteerAttendance : volunteerAttendance.filter((r: any) =>
        ((r.userName || '') + ' ' + (r.userId || '')).toLowerCase().includes(q)
    );
    const filteredGuestEntries = !q ? guestEntries : guestEntries.filter((g: any) =>
        ((g.guestName || '') + ' ' + (g.guestPhone || '')).toLowerCase().includes(q)
    );
    const filteredOrders = !q ? orders : orders.filter((o: any) => {
        const items = (o.items || []).map((i: any) => i.productName || i.itemName || '').join(' ');
        return ((o.memberName || '') + ' ' + (o.memberPhone || '') + ' ' + items).toLowerCase().includes(q);
    });
    const isSearching = q.length > 0;

    // UPI accounts from club for correction flow
    const upiAccounts: { id: string; app: string; number: string; holderName: string }[] = ((club as any)?.upiAccounts ?? []);

    const handleCorrection = async () => {
        if (!selectedEntry || !clubId) return;
        setCorrectionSaving(true);
        try {
            const upiFields = correctionMethod === 'upi' && correctionUpi ? {
                upiAccountId: correctionUpi.id,
                upiAccountName: correctionUpi.app,
                upiNumber: correctionUpi.number,
                upiHolderName: correctionUpi.holderName,
            } : correctionMethod === 'cash' ? {
                upiAccountId: null,
                upiAccountName: null,
                upiNumber: null,
                upiHolderName: null,
            } : {};

            const parsedAmount = Number(correctionAmount);
            const amountChanged = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount !== selectedEntry.amount;

            // Through the cascade, not straight at the document.
            //
            // Writing paymentMethod and amount directly left cashAmount and
            // upiAmount describing the OLD tender: a ₹500 cash payment
            // corrected to UPI stayed cashAmount 500 / upiAmount 0 while
            // calling itself UPI, so the report's cash and UPI columns stopped
            // adding up to its own total. updatePaymentCascade rewrites the
            // tender as a set through normalizeTender, and moves the member's
            // wallet by the delta where the payment type touches it.
            const res = selectedEntry.source === 'payment'
                ? await updatePaymentCascade(clubId, selectedEntry, {
                    paymentMethod: correctionMethod,
                    ...(amountChanged ? { amount: parsedAmount } : {}),
                    ...upiFields,
                })
                : await updateTopupRequestCascade(clubId, selectedEntry, {
                    paymentMethod: correctionMethod,
                    ...(amountChanged ? { approvedAmount: parsedAmount } : {}),
                    ...upiFields,
                });

            if (!res.ok) {
                alert(`Could not save the correction: ${res.errorMessage ?? 'unknown error'}`);
                return;
            }
            if (res.skipped.length) {
                // Say what could not be put right rather than reporting a clean
                // save. A silent partial correction is how the books drift.
                alert(`Saved, but some of it could not be adjusted:\n\n• ${res.skipped.join('\n• ')}`);
            }
            setSelectedEntry(null);
            setDeleteConfirm(false);
        } catch (e: any) {
            console.error('Correction failed:', e);
        } finally {
            setCorrectionSaving(false);
        }
    };

    const handleDeleteEntry = async () => {
        if (!selectedEntry || !clubId) return;
        setCorrectionDeleting(true);
        try {
            // Through the cascade, not deleteDoc.
            //
            // A payment is never just a row: a plan purchase granted shake
            // credits and moved an expiry, a product sale moved stock, a
            // top-up put money in a wallet. Deleting the document alone left
            // every one of those standing, with nothing recording that the
            // money had been taken back — and being a HARD delete there was no
            // trail to reconstruct it from either. Both cascades soft-delete
            // and reverse what they can, and write an audit entry naming what
            // they could not.
            const res = selectedEntry.source === 'payment'
                ? await deletePaymentCascade(clubId, selectedEntry)
                : await deleteTopupRequestCascade(clubId, selectedEntry);

            if (!res.ok) {
                alert(`Could not delete this entry: ${res.errorMessage ?? 'unknown error'}`);
                return;
            }
            const lines = [
                res.reversed.length ? `Reversed:\n• ${res.reversed.join('\n• ')}` : '',
                res.skipped.length ? `\n\nCould NOT reverse:\n• ${res.skipped.join('\n• ')}\n\nThese need correcting by hand.` : '',
            ].filter(Boolean).join('');
            if (lines) alert(lines);

            setSelectedEntry(null);
            setDeleteConfirm(false);
        } catch (e: any) {
            console.error('Delete failed:', e);
            alert('Could not delete this entry. Please try again.');
        } finally {
            setCorrectionDeleting(false);
        }
    };

    const handleRemoveAttendance = async (rec: any, type: 'member' | 'volunteer') => {
        if (!clubId) return;
        setAttendanceBusy(true);
        try {
            if (type === 'member') {
                // Removes the attendance record for today AND clears lastVisit,
                // together. This used to clear lastVisit and then try to delete a
                // document named after the MEMBER id — for records derived from
                // lastVisit, `rec.id` is the member id, not the date — so the real
                // `attendance/{date}` record survived. The member then vanished
                // from every lastVisit-based screen while still counting on the
                // Attendance Register, and reception could not check them in
                // again because the surviving record made the write a no-op.
                await removeMemberAttendance(clubId, rec.userId, todayStr());
            } else {
                await deleteDoc(doc(db, `clubs/${clubId}/volunteerAttendance`, rec.id));
            }
            setRemovingAttendanceId(null);
        } catch (e: any) {
            console.error('Remove attendance failed:', e);
            alert('Could not remove this check-in. Please try again.');
        } finally {
            setAttendanceBusy(false);
        }
    };

    const handleDeleteOrder = async (orderId: string) => {
        if (!clubId) return;
        setOrderDeleting(true);
        try {
            await rejectOrder.mutateAsync({
                clubId,
                orderId,
                rejectedBy: 'owner',
                reason: 'Deleted from Today Report',
            });
            setOrderDeleteId(null);
        } catch (e: any) {
            console.error('Order delete failed:', e);
            alert(e?.message || 'Could not delete this order.');
        } finally {
            setOrderDeleting(false);
        }
    };

    const fmtTime = (d: Date) => {
        try { return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
    };

    const dateLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const handleExportExcel = async () => {
        setExporting(true);
        try { await exportToExcel(club?.name ?? "Club", todayStr(), orders, topups, receptionPayments, memberAttendance, volunteerAttendance, guestEntries, expenses); }
        catch (e) { console.error(e); }
        finally { setExporting(false); }
    };

    const handleSaveReport = async () => {
        if (!clubId) return;
        setSaving(true);
        try {
            await saveReportToFirestore(clubId, todayStr(), orders, topups, receptionPayments, memberAttendance, volunteerAttendance, productUsage);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (e) { console.error(e); }
        finally { setSaving(false); }
    };

    // Opens the section picker. Actual printing happens in confirmPrint()
    // once the user has chosen what to include.
    const handlePrint = () => {
        if (!club?.id) return;
        setShowPrintPicker(true);
    };

    // Called by the picker's "Print" button. Builds the receipt
    // conditionally based on the section toggles, then sends a single
    // RawBT job.
    const confirmPrint = async () => {
        if (!club?.id) return;
        // Refuse a no-op print where the user unticked everything.
        const anyReportSection = printSections.core || printSections.guests || printSections.expenses;
        if (!anyReportSection && !printIncludeInvoice) {
            alert("Select at least one section to print.");
            return;
        }
        setPrinting(true);
        try {
            const { totals, billNumber, club: clubData } = await prepareDailyInvoice(club.id, todayStr());
            const dateLabel = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

            const reportLines = anyReportSection
                ? buildTodayReportReceipt(
                    clubData, orders, topups, receptionPayments,
                    memberAttendance.length, volunteerAttendance.length,
                    dateLabel, guestEntries, expenses,
                    printSections, productUsage,
                )
                : [];
            const invoiceLines = printIncludeInvoice
                ? buildDailyInvoiceThermal(clubData, totals, billNumber)
                : [];

            printViaRawBT([...reportLines, ...invoiceLines]);
            setShowPrintPicker(false);
        } catch (e) {
            console.error('[handlePrint]', e);
            alert("Could not print today's report. Please try again.");
        } finally {
            setPrinting(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
                <div className={`bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col ${reportModel === 'new' ? 'sm:w-[72vw] sm:max-w-[72vw] sm:h-[80vh] max-h-[92vh]' : 'sm:max-w-lg max-h-[92vh]'}`} style={{ fontFamily: "'Nunito', sans-serif" }}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b bg-white sticky top-0 z-10">
                        <div>
                            <h2 className="text-lg font-black text-slate-900">Today's Report</h2>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">{dateLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                            <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden text-[11px] font-black">
                                <button onClick={() => setReportModel('old')} className={`px-2.5 py-1.5 ${reportModel === 'old' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500'}`}>Old</button>
                                <button onClick={() => setReportModel('new')} className={`px-2.5 py-1.5 ${reportModel === 'new' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}>New</button>
                            </div>
                            <button onClick={() => setShowExpenseForm(s => !s)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors">
                                <Receipt className="w-3.5 h-3.5" /> Expense
                            </button>
                            <button onClick={() => setShowGuestEntry(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-colors">
                                <UserPlus className="w-3.5 h-3.5" /> Guest
                            </button>
                            <button onClick={() => setShowManualEntry(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold hover:bg-amber-100 transition-colors">
                                <Plus className="w-3.5 h-3.5" /> Audit Entry
                            </button>
                            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="overflow-y-auto flex-1 p-5 space-y-4">
                        {incompleteFeeds.length > 0 && (
                            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                                <p className="text-sm font-black text-amber-900">
                                    ⚠ This report is incomplete
                                </p>
                                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                    Could not load: <b>{incompleteFeeds.join(", ")}</b>. Everything else
                                    below is live and correct, but any total that depends on the missing
                                    feed will be under-counted. Check your connection and reopen the
                                    report before saving or exporting it.
                                </p>
                            </div>
                        )}
                        {isLoading ? (
                            <div className="py-16 text-center text-slate-400 animate-pulse font-semibold text-sm">Loading report...</div>
                        ) : reportModel === 'new' ? (
                            <div className="space-y-5">
                                {/* ─── NEW MODEL ─── clean, visual, ~70% screen ─── */}
                                <div className="flex items-center justify-between flex-wrap gap-3">
                                    <div>
                                        <p className="text-base font-black text-emerald-900">{club?.name}</p>
                                        <p className="text-xs text-slate-500 font-semibold">{dateLabel} · Live, updates automatically</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={handlePrint} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black">🖨️ Print</button>
                                        <button onClick={handleExportExcel} disabled={exporting} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-60">{exporting ? "Exporting…" : "⬇️ Excel"}</button>
                                    </div>
                                </div>

                                {/* Headline totals. Cash and UPI are COLLECTED — what the
                                    drawer and the bank must match, top-ups included. The big
                                    tile is collected too, with revenue shown beneath it when
                                    they differ, so the subtraction is on screen instead of
                                    happening silently inside the code. "Total Revenue" on a
                                    tile that actually held collected money is exactly how the
                                    6,560-vs-5,400 confusion happened. */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                    <BigStat icon="📱" label="UPI Received" value={rs(upiTotal)} accent="bg-sky-50 border-sky-200 text-sky-900" />
                                    <BigStat icon="💵" label="Cash in Hand" value={rs(cashTotal)} accent="bg-lime-50 border-lime-200 text-lime-900" />
                                    <BigStat icon="💰" label="Total Collected" value={rs(totalPayments)} accent="bg-emerald-50 border-emerald-300 text-emerald-900" big />
                                    <BigStat icon="🥤" label="Total Shakes" value={totalShakesServed} accent="bg-amber-50 border-amber-200 text-amber-900" />
                                    <BigStat icon="🙌" label="Total Volunteers" value={filteredVolunteerAttendance.length} accent="bg-violet-50 border-violet-200 text-violet-900" />
                                </div>
                                {money.topupTotal > 0 && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900">
                                        ₹{money.totalCollected.toLocaleString("en-IN")} collected − ₹{money.topupTotal.toLocaleString("en-IN")} wallet top-ups = ₹{money.revenue.toLocaleString("en-IN")} revenue
                                    </div>
                                )}

                                {/* Search */}
                                <div className="relative">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search name, mobile, plan, item…" className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300" />
                                </div>

                                {/* Sections */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Today's Payments — click a row to edit/delete */}
                                    <SectionCard title="Today's Payments" count={filteredEntries.length}>
                                        {filteredEntries.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic py-2 text-center">No payments yet</p>
                                        ) : filteredEntries.map((e) => (
                                            <button key={`${e.source}-${e.id}`} onClick={() => setSelectedEntry(e)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-100 text-left transition-colors">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-slate-800 truncate">{e.memberName || e.label || "Payment"}</p>
                                                    <p className="text-[11px] text-slate-500 font-semibold">{(e.paymentMethod || "").toUpperCase()}{e.label && e.memberName ? ` · ${e.label}` : ""}</p>
                                                </div>
                                                <span className="text-sm font-black text-emerald-700 shrink-0">{rs(e.amount || 0)}</span>
                                            </button>
                                        ))}
                                    </SectionCard>

                                    {/* Today's Volunteers */}
                                    <SectionCard title="Today's Volunteers" count={filteredVolunteerAttendance.length}>
                                        {filteredVolunteerAttendance.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic py-2 text-center">No volunteers yet</p>
                                        ) : filteredVolunteerAttendance.map((v: any) => (
                                            <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                                                <p className="text-sm font-bold text-slate-800 truncate">{v.userName || "Volunteer"}</p>
                                                <span className="text-[11px] text-violet-600 font-bold shrink-0">🙌 present</span>
                                            </div>
                                        ))}
                                    </SectionCard>

                                    {/* Today's Shake Orders */}
                                    <SectionCard title="Today's Shake Orders" count={filteredOrders.length}>
                                        {filteredOrders.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic py-2 text-center">No orders yet</p>
                                        ) : filteredOrders.map((o: any) => (
                                            <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-slate-800 truncate">{o.memberName || "Walk-in"}</p>
                                                    <p className="text-[11px] text-slate-500 font-semibold truncate">{(o.items || []).map((i: any) => `${i.productName || i.itemName} ×${i.quantity || i.qty || 1}`).join(", ")}</p>
                                                </div>
                                                <span className={`text-[11px] font-bold shrink-0 ${o.status === "served" ? "text-emerald-600" : "text-amber-600"}`}>{o.status}</span>
                                            </div>
                                        ))}
                                    </SectionCard>

                                    {/* Expenses */}
                                    <SectionCard title="Expenses" count={expenses.length} right={<span className="text-sm font-black text-rose-600">{rs(expensesTotal)}</span>}>
                                        <button onClick={() => setShowExpenseForm(s => !s)} className="w-full py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-bold bg-rose-50 hover:bg-rose-100 transition-colors">+ Add Expense</button>
                                        {showExpenseForm && (
                                            <div className="space-y-2 pt-1">
                                                <input value={expenseName} onChange={e => setExpenseName(e.target.value)} placeholder="Name (optional)" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                                <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="What was it for?" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                                <div className="flex gap-2">
                                                    <input value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} type="number" placeholder="₹ amount" className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                                                    <button onClick={handleAddExpense} disabled={expenseSaving} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold disabled:opacity-60">Save</button>
                                                </div>
                                            </div>
                                        )}
                                        {expenses.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic py-2 text-center">No expenses logged · Total ₹0</p>
                                        ) : expenses.map((e: any) => (
                                            <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                                                <p className="text-sm font-bold text-slate-800 truncate min-w-0">{e.name ? <span className="text-rose-600">{e.name} — </span> : null}{e.description}</p>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-sm font-black text-rose-600">{rs(e.amount || 0)}</span>
                                                    <button onClick={() => handleDeleteExpense(e.id)} title="Delete expense" className="text-rose-400 hover:text-rose-600 text-xs font-black">✕</button>
                                                </div>
                                            </div>
                                        ))}
                                    </SectionCard>

                                    {/* Gifts — complimentary / first-day shakes */}
                                    {(() => {
                                        const gifts = filteredGuestEntries.filter((g: any) => g.type !== "paid");
                                        return (
                                            <SectionCard title="Gifts · Complimentary" count={gifts.length}>
                                                {gifts.length === 0 ? (
                                                    <p className="text-xs text-slate-400 italic py-2 text-center">No complimentary shakes today</p>
                                                ) : gifts.map((g: any) => (
                                                    <div key={g.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold text-slate-800 truncate">{g.guestName || "Guest"}{g.firstDay ? " · First Day" : ""}</p>
                                                            <p className="text-[11px] text-slate-500 font-semibold truncate">{(g.items || []).map((i: any) => i.productName || i.itemName).join(", ")}</p>
                                                        </div>
                                                        <span className="text-[11px] text-pink-600 font-bold shrink-0">🎁 free</span>
                                                    </div>
                                                ))}
                                            </SectionCard>
                                        );
                                    })()}

                                    {/* Auditing entries */}
                                    <SectionCard title="Auditing Entries" right={<button onClick={() => setShowManualEntry(true)} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 text-[11px] font-bold hover:bg-amber-200 transition-colors">+ Add</button>}>
                                        <p className="text-xs text-slate-500 font-medium">Manual corrections for missed plans/shakes. Use <b>+ Add</b> to record one — it appears in Today's Payments above and in totals.</p>
                                    </SectionCard>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Club banner */}
                                <div className="text-center py-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-widest">{club?.name}</p>
                                    <p className="text-sm font-black text-emerald-900 mt-0.5">{dateLabel}</p>
                                    <p className="text-[10px] text-emerald-500 mt-0.5 font-medium">Live · Updates automatically</p>
                                </div>

                                {/* Search bar — filters payments, orders, attendance, and guests */}
                                <div className="relative">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search name, mobile, plan, item..."
                                        className="w-full pl-9 pr-9 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-100 text-slate-400"
                                            title="Clear search"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                {/* Expense quick-entry form (collapsible — appears when header "Expense" is tapped) */}
                                {showExpenseForm && (
                                    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-black text-rose-800 flex items-center gap-2">
                                                <Receipt className="w-4 h-4" /> Add Expense
                                            </p>
                                            <button onClick={() => { setShowExpenseForm(false); setExpenseName(""); setExpenseDesc(""); setExpenseAmount(""); }} className="p-1 rounded-full hover:bg-rose-100 text-rose-500">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            value={expenseName}
                                            onChange={(e) => setExpenseName(e.target.value)}
                                            placeholder="Name (e.g. Vignesh)"
                                            className="w-full px-3 py-2.5 rounded-xl border border-rose-200 bg-white text-sm font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-300"
                                        />
                                        <input
                                            type="text"
                                            value={expenseDesc}
                                            onChange={(e) => setExpenseDesc(e.target.value)}
                                            placeholder="What was it for? (e.g. Photocopies, 20 copies)"
                                            className="w-full px-3 py-2.5 rounded-xl border border-rose-200 bg-white text-sm font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-300"
                                        />
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={expenseAmount}
                                            onChange={(e) => setExpenseAmount(e.target.value)}
                                            placeholder="Amount (₹)"
                                            className="w-full px-3 py-2.5 rounded-xl border border-rose-200 bg-white text-sm font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-300"
                                        />
                                        <button
                                            disabled={expenseSaving}
                                            onClick={handleAddExpense}
                                            className="w-full py-2.5 rounded-xl bg-rose-600 text-white text-sm font-black hover:bg-rose-700 transition-colors disabled:bg-rose-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {expenseSaving ? "Saving…" : (<><Save className="w-4 h-4" /> Save Expense</>)}
                                        </button>
                                        <p className="text-[10px] text-rose-600 font-semibold text-center">
                                            Tracked separately · NOT subtracted from revenue
                                        </p>
                                    </div>
                                )}

                                {/* Payments */}
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Payments Received</p>
                                    <div className="bg-white rounded-2xl border p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Wallet className="w-4 h-4 text-slate-400" />
                                                <span className="text-sm font-bold text-slate-700">Total Collected</span>
                                            </div>
                                            <p className="text-2xl font-black text-slate-900">₹{totalPayments.toLocaleString("en-IN")}</p>
                                        </div>
                                        {/* The arithmetic, on screen. The rows below add up to
                                            Total Collected; revenue differs only by top-ups, and
                                            the subtraction is shown rather than implied. */}
                                        {money.topupTotal > 0 && (
                                            <p className="text-xs font-bold text-amber-700">
                                                − ₹{money.topupTotal.toLocaleString("en-IN")} wallet top-ups = ₹{money.revenue.toLocaleString("en-IN")} revenue
                                            </p>
                                        )}
                                        {/* Cash vs UPI — tappable filters */}
                                        <div className="border-t pt-3 grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setPaymentFilter(f => f === 'cash' ? 'all' : 'cash')}
                                                className={`rounded-xl p-3 text-center border transition-all ${paymentFilter === 'cash' ? 'bg-green-100 border-green-400 ring-2 ring-green-300' : 'bg-green-50 border-green-100 hover:border-green-300'}`}
                                            >
                                                <p className="text-[10px] font-bold text-green-700 uppercase tracking-widest">💵 Cash</p>
                                                <p className="text-lg font-black text-green-900 mt-0.5">₹{cashTotal.toLocaleString("en-IN")}</p>
                                                <p className="text-[10px] text-green-500 mt-0.5">{allEntries.filter(e => e.paymentMethod === 'cash' || e.paymentMethod === 'split').length} entries · Tap to view</p>
                                            </button>
                                            <button
                                                onClick={() => setPaymentFilter(f => f === 'upi' ? 'all' : 'upi')}
                                                className={`rounded-xl p-3 text-center border transition-all ${paymentFilter === 'upi' ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300' : 'bg-purple-50 border-purple-100 hover:border-purple-300'}`}
                                            >
                                                <p className="text-[10px] font-bold text-purple-700 uppercase tracking-widest">📱 UPI</p>
                                                <p className="text-lg font-black text-purple-900 mt-0.5">₹{upiTotal.toLocaleString("en-IN")}</p>
                                                <p className="text-[10px] text-purple-500 mt-0.5">{allEntries.filter(e => e.paymentMethod === 'upi' || e.paymentMethod === 'split').length} entries · Tap to view</p>
                                            </button>
                                        </div>
                                        {/* Per-UPI-account breakdown */}
                                        {Object.entries(upiAccBreakdown).length > 0 && (
                                            <div className="border-t pt-3 space-y-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">UPI per Account</p>
                                                {Object.entries(upiAccBreakdown).map(([key, acc]) => (
                                                    <div key={key} className="flex justify-between items-center text-sm bg-slate-50 rounded-lg px-3 py-2">
                                                        <div>
                                                            <p className="font-bold text-slate-700 text-xs">{acc.name}</p>
                                                            {acc.number && <p className="text-[10px] text-slate-400">{acc.number}</p>}
                                                        </div>
                                                        <p className="font-black text-purple-700">₹{acc.total.toLocaleString("en-IN")}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {/* Physical vs Virtual */}
                                        <div className="border-t pt-3 grid grid-cols-2 gap-2">
                                            <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                                                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">Physical</p>
                                                <p className="text-base font-black text-blue-900 mt-0.5">₹{(totalPayments - virtualTotal).toLocaleString("en-IN")}</p>
                                                {/* Counted the same way the amount above is: everything that is not
                                                    virtual. It used to be `topups.length + physicalReceptionPayments.length`,
                                                    and `physicalReceptionPayments` keeps only `plan_purchase` — so every
                                                    shake and product sale was in the ₹ figure but missing from the count.
                                                    On a day with 12 transactions the card read "8 txns", and Physical +
                                                    Virtual did not add up to the total shown directly below it. */}
                                                <p className="text-[10px] text-blue-400">{allEntries.filter(e => e.type !== 'virtual').length} txns</p>
                                            </div>
                                            <div className="bg-orange-50 rounded-xl p-3 text-center border border-orange-100 cursor-pointer" onClick={() => setShowVirtualDetail(!showVirtualDetail)}>
                                                <p className="text-[10px] font-bold text-orange-700 uppercase tracking-widest">Virtual</p>
                                                <p className="text-base font-black text-orange-900 mt-0.5">₹{virtualTotal.toLocaleString("en-IN")}</p>
                                                <p className="text-[10px] text-orange-400">{virtualPayments.length} entries {virtualPayments.length > 0 ? '▾' : ''}</p>
                                            </div>
                                        </div>
                                        {/* Virtual detail expandable */}
                                        {showVirtualDetail && virtualPayments.length > 0 && (
                                            <div className="space-y-2">
                                                {virtualPayments.map(p => (
                                                    <div key={p.id} className="flex justify-between items-center text-sm bg-orange-50 rounded-lg px-3 py-2">
                                                        <div>
                                                            <p className="font-bold text-slate-700 text-xs">{p.memberName}</p>
                                                            <p className="text-[10px] text-slate-400">{p.virtualMemberDocId} · {p.paymentMethod?.toUpperCase()}{p.upiAccountName ? ` (${p.upiAccountName})` : ''}</p>
                                                        </div>
                                                        <p className="font-black text-orange-700 text-sm">₹{p.amount.toLocaleString("en-IN")}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <p className="text-[10px] text-slate-400 text-right font-medium">
                                            {topups.length + receptionPayments.length} total transaction{(topups.length + receptionPayments.length) !== 1 ? "s" : ""}
                                        </p>
                                    </div>

                                    {/* Transaction Details — entry list */}
                                    <div className="mt-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                {paymentFilter === 'all' ? 'All Transactions' : paymentFilter === 'cash' ? 'Cash Transactions' : 'UPI Transactions'}
                                                {' '}({filteredEntries.length})
                                            </p>
                                            {paymentFilter !== 'all' && (
                                                <button onClick={() => setPaymentFilter('all')} className="text-[10px] font-bold text-blue-600 hover:underline">
                                                    Show All
                                                </button>
                                            )}
                                        </div>
                                        {filteredEntries.length === 0 ? (
                                            <div className="bg-slate-50 rounded-xl px-4 py-5 text-center">
                                                <p className="text-xs text-slate-400 font-semibold">No transactions recorded</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2 max-h-[280px] overflow-y-auto">
                                                {filteredEntries.map(entry => {
                                                    const style = TYPE_STYLES[entry.type];
                                                    return (
                                                        <div
                                                            key={`${entry.source}-${entry.id}`}
                                                            role="button"
                                                            onClick={() => { setSelectedEntry(entry); setCorrectionMethod(entry.paymentMethod); setCorrectionUpi(null); setCorrectionAmount(String(entry.amount ?? '')); setDeleteConfirm(false); }}
                                                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-all text-left cursor-pointer"
                                                        >
                                                            {/* Photo */}
                                                            {entry.memberPhoto ? (
                                                                <img src={entry.memberPhoto} className="w-10 h-10 rounded-full object-cover flex-shrink-0" alt="" />
                                                            ) : (
                                                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                                                    <span className="text-sm font-bold text-slate-500">{(entry.memberName || '?')[0].toUpperCase()}</span>
                                                                </div>
                                                            )}
                                                            {/* Details */}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1.5">
                                                                    <p className="font-bold text-slate-900 text-xs truncate">{entry.memberName}</p>
                                                                    {entry.isAudit && (
                                                                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-100 text-amber-700">AUDIT</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${style.bg} ${style.text}`}>
                                                                        {style.label}
                                                                    </span>
                                                                    <span
                                                                        title={entry.paymentMethod === 'split' ? `Cash ₹${entry.cashAmount ?? 0} + UPI ₹${entry.upiAmount ?? 0}` : undefined}
                                                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${entry.paymentMethod === 'cash' ? 'bg-green-50 text-green-700' : entry.paymentMethod === 'upi' ? 'bg-purple-50 text-purple-700' : 'bg-amber-50 text-amber-700'}`}>
                                                                        {entry.paymentMethod === 'cash' ? '💵 Cash' : entry.paymentMethod === 'upi' ? '📱 UPI' : `⚡ Split (₹${entry.cashAmount ?? 0}+₹${entry.upiAmount ?? 0})`}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400">{fmtTime(entry.time)}</span>
                                                                </div>
                                                                <p className="text-[10px] text-slate-400 truncate mt-0.5">{entry.label}</p>
                                                            </div>
                                                            {/* Amount */}
                                                            <p className="font-black text-slate-900 text-sm flex-shrink-0">₹{entry.amount.toLocaleString("en-IN")}</p>
                                                            {/* Reprint button — fires the right receipt builder for this row's type. */}
                                                            <button
                                                                title="Reprint receipt"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (!clubId) return;
                                                                    reprintEntry(clubId, entry);
                                                                }}
                                                                className="ml-1 p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors flex-shrink-0"
                                                            >
                                                                <Printer className="w-3.5 h-3.5 text-slate-600" />
                                                            </button>
                                                            {/* Edit button — opens correction panel */}
                                                            <button
                                                                title="Edit transaction"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedEntry(entry);
                                                                    setCorrectionMethod(entry.paymentMethod);
                                                                    setCorrectionUpi(null);
                                                                    setCorrectionAmount(String(entry.amount ?? ''));
                                                                    setDeleteConfirm(false);
                                                                }}
                                                                className="ml-1 p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors flex-shrink-0"
                                                            >
                                                                <Pencil className="w-3.5 h-3.5" />
                                                            </button>
                                                            {/* Delete button — opens panel pre-set to delete confirm */}
                                                            <button
                                                                title="Delete transaction"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedEntry(entry);
                                                                    setCorrectionMethod(entry.paymentMethod);
                                                                    setCorrectionUpi(null);
                                                                    setCorrectionAmount(String(entry.amount ?? ''));
                                                                    setDeleteConfirm(true);
                                                                }}
                                                                className="ml-1 p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors flex-shrink-0"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Orders */}
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Shake Orders</p>
                                        {orders.length > 0 && (
                                            <button onClick={() => setShowOrderDetail(!showOrderDetail)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">
                                                {showOrderDetail ? <><ChevronUp className="w-3 h-3" /> Hide</> : <><ChevronDown className="w-3 h-3" /> Details</>}
                                            </button>
                                        )}
                                    </div>
                                    {/* Total Served — single number. Rejected/cancelled orders
                                        are excluded from every count here, per owner spec. */}
                                    <StatCard
                                        icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                                        label="Total Shakes Served (members + guests)"
                                        value={totalShakesServed}
                                        sub={guestShakesServed > 0 ? `${memberShakesServed} members + ${guestShakesServed} guests` : `${memberShakesServed} members`}
                                        color="bg-emerald-100 border-emerald-300"
                                        emphasize
                                    />
                                    {/* Per-shake breakdown — counts how many of each shake
                                        were served today. Only served orders count. */}
                                    {(() => {
                                        const counts: Record<string, number> = {};
                                        for (const o of orders) {
                                            if (o.status !== "served") continue;
                                            for (const it of (o.items || [])) {
                                                const name = (it as any).productName || (it as any).itemName || (it as any).name || "Shake";
                                                const qty = Number((it as any).quantity ?? (it as any).qty ?? 1) || 1;
                                                counts[name] = (counts[name] || 0) + qty;
                                            }
                                        }
                                        const breakdown = Object.entries(counts).sort(([, a], [, b]) => b - a);
                                        if (breakdown.length === 0) return null;
                                        return (
                                            <div className="mt-2 bg-white border border-slate-200 rounded-2xl p-3 space-y-1.5">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">By Shake</p>
                                                {breakdown.map(([name, qty]) => (
                                                    <div key={name} className="flex items-center justify-between text-xs">
                                                        <span className="font-bold text-slate-700 truncate pr-2">{name}</span>
                                                        <span className="font-black text-emerald-700 flex-shrink-0">× {qty}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    {/* Product Usage Breakdown — boxes/products consumed today via
                                        Daily Club Usage (Afresh ×10, Protein ×5, …). */}
                                    {productUsage.length > 0 && (
                                        <div className="mt-2 bg-white border border-indigo-200 rounded-2xl p-3 space-y-1.5">
                                            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Product Usage</p>
                                            {productUsage.map(u => (
                                                <div key={u.name} className="flex items-center justify-between text-xs">
                                                    <span className="font-bold text-slate-700 truncate pr-2">{u.name}</span>
                                                    <span className="font-black text-indigo-700 flex-shrink-0">× {u.qty}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {showOrderDetail && filteredOrders.length > 0 && (
                                        <div className="mt-2 space-y-1.5 max-h-[220px] overflow-y-auto">
                                            {[...filteredOrders].sort((a, b) => {
                                                const ta = (a as any).createdAt?.toMillis?.() || 0;
                                                const tb = (b as any).createdAt?.toMillis?.() || 0;
                                                return tb - ta;
                                            }).map((o, i) => {
                                                const statusColors: Record<string, string> = {
                                                    served: 'bg-emerald-100 text-emerald-700',
                                                    pending: 'bg-amber-100 text-amber-700',
                                                    preparing: 'bg-blue-100 text-blue-700',
                                                    cancelled: 'bg-red-100 text-red-700',
                                                    rejected: 'bg-red-100 text-red-700',
                                                };
                                                const items = o.items?.map(it => `${it.productName || it.itemName} x${it.quantity}`).join(', ') || '';
                                                const credits = o.items?.reduce((s, it) => s + (it.quantity || 1), 0) || 0;
                                                const canDelete = o.status !== 'served' && o.status !== 'rejected';
                                                return (
                                                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white border border-slate-100">
                                                        {(o as any).memberPhoto ? (
                                                            <img src={(o as any).memberPhoto} className="w-8 h-8 rounded-full object-cover flex-shrink-0" alt="" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                                                <span className="text-xs font-bold text-slate-500">{(o.memberName || '?')[0].toUpperCase()}</span>
                                                            </div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-bold text-slate-900 text-xs truncate">{o.memberName}</p>
                                                            <p className="text-[10px] text-slate-400 truncate">{items}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                                            <span className="text-[10px] font-bold text-slate-500">{credits} cr</span>
                                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${statusColors[o.status] || 'bg-slate-100 text-slate-700'}`}>
                                                                {o.status}
                                                            </span>
                                                            {canDelete && (
                                                                <button
                                                                    onClick={() => setOrderDeleteId(o.id)}
                                                                    title="Delete & refund order"
                                                                    className="p-1 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Expenses — tracked separately, NOT subtracted from revenue */}
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Today's Expenses</p>
                                        <button
                                            onClick={() => setShowExpenseForm(true)}
                                            className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:underline"
                                        >
                                            <Plus className="w-3 h-3" /> Add
                                        </button>
                                    </div>
                                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Receipt className="w-4 h-4 text-rose-500" />
                                                <span className="text-sm font-bold text-rose-800">Total Expenses</span>
                                            </div>
                                            <p className="text-2xl font-black text-rose-900">₹{expensesTotal.toLocaleString("en-IN")}</p>
                                        </div>
                                        <p className="text-[10px] text-rose-500 font-semibold mb-2">{expenses.length} entr{expenses.length === 1 ? "y" : "ies"} · informational only</p>
                                        {expenses.length === 0 ? (
                                            <p className="text-xs text-rose-400 italic py-2">No expenses logged today. Tap "Add" or the "Expense" button above to log one.</p>
                                        ) : (
                                            <div className="space-y-1.5 border-t border-rose-200 pt-2">
                                                {expenses
                                                    .slice()
                                                    .sort((a, b) => {
                                                        const ta = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
                                                        const tb = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
                                                        return tb - ta;
                                                    })
                                                    .map(e => (
                                                    <div key={e.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-rose-100">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-bold text-slate-800 truncate">
                                                                {e.name ? <span className="text-rose-700">{e.name} — </span> : null}{e.description || "Expense"}
                                                            </p>
                                                            <p className="text-[10px] text-slate-400 font-medium">
                                                                {e.createdAt?.toDate ? e.createdAt.toDate().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : ""}
                                                            </p>
                                                        </div>
                                                        <p className="text-sm font-black text-rose-700 mr-2">₹{(e.amount || 0).toLocaleString("en-IN")}</p>
                                                        {deletingExpenseId === e.id ? (
                                                            <div className="flex gap-1">
                                                                <button
                                                                    onClick={() => setDeletingExpenseId(null)}
                                                                    className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold hover:bg-slate-200"
                                                                >No</button>
                                                                <button
                                                                    onClick={() => handleDeleteExpense(e.id)}
                                                                    className="px-2 py-1 rounded-md bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700"
                                                                >Delete</button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setDeletingExpenseId(e.id)}
                                                                className="p-1 rounded-full hover:bg-rose-100 text-rose-400 hover:text-rose-600"
                                                                title="Delete expense"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Member Visits / Attendance — expanded list with per-row remove */}
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Today's Attendance</p>
                                        <button
                                            onClick={() => setShowAttendanceList(s => !s)}
                                            className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline"
                                        >
                                            {showAttendanceList ? <><ChevronUp className="w-3 h-3" /> Hide list</> : <><ChevronDown className="w-3 h-3" /> Show list</>}
                                        </button>
                                    </div>
                                    {/* Big summary cards */}
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-center">
                                            <Users className="w-6 h-6 text-violet-500 mx-auto mb-1" />
                                            <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest">Members</p>
                                            <p className="text-3xl font-black text-violet-900 mt-1">{filteredMemberAttendance.length}{isSearching && filteredMemberAttendance.length !== memberAttendance.length ? <span className="text-sm text-violet-400"> / {memberAttendance.length}</span> : null}</p>
                                            <p className="text-[10px] text-violet-500 mt-0.5">visited today</p>
                                        </div>
                                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                                            <UserCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                                            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Volunteers</p>
                                            <p className="text-3xl font-black text-emerald-900 mt-1">{filteredVolunteerAttendance.length}{isSearching && filteredVolunteerAttendance.length !== volunteerAttendance.length ? <span className="text-sm text-emerald-400"> / {volunteerAttendance.length}</span> : null}</p>
                                            <p className="text-[10px] text-emerald-500 mt-0.5">on duty today</p>
                                        </div>
                                    </div>

                                    {/* Detailed list */}
                                    {showAttendanceList && (
                                        <div className="bg-white rounded-2xl border overflow-hidden">
                                            {filteredMemberAttendance.length === 0 && filteredVolunteerAttendance.length === 0 ? (
                                                <div className="px-4 py-5 text-center">
                                                    <p className="text-xs text-slate-400 font-semibold">{isSearching ? 'No check-ins match your search' : 'No check-ins yet today'}</p>
                                                </div>
                                            ) : (
                                                <div className="divide-y max-h-[320px] overflow-y-auto">
                                                    {filteredMemberAttendance.map((rec: any) => {
                                                        const tDate = rec.checkInTime?.toDate ? rec.checkInTime.toDate() : null;
                                                        const isRemoving = removingAttendanceId === `m_${rec.id}`;
                                                        return (
                                                            <div key={`m_${rec.id}`} className="px-3 py-2.5">
                                                                {isRemoving ? (
                                                                    <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                                                                        <p className="text-xs font-bold text-red-700 mb-2">Remove {rec.userName}'s check-in?</p>
                                                                        <div className="flex gap-2">
                                                                            <button onClick={() => setRemovingAttendanceId(null)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">Keep</button>
                                                                            <button
                                                                                onClick={() => handleRemoveAttendance(rec, 'member')}
                                                                                disabled={attendanceBusy}
                                                                                className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-60"
                                                                            >
                                                                                {attendanceBusy ? 'Removing...' : 'Yes, remove'}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-3">
                                                                        {rec.userPhoto ? (
                                                                            <img src={rec.userPhoto} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                                                                        ) : (
                                                                            <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                                                                                <span className="text-xs font-black text-violet-600">{(rec.userName || '?')[0]?.toUpperCase()}</span>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <p className="font-bold text-slate-900 text-xs truncate">{rec.userName}</p>
                                                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-violet-100 text-violet-700">MEMBER</span>
                                                                            </div>
                                                                            <p className="text-[10px] text-slate-400 mt-0.5">{tDate ? fmtTime(tDate) : 'Today'}</p>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setRemovingAttendanceId(`m_${rec.id}`)}
                                                                            title="Remove check-in"
                                                                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors flex-shrink-0"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                    {filteredVolunteerAttendance.map((rec: any) => {
                                                        const tDate = rec.checkInTime?.toDate ? rec.checkInTime.toDate() : null;
                                                        const isRemoving = removingAttendanceId === `v_${rec.id}`;
                                                        return (
                                                            <div key={`v_${rec.id}`} className="px-3 py-2.5">
                                                                {isRemoving ? (
                                                                    <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                                                                        <p className="text-xs font-bold text-red-700 mb-2">Remove {rec.userName}'s volunteer session?</p>
                                                                        <div className="flex gap-2">
                                                                            <button onClick={() => setRemovingAttendanceId(null)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">Keep</button>
                                                                            <button
                                                                                onClick={() => handleRemoveAttendance(rec, 'volunteer')}
                                                                                disabled={attendanceBusy}
                                                                                className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-60"
                                                                            >
                                                                                {attendanceBusy ? 'Removing...' : 'Yes, remove'}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-3">
                                                                        {rec.userPhoto ? (
                                                                            <img src={rec.userPhoto} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                                                                        ) : (
                                                                            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                                                                <span className="text-xs font-black text-emerald-600">{(rec.userName || '?')[0]?.toUpperCase()}</span>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <p className="font-bold text-slate-900 text-xs truncate">{rec.userName}</p>
                                                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-100 text-emerald-700">VOLUNTEER</span>
                                                                            </div>
                                                                            <p className="text-[10px] text-slate-400 mt-0.5">{tDate ? fmtTime(tDate) : 'Today'}</p>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setRemovingAttendanceId(`v_${rec.id}`)}
                                                                            title="Remove session"
                                                                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors flex-shrink-0"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Guests */}
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Guests</p>
                                        <button onClick={() => setShowGuestEntry(true)} className="flex items-center gap-1 text-[10px] font-bold text-violet-600 hover:underline">
                                            <UserPlus className="w-3 h-3" /> Add Guest
                                        </button>
                                    </div>
                                    {guestEntries.length === 0 ? (
                                        <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-5 text-center">
                                            <p className="text-xs text-slate-400 font-semibold">No guests recorded today</p>
                                        </div>
                                    ) : (
                                        <div className="bg-white rounded-2xl border overflow-hidden">
                                            {/* Summary row */}
                                            <div className="grid grid-cols-3 divide-x border-b">
                                                <div className="p-3 text-center">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</p>
                                                    <p className="text-xl font-black text-slate-900 mt-0.5">{guestEntries.length}</p>
                                                </div>
                                                <div className="p-3 text-center">
                                                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Free</p>
                                                    <p className="text-xl font-black text-emerald-700 mt-0.5">{guestEntries.filter(g => g.type === 'unpaid').length}</p>
                                                </div>
                                                <div className="p-3 text-center">
                                                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Paid</p>
                                                    <p className="text-xl font-black text-blue-700 mt-0.5">{guestEntries.filter(g => g.type === 'paid').length}</p>
                                                </div>
                                            </div>
                                            {/* Guest revenue */}
                                            {guestEntries.some(g => g.type === 'paid') && (
                                                <div className="px-4 py-2.5 border-b bg-blue-50 flex items-center justify-between">
                                                    <p className="text-xs font-bold text-blue-700">Guest Revenue</p>
                                                    <p className="text-sm font-black text-blue-800">
                                                        ₹{guestEntries.filter(g => g.type === 'paid').reduce((s, g) => s + (g.amountPaid ?? 0), 0).toLocaleString("en-IN")}
                                                    </p>
                                                </div>
                                            )}
                                            {/* Guest list (expandable) */}
                                            <button
                                                onClick={() => setShowGuestDetail(!showGuestDetail)}
                                                className="w-full px-4 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:bg-slate-50 transition-colors"
                                            >
                                                {showGuestDetail ? "Hide details ▲" : "Show details ▼"}
                                            </button>
                                            {showGuestDetail && (
                                                <div className="divide-y border-t">
                                                    {filteredGuestEntries.length === 0 && isSearching ? (
                                                        <div className="px-4 py-4 text-center text-[11px] text-slate-400 font-semibold">No guests match your search</div>
                                                    ) : null}
                                                    {filteredGuestEntries.map((g) => (
                                                        <div key={g.id} className="px-4 py-3">
                                                            {/* Confirm-delete overlay */}
                                                            {deletingGuestId === g.id ? (
                                                                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                                                                    <p className="text-xs font-bold text-red-700 mb-2">Delete {g.guestName}'s entry?</p>
                                                                    <p className="text-[10px] text-red-500 mb-3">
                                                                        {(g.items && g.items.length > 0)
                                                                            ? `All ${g.items.length} item${g.items.length > 1 ? 's' : ''} will be reversed: orders cancelled & stock restored.`
                                                                            : g.itemType === 'shake' ? 'Shake order will be cancelled & stock restored.' : 'Inventory quantity will be restored.'}
                                                                        {g.type === 'paid' ? ' Payment record will be removed.' : ''}
                                                                    </p>
                                                                    <div className="flex gap-2">
                                                                        <button onClick={() => setDeletingGuestId(null)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">Cancel</button>
                                                                        <button
                                                                            onClick={async () => {
                                                                                await deleteGuestEntry.mutateAsync({ entryId: g.id, clubId: clubId ?? undefined });
                                                                                setDeletingGuestId(null);
                                                                            }}
                                                                            className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                                                                        >
                                                                            {deleteGuestEntry.isPending ? "Deleting..." : "Yes, Delete"}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-3">
                                                                    {g.guestPhoto ? (
                                                                        <img src={g.guestPhoto} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                                                                    ) : (
                                                                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                                                            <UserCheck className="w-4 h-4 text-slate-400" />
                                                                        </div>
                                                                    )}
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="font-bold text-slate-900 text-xs truncate">{g.guestName}</p>
                                                                        <p className="text-[10px] text-slate-400">{g.guestPhone}</p>
                                                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                                                            {(g.items && g.items.length > 0)
                                                                                ? g.items.map((it: any) =>
                                                                                    `${it.type === 'shake' ? '🥤' : it.type === 'inventory_product' ? '📦' : '🎫'} ${it.productName}${it.qty > 1 ? ` × ${it.qty}` : ''}`
                                                                                ).join(', ')
                                                                                : g.itemType === 'shake' ? `🥤 ${g.shakeProductName}` : `📦 ${g.inventoryProductName}${g.inventoryQuantity ? ` × ${g.inventoryQuantity} ${g.inventoryProductUnit}` : ''}`}
                                                                        </p>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                        <div className="text-right mr-1">
                                                                            {g.type === 'paid' ? (
                                                                                <>
                                                                                    <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[9px] font-black uppercase">Paid</span>
                                                                                    <p className="text-xs font-black text-blue-700 mt-0.5">₹{(g.amountPaid ?? 0).toLocaleString("en-IN")}</p>
                                                                                </>
                                                                            ) : (
                                                                                <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">Free</span>
                                                                            )}
                                                                        </div>
                                                                        <button onClick={() => setEditingGuest(g)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors" title="Edit">
                                                                            <Pencil className="w-3 h-3 text-slate-500" />
                                                                        </button>
                                                                        <button onClick={() => setDeletingGuestId(g.id)} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors" title="Delete">
                                                                            <Trash2 className="w-3 h-3 text-red-500" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {saveSuccess && (
                                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 text-sm font-bold">
                                        <CheckCircle2 className="w-4 h-4" /> Report saved to history
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-4 border-t bg-white space-y-2">
                        <div className="flex gap-2">
                            <button onClick={handleSaveReport} disabled={saving || isLoading}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 text-emerald-700 font-bold text-sm hover:bg-emerald-50 transition-colors disabled:opacity-60">
                                <Save className="w-4 h-4" />
                                {saving ? "Saving..." : saveSuccess ? "Saved ✓" : "Save Report"}
                            </button>
                            <button onClick={handlePrint}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
                                <Printer className="w-4 h-4" /> Print
                            </button>
                        </div>
                        <button
                            onClick={() => {
                                if (!clubId) return;
                                fetchClubAndPrint(clubId, (freshClub) => buildShiftSummarySlip({
                                    club: freshClub,
                                    date: todayStr(),
                                    cashTotal,
                                    upiTotal,
                                    upiBreakdown: Object.values(upiAccBreakdown).map(u => ({
                                        accountName: u.name, number: u.number, total: u.total,
                                    })),
                                    totalOrders,
                                    totalShakesServed,
                                    timestamp: new Date(),
                                }));
                            }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-bold text-sm hover:bg-amber-100 transition-colors">
                            <Printer className="w-4 h-4" /> Print Shift Summary (cash drawer handover)
                        </button>
                        <button onClick={handleExportExcel} disabled={exporting || isLoading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60">
                            <Download className="w-4 h-4" />
                            {exporting ? "Exporting..." : "Export Excel"}
                        </button>
                    </div>
                </div>
            </div>

            {showPrintPicker && (
                <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                    <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col" style={{ fontFamily: "'Nunito', sans-serif" }}>
                        <div className="px-5 py-4 border-b flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-black text-slate-900">What should we print?</h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">Pick the sections to include on the receipt.</p>
                            </div>
                            <button onClick={() => setShowPrintPicker(false)} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-2">
                            {[
                                { key: 'core' as const, label: "Today's report (shakes, payments, attendance)", checked: printSections.core, onToggle: () => setPrintSections(s => ({ ...s, core: !s.core })) },
                                { key: 'guests' as const, label: `Guests${guestEntries.length === 0 ? ' (no entries today)' : ` (${guestEntries.length} today)`}`, checked: printSections.guests, onToggle: () => setPrintSections(s => ({ ...s, guests: !s.guests })), disabled: guestEntries.length === 0 },
                                { key: 'letterhead' as const, label: 'Club letterhead (address, GST, tagline) — off saves most of the paper', checked: printSections.letterhead, onToggle: () => setPrintSections(s => ({ ...s, letterhead: !s.letterhead })) },
                                { key: 'expenses' as const, label: `Expenses${expenses.length === 0 ? ' (no entries today)' : ` (${expenses.length} today)`}`, checked: printSections.expenses, onToggle: () => setPrintSections(s => ({ ...s, expenses: !s.expenses })), disabled: expenses.length === 0 },
                                { key: 'invoice' as const, label: 'Daily tax invoice (GST breakdown)', checked: printIncludeInvoice, onToggle: () => setPrintIncludeInvoice(v => !v) },
                            ].map(row => (
                                <label key={row.key} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${row.disabled ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-100' : row.checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                    <input
                                        type="checkbox"
                                        checked={row.checked && !row.disabled}
                                        onChange={() => { if (!row.disabled) row.onToggle(); }}
                                        disabled={row.disabled}
                                        className="mt-0.5 w-5 h-5 accent-emerald-600 cursor-pointer disabled:cursor-not-allowed"
                                    />
                                    <span className="text-sm font-bold text-slate-800 select-none">{row.label}</span>
                                </label>
                            ))}
                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => {
                                        setPrintSections({ core: true, guests: true, expenses: true, letterhead: true });
                                        setPrintIncludeInvoice(true);
                                    }}
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                                >Select all</button>
                                <button
                                    onClick={() => {
                                        setPrintSections({ core: false, guests: false, expenses: false, letterhead: false });
                                        setPrintIncludeInvoice(false);
                                    }}
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                                >Clear all</button>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t flex gap-2 bg-slate-50">
                            <button
                                onClick={() => setShowPrintPicker(false)}
                                disabled={printing}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-white disabled:opacity-50"
                            >Cancel</button>
                            <button
                                onClick={confirmPrint}
                                disabled={printing}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60"
                            >
                                <Printer className="w-4 h-4" />
                                {printing ? 'Sending…' : 'Print'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showManualEntry && <ManualEntryModal onClose={() => setShowManualEntry(false)} />}
            {showGuestEntry && clubId && (
                <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                    <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] overflow-y-auto">
                        <ReceptionGuestWizard clubId={clubId} onClose={() => setShowGuestEntry(false)} />
                    </div>
                </div>
            )}
            {editingGuest && <GuestEntryModal editEntry={editingGuest} onClose={() => setEditingGuest(null)} />}

            {/* Correction bottom sheet */}
            {selectedEntry && (
                <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                    <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden" style={{ fontFamily: "'Nunito', sans-serif" }}>
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b">
                            <h3 className="text-base font-black text-slate-900 flex items-center gap-2"><Pencil className="w-4 h-4" /> Edit Transaction</h3>
                            <button onClick={() => setSelectedEntry(null)} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-5">
                            {/* Member info */}
                            <div className="flex flex-col items-center gap-2">
                                {selectedEntry.memberPhoto ? (
                                    <img src={selectedEntry.memberPhoto} className="w-16 h-16 rounded-full object-cover border-4 border-slate-100" alt="" />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border-4 border-slate-50">
                                        <span className="text-2xl font-bold text-slate-500">{(selectedEntry.memberName || '?')[0].toUpperCase()}</span>
                                    </div>
                                )}
                                <p className="font-black text-slate-900 text-lg">{selectedEntry.memberName}</p>
                                {selectedEntry.memberId && <p className="text-xs text-slate-400 font-mono">{selectedEntry.memberId}</p>}
                            </div>

                            {/* Details grid */}
                            <div className="bg-slate-50 rounded-2xl divide-y divide-slate-100 overflow-hidden">
                                <div className="flex justify-between px-4 py-2.5">
                                    <span className="text-xs text-slate-500 font-bold">Amount</span>
                                    <span className="text-sm font-black text-slate-900">₹{selectedEntry.amount.toLocaleString("en-IN")}</span>
                                </div>
                                <div className="flex justify-between px-4 py-2.5">
                                    <span className="text-xs text-slate-500 font-bold">Type</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${TYPE_STYLES[selectedEntry.type].bg} ${TYPE_STYLES[selectedEntry.type].text}`}>
                                        {TYPE_STYLES[selectedEntry.type].label}
                                    </span>
                                </div>
                                <div className="flex justify-between px-4 py-2.5">
                                    <span className="text-xs text-slate-500 font-bold">Details</span>
                                    <span className="text-xs font-bold text-slate-700 text-right max-w-[200px] truncate">{selectedEntry.label}</span>
                                </div>
                                <div className="flex justify-between px-4 py-2.5">
                                    <span className="text-xs text-slate-500 font-bold">Current Method</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${selectedEntry.paymentMethod === 'cash' ? 'bg-green-100 text-green-700' : selectedEntry.paymentMethod === 'upi' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {selectedEntry.paymentMethod === 'cash' ? '💵 Cash' : selectedEntry.paymentMethod === 'upi' ? '📱 UPI' : `⚡ Split (₹${selectedEntry.cashAmount ?? 0}+₹${selectedEntry.upiAmount ?? 0})`}
                                        {selectedEntry.upiAccountName ? ` · ${selectedEntry.upiAccountName}` : ''}
                                    </span>
                                </div>
                                <div className="flex justify-between px-4 py-2.5">
                                    <span className="text-xs text-slate-500 font-bold">Time</span>
                                    <span className="text-xs font-bold text-slate-700">{fmtTime(selectedEntry.time)}</span>
                                </div>
                                {selectedEntry.verifiedBy && (
                                    <div className="flex justify-between px-4 py-2.5">
                                        <span className="text-xs text-slate-500 font-bold">Verified by</span>
                                        <span className="text-xs font-bold text-slate-700">{selectedEntry.verifiedBy}</span>
                                    </div>
                                )}
                                {selectedEntry.isAudit && (
                                    <div className="flex justify-between px-4 py-2.5">
                                        <span className="text-xs text-slate-500 font-bold">Source</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-700">Audit Entry</span>
                                    </div>
                                )}
                            </div>

                            {/* Correction: edit amount */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Edit Amount (₹)</p>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={correctionAmount}
                                    onChange={(e) => setCorrectionAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 font-bold text-slate-900 text-sm"
                                    placeholder="Amount"
                                />
                                {correctionAmount && Number(correctionAmount) !== selectedEntry.amount && (
                                    <p className="text-[10px] text-amber-600 mt-1 font-semibold">
                                        Amount will be updated from ₹{selectedEntry.amount} → ₹{Number(correctionAmount).toLocaleString('en-IN')}
                                    </p>
                                )}
                            </div>

                            {/* Correction: change payment method */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Change Payment Method</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => { setCorrectionMethod('cash'); setCorrectionUpi(null); }}
                                        className={`py-3 rounded-xl border text-sm font-bold transition-all ${correctionMethod === 'cash' ? 'bg-green-50 border-green-400 text-green-700 ring-2 ring-green-200' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                    >
                                        💵 Cash
                                    </button>
                                    <button
                                        onClick={() => setCorrectionMethod('upi')}
                                        className={`py-3 rounded-xl border text-sm font-bold transition-all ${correctionMethod === 'upi' ? 'bg-purple-50 border-purple-400 text-purple-700 ring-2 ring-purple-200' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                    >
                                        📱 UPI
                                    </button>
                                </div>
                                {correctionMethod === 'upi' && (
                                    <div className="mt-2 space-y-1.5">
                                        {upiAccounts.length === 0 ? (
                                            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
                                                No UPI accounts configured.
                                            </p>
                                        ) : upiAccounts.map(u => (
                                            <button
                                                key={u.id}
                                                onClick={() => setCorrectionUpi(u)}
                                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all ${correctionUpi?.id === u.id ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-200' : 'border-slate-200 hover:bg-slate-50'}`}
                                            >
                                                <div className="text-left">
                                                    <p className="font-bold text-slate-700 text-xs">{u.app}</p>
                                                    <p className="text-[10px] text-slate-400">{u.holderName} · {u.number}</p>
                                                </div>
                                                {correctionUpi?.id === u.id && <span className="text-purple-600 font-bold text-xs">✓</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-4 border-t space-y-2">
                            {deleteConfirm ? (
                                <div className="space-y-2">
                                    <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                                        <p className="text-xs font-bold text-red-800">
                                            Delete this entry permanently? The amount will no longer appear in today's totals or reports.
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setDeleteConfirm(false)}
                                            disabled={correctionDeleting}
                                            className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors"
                                        >
                                            Keep
                                        </button>
                                        <button
                                            onClick={handleDeleteEntry}
                                            disabled={correctionDeleting}
                                            className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors disabled:opacity-60"
                                        >
                                            {correctionDeleting ? 'Deleting...' : 'Confirm Delete'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedEntry(null)}
                                            className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleCorrection}
                                            disabled={correctionSaving || correctionDeleting}
                                            className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
                                        >
                                            {correctionSaving ? 'Saving...' : 'Save Changes'}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => setDeleteConfirm(true)}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> Delete Entry
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Order delete confirm */}
            {orderDeleteId && (
                <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white w-full sm:max-w-md rounded-3xl shadow-2xl overflow-hidden" style={{ fontFamily: "'Nunito', sans-serif" }}>
                        <div className="px-5 py-4 border-b flex items-center justify-between">
                            <h3 className="text-base font-black text-slate-900">Delete Order</h3>
                            <button onClick={() => setOrderDeleteId(null)} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                                <p className="text-xs font-bold text-red-800 mb-1">This will reject the order and refund everything:</p>
                                <ul className="text-[11px] text-red-700 list-disc list-inside space-y-0.5">
                                    <li>Shake credits returned to the member</li>
                                    <li>Menu stock restored</li>
                                    <li>Today's special stock restored (if limited)</li>
                                </ul>
                            </div>
                            <p className="text-[11px] text-slate-500">Orders that have already been served cannot be deleted.</p>
                        </div>
                        <div className="px-5 py-4 border-t flex gap-2">
                            <button
                                onClick={() => setOrderDeleteId(null)}
                                disabled={orderDeleting}
                                className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteOrder(orderDeleteId)}
                                disabled={orderDeleting}
                                className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors disabled:opacity-60"
                            >
                                {orderDeleting ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
