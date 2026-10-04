import type { User as Member, Product, MembershipPlan } from "@/types/firestore";

// ─── Magician payment intents ─────────────────────────────────────────
// Voice flows that touch money. Every one resolves to a PaymentIntent
// that the unified PaymentIntentCard renders + the unified submit
// dispatcher executes (after accountant face-verify).

export type PaymentIntentKind =
    | "oneday_shake"        // ₹240 × days, today + extras banked
    | "day_redeem"          // free — uses banked oneDayShakeCredits
    | "topup"               // wallet top-up
    | "plan_renewal"        // membership plan renewal
    | "product_sale";       // inventory item sale (needs accountant + inventory mgr verify)

export type PaymentMethod = "cash" | "upi" | "split";

export interface PaymentSelectionShape {
    method: PaymentMethod;
    cashAmount?: number;     // used when split
    upiAmount?: number;      // used when split
    upiAccountId?: string;   // selected UPI app
}

export interface UpiAccount {
    id: string;
    app: string;
    number: string;
    holderName?: string;
}

// Per-intent payload — keeps the union tight so the card + handlers
// only need to switch on kind, not on which optional fields are set.
export interface OneDayShakePayload {
    kind: "oneday_shake";
    member: Member;             // walk-in not supported in voice v1
    item: Product;              // today's special
    days: 1 | 2 | 3;
    unitPrice: number;          // 240
}

export interface DayRedeemPayload {
    kind: "day_redeem";
    member: Member;
    item: Product;
    creditsAvailable: number;   // pre-flight from member.oneDayShakeCredits
}

export interface TopupPayload {
    kind: "topup";
    member: Member;
    amount: number;             // ₹ spoken by receptionist
}

export interface PlanRenewalPayload {
    kind: "plan_renewal";
    member: Member;
    plan: MembershipPlan;       // resolved from spoken plan name
}

export interface InventoryProductLite {
    id: string;
    name: string;
    unit: string;       // e.g. "kg" / "packet" / "scoop"
    price: number;      // per unit
    quantity: number;   // current stock
    category?: string;
}

export interface ProductSalePayload {
    kind: "product_sale";
    buyer: Member;
    product: InventoryProductLite;
    quantity: number;
    unitPrice: number;
    isGift: boolean;
}

export type PaymentPayload =
    | OneDayShakePayload
    | DayRedeemPayload
    | TopupPayload
    | PlanRenewalPayload
    | ProductSalePayload;

// What lives on a ParsedAction.payment when the action.kind is one of
// the paid kinds. The receptionist can edit method/amount in the card
// before submit; method always defaults to cash.
export interface PaymentIntent {
    payload: PaymentPayload;
    selection: PaymentSelectionShape;
    // Computed at parse/edit time so the card displays it consistently.
    totalAmount: number;
    // Validation flags surfaced in the card UI
    error?: string;
}

// What the submit dispatcher receives per row that needs face-verify.
export interface ApprovedPaymentRow {
    intent: PaymentIntent;
    verifier: { id: string; name: string };
}
