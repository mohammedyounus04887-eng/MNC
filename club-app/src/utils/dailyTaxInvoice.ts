// ──────────────────────────────────────────────────────────────────────
// Daily Tax Invoice
//
// Aggregates a single day's revenue into a two-line tax invoice
// (Shakes / Products) and produces both:
//   - a thermal slip (ESC/POS) printed right after Today's Report
//   - an A4 HTML invoice openable from the admin Reports page
//
// Bill numbers are sequential per day (`INV-YYYYMMDD-NNN`) and persisted
// in a counter doc so reprints reuse the same number. A snapshot of every
// generated invoice is stored at clubs/{clubId}/dailyInvoices/{date}.
//
// Invoice header is "Usha Prasad Enterprises" (the legal billing entity)
// with address + GSTIN pulled from the club doc — different from the
// rest of the app's slips, which carry the customer-facing club name.
// ──────────────────────────────────────────────────────────────────────

import {
    collection, doc, getDoc, getDocs, query, where, runTransaction,
    setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
    PRINTER_RESET, ALIGN_CENTER, ALIGN_LEFT,
    BOLD_ON, BOLD_OFF, SIZE_MEDIUM, SIZE_NORMAL,
    LF, DIVIDER, DIVIDER_THIN, CUT,
} from './escpos';
import { formatINR } from './printReceipt';

const LEGAL_ENTITY_NAME = 'Usha Prasad Enterprises';

export interface DailyInvoiceTotals {
    date: string;             // YYYY-MM-DD
    shakeQty: number;
    shakeRevenue: number;     // gross (5% GST inclusive)
    productQty: number;
    productRevenue: number;
    planQty: number;
    planRevenue: number;
    virtualQty: number;
    virtualRevenue: number;
    topupQty: number;
    topupRevenue: number;
    subtotal: number;         // total / 1.05
    sgst: number;             // 2.5%
    cgst: number;             // 2.5%
    total: number;            // sum of all category revenues
}

export interface DailyInvoiceClub {
    name: string;             // original club name (kept for footer / records)
    address: string;
    phone: string;
    email: string;
    gstNumber: string;
}

export interface SavedDailyInvoice extends DailyInvoiceTotals {
    billNumber: string;
}

// ── Aggregation: sum the day's payments + paid guest entries + topups ─
export async function computeDailyTotals(
    clubId: string, dateStr: string,
): Promise<DailyInvoiceTotals> {
    let shakeQty = 0, shakeRevenue = 0;
    let productQty = 0, productRevenue = 0;
    let planQty = 0, planRevenue = 0;
    let virtualQty = 0, virtualRevenue = 0;
    let topupQty = 0, topupRevenue = 0;

    const paymentsSnap = await getDocs(query(
        collection(db, `clubs/${clubId}/payments`),
        where('date', '==', dateStr),
    ));
    for (const d of paymentsSnap.docs) {
        const p = d.data() as any;
        // Skip removed payments. This total prints on the SAME job as the
        // report block above it, which does filter them — so a payment the desk
        // deleted was gone from one total and still in the other, and the slip
        // carried two different figures for the same day, inches apart.
        if (p.deleted) continue;
        const amt = Number(p.amount) || 0;
        if (p.type === 'oneday_shake') {
            shakeQty += 1;
            shakeRevenue += amt;
        } else if (p.type === 'product_sale' && !p.isGift) {
            productQty += Number(p.quantity) || 1;
            productRevenue += amt;
        } else if (p.type === 'plan_purchase') {
            planQty += 1;
            planRevenue += amt;
        } else if (p.type === 'virtual_member') {
            virtualQty += 1;
            virtualRevenue += amt;
        } else if (p.type === 'wallet_topup' || p.type === 'topup') {
            // Desk-side top-ups were counted by NEITHER this branch nor the
            // topupRequests loop below, so they vanished from this total while
            // the report block above counted them.
            topupQty += 1;
            topupRevenue += amt;
        }
    }

    // Guest wizard — paid orders aren't expanded into per-item payment rows
    // in the payments collection, so pull them from the guestEntries doc
    // where the line items (shake vs product) are still on each item.
    const guestSnap = await getDocs(query(
        collection(db, `clubs/${clubId}/guestEntries`),
        where('date', '==', dateStr),
        where('type', '==', 'paid'),
    ));
    for (const d of guestSnap.docs) {
        const e = d.data() as any;
        // Deleting a guest used to remove the document outright, so every reader
        // was correct for free. It is a soft delete now, and this reader was
        // missed — a guest deleted by mistake kept inflating the revenue and the
        // 5% GST on a TAX document, while the Reports page showed it reversed.
        if (e.deleted) continue;
        const items: Array<{ type?: string; qty?: number; total?: number }> = e.items ?? [];
        for (const it of items) {
            const q = Number(it.qty) || 0;
            const t = Number(it.total) || 0;
            if (it.type === 'shake') {
                shakeQty += q;
                shakeRevenue += t;
            } else if (it.type === 'inventory_product') {
                productQty += q;
                productRevenue += t;
            }
        }
    }

    // Wallet top-ups — `topupRequests` is keyed by approval (resolvedAt),
    // not a `date` field, so filter by resolvedAt falling inside the day.
    const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
    const dayEnd = dayStart + 86_400_000;
    const topupSnap = await getDocs(query(
        collection(db, `clubs/${clubId}/topupRequests`),
        where('status', '==', 'approved'),
    ));
    for (const d of topupSnap.docs) {
        const t = d.data() as any;
        const ts = t.resolvedAt;
        if (!ts) continue;
        const ms = ts.toMillis ? ts.toMillis() : Number(ts) * 1000;
        if (ms < dayStart || ms >= dayEnd) continue;
        topupQty += 1;
        topupRevenue += Number(t.amount ?? t.approvedAmount) || 0;
    }

    const total = round2(
        shakeRevenue + productRevenue + planRevenue + virtualRevenue + topupRevenue,
    );
    const subtotal = total > 0 ? round2(total / 1.05) : 0;
    const totalGst = round2(total - subtotal);
    const sgst = round2(totalGst / 2);
    const cgst = round2(totalGst - sgst);

    return {
        date: dateStr,
        shakeQty, shakeRevenue: round2(shakeRevenue),
        productQty, productRevenue: round2(productRevenue),
        planQty, planRevenue: round2(planRevenue),
        virtualQty, virtualRevenue: round2(virtualRevenue),
        topupQty, topupRevenue: round2(topupRevenue),
        subtotal, sgst, cgst, total,
    };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Bill number allocator ─────────────────────────────────────────────
// First call for a given date allocates a fresh sequential number from
// the per-day counter; subsequent calls reuse the number stored on the
// snapshot, so reprints don't burn through bill numbers.
export async function getOrAllocateBillNumber(
    clubId: string, dateStr: string,
): Promise<string> {
    const snapRef = doc(db, `clubs/${clubId}/dailyInvoices/${dateStr}`);
    const existing = await getDoc(snapRef);
    if (existing.exists()) {
        const bn = (existing.data() as any).billNumber as string | undefined;
        if (bn) return bn;
    }

    const counterRef = doc(db, `clubs/${clubId}/dailyInvoiceCounters/${dateStr}`);
    const seq = await runTransaction(db, async (tx) => {
        const cs = await tx.get(counterRef);
        const next = cs.exists() ? Number((cs.data() as any).next ?? 1) : 1;
        tx.set(counterRef, { next: next + 1, date: dateStr }, { merge: true });
        return next;
    });
    return `INV-${dateStr.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

export async function saveDailyInvoiceSnapshot(
    clubId: string,
    snapshot: SavedDailyInvoice,
): Promise<void> {
    await setDoc(
        doc(db, `clubs/${clubId}/dailyInvoices/${snapshot.date}`),
        { ...snapshot, generatedAt: serverTimestamp() },
        { merge: true },
    );
}

// ── Fetch club header data (no override yet) ──────────────────────────
async function fetchClubData(clubId: string): Promise<DailyInvoiceClub> {
    const clubSnap = await getDoc(doc(db, 'clubs', clubId));
    const raw = clubSnap.exists() ? (clubSnap.data() as any) : {};
    return {
        name: (raw.clubName || raw.name || 'Nutrition Club') as string,
        address: (raw.address ?? '') as string,
        phone: (raw.phone ?? raw.ownerPhone ?? '') as string,
        email: (raw.email ?? raw.ownerEmail ?? '') as string,
        gstNumber: (raw.gstNumber ?? '') as string,
    };
}

// All five revenue categories shown on the invoice. We skip rows that
// have no activity for the day so single-stream days don't print a
// wall of "x0  Rs. 0.00" lines.
const lineCategories = (totals: DailyInvoiceTotals): Array<{ label: string; qty: number; revenue: number }> => [
    { label: 'Shakes',              qty: totals.shakeQty,   revenue: totals.shakeRevenue },
    { label: 'Products',            qty: totals.productQty, revenue: totals.productRevenue },
    { label: 'Membership Plans',    qty: totals.planQty,    revenue: totals.planRevenue },
    { label: 'Virtual Memberships', qty: totals.virtualQty, revenue: totals.virtualRevenue },
    { label: 'Wallet Top-ups',      qty: totals.topupQty,   revenue: totals.topupRevenue },
].filter(c => c.qty > 0 || c.revenue > 0);

// ── Thermal builder (ESC/POS) ─────────────────────────────────────────
export function buildDailyInvoiceThermal(
    club: DailyInvoiceClub,
    totals: DailyInvoiceTotals,
    billNumber: string,
): string[] {
    const [yyyy, mm, dd] = totals.date.split('-');
    const prettyDate = `${dd}/${mm}/${yyyy}`;
    const cats = lineCategories(totals);
    const catLines = cats.length > 0
        ? cats.map(c => `${c.label} x${c.qty} ${formatINR(c.revenue)}` + '\n')
        : [`No sales recorded ${formatINR(0)}` + '\n'];

    return [
        PRINTER_RESET,
        ALIGN_CENTER, BOLD_ON,
        LEGAL_ENTITY_NAME + '\n',
        BOLD_OFF,
        ...(club.address ? [club.address + '\n'] : []),
        ...(club.phone ? [`Ph: ${club.phone}\n`] : []),
        ...(club.gstNumber ? [`GSTIN: ${club.gstNumber}\n`] : []),
        DIVIDER + '\n',
        BOLD_ON, SIZE_MEDIUM, 'TAX INVOICE\n', SIZE_NORMAL, BOLD_OFF,
        ALIGN_LEFT,
        'Bill No: ' + billNumber + '\n',
        'Date: ' + prettyDate + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, 'PARTICULARS\n', BOLD_OFF,
        ...catLines,
        DIVIDER_THIN + '\n',
        'Net Amount: ' + formatINR(totals.subtotal) + '\n',
        'SGST (2.5%): ' + formatINR(totals.sgst) + '\n',
        'CGST (2.5%): ' + formatINR(totals.cgst) + '\n',
        DIVIDER_THIN + '\n',
        BOLD_ON, SIZE_MEDIUM,
        'TOTAL: ' + formatINR(totals.total) + '\n',
        SIZE_NORMAL, BOLD_OFF,
        LF,
        ALIGN_CENTER,
        'Inclusive of 5% GST (SGST 2.5% + CGST 2.5%)\n',
        DIVIDER + '\n',
        'This is a computer-generated tax invoice.\n',
        LF,
        CUT,
    ];
}

// ── A4 HTML builder (browser print / save-as-PDF) ─────────────────────
const escapeHtml = (s: string): string =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const fmtINRHtml = (n: number): string =>
    `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildDailyInvoiceHtml(
    club: DailyInvoiceClub,
    totals: DailyInvoiceTotals,
    billNumber: string,
): string {
    const [yyyy, mm, dd] = totals.date.split('-');
    const prettyDate = `${dd}/${mm}/${yyyy}`;
    const addr = escapeHtml(club.address);
    const phone = escapeHtml(club.phone);
    const email = escapeHtml(club.email);
    const gstin = escapeHtml(club.gstNumber);
    const clubSub = escapeHtml(club.name);

    const cats = lineCategories(totals);
    const itemsHtml = (cats.length > 0
        ? cats
        : [{ label: 'No sales recorded', qty: 0, revenue: 0 }])
        .map((c, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(c.label)}</td>
          <td class="ctr">${c.qty}</td>
          <td class="rt">${fmtINRHtml(c.revenue)}</td>
        </tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tax Invoice ${escapeHtml(billNumber)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; background: #f4f4f5; padding: 24px; }
  .page { max-width: 780px; margin: 0 auto; background: #fff; padding: 40px 48px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1b4332; padding-bottom: 18px; margin-bottom: 24px; }
  .brand-name { font-size: 22px; font-weight: 900; color: #1b4332; letter-spacing: 0.2px; }
  .brand-sub { font-size: 11px; color: #6b7280; margin-top: 4px; line-height: 1.5; max-width: 320px; }
  .inv-meta { text-align: right; font-size: 12px; }
  .inv-meta h1 { font-size: 26px; font-weight: 900; color: #1b4332; letter-spacing: 2px; margin-bottom: 6px; }
  .inv-meta .row { color: #4b5563; margin-top: 3px; }
  .inv-meta .row b { color: #111; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { background: #1b4332; color: #fff; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding: 10px 12px; font-weight: 800; text-align: left; }
  thead th.ctr { text-align: center; }
  thead th.rt { text-align: right; }
  thead th:first-child { border-top-left-radius: 8px; }
  thead th:last-child { border-top-right-radius: 8px; }
  tbody td { padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  tbody td.num { text-align: center; width: 42px; }
  tbody td.ctr { text-align: center; width: 96px; }
  tbody td.rt { text-align: right; font-weight: 700; width: 160px; }
  .totals { margin-left: auto; width: 320px; margin-bottom: 24px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #4b5563; }
  .totals-row.grand { border-top: 2px solid #1b4332; margin-top: 6px; padding-top: 12px; font-size: 16px; font-weight: 900; color: #1b4332; }
  .gst-note { text-align: center; font-size: 11px; color: #6b7280; font-style: italic; margin: 18px 0; }
  .foot { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; border-top: 1px solid #e5e7eb; padding-top: 18px; font-size: 12px; color: #4b5563; }
  .foot .label { font-size: 10px; font-weight: 800; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; }
  .thanks { text-align: center; margin-top: 26px; padding-top: 16px; border-top: 1px dashed #d1d5db; font-size: 12px; color: #6b7280; font-style: italic; }
  .actions { max-width: 780px; margin: 0 auto 16px; text-align: right; }
  .actions button { padding: 8px 18px; background: #1b4332; color: #fff; border: none; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer; }
  @media print {
    body { padding: 0; background: #fff; }
    .actions { display: none; }
    .page { box-shadow: none; padding: 24px; max-width: none; }
  }
</style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">Print Invoice</button></div>
  <div class="page">
    <div class="head">
      <div>
        <div class="brand-name">${LEGAL_ENTITY_NAME}</div>
        <div class="brand-sub">
          ${clubSub ? `Operating: <b>${clubSub}</b><br/>` : ''}
          ${addr ? addr + '<br/>' : ''}
          ${phone ? 'Ph: ' + phone : ''}
          ${phone && email ? ' &middot; ' : ''}
          ${email ? email : ''}
          ${gstin ? '<br/>GSTIN: <b>' + gstin + '</b>' : ''}
        </div>
      </div>
      <div class="inv-meta">
        <h1>TAX INVOICE</h1>
        <div class="row"><b>${escapeHtml(billNumber)}</b></div>
        <div class="row">Date: <b>${prettyDate}</b></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:42px" class="ctr">#</th>
          <th>Description</th>
          <th class="ctr" style="width:96px">Qty</th>
          <th class="rt" style="width:160px">Amount</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Net Amount</span><span>${fmtINRHtml(totals.subtotal)}</span></div>
      <div class="totals-row"><span>SGST (2.5%)</span><span>${fmtINRHtml(totals.sgst)}</span></div>
      <div class="totals-row"><span>CGST (2.5%)</span><span>${fmtINRHtml(totals.cgst)}</span></div>
      <div class="totals-row grand"><span>Total</span><span>${fmtINRHtml(totals.total)}</span></div>
    </div>

    <div class="gst-note">Inclusive of 5% GST (SGST 2.5% + CGST 2.5%)</div>

    <div class="foot">
      <div>
        <div class="label">Notes</div>
        <div>Daily consolidated tax invoice for shake & product sales.</div>
      </div>
      <div style="text-align:right">
        <div class="label">Authorised Signature</div>
        <div style="margin-top:30px;border-top:1px solid #9ca3af;padding-top:4px">For ${LEGAL_ENTITY_NAME}</div>
      </div>
    </div>

    <div class="thanks">This is a computer-generated tax invoice and does not require a physical signature.</div>
  </div>
</body>
</html>`;
}

// ── End-to-end: prepare a daily invoice (totals + bill number + save) ─
// Used by both the thermal-print path (TodayReportModal) and the A4
// admin-download path (ReportsPage).
export async function prepareDailyInvoice(
    clubId: string, dateStr: string,
): Promise<{ totals: DailyInvoiceTotals; billNumber: string; club: DailyInvoiceClub }> {
    const [totals, club] = await Promise.all([
        computeDailyTotals(clubId, dateStr),
        fetchClubData(clubId),
    ]);
    const billNumber = await getOrAllocateBillNumber(clubId, dateStr);
    await saveDailyInvoiceSnapshot(clubId, { ...totals, billNumber });
    return { totals, billNumber, club };
}

// ── Open the A4 invoice in a new browser window for print/save-as-PDF ─
export async function openDailyInvoiceWindow(
    clubId: string, dateStr: string,
): Promise<void> {
    try {
        const { totals, billNumber, club } = await prepareDailyInvoice(clubId, dateStr);
        const html = buildDailyInvoiceHtml(club, totals, billNumber);
        const win = window.open('', '_blank', 'width=860,height=980');
        if (!win) {
            alert('Popup blocked. Please allow popups for this site to view the tax invoice.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    } catch (err) {
        console.error('[openDailyInvoiceWindow]', err);
        alert('Could not open tax invoice. Please try again.');
    }
}
