/**
 * How much a payment was, and how it was tendered.
 *
 * Every screen that totals money needs the same two answers — what the payment
 * was worth, and how it split between cash and UPI — and they were each working
 * it out themselves. The formula they shared was wrong in the same way:
 *
 *     const cash = Number(p.cashAmount ?? (p.paymentMethod === "cash" ? amt : 0));
 *     const upi  = Number(p.upiAmount  ?? (p.paymentMethod === "upi"  ? amt : 0));
 *
 * The two `??` fallbacks fire independently. A payment that has `cashAmount`
 * written but no `upiAmount`, on a doc whose `paymentMethod` is "upi", scores
 * `cash = cashAmount` AND `upi = amount` — the full amount counted a second
 * time on top of the part that was already recorded. Reports and the
 * transactions modal both over-stated the day by that overlap, while the rows
 * they listed underneath added up correctly, so the totals disagreed with the
 * list on the same screen.
 *
 * The rule here: **`amount` is the truth.** The split is only a description of
 * how that amount arrived, and can never add up to more than it.
 *
 * Anything left unattributed is reported as UPI, by the club's decision — see
 * the note at the bottom of splitOf(). So cash + upi always equals amount, and
 * `other` is always 0.
 */

export interface PaymentSplit {
    /** What the payment was worth. The number every total should be built from. */
    amount: number;
    /** Part of `amount` tendered as cash. */
    cash: number;
    /** Part of `amount` tendered by UPI, including anything unattributed. */
    upi: number;
    /** Always 0 — kept so callers that read it still compile. */
    other: number;
}

/**
 * Resolve one payment doc. Safe on partial, malformed and legacy records:
 * cash + upi + other always equals amount exactly.
 */
export function splitOf(p: any): PaymentSplit {
    const rawAmount = Number(p?.amount);
    const hasCash = p?.cashAmount != null;
    const hasUpi = p?.upiAmount != null;
    const cashField = Number(p?.cashAmount) || 0;
    const upiField = Number(p?.upiAmount) || 0;

    // A doc with no usable `amount` but a written split still represents money:
    // fall back to the split's own sum rather than dropping it from the books.
    const amount = Number.isFinite(rawAmount) && rawAmount !== 0
        ? rawAmount
        : cashField + upiField;

    if (amount <= 0) return { amount: 0, cash: 0, upi: 0, other: 0 };

    let cash: number;
    let upi: number;

    if ((hasCash || hasUpi) && cashField + upiField > 0) {
        // At least one side was recorded — trust what is there, and do NOT let
        // the missing side fall back to the whole amount. That fallback is the
        // bug this module exists to remove.
        //
        // The nonzero check matters: a record carrying an explicit
        // cashAmount: 0, upiAmount: 0 but a real amount and a method must fall
        // through to the method, or a cash payment gets reported as UPI by the
        // unattributed rule below.
        cash = cashField;
        upi = upiField;
    } else {
        // Nothing recorded: infer the whole amount from the method.
        const m = String(p?.paymentMethod || "").toLowerCase();
        cash = m === "cash" ? amount : 0;
        upi = m === "upi" ? amount : 0;
    }

    // Bad data can claim more was tendered than the payment was worth. Scale
    // back proportionally rather than inventing revenue.
    const tendered = cash + upi;
    if (tendered > amount) {
        const k = amount / tendered;
        cash = cash * k;
        upi = upi * k;
    }

    // Whatever is still unattributed goes to the method the payment DECLARES.
    //
    // This used to go blindly to UPI, and that was the visible bug the club
    // kept reporting. A real example from their own records: a ₹480 one-day
    // shake marked paymentMethod "cash", stored with cashAmount 240 because the
    // writer used the per-day price instead of the total. The ₹240 shortfall
    // was handed to UPI, so a payment taken entirely in cash was reported as
    // ₹240 cash and ₹240 UPI. The total stayed right — which is exactly why it
    // survived every previous fix — while both columns were wrong, and the
    // drawer never matched. Twenty-six payments in one month were affected.
    //
    // Only when the record names no method at all does the club's rule apply:
    // those are old documents where the money was taken but the method was
    // never written down, and the club has said to report them as UPI.
    const unattributed = Math.max(0, amount - cash - upi);
    if (unattributed > 0) {
        const declared = String(p?.paymentMethod || "").toLowerCase();
        if (declared === "cash") cash += unattributed;
        else upi += unattributed;
    }

    return { amount, cash, upi, other: 0 };
}

/** Total of `amount` across many payments — the figure a day or month is worth. */
export function totalOf(payments: any[]): number {
    return (payments || []).reduce((s, p) => s + splitOf(p).amount, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// THE WRITE SIDE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Force a payment's tender fields to add up to its amount, before it is stored.
 *
 * `splitOf` above repairs a broken split when READING, and it does that job
 * well enough that the damage stays invisible: it folds whatever is
 * unattributed into UPI, so the total always looks right while the two columns
 * quietly stop reflecting what was actually taken. That is precisely the fault
 * the club kept reporting — the total correct, cash and UPI not adding up to
 * it — and no amount of fixing readers could cure it, because the DOCUMENTS
 * were already wrong.
 *
 * Two ways a document gets written wrong, both found in this codebase:
 *
 *   1. The amount and the split are captured at different moments. The
 *      products cart validates a split against the cart total, then lets the
 *      receptionist change the cart before confirming — ₹500 split 200/300,
 *      cart edited to ₹800, stored as amount 800 with 200+300.
 *   2. An edit changes the amount and not the split. Editing a split payment
 *      from ₹1,000 to ₹2,000 in the Transactions modal left cashAmount 400 and
 *      upiAmount 600 against an amount of 2,000.
 *
 * Every writer must pass through here. For a single-method payment the answer
 * is the whole amount on that side. For a split, any drift is folded into cash
 * — the same rule `buildPaymentDoc` already applied, now shared so it is not
 * one writer's private good behaviour.
 */
export interface NormalizedTender {
    paymentMethod: "cash" | "upi" | "split";
    amount: number;
    cashAmount: number;
    upiAmount: number;
}

export function normalizeTender(
    rawAmount: any,
    rawMethod: any,
    rawCash?: any,
    rawUpi?: any,
): NormalizedTender {
    const amount = Number(rawAmount) || 0;
    const m = String(rawMethod ?? "").toLowerCase();
    const method: NormalizedTender["paymentMethod"] =
        m === "upi" ? "upi" : m === "split" ? "split" : "cash";

    if (method === "upi") return { paymentMethod: "upi", amount, cashAmount: 0, upiAmount: amount };
    if (method === "cash") return { paymentMethod: "cash", amount, cashAmount: amount, upiAmount: 0 };

    let cash = Number(rawCash) || 0;
    let upi = Number(rawUpi) || 0;
    const drift = amount - cash - upi;
    // Fold any drift into cash rather than inventing or losing money. Over a
    // half-rupee is real disagreement; below that it is float noise.
    if (Math.abs(drift) > 0.5) cash += drift;
    // A "split" that ended up entirely on one side is not a split. Say what it
    // actually was, so the reports and the drawer agree on the tender too.
    if (upi <= 0) return { paymentMethod: "cash", amount, cashAmount: amount, upiAmount: 0 };
    if (cash <= 0) return { paymentMethod: "upi", amount, cashAmount: 0, upiAmount: amount };
    return { paymentMethod: "split", amount, cashAmount: cash, upiAmount: upi };
}

/**
 * Does this stored document already add up? Used by the health check so a bad
 * record can be found and corrected rather than silently patched on every read.
 */
export function tenderIsConsistent(p: any): boolean {
    const amount = Number(p?.amount) || 0;
    if (amount <= 0) return true;
    const cash = Number(p?.cashAmount) || 0;
    const upi = Number(p?.upiAmount) || 0;
    if (p?.cashAmount == null && p?.upiAmount == null) return true; // method-only, splitOf infers
    return Math.abs(amount - cash - upi) <= 0.5;
}

/** A wallet top-up: money moved into a balance, not money earned. */
export function isWalletTopup(p: any): boolean {
    return p?.type === "wallet_topup" || p?.type === "topup";
}

/**
 * The one money summary every report shows.
 *
 * Two different questions get asked of a day's money, and mixing them up is
 * what made the reports disagree with each other and with the drawer:
 *
 *   - **Collected** — every rupee physically taken, including wallet top-ups.
 *     This is what the drawer and the bank must match at close.
 *   - **Revenue** — collected minus top-ups, since a top-up is owed back in
 *     shakes. This is what the business earned.
 *
 * Before this, six places computed money independently — the Today's Report
 * screen tiles, its print, its Excel, its saved report, the Reports page and
 * the Transactions modal — and they disagreed about which question they were
 * answering. The receptionist adding the listed rows by hand got "collected"
 * while the total printed under them was "revenue", which reads as the app
 * failing at basic arithmetic.
 *
 * `payments` are club payment docs (soft-deleted ones are skipped here, so
 * callers cannot forget). `topupRequests` are the member-app's approved top-up
 * requests, which never write a payments doc — pass them where the surface
 * shows them, or omit where it only deals in payment docs.
 */
export interface MoneySummary {
    cashCollected: number;
    upiCollected: number;
    totalCollected: number;
    topupTotal: number;
    revenue: number;
    revenueCash: number;
    revenueUpi: number;
}

export function summarizeMoney(payments: any[], topupRequests: any[] = []): MoneySummary {
    let cashCollected = 0, upiCollected = 0, topupTotal = 0, revenueCash = 0, revenueUpi = 0;

    for (const p of payments || []) {
        if (p?.deleted) continue;
        const s = splitOf(p);
        cashCollected += s.cash;
        upiCollected += s.upi;
        if (isWalletTopup(p)) topupTotal += s.amount;
        else { revenueCash += s.cash; revenueUpi += s.upi; }
    }
    for (const t of topupRequests || []) {
        const amt = Number(t?.approvedAmount ?? t?.requestedAmount ?? t?.amount) || 0;
        if (amt <= 0) continue;
        const s = splitOf({ ...t, amount: amt });
        cashCollected += s.cash;
        upiCollected += s.upi;
        topupTotal += s.amount;
    }

    return {
        cashCollected,
        upiCollected,
        totalCollected: cashCollected + upiCollected,
        topupTotal,
        revenue: cashCollected + upiCollected - topupTotal,
        revenueCash,
        revenueUpi,
    };
}
