import type { User as Member, Product, MembershipPlan } from "@/types/firestore";
import type { InventoryProductLite, PaymentIntent, PaymentPayload } from "./types";

// ─── Per-clause paid-intent detection ──────────────────────────────────
// Each function inspects a single clause and returns a PaymentIntent if
// it matches, or null otherwise. The main Magician parser calls these
// BEFORE the existing attendance/order detection so paid intents win.

const ONEDAY_PRICE = 240;

// ─── one-day shake (buy) ───────────────────────────────────────────────
// Patterns:
//   "Order a one-day kulfi shake for Chandana"
//   "One day shake for Prasad mango"
//   "Two day shake for Prasad special"
//   "Three day shake for member 042 mango"

const ONEDAY_BUY_RE = /\b(?:one|two|three|1|2|3)[\s-]?day(?:s)?\s+(?:shake|pass)\b/i;

const NUM_WORD_DAYS: Record<string, 1 | 2 | 3> = {
    one: 1, "1": 1, two: 2, "2": 2, three: 3, "3": 3,
};

export function parseOneDayShakeClause(
    clause: string,
    members: Member[],
    products: Product[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
    matchItemForClause: (clause: string, products: Product[]) => Product | null,
): PaymentIntent | null {
    if (!ONEDAY_BUY_RE.test(clause)) return null;

    // Extract day count
    const dayMatch = clause.match(/\b(one|two|three|1|2|3)\s*-?\s*day/i);
    const days = (NUM_WORD_DAYS[(dayMatch?.[1] ?? "1").toLowerCase()] ?? 1) as 1 | 2 | 3;

    // Strip "one/two/three day shake" so the rest is just member + item
    const work = clause.replace(ONEDAY_BUY_RE, " ").trim();

    // Find member — try id first, then name from the remaining text
    const member = findMemberInClause(work, members, matchMemberByDigits, matchByName);
    if (!member) return null;

    // Find item — try matching against today's specials
    const item = matchItemForClause(work, products);
    if (!item) return null;

    const totalAmount = ONEDAY_PRICE * days;
    return {
        payload: {
            kind: "oneday_shake",
            member, item, days, unitPrice: ONEDAY_PRICE,
        },
        selection: { method: "cash" },
        totalAmount,
    };
}

// ─── day redeem (free, uses banked credits) ────────────────────────────
// Patterns:
//   "Day shake for Prasad mango"   ← note: NOT "one day shake"
//   "Redeem day shake for 042 special"
//   "Use day credit for Prasad strawberry"

const DAY_REDEEM_RE = /\b(?:redeem\s+)?(?:day\s+shake|day\s+credit|day\s+pass)\b/i;

export function parseDayRedeemClause(
    clause: string,
    members: Member[],
    products: Product[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
    matchItemForClause: (clause: string, products: Product[]) => Product | null,
): PaymentIntent | null {
    // The one-day BUY pattern already consumed "one day shake" forms.
    // Only fire on bare "day shake" (no number prefix).
    if (ONEDAY_BUY_RE.test(clause)) return null;
    if (!DAY_REDEEM_RE.test(clause)) return null;

    const work = clause.replace(DAY_REDEEM_RE, " ").trim();

    const member = findMemberInClause(work, members, matchMemberByDigits, matchByName);
    if (!member) return null;

    const item = matchItemForClause(work, products);
    if (!item) return null;

    const creditsAvailable = (member as any).oneDayShakeCredits ?? 0;
    return {
        payload: {
            kind: "day_redeem",
            member, item, creditsAvailable,
        },
        selection: { method: "cash" },   // unused for free; satisfies type
        totalAmount: 0,
        error: creditsAvailable <= 0
            ? "No day-shake credits — buy a 1/2/3-day pack first"
            : undefined,
    };
}

// ─── wallet top-up ─────────────────────────────────────────────────────
// Patterns:
//   "Top up Prasad 500"
//   "Top up 042 1000 cash"
//   "Add 500 to Prasad wallet"
//   "Wallet top up 500 for Prasad"

const TOPUP_RE = /\b(top\s*up|topup|wallet\s+top\s*up|add\s+money|add\s+to\s+wallet)\b/i;

export function parseTopupClause(
    clause: string,
    members: Member[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
): PaymentIntent | null {
    if (!TOPUP_RE.test(clause)) return null;

    const work = clause.replace(TOPUP_RE, " ").trim();

    // Amount: prefer the LARGEST digit run in the clause (since member ids
    // are typically 1-3 digits, top-up amounts 100+).
    const allDigitRuns = Array.from(work.matchAll(/\d+/g)).map((m) => m[0]);
    if (allDigitRuns.length === 0) return null;
    // Sort by numeric value desc, take biggest
    const amountStr = allDigitRuns
        .map((s) => ({ s, n: parseInt(s, 10) }))
        .sort((a, b) => b.n - a.n)[0].s;
    const amount = parseInt(amountStr, 10);
    if (amount < 1) return null;

    // Member: try matching the OTHER digit runs as ids, plus name fallback.
    const otherDigitRuns = allDigitRuns.filter((s) => s !== amountStr);
    let member: Member | null = null;
    for (const d of otherDigitRuns) {
        member = matchMemberByDigits(d);
        if (member) break;
    }
    if (!member) {
        // Strip all digits + filler then try name match on what's left.
        const nameText = work
            .replace(/\d+/g, " ")
            .replace(/\b(?:to|for|wallet|cash|upi|rupees?|rs\.?|inr)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (nameText) {
            const candidates = matchByName(nameText, members);
            if (candidates.length === 1) member = candidates[0];
        }
    }
    if (!member) return null;

    // Method hint in clause
    const method = detectMethodHint(clause);
    return {
        payload: { kind: "topup", member, amount },
        selection: { method },
        totalAmount: amount,
    };
}

// ─── plan renewal ──────────────────────────────────────────────────────
// Patterns:
//   "Renew gold plan for Prasad"
//   "Renew Prasad gold plan cash"
//   "Renewal silver for 042 UPI"

const RENEW_RE = /\b(renew(?:al)?|renew\s+plan)\b/i;

export function parsePlanRenewalClause(
    clause: string,
    members: Member[],
    plans: MembershipPlan[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
): PaymentIntent | null {
    if (!RENEW_RE.test(clause)) return null;
    if (plans.length === 0) return null;

    // Match plan by name (or partial — "gold" matches "Gold Monthly")
    let plan: MembershipPlan | null = null;
    const lc = clause.toLowerCase();
    for (const p of plans) {
        const planWords = (p.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        if (planWords.some((w) => lc.includes(w))) { plan = p; break; }
    }
    if (!plan) return null;

    // Strip renew keyword + plan name to find member text
    const work = clause
        .replace(RENEW_RE, " ")
        .replace(new RegExp(`\\b${plan.name}\\b`, "i"), " ")
        .replace(/\b(plan|membership)\b/gi, " ")
        .trim();

    // Find member by id or name
    const digitMatch = work.match(/\d+/);
    let member: Member | null = digitMatch ? matchMemberByDigits(digitMatch[0]) : null;
    if (!member) {
        const nameText = work
            .replace(/\d+/g, " ")
            .replace(/\b(?:for|of|to|cash|upi|by)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (nameText) {
            const candidates = matchByName(nameText, members);
            if (candidates.length === 1) member = candidates[0];
        }
    }
    if (!member) return null;

    return {
        payload: { kind: "plan_renewal", member, plan },
        selection: { method: detectMethodHint(clause) },
        totalAmount: (plan as any).price ?? 0,
    };
}

// ─── product sale (inventory) ──────────────────────────────────────────
// Patterns:
//   "Sell whey to Prasad cash"
//   "Sell 2 whey to Prasad UPI"
//   "Sell whey protein to 042"
//   "Gift whey to Prasad"  ← isGift=true, ₹0

const SELL_RE = /\b(sell|gift|give)\b/i;
const GIFT_RE = /\b(gift|free|complimentary)\b/i;

export function parseProductSaleClause(
    clause: string,
    members: Member[],
    inventory: InventoryProductLite[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
): PaymentIntent | null {
    if (!SELL_RE.test(clause)) return null;
    if (inventory.length === 0) return null;

    const isGift = GIFT_RE.test(clause);
    const lc = clause.toLowerCase();

    // Find product — fuzzy match by name words present in clause
    let product: InventoryProductLite | null = null;
    let bestScore = 0;
    for (const p of inventory) {
        const nameWords = (p.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const score = nameWords.filter((w) => lc.includes(w)).length;
        if (score > bestScore) { bestScore = score; product = p; }
    }
    if (!product) return null;

    // Quantity — digit run NOT matching a member id near "sell"
    // Prefer small numbers (1-9) right after the verb.
    let quantity = 1;
    const qMatch = clause.match(/\b(?:sell|gift|give)\s+(\d+)\s/i);
    if (qMatch) quantity = Math.min(99, parseInt(qMatch[1], 10) || 1);

    // Find buyer — strip product name + "to" + "for"
    const work = clause
        .replace(new RegExp(`\\b${escapeRegExp(product.name)}\\b`, "gi"), " ")
        .replace(/\b(?:sell|gift|give|to|for|cash|upi|wallet)\b/gi, " ")
        .replace(/\d+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    let buyer: Member | null = null;
    // Try id first from the full clause (digits not used as quantity)
    const allDigits = Array.from(clause.matchAll(/\d+/g)).map((m) => m[0]);
    for (const d of allDigits) {
        if (qMatch && d === qMatch[1]) continue;
        const m = matchMemberByDigits(d);
        if (m) { buyer = m; break; }
    }
    if (!buyer && work) {
        const candidates = matchByName(work, members);
        if (candidates.length === 1) buyer = candidates[0];
    }
    if (!buyer) return null;

    const unitPrice = isGift ? 0 : product.price;
    const totalAmount = unitPrice * quantity;
    return {
        payload: {
            kind: "product_sale",
            buyer, product, quantity, unitPrice, isGift,
        },
        selection: { method: detectMethodHint(clause) },
        totalAmount,
    };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── shared helpers ────────────────────────────────────────────────────

function detectMethodHint(clause: string): "cash" | "upi" | "split" {
    const lc = clause.toLowerCase();
    if (/\bupi\b/.test(lc) || /\bphonepe\b/.test(lc) || /\bgoogle\s*pay\b/.test(lc)) return "upi";
    if (/\bsplit\b/.test(lc)) return "split";
    return "cash";   // default per Q2 answer
}

function findMemberInClause(
    text: string,
    members: Member[],
    matchMemberByDigits: (d: string) => Member | null,
    matchByName: (q: string, members: Member[]) => Member[],
): Member | null {
    // Prefer id match (digit run that resolves)
    const digitRuns = Array.from(text.matchAll(/\d+/g)).map((m) => m[0]);
    for (const d of digitRuns) {
        const m = matchMemberByDigits(d);
        if (m) return m;
    }
    // Fall back to name — strip "for"/"to"/digits/punct, try as a whole.
    const cleaned = text
        .replace(/\d+/g, " ")
        .replace(/\b(?:for|to|of|the|a|an|please|kindly|sir|madam)\b/gi, " ")
        .replace(/[,.;]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) return null;
    const candidates = matchByName(cleaned, members);
    if (candidates.length === 1) return candidates[0];
    // Try each word individually if multi-word piece didn't resolve uniquely.
    const words = cleaned.split(/\s+/);
    for (const w of words) {
        const c = matchByName(w, members);
        if (c.length === 1) return c[0];
    }
    return null;
}
