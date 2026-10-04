// ──────────────────────────────────────────────────────────────────────
// Invoice system — shared helpers
//
// Every payment in the app (top-up, renewal, shake order, product sale,
// upgrade, plan purchase) writes a GST-compliant invoice to:
//   clubs/{clubId}/members/{memberId}/invoices/{invoiceId}
// and also appears in:
//   clubs/{clubId}/invoices/{invoiceId}      (club-wide index copy)
//
// The invoice contains:
//   - club details (name, address, phone, GSTIN)
//   - member details (name, MNC ID, phone, address)
//   - line items (with qty + rate)
//   - GST breakdown (CGST 2.5% + SGST 2.5%, inclusive of total)
//   - payment method + reference
//
// Invoices are printable via openInvoicePrintWindow() — opens an A4 HTML
// window that uses the browser's native print dialog (works on any
// printer or PDF target, not RawBT-thermal-only).
// ──────────────────────────────────────────────────────────────────────

import { doc, setDoc, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type InvoiceItem = {
    description: string;
    qty: number;
    rate: number;        // per-unit price (gross, GST-inclusive)
    amount: number;      // qty × rate (gross)
};

export type InvoiceType =
    | 'wallet_topup'
    | 'membership_renewal'
    | 'plan_purchase'
    | 'shake_order'
    | 'product_sale'
    | 'member_upgrade'
    | 'other';

export type InvoiceInput = {
    type: InvoiceType;
    title: string;                 // e.g. "Wallet Top-up", "Membership Renewal"
    items: InvoiceItem[];          // at least one
    paymentMethod: string;         // 'cash' | 'upi' | 'wallet' | 'shake_credits' | etc.
    paymentReference?: string;     // UPI txn ID, cheque no, etc.
    notes?: string;
};

export type SavedInvoice = {
    id: string;
    clubId: string;
    memberId: string;
    memberName: string;
    memberCode?: string;
    memberPhone?: string;
    memberAddress?: string;
    type: InvoiceType;
    title: string;
    items: InvoiceItem[];
    subtotal: number;
    cgst: number;
    sgst: number;
    total: number;
    paymentMethod: string;
    paymentReference?: string;
    notes?: string;
    invoiceDate: string;           // YYYY-MM-DD
    createdAt: Timestamp | null;
};

// ── GST calculation ───────────────────────────────────────────────────
// Prices in the app are GST-inclusive (customer-facing). Given a gross
// total, compute the net subtotal and the CGST/SGST split (2.5% each).
export const calcGST = (grossTotal: number) => {
    const net = Math.round((grossTotal / 1.05) * 100) / 100;
    const totalGst = Math.round((grossTotal - net) * 100) / 100;
    const sgst = Math.round((totalGst / 2) * 100) / 100;
    const cgst = Math.round((totalGst - sgst) * 100) / 100;
    return { subtotal: net, sgst, cgst, total: grossTotal };
};

// ── Invoice ID generator (separate namespace from receipt TXN IDs) ────
// Format: INV20260423-4821
export const generateInvoiceId = (): string => {
    const now = new Date();
    const datePart =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV${datePart}-${rand}`;
};

const todayStr = (): string => {
    const d = new Date();
    return (
        d.getFullYear().toString() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
    );
};

// ── Write an invoice to Firestore ─────────────────────────────────────
// Writes both copies (member subcollection + club-wide index) and
// returns the full invoice object that the caller can print.
export async function writeInvoice(
    clubId: string,
    memberId: string,
    memberMeta: {
        memberName?: string;
        memberCode?: string;
        memberPhone?: string;
        memberAddress?: string;
    },
    input: InvoiceInput,
): Promise<SavedInvoice> {
    if (!clubId || !memberId) {
        throw new Error('writeInvoice: clubId and memberId are required');
    }
    const grossTotal = input.items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const gst = calcGST(grossTotal);

    const id = generateInvoiceId();
    const payload: Omit<SavedInvoice, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
        id,
        clubId,
        memberId,
        memberName: memberMeta.memberName || '',
        memberCode: memberMeta.memberCode || '',
        memberPhone: memberMeta.memberPhone || '',
        memberAddress: memberMeta.memberAddress || '',
        type: input.type,
        title: input.title,
        items: input.items.map((i) => ({
            description: i.description,
            qty: Number(i.qty) || 1,
            rate: Number(i.rate) || 0,
            amount: Number(i.amount) || 0,
        })),
        subtotal: gst.subtotal,
        cgst: gst.cgst,
        sgst: gst.sgst,
        total: gst.total,
        paymentMethod: input.paymentMethod || '',
        paymentReference: input.paymentReference || '',
        notes: input.notes || '',
        invoiceDate: todayStr(),
        createdAt: serverTimestamp(),
    };

    // Write both locations (best-effort — member subcollection is primary)
    try {
        await setDoc(
            doc(db, 'clubs', clubId, 'members', memberId, 'invoices', id),
            payload,
        );
    } catch (e) {
        console.error('[writeInvoice] member-subcollection write failed', e);
        throw e;
    }

    // Club-wide index copy — non-blocking
    try {
        await setDoc(doc(db, 'clubs', clubId, 'invoices', id), payload);
    } catch (e) {
        // Don't fail the caller if the index copy fails
        console.warn('[writeInvoice] club-index copy failed (non-fatal)', e);
    }

    // Return the invoice (swap serverTimestamp sentinel for null; callers
    // that need the real timestamp should re-read from Firestore).
    return { ...(payload as Omit<SavedInvoice, 'createdAt'>), createdAt: null };
}

// ── Fetch an invoice back (e.g. to reprint) ──────────────────────────
export async function fetchInvoice(
    clubId: string,
    memberId: string,
    invoiceId: string,
): Promise<SavedInvoice | null> {
    const snap = await getDoc(
        doc(db, 'clubs', clubId, 'members', memberId, 'invoices', invoiceId),
    );
    if (!snap.exists()) return null;
    return snap.data() as SavedInvoice;
}

// ── A4 printable HTML ────────────────────────────────────────────────
type ClubPrintHeader = {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    gstNumber?: string;
    logo?: string;
};

function escapeHtml(s: string | undefined | null): string {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const fmtINR = (n: number): string =>
    '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

const prettyType: Record<InvoiceType, string> = {
    wallet_topup: 'Wallet Top-up',
    membership_renewal: 'Membership Renewal',
    plan_purchase: 'Plan Purchase',
    shake_order: 'Shake Order',
    product_sale: 'Product Sale',
    member_upgrade: 'Membership Upgrade',
    other: 'Service',
};

export function buildInvoiceHtml(invoice: SavedInvoice, club: ClubPrintHeader): string {
    const clubName = escapeHtml(club.name || 'Nutrition Club');
    const clubAddr = escapeHtml(club.address || '');
    const clubPhone = escapeHtml(club.phone || '');
    const clubEmail = escapeHtml(club.email || '');
    const gstin = escapeHtml(club.gstNumber || '');

    const issuedOn = invoice.invoiceDate || todayStr();
    const [yyyy, mm, dd] = issuedOn.split('-');
    const prettyDate = `${dd}/${mm}/${yyyy}`;

    const itemsHtml = invoice.items
        .map(
            (it, idx) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${idx + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${escapeHtml(it.description)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${it.qty}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${fmtINR(it.rate)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:700">${fmtINR(it.amount)}</td>
        </tr>`,
        )
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${escapeHtml(invoice.id)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; background: #f4f4f5; padding: 24px; }
  .page { max-width: 780px; margin: 0 auto; background: #fff; padding: 40px 48px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1b4332; padding-bottom: 18px; margin-bottom: 24px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { height: 54px; width: 54px; border-radius: 10px; object-fit: cover; }
  .brand-name { font-size: 22px; font-weight: 900; color: #1b4332; letter-spacing: 0.2px; }
  .brand-sub { font-size: 11px; color: #6b7280; margin-top: 2px; line-height: 1.5; max-width: 260px; }
  .inv-meta { text-align: right; font-size: 12px; }
  .inv-meta h1 { font-size: 28px; font-weight: 900; color: #1b4332; letter-spacing: 2px; margin-bottom: 6px; }
  .inv-meta .row { color: #4b5563; margin-top: 3px; }
  .inv-meta .row b { color: #111; }
  .party { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 28px; }
  .card { background: #f8faf9; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
  .card .label { font-size: 10px; font-weight: 800; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 6px; }
  .card .name { font-size: 15px; font-weight: 800; color: #111; margin-bottom: 4px; }
  .card .line { font-size: 12px; color: #4b5563; margin-top: 2px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { background: #1b4332; color: #fff; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding: 10px 12px; font-weight: 800; }
  thead th:first-child { border-top-left-radius: 8px; }
  thead th:last-child { border-top-right-radius: 8px; }
  .totals { margin-left: auto; width: 320px; margin-bottom: 24px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #4b5563; }
  .totals-row.grand { border-top: 2px solid #1b4332; margin-top: 6px; padding-top: 12px; font-size: 16px; font-weight: 900; color: #1b4332; }
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
  <div class="actions"><button onclick="window.print()">🖨️ Print Invoice</button></div>
  <div class="page">
    <div class="head">
      <div class="brand">
        ${club.logo ? `<img src="${escapeHtml(club.logo)}" alt="logo"/>` : ''}
        <div>
          <div class="brand-name">${clubName}</div>
          <div class="brand-sub">
            ${clubAddr ? escapeHtml(clubAddr) + '<br/>' : ''}
            ${clubPhone ? 'Ph: ' + clubPhone : ''}
            ${clubPhone && clubEmail ? ' · ' : ''}
            ${clubEmail ? clubEmail : ''}
            ${gstin ? '<br/>GSTIN: <b>' + gstin + '</b>' : ''}
          </div>
        </div>
      </div>
      <div class="inv-meta">
        <h1>INVOICE</h1>
        <div class="row"><b>${escapeHtml(invoice.id)}</b></div>
        <div class="row">Date: <b>${prettyDate}</b></div>
        <div class="row">Service: <b>${escapeHtml(prettyType[invoice.type] || invoice.title || 'Service')}</b></div>
      </div>
    </div>

    <div class="party">
      <div class="card">
        <div class="label">Billed To</div>
        <div class="name">${escapeHtml(invoice.memberName || 'Member')}</div>
        ${invoice.memberCode ? `<div class="line"><b>MNC ID:</b> ${escapeHtml(invoice.memberCode)}</div>` : ''}
        ${invoice.memberPhone ? `<div class="line">📞 ${escapeHtml(invoice.memberPhone)}</div>` : ''}
        ${invoice.memberAddress ? `<div class="line">📍 ${escapeHtml(invoice.memberAddress)}</div>` : ''}
      </div>
      <div class="card">
        <div class="label">Payment Details</div>
        <div class="name">${escapeHtml(invoice.title)}</div>
        <div class="line"><b>Method:</b> ${escapeHtml((invoice.paymentMethod || '—').toUpperCase())}</div>
        ${invoice.paymentReference ? `<div class="line"><b>Ref:</b> ${escapeHtml(invoice.paymentReference)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:42px;text-align:center">#</th>
          <th style="text-align:left">Description</th>
          <th style="width:64px;text-align:center">Qty</th>
          <th style="width:110px;text-align:right">Rate</th>
          <th style="width:140px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${fmtINR(invoice.subtotal)}</span></div>
      <div class="totals-row"><span>CGST (2.5%)</span><span>${fmtINR(invoice.cgst)}</span></div>
      <div class="totals-row"><span>SGST (2.5%)</span><span>${fmtINR(invoice.sgst)}</span></div>
      <div class="totals-row grand"><span>Total</span><span>${fmtINR(invoice.total)}</span></div>
    </div>

    <div class="foot">
      <div>
        <div class="label">Notes</div>
        <div>${escapeHtml(invoice.notes || 'Thank you for choosing ' + (club.name || 'our club') + '.')}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Authorised Signature</div>
        <div style="margin-top:30px;border-top:1px solid #9ca3af;padding-top:4px">For ${clubName}</div>
      </div>
    </div>

    <div class="thanks">🌿 This is a computer-generated invoice and does not require a physical signature. 🌿</div>
  </div>
</body>
</html>`;
}

// ── Open invoice in a new print window ────────────────────────────────
export async function openInvoicePrintWindow(
    invoice: SavedInvoice,
): Promise<void> {
    try {
        const clubSnap = await getDoc(doc(db, 'clubs', invoice.clubId));
        const raw = clubSnap.exists() ? (clubSnap.data() as Record<string, unknown>) : {};
        const club: ClubPrintHeader = {
            name: (raw.clubName || raw.name || 'Nutrition Club') as string,
            address: ((raw.address as string) ?? '') as string,
            phone: ((raw.phone as string) ?? (raw.ownerPhone as string) ?? '') as string,
            email: ((raw.email as string) ?? (raw.ownerEmail as string) ?? '') as string,
            gstNumber: ((raw.gstNumber as string) ?? '') as string,
            logo: ((raw.logo as string) ?? (raw.logoUrl as string) ?? '') as string,
        };
        const html = buildInvoiceHtml(invoice, club);
        const win = window.open('', '_blank', 'width=860,height=980');
        if (!win) {
            alert('Popup blocked. Please allow popups for this site to print invoices.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        // Give the browser a moment to render before triggering print
        // (optional — the user can also click the Print button in the window)
    } catch (err) {
        console.error('[openInvoicePrintWindow]', err);
        alert('Could not open invoice window. Please try again.');
    }
}

// ── Helper: fetch member details for invoice header ───────────────────
async function fetchMemberMeta(
    clubId: string,
    memberId: string,
): Promise<{
    memberName: string;
    memberCode: string;
    memberPhone: string;
    memberAddress: string;
}> {
    try {
        const snap = await getDoc(doc(db, 'clubs', clubId, 'members', memberId));
        if (!snap.exists()) {
            return { memberName: '', memberCode: '', memberPhone: '', memberAddress: '' };
        }
        const raw = snap.data() as Record<string, unknown>;
        return {
            memberName: ((raw.name as string) || (raw.fullName as string) || '') as string,
            memberCode: ((raw.memberId as string) || '') as string,
            memberPhone: ((raw.phone as string) || (raw.whatsapp as string) || '') as string,
            memberAddress: ((raw.address as string) || '') as string,
        };
    } catch (e) {
        console.warn('[fetchMemberMeta] failed', e);
        return { memberName: '', memberCode: '', memberPhone: '', memberAddress: '' };
    }
}

// ── One-call helper for payment flows ─────────────────────────────────
// Fetches member meta, writes invoice, and saves. Caller decides whether
// to print immediately (default: no — too noisy in loops / background).
export async function logInvoice(
    clubId: string,
    memberId: string,
    input: InvoiceInput,
): Promise<SavedInvoice | null> {
    try {
        if (!clubId || !memberId) return null;
        const meta = await fetchMemberMeta(clubId, memberId);
        return await writeInvoice(clubId, memberId, meta, input);
    } catch (err) {
        console.error('[logInvoice] failed', err);
        return null;
    }
}

// ── Helper: write + immediately open print window ────────────────────
// Use this in payment flows:
//   await createAndPrintInvoice(clubId, memberId, memberMeta, input);
export async function createAndPrintInvoice(
    clubId: string,
    memberId: string,
    memberMeta: {
        memberName?: string;
        memberCode?: string;
        memberPhone?: string;
        memberAddress?: string;
    },
    input: InvoiceInput,
    options?: { autoPrint?: boolean },
): Promise<SavedInvoice | null> {
    try {
        const invoice = await writeInvoice(clubId, memberId, memberMeta, input);
        if (options?.autoPrint !== false) {
            // Fire-and-forget — don't block caller
            openInvoicePrintWindow(invoice).catch(() => { /* already alerted */ });
        }
        return invoice;
    } catch (err) {
        console.error('[createAndPrintInvoice] failed', err);
        return null;
    }
}
