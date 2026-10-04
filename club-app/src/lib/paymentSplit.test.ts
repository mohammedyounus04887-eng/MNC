import { describe, it, expect } from "vitest";
import { splitOf } from "./paymentSplit";

/**
 * The rule these tests protect: `cash + upi` must equal `amount`, AND each side
 * must be the tender the money actually arrived by.
 *
 * Total Revenue was always right, because it is built from `amount`. What went
 * wrong was the split beneath it — money arriving by one tender being reported
 * under the other. That is invisible on a dashboard and expensive at a cash
 * drawer, which is exactly why it survived.
 */
describe("splitOf — the recorded split is trusted", () => {
    it("reads a written cash split", () => {
        const s = splitOf({ amount: 500, paymentMethod: "cash", cashAmount: 500, upiAmount: 0 });
        expect(s.cash).toBe(500);
        expect(s.upi).toBe(0);
    });

    it("reads a written upi split", () => {
        const s = splitOf({ amount: 500, paymentMethod: "upi", cashAmount: 0, upiAmount: 500 });
        expect(s.upi).toBe(500);
        expect(s.cash).toBe(0);
    });

    it("reads a genuine split payment", () => {
        const s = splitOf({ amount: 500, paymentMethod: "split", cashAmount: 200, upiAmount: 300 });
        expect(s.cash).toBe(200);
        expect(s.upi).toBe(300);
    });
});

describe("splitOf — a zero split must not become UPI", () => {
    /**
     * The defect this file was written for.
     *
     * Writers store `cashAmount: 0, upiAmount: 0` for any method that is not
     * cash, upi or split — `wallet` in useInventoryManagement, and anything else
     * a caller passes through. `splitOf` treated "both fields present" as "the
     * split was recorded", found nothing attributed, and applied the legacy rule
     * that unattributed money is UPI.
     *
     * A wallet payment is not UPI. Nothing arrived in the UPI account, so the
     * UPI figure on Reports and Today's Report was overstated by the value of
     * every wallet, card and credit payment in the period — while Total Revenue
     * stayed correct, because it is built from `amount`.
     */
    /**
     * OPEN DECISION FOR THE OWNER — these two pin what the code does TODAY, not
     * what is necessarily right.
     *
     * A wallet or card payment still lands in UPI, because the legacy rule below
     * sweeps up anything left unattributed and the club's stated position is that
     * "Total Revenue is exactly Cash + UPI".
     *
     * The cost of that: nothing arrived in the UPI account for these, so the UPI
     * figure cannot be reconciled against a bank statement — it is inflated by
     * every wallet and card payment in the period.
     *
     * The cost of changing it: a third bucket, and Total Revenue stops equalling
     * Cash + UPI on every screen.
     *
     * That is a bookkeeping decision, not an engineering one, so it is written
     * down here rather than quietly chosen. Flip these two expectations to 0 and
     * add the third bucket if the club wants UPI to mean "money in the UPI
     * account".
     */
    it("currently reports a wallet payment as UPI (see note above)", () => {
        const s = splitOf({ amount: 960, paymentMethod: "wallet", cashAmount: 0, upiAmount: 0 });
        expect(s.upi).toBe(960);
    });

    it("currently reports a card payment as UPI (see note above)", () => {
        const s = splitOf({ amount: 500, paymentMethod: "card", cashAmount: 0, upiAmount: 0 });
        expect(s.upi).toBe(500);
    });

    /**
     * The worst case: the method says CASH, the zeros say nothing, and the money
     * was reported as UPI — the opposite tender. A cashier counting the drawer
     * against this figure is short and has no way to see why.
     */
    it("reports a cash payment written with a zero split as CASH", () => {
        const s = splitOf({ amount: 240, paymentMethod: "cash", cashAmount: 0, upiAmount: 0 });
        expect(s.cash).toBe(240);
        expect(s.upi).toBe(0);
    });

    it("reports a upi payment written with a zero split as UPI", () => {
        const s = splitOf({ amount: 240, paymentMethod: "upi", cashAmount: 0, upiAmount: 0 });
        expect(s.upi).toBe(240);
        expect(s.cash).toBe(0);
    });
});

describe("splitOf — the legacy rule still applies where it was meant to", () => {
    /**
     * Old records from before recordPayment always stored the split: no split
     * fields at all and no usable method. The club's decision is that these were
     * UPI, and that decision is unchanged — it just no longer swallows payments
     * whose method WAS recorded.
     */
    it("treats a record with no split and no method as UPI", () => {
        const s = splitOf({ amount: 300 });
        expect(s.upi).toBe(300);
    });

    it("keeps cash + upi equal to amount for a partial split", () => {
        const s = splitOf({ amount: 500, paymentMethod: "split", cashAmount: 200, upiAmount: 0 });
        expect(s.cash + s.upi).toBe(500);
    });

    it("never invents revenue when the parts exceed the whole", () => {
        const s = splitOf({ amount: 100, paymentMethod: "split", cashAmount: 90, upiAmount: 90 });
        expect(s.cash + s.upi).toBeCloseTo(100);
    });
});
