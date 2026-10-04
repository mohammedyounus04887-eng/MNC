/**
 * The merge decides how many times a member has renewed.
 *
 * Every virtual renewal writes a payment, and since 2026-06 it also writes a
 * history row — so most renewals exist TWICE. Get the de-dupe wrong and the
 * complete export either doubles everyone's count or hides renewals that only
 * ever made it into payments. Both look plausible on screen, which is why this
 * is pinned down here rather than eyeballed.
 */

import { describe, it, expect } from "vitest";
import { mergeRenewals, renewalDedupeKey, type RenewalLike } from "@/lib/virtualRenewals";

// Annotated as RenewalLike rather than left to inference: without it each
// helper returns its own narrow literal type, and an array mixing them becomes
// a union that neither accepts a payment row nor exposes `backdated`.
const hist = (date: string, amount: number, id = `h_${date}_${amount}`): RenewalLike =>
    ({ id, date, amount, source: "history", planName: "Monthly" });
const pay = (date: string, amount: number, id = `p_${date}_${amount}`): RenewalLike =>
    ({ id, date, amount, source: "payment" });
const fix = (date: string, id: string): RenewalLike =>
    ({ id, date, backdated: true, source: "history" });

describe("renewalDedupeKey", () => {
    it("keys a real renewal on date and amount, so the two copies collapse", () => {
        expect(renewalDedupeKey(hist("2026-03-01", 500)))
            .toBe(renewalDedupeKey(pay("2026-03-01", 500)));
    });

    it("keys each back-dated fix on its own id", () => {
        // Two corrections on one day used to collapse to "2026-03-01|0" and one
        // would silently vanish.
        expect(renewalDedupeKey(fix("2026-03-01", "a")))
            .not.toBe(renewalDedupeKey(fix("2026-03-01", "b")));
    });

    it("rounds the amount so 500 and 500.4 are the same renewal", () => {
        expect(renewalDedupeKey(hist("2026-03-01", 500)))
            .toBe(renewalDedupeKey(pay("2026-03-01", 500.4)));
    });
});

describe("mergeRenewals", () => {
    it("counts a renewal once when both sources have it", () => {
        const merged = mergeRenewals([hist("2026-03-01", 500)], [pay("2026-03-01", 500)]);
        expect(merged).toHaveLength(1);
    });

    it("keeps the richer history row when both exist", () => {
        const merged = mergeRenewals([hist("2026-03-01", 500)], [pay("2026-03-01", 500)]);
        expect(merged[0].source).toBe("history");
        expect((merged[0] as any).planName).toBe("Monthly");
    });

    it("keeps a renewal that only ever reached payments", () => {
        // The case that matters most: everything before the history collection
        // existed lives only here. Dropping it under-reports long-standing
        // members — exactly the people the report is for.
        const merged = mergeRenewals([], [pay("2025-11-01", 500)]);
        expect(merged).toHaveLength(1);
        expect(merged[0].source).toBe("payment");
    });

    it("counts nine monthly renewals as nine, from mixed sources", () => {
        const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
        const history = months.slice(4).map(m => hist(`2026-${m}-05`, 500));   // newer half
        const payments = months.map(m => pay(`2026-${m}-05`, 500));            // all of them
        const merged = mergeRenewals(history, payments);
        expect(merged).toHaveLength(9);
        expect(new Set(merged.map(r => r.date)).size).toBe(9);
    });

    it("returns newest first", () => {
        const merged = mergeRenewals(
            [hist("2026-01-05", 500), hist("2026-03-05", 500), hist("2026-02-05", 500)],
            [],
        );
        expect(merged.map(r => r.date)).toEqual(["2026-03-05", "2026-02-05", "2026-01-05"]);
    });

    it("keeps two different amounts on the same day as two renewals", () => {
        const merged = mergeRenewals([], [pay("2026-03-01", 500), pay("2026-03-01", 750)]);
        expect(merged).toHaveLength(2);
    });

    it("keeps back-dated fixes alongside a real renewal on the same day", () => {
        const merged = mergeRenewals(
            [hist("2026-03-01", 500), fix("2026-03-01", "a"), fix("2026-03-01", "b")],
            [pay("2026-03-01", 500)],
        );
        expect(merged).toHaveLength(3);
        // The export filters these out of the count; they must survive the
        // merge first, or there is nothing to filter.
        expect(merged.filter(r => r.backdated)).toHaveLength(2);
    });

    it("copes with rows that have no date at all", () => {
        const merged = mergeRenewals([], [{ id: "x", amount: 500 } as any]);
        expect(merged).toHaveLength(1);
        expect(() => mergeRenewals([], [{} as any])).not.toThrow();
    });
});
