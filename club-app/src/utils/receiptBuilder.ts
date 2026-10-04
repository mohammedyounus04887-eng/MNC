/**
 * Receipt builders for all print types.
 * All receipts use ESC/POS commands formatted for 80mm (48-char) thermal paper.
 */

import {
    ALIGN_CENTER, ALIGN_LEFT,
    BOLD_ON, BOLD_OFF,
    SIZE_LARGE, SIZE_NORMAL, SIZE_MEDIUM,
    LF, DIVIDER, DIVIDER_THIN,
    CUT, twoCol, truncate, WIDE_WIDTH,
    PRINTER_RESET,
} from './escpos';
import { formatINR } from './printReceipt';
import { getMemberStatusEmoji } from './memberEmoji';

// ═══════════════════════════════════════════════
// Club data shape used by all receipts
// ═══════════════════════════════════════════════
export interface ClubPrintData {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    gstNumber?: string;
}

// ═══════════════════════════════════════════════
// HEADER + FOOTER (shared by all receipts)
// ═══════════════════════════════════════════════

export const buildHeader = (club: ClubPrintData): string[] => [
    // Reset printer to a known clean state (Font A, default line spacing,
    // PC437 codepage). Without this, the printer inherits whatever font/
    // width/spacing the previous print job left it in — which is how things
    // like "each word of the date on its own line" leak in.
    PRINTER_RESET,
    ALIGN_CENTER,
    BOLD_ON,
    'Usha Prasad Enterprises\n',
    BOLD_OFF,
    ...(club.address ? [club.address + '\n'] : []),
    ...(club.phone ? [`Ph: ${club.phone}\n`] : []),
    ...(club.email ? [`Email: ${club.email}\n`] : []),
    ...(club.gstNumber ? [`GSTIN: ${club.gstNumber}\n`] : []),
    DIVIDER + '\n',
    ALIGN_LEFT,
];

export const buildFooter = (): string[] => [
    LF,
    DIVIDER + '\n',
    ALIGN_CENTER,
    BOLD_ON,
    SIZE_MEDIUM,
    '"Good nutrition is not\n',
    'a luxury, it is a\n',
    'necessity of life."\n',
    SIZE_NORMAL,
    BOLD_OFF,
    'Powered by Magic Nutrition Club\n',
    LF,
    CUT,
];

// Helper to format a Date
const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

// ═══════════════════════════════════════════════
// 1. WALLET TOP-UP RECEIPT
// ═══════════════════════════════════════════════

export interface TopUpReceiptData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    phone: string;
    amount: number;
    previousBalance: number;
    newBalance: number;
    paymentMethod: string;
    /** Split breakdown — set when paymentMethod === 'split'. */
    cashAmount?: number;
    upiAmount?: number;
    upiAccountName?: string;
    transactionId: string;
    timestamp?: Date;
}

export const buildTopUpReceipt = (data: TopUpReceiptData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'WALLET TOP-UP RECEIPT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp ?? new Date()) + '\n',
    'Time: ' + fmtTime(data.timestamp ?? new Date()) + '\n',
    'Receipt No: ' + data.transactionId + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'MEMBER DETAILS\n',
    BOLD_OFF,
    'Name: ' + truncate(data.memberName, 30) + '\n',
    'Member ID: ' + data.memberId + '\n',
    'Phone: ' + data.phone + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TRANSACTION DETAILS\n',
    BOLD_OFF,
    'Amount Added: ' + formatINR(data.amount) + '\n',
    'Payment Method: ' + (data.paymentMethod === 'split' ? 'Split' : data.paymentMethod) + '\n',
    ...(data.paymentMethod === 'split' ? [
        '  Cash: ' + formatINR(data.cashAmount ?? 0) + '\n',
        '  UPI: ' + formatINR(data.upiAmount ?? 0) + '\n',
        ...(data.upiAccountName ? ['  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n'] : []),
    ] : data.paymentMethod === 'upi' && data.upiAccountName ? [
        '  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n',
    ] : []),
    'Prev Balance: ' + formatINR(data.previousBalance) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    SIZE_MEDIUM,
    'NEW BALANCE: ' + formatINR(data.newBalance) + '\n',
    SIZE_NORMAL,
    BOLD_OFF,
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 2. MEMBERSHIP RECEIPT
// ═══════════════════════════════════════════════

export interface MembershipReceiptData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    planName: string;
    amount: number;
    totalVisits?: number;
    paymentMethod: string;
    startDate: Date;
    endDate: Date;
    timestamp: Date;
    receiptNumber: string;
    walletBalanceAfter?: number;
}

// GST calculation: amount is inclusive of 5% GST (SGST 2.5% + CGST 2.5%)
const calcGST = (grossAmount: number) => {
    const net = Math.round((grossAmount / 1.05) * 100) / 100;
    const totalGst = grossAmount - net;
    const sgst = Math.round((totalGst / 2) * 100) / 100;
    const cgst = Math.round((totalGst - sgst) * 100) / 100;
    return { net, sgst, cgst, total: grossAmount };
};

export const buildMembershipReceipt = (data: MembershipReceiptData): string[] => {
    const gst = calcGST(data.amount);
    return [
        ...buildHeader(data.club),
        LF,
        ALIGN_CENTER,
        BOLD_ON,
        'MEMBERSHIP RECEIPT\n',
        BOLD_OFF,
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt No: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'MEMBER DETAILS\n',
        BOLD_OFF,
        'Name: ' + truncate(data.memberName, 30) + '\n',
        'Member ID: ' + data.memberId + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'PLAN DETAILS\n',
        BOLD_OFF,
        'Plan: ' + data.planName + '\n',
        'Credits: ' + `${data.totalVisits} credits` + '\n',
        'Valid From: ' + fmtDate(data.startDate) + '\n',
        'Valid Until: ' + fmtDate(data.endDate) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'AMOUNT BREAKDOWN\n',
        BOLD_OFF,
        'Net Amount: ' + formatINR(gst.net) + '\n',
        'SGST (2.5%): ' + formatINR(gst.sgst) + '\n',
        'CGST (2.5%): ' + formatINR(gst.cgst) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        SIZE_MEDIUM,
        'TOTAL: ' + formatINR(gst.total) + '\n',
        SIZE_NORMAL,
        BOLD_OFF,
        'Payment: Wallet\n',
        'Wallet After: ' + formatINR(data.walletBalanceAfter) + '\n',
        LF,
        ...buildFooter(),
    ];
};

// ═══════════════════════════════════════════════
// 3. KITCHEN DAILY REPORT
// ═══════════════════════════════════════════════

export interface KitchenDailyData {
    club: ClubPrintData;
    date: string;
    totalShakes: number;
    completedOrders: number;
    pendingOrders: number;
    totalRevenue: number;
    productBreakdown: Array<{ name: string; qty: number }>;
}

export const buildKitchenDailyReceipt = (data: KitchenDailyData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'KITCHEN DAILY REPORT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date,
    LF,
    DIVIDER_THIN,
    LF,
    BOLD_ON,
    'SUMMARY\n',
    BOLD_OFF,
    'Total Shakes Sold: ' + String(data.totalShakes),
    LF,
    'Orders Completed: ' + String(data.completedOrders),
    LF,
    'Orders Pending: ' + String(data.pendingOrders),
    LF,
    'Total Revenue: ' + formatINR(data.totalRevenue),
    LF,
    DIVIDER_THIN,
    LF,
    BOLD_ON,
    'PRODUCT BREAKDOWN\n',
    BOLD_OFF,
    ...data.productBreakdown.flatMap(p => [
        truncate(p.name, 22) + ' ' + `${p.qty} sold`,
        LF,
    ]),
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 4. DAILY SALES REPORT
// ═══════════════════════════════════════════════

export interface DailySalesData {
    club: ClubPrintData;
    date: string;
    totalRevenue: number;
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    topProducts: Array<{ name: string; count: number }>;
    topMembers: Array<{ name: string; count: number }>;
}

export const buildDailySalesReceipt = (data: DailySalesData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'DAILY SALES REPORT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'REVENUE SUMMARY\n',
    BOLD_OFF,
    'Total Revenue: ' + formatINR(data.totalRevenue) + '\n',
    'Total Orders: ' + String(data.totalOrders) + '\n',
    'Completed: ' + String(data.completedOrders) + '\n',
    'Cancelled: ' + String(data.cancelledOrders) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TOP PRODUCTS\n',
    BOLD_OFF,
    ...data.topProducts.map((p, i) =>
        `${i + 1}. ${truncate(p.name, 28)} ${p.count} sold` + '\n'
    ),
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TOP MEMBERS TODAY\n',
    BOLD_OFF,
    ...data.topMembers.map((m, i) =>
        `${i + 1}. ${truncate(m.name, 28)} ${m.count} order${m.count > 1 ? 's' : ''}` + '\n'
    ),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 5. MONTHLY SALES REPORT
// ═══════════════════════════════════════════════

export interface MonthlySalesData {
    club: ClubPrintData;
    monthYear: string; // e.g. "March 2026"
    totalRevenue: number;
    totalOrders: number;
    activeMembers: number;
    newMembers: number;
    topProducts: Array<{ name: string; count: number }>;
    totalTopUps: number;
    topUpCount: number;
}

export const buildMonthlySalesReceipt = (data: MonthlySalesData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    `MONTHLY REPORT — ${data.monthYear}\n`,
    BOLD_OFF,
    ALIGN_LEFT,
    DIVIDER_THIN + '\n',
    'Total Revenue: ' + formatINR(data.totalRevenue) + '\n',
    'Total Orders: ' + String(data.totalOrders) + '\n',
    'Active Members: ' + String(data.activeMembers) + '\n',
    'New Members: ' + String(data.newMembers) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TOP PRODUCTS THIS MONTH\n',
    BOLD_OFF,
    ...data.topProducts.map((p, i) =>
        `${i + 1}. ${truncate(p.name, 26)} ${p.count} sold` + '\n'
    ),
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'WALLET TOP-UPS\n',
    BOLD_OFF,
    'Total Top-ups: ' + formatINR(data.totalTopUps) + '\n',
    'No. of Top-ups: ' + String(data.topUpCount) + '\n',
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 6. YEARLY SALES REPORT
// ═══════════════════════════════════════════════

export interface YearlySalesData {
    club: ClubPrintData;
    year: string;
    totalRevenue: number;
    totalOrders: number;
    totalMembers: number;
    monthlyBreakdown: Array<{ month: string; revenue: number }>;
}

export const buildYearlySalesReceipt = (data: YearlySalesData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    `YEARLY REPORT — ${data.year}\n`,
    BOLD_OFF,
    ALIGN_LEFT,
    DIVIDER_THIN + '\n',
    'Total Revenue: ' + formatINR(data.totalRevenue) + '\n',
    'Total Orders: ' + String(data.totalOrders) + '\n',
    'Total Members: ' + String(data.totalMembers) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'MONTHLY BREAKDOWN\n',
    BOLD_OFF,
    ...data.monthlyBreakdown.map(m =>
        m.month + ': ' + formatINR(m.revenue) + '\n'
    ),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 7. MEMBER LIST RECEIPT
// ═══════════════════════════════════════════════

export interface MemberListData {
    club: ClubPrintData;
    date: string;
    totalMembers: number;
    members: Array<{ name: string; plan: string; expires: string }>;
}

export const buildMemberListReceipt = (data: MemberListData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'ACTIVE MEMBERS LIST\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    'Total Members: ' + String(data.totalMembers) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    twoCol('No.  Name', 'Plan    Expires') + '\n',
    BOLD_OFF,
    ...data.members.map((m, i) => {
        const num = String(i + 1).padEnd(4);
        const name = truncate(m.name, 16).padEnd(16);
        const plan = truncate(m.plan, 7).padEnd(8);
        const exp = truncate(m.expires, 10);
        return `${num} ${name} ${plan} ${exp}\n`;
    }),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 8. EXPIRED MEMBERSHIPS RECEIPT
// ═══════════════════════════════════════════════

export interface ExpiredMembersData {
    club: ClubPrintData;
    date: string;
    totalExpired: number;
    members: Array<{ name: string; plan: string; expiredOn: string }>;
}

export const buildExpiredMembersReceipt = (data: ExpiredMembersData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'EXPIRED MEMBERSHIPS\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    'Total Expired: ' + String(data.totalExpired) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    twoCol('No.  Name', 'Plan   Expired On') + '\n',
    BOLD_OFF,
    ...data.members.map((m, i) => {
        const num = String(i + 1).padEnd(4);
        const name = truncate(m.name, 14).padEnd(14);
        const plan = truncate(m.plan, 7).padEnd(7);
        const exp = truncate(m.expiredOn, 12);
        return `${num} ${name} ${plan} ${exp}\n`;
    }),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 9. TOP-UP HISTORY RECEIPT
// ═══════════════════════════════════════════════

export interface TopUpHistoryData {
    club: ClubPrintData;
    period: string;
    transactions: Array<{ date: string; member: string; amount: number }>;
    totalAmount: number;
    totalCount: number;
}

export const buildTopUpHistoryReceipt = (data: TopUpHistoryData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'TOP-UP HISTORY REPORT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Period: ' + data.period + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'Date     Member         Amount\n',
    BOLD_OFF,
    ...data.transactions.map(t => {
        const dt = truncate(t.date, 8).padEnd(9);
        const name = truncate(t.member, 14).padEnd(15);
        return `${dt}${name}${formatINR(t.amount)}\n`;
    }),
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TOTAL TOP-UPS: ' + formatINR(data.totalAmount) + '\n',
    'COUNT: ' + String(data.totalCount) + '\n',
    BOLD_OFF,
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 10. MEMBERSHIP TIER BREAKDOWN RECEIPT
// ═══════════════════════════════════════════════

export interface TierBreakdownData {
    club: ClubPrintData;
    date: string;
    gold: number;
    silver: number;
    bronze: number;
    totalActive: number;
    totalExpired: number;
    totalPending: number;
}

export const buildTierBreakdownReceipt = (data: TierBreakdownData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'MEMBERSHIP TIER REPORT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TIER BREAKDOWN\n',
    BOLD_OFF,
    'Gold Members: ' + String(data.gold) + '\n',
    'Silver Members: ' + String(data.silver) + '\n',
    'Bronze Members: ' + String(data.bronze) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'TOTAL ACTIVE: ' + String(data.totalActive) + '\n',
    'TOTAL EXPIRED: ' + String(data.totalExpired) + '\n',
    'TOTAL PENDING: ' + String(data.totalPending) + '\n',
    BOLD_OFF,
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 11. EXPIRING MEMBERSHIPS (Dashboard)
// ═══════════════════════════════════════════════

export interface ExpiringMembersData {
    club: ClubPrintData;
    date: string;
    withinDays: number;
    members: Array<{ name: string; tier: string; expiresOn: string; daysLeft: number }>;
}

export const buildExpiringMembersReceipt = (data: ExpiringMembersData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'EXPIRING MEMBERSHIPS\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    'Expiring within: ' + `${data.withinDays} days` + '\n',
    'Count: ' + String(data.members.length) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'No.  Name             Tier   Days\n',
    BOLD_OFF,
    ...data.members.map((m, i) => {
        const num = String(i + 1).padEnd(3);
        const name = truncate(m.name, 17).padEnd(18);
        const tier = truncate(m.tier, 6).padEnd(7);
        return `${num}. ${name} ${tier} ${m.daysLeft}d\n`;
    }),
    DIVIDER_THIN + '\n',
    'ACTION: Contact members to renew.\n',
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 12. LOW STOCK ALERT (Dashboard)
// ═══════════════════════════════════════════════

export interface LowStockData {
    club: ClubPrintData;
    date: string;
    time: string;
    items: Array<{ name: string; stock: number; threshold: number }>;
}

export const buildLowStockReceipt = (data: LowStockData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'LOW STOCK ALERT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + data.date + '\n',
    'Time: ' + data.time + '\n',
    'Items affected: ' + String(data.items.length) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'Item Name            Stock  Threshold\n',
    BOLD_OFF,
    ...data.items.map(p => {
        const name = truncate(p.name, 21).padEnd(22);
        const stock = String(p.stock).padEnd(7);
        return `${name}${stock}${p.threshold}\n`;
    }),
    DIVIDER_THIN + '\n',
    'ACTION: Restock before next session.\n',
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// ORDER RECEIPT (Shake / Product order)
// ═══════════════════════════════════════════════

export interface OrderReceiptData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    memberPhone?: string;
    // Shake credits info
    shakeCredits?: number;
    shakeCreditsPlanTotal?: number;
    statusEmoji?: string;
    // Order
    items: Array<{ name: string; qty: number; price: number }>;
    totalAmount: number;
    // Wallet
    walletBalanceBefore: number;
    walletBalanceAfter: number;
    // Top-up (optional — only if they topped up in this session)
    topupAmount?: number;
    topupOldBalance?: number;
    topupNewBalance?: number;
    // Meta
    receiptNumber: string;
    timestamp: Date;
}

export const buildOrderReceipt = (data: OrderReceiptData): string[] => {
    const lines: string[] = [
        ...buildHeader(data.club),
        LF,
        ALIGN_CENTER,
        BOLD_ON,
        SIZE_MEDIUM,
        `${data.statusEmoji || ''} ORDER RECEIPT\n`,
        SIZE_NORMAL,
        BOLD_OFF,
        ...(data.statusEmoji ? [
            BOLD_ON,
            SIZE_LARGE,
            data.statusEmoji + '\n',
            SIZE_NORMAL,
            BOLD_OFF,
        ] : []),
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt No: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'MEMBER DETAILS\n',
        BOLD_OFF,
        'Name: ' + truncate(data.memberName, 30) + '\n',
        'Member ID: ' + data.memberId + '\n',
    ];

    if (data.memberPhone) lines.push('Phone: ' + data.memberPhone + '\n');

    // Shake credits info
    lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'SHAKE CREDITS\n', BOLD_OFF);
    const credits = data.shakeCredits ?? 0;
    const totalCredits = data.shakeCreditsPlanTotal ?? 0;
    lines.push('Credits: ' + `${credits} / ${totalCredits}` + '\n');
    if (totalCredits > 0) {
        lines.push('Used: ' + `${totalCredits - credits}` + '\n');
    }

    // Items ordered
    if (data.items.length > 0) {
        lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'ITEMS ORDERED\n', BOLD_OFF);
        for (const item of data.items) {
            lines.push(`${truncate(item.name, 28)} x${item.qty} ${formatINR(item.price * item.qty)}` + '\n');
        }
        lines.push(DIVIDER_THIN + '\n');
        lines.push(BOLD_ON, SIZE_MEDIUM);
        lines.push('ORDER TOTAL: ' + formatINR(data.totalAmount) + '\n');
        lines.push(SIZE_NORMAL, BOLD_OFF);
    }

    // Wallet top-up (if any)
    if (data.topupAmount && data.topupAmount > 0) {
        lines.push(LF, DIVIDER_THIN + '\n', BOLD_ON, 'WALLET TOP-UP\n', BOLD_OFF);
        lines.push('Amount Added: ' + formatINR(data.topupAmount) + '\n');
        lines.push('Old Balance: ' + formatINR(data.topupOldBalance || 0) + '\n');
        lines.push('New Balance: ' + formatINR(data.topupNewBalance || 0) + '\n');
    }

    // Wallet balance
    lines.push(LF, DIVIDER_THIN + '\n', BOLD_ON, 'WALLET\n', BOLD_OFF);
    lines.push('Balance Before: ' + formatINR(data.walletBalanceBefore) + '\n');
    lines.push('Deducted: ' + formatINR(data.totalAmount) + '\n');
    lines.push(BOLD_ON, SIZE_MEDIUM);
    lines.push('BALANCE: ' + formatINR(data.walletBalanceAfter) + '\n');
    lines.push(SIZE_NORMAL, BOLD_OFF);

    lines.push(LF, ...buildFooter());
    return lines;
};

// ═══════════════════════════════════════════════
// SHAKE TOKEN + AFRESH TOKEN
// Two minimal slips that replace the long club-branded token.
// Each ends with a CUT so when both are printed in one job the
// printer slices between them — staff hands one to the kitchen
// (with the shake name) and one to the refreshment counter.
// ═══════════════════════════════════════════════

export interface ShakeTokenReceiptData {
    /** Kept for back-compat with existing callers; no longer printed. */
    club?: ClubPrintData;
    memberName: string;
    /** Kept for back-compat; no longer printed. */
    memberId?: string;
    /** Kept for back-compat; no longer printed. */
    memberPhone?: string;
    items: Array<{ name: string; qty: number; ice?: string }>;
    /** Kept for back-compat; no longer printed. */
    creditsRemaining?: number;
    /** Kept for back-compat; no longer printed. */
    creditsPlanTotal?: number;
    tokenNumber: string;
    timestamp: Date;
    /** Kept for back-compat; no longer used. */
    lowCreditThreshold?: number;
}

export const buildShakeTokenReceipt = (data: ShakeTokenReceiptData): string[] => {
    const lines: string[] = [
        PRINTER_RESET,
        ALIGN_CENTER,
        BOLD_ON, SIZE_LARGE,
        `#${data.tokenNumber}\n`,
        SIZE_NORMAL, BOLD_OFF,
        BOLD_ON,
        truncate(data.memberName, 24) + '\n',
        BOLD_OFF,
        fmtDate(data.timestamp) + '\n',
        DIVIDER_THIN + '\n',
    ];
    for (const item of data.items) {
        const fullName = item.qty > 1 ? `${item.name} x${item.qty}` : item.name;
        // Word-wrap full name to WIDE_WIDTH (SIZE_LARGE uses double-width chars).
        // Keeps long shake names readable without mid-word printer wrap.
        const words = fullName.split(/\s+/).filter(Boolean);
        const wrapped: string[] = [];
        let current = '';
        for (const w of words) {
            const word = w.length > WIDE_WIDTH ? w.slice(0, WIDE_WIDTH) : w;
            if (!current) {
                current = word;
            } else if (current.length + 1 + word.length <= WIDE_WIDTH) {
                current += ' ' + word;
            } else {
                wrapped.push(current);
                current = word;
            }
        }
        if (current) wrapped.push(current);
        lines.push(BOLD_ON, SIZE_LARGE);
        for (const line of wrapped) lines.push(line + '\n');
        lines.push(SIZE_NORMAL, BOLD_OFF);
        if (item.ice) lines.push(BOLD_ON, item.ice.toUpperCase() + '\n', BOLD_OFF);
    }
    lines.push(LF, CUT);
    return lines;
};

export interface AfreshTokenData {
    memberName: string;
    tokenNumber: string;
    timestamp: Date;
}

export const buildAfreshToken = (data: AfreshTokenData): string[] => [
    PRINTER_RESET,
    ALIGN_CENTER,
    BOLD_ON, SIZE_LARGE,
    `#${data.tokenNumber}\n`,
    SIZE_NORMAL, BOLD_OFF,
    BOLD_ON,
    truncate(data.memberName, 24) + '\n',
    BOLD_OFF,
    fmtDate(data.timestamp) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON, SIZE_MEDIUM,
    'AFRESH\n',
    SIZE_NORMAL, BOLD_OFF,
    LF, CUT,
];

// ═══════════════════════════════════════════════
// PRODUCT SALE RECEIPT (reception product purchases)
// Mirrors the membership receipt layout — itemised, GST-split, dual verifier.
// ═══════════════════════════════════════════════

export interface ProductSaleReceiptData {
    club: ClubPrintData;
    buyerName: string;
    buyerId?: string;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalAmount: number;
    isGift: boolean;
    paymentMethod: 'cash' | 'upi' | 'wallet' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountName?: string;
    accountantVerifiedBy?: string;
    inventoryVerifiedBy?: string;
    receiptNumber: string;
    timestamp: Date;
}

export const buildProductSaleReceipt = (data: ProductSaleReceiptData): string[] => {
    const isFree = data.isGift || data.totalAmount <= 0;
    const net = isFree ? 0 : Math.round((data.totalAmount / 1.05) * 100) / 100;
    const gstTotal = isFree ? 0 : Math.round((data.totalAmount - net) * 100) / 100;
    const sgst = Math.round((gstTotal / 2) * 100) / 100;
    const cgst = Math.round((gstTotal - sgst) * 100) / 100;

    const lines: string[] = [
        ...buildHeader(data.club),
        ALIGN_CENTER,
        BOLD_ON,
        SIZE_MEDIUM,
        isFree ? 'GIFT RECEIPT\n' : 'PRODUCT SALE RECEIPT\n',
        SIZE_NORMAL,
        BOLD_OFF,
        DIVIDER + '\n',
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt No: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, 'BUYER\n', BOLD_OFF,
        'Name: ' + truncate(data.buyerName, 30) + '\n',
        ...(data.buyerId ? ['Member ID: ' + data.buyerId + '\n'] : []),
        DIVIDER_THIN + '\n',
        BOLD_ON, 'ITEM\n', BOLD_OFF,
        `${truncate(data.productName, 24)} x${data.quantity} ${isFree ? 'FREE' : formatINR(data.totalAmount)}` + '\n',
        'Unit Price: ' + formatINR(data.unitPrice) + '\n',
        'Unit: ' + (data.unit || '-') + '\n',
    ];

    if (!isFree) {
        lines.push(
            DIVIDER_THIN + '\n',
            BOLD_ON, 'AMOUNT BREAKDOWN\n', BOLD_OFF,
            'Net Amount: ' + formatINR(net) + '\n',
            'SGST (2.5%): ' + formatINR(sgst) + '\n',
            'CGST (2.5%): ' + formatINR(cgst) + '\n',
            DIVIDER_THIN + '\n',
            BOLD_ON, SIZE_MEDIUM,
            'TOTAL PAID: ' + formatINR(data.totalAmount) + '\n',
            SIZE_NORMAL, BOLD_OFF,
        );
        if (data.paymentMethod === 'split') {
            lines.push('Payment: Split\n');
            lines.push('  Cash: ' + formatINR(data.cashAmount ?? 0) + '\n');
            lines.push('  UPI: ' + formatINR(data.upiAmount ?? 0) + '\n');
            if (data.upiAccountName) lines.push('  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n');
        } else if (data.paymentMethod === 'upi') {
            lines.push('Payment: UPI\n');
            if (data.upiAccountName) lines.push('  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n');
        } else if (data.paymentMethod === 'wallet') {
            lines.push('Payment: Wallet\n');
        } else {
            lines.push('Payment: Cash\n');
        }
    }

    if (data.accountantVerifiedBy || data.inventoryVerifiedBy) {
        lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'VERIFIED BY\n', BOLD_OFF);
        if (data.accountantVerifiedBy) lines.push('Accountant: ' + truncate(data.accountantVerifiedBy, 24) + '\n');
        if (data.inventoryVerifiedBy) lines.push('Inventory: ' + truncate(data.inventoryVerifiedBy, 24) + '\n');
    }

    if (!isFree) lines.push(ALIGN_CENTER, 'Inclusive of 5% GST (SGST 2.5% + CGST 2.5%)\n', ALIGN_LEFT);
    lines.push(LF, ...buildFooter());
    return lines;
};

// ═══════════════════════════════════════════════
// MEMBER WELCOME SLIP (printed on enrollment)
// ═══════════════════════════════════════════════

export interface MemberWelcomeData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    phone?: string;
    planName?: string;
    planValidUntil?: Date;
    shakeCredits?: number;
    timestamp: Date;
}

export const buildMemberWelcomeSlip = (data: MemberWelcomeData): string[] => [
    ...buildHeader(data.club),
    ALIGN_CENTER,
    BOLD_ON,
    SIZE_LARGE,
    'WELCOME!\n',
    SIZE_NORMAL,
    BOLD_OFF,
    DIVIDER + '\n',
    BOLD_ON,
    'NEW MEMBER ENROLLED\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp) + '\n',
    'Time: ' + fmtTime(data.timestamp) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON, 'MEMBER\n', BOLD_OFF,
    'Name: ' + truncate(data.memberName, 30) + '\n',
    'Member ID: ' + data.memberId + '\n',
    ...(data.phone ? ['Phone: ' + data.phone + '\n'] : []),
    ...(data.planName ? [
        DIVIDER_THIN + '\n',
        BOLD_ON, 'PLAN\n', BOLD_OFF,
        'Plan: ' + data.planName + '\n',
        ...(data.planValidUntil ? ['Valid Until: ' + fmtDate(data.planValidUntil) + '\n'] : []),
        ...(data.shakeCredits !== undefined ? ['Shake Credits: ' + String(data.shakeCredits) + '\n'] : []),
    ] : []),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    SIZE_MEDIUM,
    'Thank you for joining!\n',
    SIZE_NORMAL,
    BOLD_OFF,
    ALIGN_LEFT,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// ORDER REFUND SLIP (printed when an order is rejected)
// ═══════════════════════════════════════════════

export interface OrderRefundData {
    club: ClubPrintData;
    memberName: string;
    memberId?: string;
    items: Array<{ name: string; qty: number }>;
    rejectedBy: string;
    rejectReason?: string;
    refund: {
        shakeCredits: number;
        amountRefunded?: number;
    };
    refNumber: string;
    timestamp: Date;
}

export const buildOrderRefundSlip = (data: OrderRefundData): string[] => [
    ...buildHeader(data.club),
    ALIGN_CENTER,
    BOLD_ON,
    SIZE_MEDIUM,
    'ORDER REFUND / CANCELLATION\n',
    SIZE_NORMAL,
    BOLD_OFF,
    DIVIDER + '\n',
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp) + '\n',
    'Time: ' + fmtTime(data.timestamp) + '\n',
    'Ref No: ' + data.refNumber + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON, 'MEMBER\n', BOLD_OFF,
    'Name: ' + truncate(data.memberName, 30) + '\n',
    ...(data.memberId ? ['Member ID: ' + data.memberId + '\n'] : []),
    DIVIDER_THIN + '\n',
    BOLD_ON, 'CANCELLED ITEMS\n', BOLD_OFF,
    ...data.items.map(it => `${truncate(it.name, 24)} x${it.qty}\n`),
    DIVIDER_THIN + '\n',
    BOLD_ON, 'REFUND\n', BOLD_OFF,
    'Shake Credits: ' + `+${data.refund.shakeCredits}` + '\n',
    ...(data.refund.amountRefunded && data.refund.amountRefunded > 0
        ? ['Wallet Refund: ' + formatINR(data.refund.amountRefunded) + '\n']
        : []),
    DIVIDER_THIN + '\n',
    'Rejected by: ' + truncate(data.rejectedBy, 24) + '\n',
    ...(data.rejectReason ? ['Reason: ' + truncate(data.rejectReason, 24) + '\n'] : []),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// SHIFT SUMMARY (cash-drawer handover)
// ═══════════════════════════════════════════════

export interface ShiftSummaryData {
    club: ClubPrintData;
    date: string;
    cashTotal: number;
    upiTotal: number;
    upiBreakdown: Array<{ accountName: string; number?: string; total: number }>;
    totalOrders: number;
    totalShakesServed: number;
    timestamp: Date;
}

export const buildShiftSummarySlip = (data: ShiftSummaryData): string[] => {
    const grand = data.cashTotal + data.upiTotal;
    return [
        ...buildHeader(data.club),
        ALIGN_CENTER,
        BOLD_ON,
        SIZE_MEDIUM,
        'SHIFT SUMMARY\n',
        SIZE_NORMAL,
        BOLD_OFF,
        DIVIDER + '\n',
        ALIGN_LEFT,
        'Date: ' + data.date + '\n',
        'Printed: ' + fmtTime(data.timestamp) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, 'CASH DRAWER\n', BOLD_OFF,
        'Cash Collected: ' + formatINR(data.cashTotal) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, 'UPI COLLECTED\n', BOLD_OFF,
        'Total UPI: ' + formatINR(data.upiTotal) + '\n',
        ...data.upiBreakdown.flatMap(u => [
            `  ${truncate(u.accountName, 20)} ${formatINR(u.total)}` + '\n',
            ...(u.number ? [`  ${u.number}\n`] : []),
        ]),
        DIVIDER_THIN + '\n',
        BOLD_ON, SIZE_MEDIUM,
        'GRAND TOTAL: ' + formatINR(grand) + '\n',
        SIZE_NORMAL, BOLD_OFF,
        DIVIDER_THIN + '\n',
        BOLD_ON, 'ACTIVITY\n', BOLD_OFF,
        'Orders Today: ' + String(data.totalOrders) + '\n',
        'Shakes Served: ' + String(data.totalShakesServed) + '\n',
        LF,
        ALIGN_CENTER,
        'Match cash drawer count to "CASH COLLECTED"\n',
        ALIGN_LEFT,
        ...buildFooter(),
    ];
};

// ═══════════════════════════════════════════════
// TOPUP REQUEST SLIP (printed when a member raises a top-up request)
// Acknowledgment only — the actual approval prints a TopUp receipt later.
// ═══════════════════════════════════════════════

export interface TopupRequestSlipData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    requestedAmount: number;
    paymentMethod: 'cash' | 'upi' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountName?: string;
    requestId: string;
    timestamp: Date;
}

export const buildTopupRequestSlip = (data: TopupRequestSlipData): string[] => [
    ...buildHeader(data.club),
    ALIGN_CENTER,
    BOLD_ON,
    SIZE_MEDIUM,
    'TOP-UP REQUEST\n',
    SIZE_NORMAL,
    BOLD_OFF,
    DIVIDER + '\n',
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp) + '\n',
    'Time: ' + fmtTime(data.timestamp) + '\n',
    'Request #: ' + data.requestId.slice(-8).toUpperCase() + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON, 'MEMBER\n', BOLD_OFF,
    'Name: ' + truncate(data.memberName, 30) + '\n',
    'Member ID: ' + data.memberId + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON, SIZE_MEDIUM,
    'AMOUNT: ' + formatINR(data.requestedAmount) + '\n',
    SIZE_NORMAL, BOLD_OFF,
    ...(data.paymentMethod === 'split' ? [
        'Payment: Split\n',
        '  Cash: ' + formatINR(data.cashAmount ?? 0) + '\n',
        '  UPI: ' + formatINR(data.upiAmount ?? 0) + '\n',
        ...(data.upiAccountName ? ['  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n'] : []),
    ] : data.paymentMethod === 'upi' ? [
        'Payment: UPI\n',
        ...(data.upiAccountName ? ['  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n'] : []),
    ] : [
        'Payment: Cash\n',
    ]),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'STATUS: PENDING APPROVAL\n',
    BOLD_OFF,
    'Wallet will credit once owner approves.\n',
    ALIGN_LEFT,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// GUEST TOKEN SLIP (kitchen-bound)
// Lists every token number issued in a single guest checkout,
// the shake breakdown, and the items being prepared.
// ═══════════════════════════════════════════════

export interface GuestTokenSlipData {
    club: ClubPrintData;
    guestName: string;
    guestPhone: string;
    tokenNumbers: string[];                              // e.g. ["012", "013", "014"]
    shakes: Array<{ name: string; qty: number; ice?: string }>;
    timestamp: Date;
}

export const buildGuestTokenSlip = (data: GuestTokenSlipData): string[] => {
    const tokenRange = data.tokenNumbers.length > 1
        ? `${data.tokenNumbers[0]} – ${data.tokenNumbers[data.tokenNumbers.length - 1]}`
        : (data.tokenNumbers[0] || '—');

    const lines: string[] = [
        ...buildHeader(data.club),
        ALIGN_CENTER,
        BOLD_ON,
        SIZE_LARGE,
        `TOKEN ${tokenRange}\n`,
        SIZE_NORMAL,
        BOLD_OFF,
        DIVIDER + '\n',
        BOLD_ON,
        'GUEST TOKEN\n',
        BOLD_OFF,
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'GUEST\n',
        BOLD_OFF,
        'Name: ' + truncate(data.guestName, 30) + '\n',
        ...(data.guestPhone ? ['Phone: ' + data.guestPhone + '\n'] : []),
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'TOKEN NUMBERS\n',
        BOLD_OFF,
    ];
    for (const t of data.tokenNumbers) {
        lines.push(`  #${t}\n`);
    }

    lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'SHAKES\n', BOLD_OFF);
    for (const s of data.shakes) {
        lines.push(BOLD_ON, SIZE_MEDIUM);
        lines.push(`${truncate(s.name, 24)} x${s.qty}\n`);
        lines.push(SIZE_NORMAL, BOLD_OFF);
        if (s.ice) lines.push(`  ${s.ice.toUpperCase()}\n`);
    }

    lines.push(LF, ...buildFooter());
    return lines;
};

// ═══════════════════════════════════════════════
// GUEST PAYMENT RECEIPT (customer-bound)
// Itemised bill with GST breakdown (SGST 2.5% + CGST 2.5% inclusive of 5%).
// Printed back-to-back with the token slip in a single RawBT job.
// ═══════════════════════════════════════════════

export interface GuestPaymentReceiptData {
    club: ClubPrintData;
    guestName: string;
    guestPhone: string;
    items: Array<{ name: string; qty: number; unitPrice: number; total: number }>;
    totalAmount: number;
    amountPaid: number;
    paymentMethod: 'cash' | 'upi' | 'split' | 'complimentary';
    /** When `paymentMethod === 'split'`, both amounts must be set. */
    cashAmount?: number;
    upiAmount?: number;
    upiAccountName?: string;    // e.g. "GPay (Anand)"
    upiNumber?: string;
    receiptNumber: string;
    tokenNumbers?: string[];    // cross-reference to the token slip
    timestamp: Date;
}

export const buildGuestPaymentReceipt = (data: GuestPaymentReceiptData): string[] => {
    const isComplimentary = data.paymentMethod === 'complimentary' || data.totalAmount <= 0;
    // 5% GST inclusive: net = total / 1.05, SGST = CGST = (total - net) / 2
    const net = isComplimentary ? 0 : Math.round((data.totalAmount / 1.05) * 100) / 100;
    const totalGst = isComplimentary ? 0 : Math.round((data.totalAmount - net) * 100) / 100;
    const sgst = Math.round((totalGst / 2) * 100) / 100;
    const cgst = Math.round((totalGst - sgst) * 100) / 100;

    const lines: string[] = [
        ...buildHeader(data.club),
        ALIGN_CENTER,
        BOLD_ON,
        SIZE_MEDIUM,
        isComplimentary ? 'COMPLIMENTARY RECEIPT\n' : 'PAYMENT RECEIPT\n',
        SIZE_NORMAL,
        BOLD_OFF,
        DIVIDER + '\n',
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt No: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'GUEST\n',
        BOLD_OFF,
        'Name: ' + truncate(data.guestName, 30) + '\n',
        ...(data.guestPhone ? ['Phone: ' + data.guestPhone + '\n'] : []),
    ];

    if (data.tokenNumbers && data.tokenNumbers.length > 0) {
        const tokenRange = data.tokenNumbers.length > 1
            ? `${data.tokenNumbers[0]} – ${data.tokenNumbers[data.tokenNumbers.length - 1]}`
            : data.tokenNumbers[0];
        lines.push('Tokens: ' + tokenRange + '\n');
    }

    lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'ITEMS\n', BOLD_OFF);
    for (const it of data.items) {
        const label = `${truncate(it.name, 26)} x${it.qty}`;
        lines.push(label + ' ' + (isComplimentary ? 'FREE' : formatINR(it.total)) + '\n');
    }

    lines.push(DIVIDER_THIN + '\n');

    if (!isComplimentary) {
        lines.push(BOLD_ON, 'AMOUNT BREAKDOWN\n', BOLD_OFF);
        lines.push('Net Amount: ' + formatINR(net) + '\n');
        lines.push('SGST (2.5%): ' + formatINR(sgst) + '\n');
        lines.push('CGST (2.5%): ' + formatINR(cgst) + '\n');
        lines.push(DIVIDER_THIN + '\n');
    }

    lines.push(BOLD_ON, SIZE_MEDIUM);
    lines.push(
        (isComplimentary ? 'TOTAL: ' : 'TOTAL PAID: ') +
        (isComplimentary ? 'FREE' : formatINR(data.amountPaid)) + '\n'
    );
    lines.push(SIZE_NORMAL, BOLD_OFF);

    if (!isComplimentary) {
        if (data.paymentMethod === 'split') {
            lines.push('Payment: Split\n');
            lines.push('  Cash: ' + formatINR(data.cashAmount ?? 0) + '\n');
            lines.push('  UPI: ' + formatINR(data.upiAmount ?? 0) + '\n');
            if (data.upiAccountName) lines.push('  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n');
        } else if (data.paymentMethod === 'upi') {
            lines.push('Payment: UPI\n');
            if (data.upiAccountName) lines.push('  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n');
        } else {
            lines.push('Payment: Cash\n');
        }
        lines.push(ALIGN_CENTER, 'Inclusive of 5% GST (SGST 2.5% + CGST 2.5%)\n', ALIGN_LEFT);
    }

    lines.push(LF, ...buildFooter());
    return lines;
};

// ═══════════════════════════════════════════════
// 13. BILL RECEIPT (BillingPage / BillingReportsPage)
// ═══════════════════════════════════════════════

export interface BillReceiptData {
    club: ClubPrintData;
    memberName: string;
    billId: string;
    items: Array<{ name: string; quantity: number; total: number }>;
    subtotal: number;
    total: number;
    paidFrom: 'wallet' | 'cash';
    currencyName?: string;
    timestamp: Date;
}

export const buildBillReceipt = (data: BillReceiptData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'BILL RECEIPT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp) + '\n',
    'Time: ' + fmtTime(data.timestamp) + '\n',
    'Bill #: ' + data.billId.slice(-6).toUpperCase() + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'MEMBER\n',
    BOLD_OFF,
    'Name: ' + truncate(data.memberName, 34) + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'ITEMS\n',
    BOLD_OFF,
    ...data.items.map(item =>
        `${truncate(item.name, 26)} x${item.quantity} ${formatINR(item.total)}` + '\n'
    ),
    DIVIDER_THIN + '\n',
    BOLD_ON,
    SIZE_MEDIUM,
    'TOTAL: ' + formatINR(data.total) + '\n',
    SIZE_NORMAL,
    BOLD_OFF,
    LF,
    'Payment: ' + (data.paidFrom === 'wallet' ? (data.currencyName || 'Wallet') : 'Cash'),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// 14. SESSION SUMMARY RECEIPT (Reception end-of-session)
// ═══════════════════════════════════════════════

export interface SessionSummaryData {
    club: ClubPrintData;
    memberName: string;
    memberId?: string;
    shakeCredits?: number;
    shakeCreditsPlanTotal?: number;
    sessionItems: Array<{ label: string; qty: number; amount: number; type: 'order' | 'topup' }>;
    finalBalance: number;
    timestamp: Date;
    receiptNumber: string;
}

export const buildSessionSummaryReceipt = (data: SessionSummaryData): string[] => {
    const orderItems = data.sessionItems.filter(i => i.type === 'order');
    const topupItems = data.sessionItems.filter(i => i.type === 'topup');
    const totalSpent = orderItems.reduce((s, i) => s + i.amount, 0);
    const totalTopup = topupItems.reduce((s, i) => s + i.amount, 0);

    const lines: string[] = [
        ...buildHeader(data.club),
        LF,
        ALIGN_CENTER,
        BOLD_ON,
        'VISIT RECEIPT\n',
        BOLD_OFF,
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON,
        'MEMBER\n',
        BOLD_OFF,
        'Name: ' + truncate(data.memberName, 30) + '\n',
        ...(data.memberId ? ['ID: ' + data.memberId + '\n'] : []),
        'Shake Credits: ' + `${data.shakeCredits ?? 0} / ${data.shakeCreditsPlanTotal ?? 0}` + '\n',
    ];

    if (orderItems.length > 0) {
        lines.push(DIVIDER_THIN + '\n', BOLD_ON, "TODAY'S ORDERS\n", BOLD_OFF);
        for (const item of orderItems) {
            lines.push(`${truncate(item.label, 30)} x${item.qty} ${formatINR(item.amount)}` + '\n');
        }
        lines.push(DIVIDER_THIN + '\n', BOLD_ON, 'Total Spent: ' + formatINR(totalSpent) + '\n', BOLD_OFF);
    }

    if (topupItems.length > 0) {
        lines.push(LF, DIVIDER_THIN + '\n', BOLD_ON, 'WALLET TOP-UP\n', BOLD_OFF);
        for (const item of topupItems) {
            lines.push('Amount Added: ' + formatINR(item.amount) + '\n');
        }
    }

    lines.push(
        LF, DIVIDER_THIN + '\n',
        BOLD_ON, SIZE_MEDIUM,
        'WALLET BALANCE: ' + formatINR(data.finalBalance) + '\n',
        SIZE_NORMAL, BOLD_OFF,
        LF,
        ...buildFooter(),
    );
    return lines;
};

// ═══════════════════════════════════════════════
// #15 — WALLET TOP-UP RECEIPT
// ═══════════════════════════════════════════════
export interface TopupReceiptData {
    club: ClubPrintData;
    memberName: string;
    memberId?: string;
    amountAdded: number;
    balanceBefore: number;
    balanceAfter: number;
    verifiedBy: string;      // accountant name who face-verified
    receiptId?: string;
    timestamp: Date;
    /** Defaults to 'cash' for back-compat with existing call sites. */
    paymentMethod?: 'cash' | 'upi' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountName?: string;
}

export const buildTopupReceipt = (data: TopupReceiptData): string[] => {
    const ts = data.timestamp;
    const dateStr = ts.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const method = data.paymentMethod ?? 'cash';

    const receivedLines: string[] = method === 'split' ? [
        'Received (Split): ' + formatINR(data.amountAdded) + '\n',
        '  Cash: ' + formatINR(data.cashAmount ?? 0) + '\n',
        '  UPI: ' + formatINR(data.upiAmount ?? 0) + '\n',
        ...(data.upiAccountName ? ['  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n'] : []),
    ] : method === 'upi' ? [
        'Received (UPI): ' + formatINR(data.amountAdded) + '\n',
        ...(data.upiAccountName ? ['  UPI Acct: ' + truncate(data.upiAccountName, 28) + '\n'] : []),
    ] : [
        'Received (Cash): ' + formatINR(data.amountAdded) + '\n',
    ];

    return [
        ...buildHeader(data.club),

        ALIGN_CENTER,
        BOLD_ON, SIZE_MEDIUM,
        'WALLET TOP-UP\n',
        SIZE_NORMAL, BOLD_OFF,
        DIVIDER + '\n',
        ALIGN_LEFT,

        'Member: ' + truncate(data.memberName, 30) + '\n',
        ...(data.memberId ? ['Member ID: ' + data.memberId + '\n'] : []),
        'Date: ' + dateStr + '\n',
        'Time: ' + timeStr + '\n',
        ...(data.receiptId ? ['Receipt #: ' + data.receiptId.slice(-8).toUpperCase() + '\n'] : []),
        DIVIDER_THIN + '\n',

        BOLD_ON,
        'Amount Added: ' + formatINR(data.amountAdded) + '\n',
        BOLD_OFF,
        'Balance Before: ' + formatINR(data.balanceBefore) + '\n',
        'Balance After: ' + formatINR(data.balanceAfter) + '\n',
        DIVIDER_THIN + '\n',

        ...receivedLines,
        DIVIDER_THIN + '\n',

        BOLD_ON,
        'Verified by: ' + truncate(data.verifiedBy, 28) + '\n',
        BOLD_OFF,
        LF,

        ALIGN_CENTER,
        SIZE_MEDIUM,
        BOLD_ON,
        'Thank you!\n',
        BOLD_OFF,
        SIZE_NORMAL,
        ALIGN_LEFT,

        ...buildFooter(),
    ];
};

// ═══════════════════════════════════════════════
// PURCHASE REQUEST RECEIPT (combined fulfillment)
// ═══════════════════════════════════════════════

export interface PurchaseRequestReceiptItem {
    label: string;       // "5 Shake Credits Plan", "Wallet Top-up", "Whey Protein x2"
    detail?: string;     // "5 credits · 30 days", "₹230/shake"
    amount: number;
}

export interface PurchaseRequestReceiptData {
    club: ClubPrintData;
    memberName: string;
    memberId: string;
    items: PurchaseRequestReceiptItem[];
    totalAmount: number;
    paymentMethod: string;
    receiptNumber: string;
    timestamp: Date;
    accountantName?: string;
    creditsAdded?: number;
    membershipValidTill?: Date;
    walletBalanceAfter?: number;
}

export const buildPurchaseRequestReceipt = (data: PurchaseRequestReceiptData): string[] => [
    ...buildHeader(data.club),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    'PURCHASE RECEIPT\n',
    BOLD_OFF,
    ALIGN_LEFT,
    'Date: ' + fmtDate(data.timestamp) + '\n',
    'Time: ' + fmtTime(data.timestamp) + '\n',
    'Receipt No: ' + data.receiptNumber + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'MEMBER\n',
    BOLD_OFF,
    'Name: ' + truncate(data.memberName, 30) + '\n',
    'Member ID: ' + data.memberId + '\n',
    DIVIDER_THIN + '\n',
    BOLD_ON,
    'ITEMS\n',
    BOLD_OFF,
    ...data.items.flatMap((item) => [
        truncate(item.label, 28) + ' ' + formatINR(item.amount) + '\n',
        ...(item.detail ? ['  ' + truncate(item.detail, 44) + '\n'] : []),
    ]),
    DIVIDER_THIN + '\n',
    BOLD_ON,
    SIZE_MEDIUM,
    'TOTAL: ' + formatINR(data.totalAmount) + '\n',
    SIZE_NORMAL,
    BOLD_OFF,
    'Payment: ' + data.paymentMethod.toUpperCase() + '\n',
    ...(data.creditsAdded && data.creditsAdded > 0
        ? ['Credits Added: ' + `+${data.creditsAdded}` + '\n']
        : []),
    ...(data.membershipValidTill
        ? ['Valid Till: ' + fmtDate(data.membershipValidTill) + '\n']
        : []),
    ...(data.walletBalanceAfter != null
        ? ['Wallet Balance: ' + formatINR(data.walletBalanceAfter) + '\n']
        : []),
    ...(data.accountantName
        ? [DIVIDER_THIN + '\n', 'Verified by: ' + truncate(data.accountantName, 30) + '\n']
        : []),
    LF,
    ...buildFooter(),
];

// ═══════════════════════════════════════════════
// STOCK-OUT RECEIPT
// Used by inventory Give-to-Member, Give-to-Recipient, Virtual Collection.
// ═══════════════════════════════════════════════

export interface StockOutLine {
    name: string;
    qty: number;
    unit?: string;
}

export interface StockOutReceiptData {
    club: ClubPrintData;
    title: string;                     // e.g. "STOCK ISSUE - MEMBER"
    recipientLabel: string;            // e.g. "Member" / "Recipient" / "Virtual Member"
    recipientName: string;
    recipientId?: string;
    recipientPhone?: string;
    items: StockOutLine[];
    notes?: string;
    // Virtual-member-specific extras (optional)
    renewalDate?: Date;
    expiryDate?: Date;
    collectionDate?: Date;
    timestamp: Date;
    receiptNumber: string;
}

export const buildStockOutReceipt = (data: StockOutReceiptData): string[] => {
    const totalQty = data.items.reduce((s, it) => s + (it.qty || 0), 0);
    return [
        ...buildHeader(data.club),
        LF,
        ALIGN_CENTER,
        BOLD_ON,
        data.title + '\n',
        BOLD_OFF,
        ALIGN_LEFT,
        'Date: ' + fmtDate(data.timestamp) + '\n',
        'Time: ' + fmtTime(data.timestamp) + '\n',
        'Receipt: ' + data.receiptNumber + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, data.recipientLabel.toUpperCase() + '\n', BOLD_OFF,
        'Name : ' + truncate(data.recipientName, 30) + '\n',
        ...(data.recipientId ? ['ID   : ' + data.recipientId + '\n'] : []),
        ...(data.recipientPhone ? ['Phone: ' + data.recipientPhone + '\n'] : []),
        ...(data.renewalDate ? ['Renewed : ' + fmtDate(data.renewalDate) + '\n'] : []),
        ...(data.expiryDate ? ['Expires : ' + fmtDate(data.expiryDate) + '\n'] : []),
        ...(data.collectionDate ? ['Collected: ' + fmtDate(data.collectionDate) + '\n'] : []),
        DIVIDER_THIN + '\n',
        BOLD_ON, 'ITEMS ISSUED\n', BOLD_OFF,
        ...data.items.map(it => `${truncate(it.name, 32)} x${it.qty}${it.unit ? ' ' + it.unit : ''}\n`),
        DIVIDER_THIN + '\n',
        BOLD_ON, SIZE_MEDIUM,
        `TOTAL ITEMS: ${data.items.length} · QTY: ${totalQty}\n`,
        SIZE_NORMAL, BOLD_OFF,
        ...(data.notes ? [DIVIDER_THIN + '\n', 'Notes: ' + truncate(data.notes, 38) + '\n'] : []),
        LF,
        ALIGN_CENTER,
        'Receiver Signature: ____________\n',
        ALIGN_LEFT,
        LF,
        ...buildFooter(),
    ];
};

// ═══════════════════════════════════════════════
// INVENTORY GIVE-AWAY (to person or event)
// Auto-printed after a "Give to Person" or "Give for Event" save in the
// owner Inventory page.
// ═══════════════════════════════════════════════

export interface InventoryGiveReceiptData {
    club: ClubPrintData;
    kind: 'person' | 'event';
    recipientName: string;
    recipientPhone?: string;
    memberId?: string;                       // present when person == registered member
    items: Array<{ name: string; flavor?: string; size?: string; quantity: number }>;
    totalBoxes: number;
    returnDeadline?: string;                 // YYYY-MM-DD, person only
    notes?: string;
    timestamp: Date;
}

export const buildInventoryGiveReceipt = (data: InventoryGiveReceiptData): string[] => [
    ...buildHeader(data.club),
    ALIGN_CENTER,
    BOLD_ON, SIZE_MEDIUM,
    data.kind === 'event' ? 'INVENTORY → EVENT\n' : 'INVENTORY → PERSON\n',
    SIZE_NORMAL, BOLD_OFF,
    ALIGN_LEFT,
    `Date  : ${fmtDate(data.timestamp)}\n`,
    `Time  : ${fmtTime(data.timestamp)}\n`,
    DIVIDER_THIN + '\n',
    BOLD_ON,
    (data.kind === 'event' ? 'EVENT / GROUP\n' : 'PERSON\n'),
    BOLD_OFF,
    `Name : ${truncate(data.recipientName, 30)}\n`,
    ...(data.memberId ? [`ID   : ${data.memberId}\n`] : []),
    ...(data.recipientPhone ? [`Phone: ${data.recipientPhone}\n`] : []),
    ...(data.returnDeadline
        ? [`Return by: ${new Date(data.returnDeadline + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n`]
        : []),
    DIVIDER_THIN + '\n',
    BOLD_ON, 'ITEMS ISSUED\n', BOLD_OFF,
    ...data.items.map(it => {
        const label = `${it.quantity}x ${it.name}${it.flavor ? ` (${it.flavor})` : ''}`;
        return `${truncate(label, 38)}${it.size ? '  ' + it.size : ''}\n`;
    }),
    DIVIDER_THIN + '\n',
    BOLD_ON, SIZE_MEDIUM,
    `TOTAL BOXES: ${data.totalBoxes}\n`,
    SIZE_NORMAL, BOLD_OFF,
    ...(data.notes ? [DIVIDER_THIN + '\n', `Note: ${truncate(data.notes, 38)}\n`] : []),
    LF,
    ALIGN_CENTER,
    'Receiver Signature: ____________\n',
    ALIGN_LEFT,
    LF,
    ...buildFooter(),
];
