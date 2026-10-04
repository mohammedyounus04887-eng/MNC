/**
 * The point of this file is the last describe block: nothing throws.
 *
 * "TypeError: r.toDate is not a function" has taken the member app down more
 * than once, and every one of those was a date field holding something the
 * reader did not expect. These are the shapes that have actually turned up.
 */

import { describe, it, expect } from "vitest";
import { toDateSafe, toMillisSafe } from "@/lib/toDateSafe";

/** Stands in for a Firestore Timestamp without importing the SDK. */
const stamp = (d: Date) => ({ toDate: () => d });

describe("toDateSafe", () => {
    const when = new Date("2026-09-04T14:30:00.000Z");

    it("reads a Firestore Timestamp", () => {
        expect(toDateSafe(stamp(when))?.toISOString()).toBe(when.toISOString());
    });

    it("reads a Timestamp that has been through JSON", () => {
        // This is the one my own menu cache created: JSON.stringify keeps the
        // numbers and drops toDate().
        const json = JSON.parse(JSON.stringify({ seconds: 1788575400, nanoseconds: 0 }));
        expect(toDateSafe(json)?.getTime()).toBe(1788575400 * 1000);
    });

    it("reads the admin SDK's underscored shape", () => {
        expect(toDateSafe({ _seconds: 1788575400, nanoseconds: 0 })?.getTime())
            .toBe(1788575400 * 1000);
    });

    it("reads a Date, a string and epoch millis", () => {
        expect(toDateSafe(when)?.toISOString()).toBe(when.toISOString());
        expect(toDateSafe("2026-09-04")?.getUTCFullYear()).toBe(2026);
        expect(toDateSafe(when.getTime())?.toISOString()).toBe(when.toISOString());
    });

    it("treats a small number as seconds, not milliseconds", () => {
        // 1788575400 as millis would be 1970. Seconds is the only sane reading.
        expect(toDateSafe(1788575400)?.getUTCFullYear()).toBe(2026);
    });

    it("returns null for every kind of nothing", () => {
        for (const v of [null, undefined, "", 0]) {
            expect(toDateSafe(v)).toBeNull();
        }
    });

    it("returns null rather than an Invalid Date", () => {
        expect(toDateSafe("not a date")).toBeNull();
        expect(toDateSafe({ seconds: "nope" })).toBeNull();
        expect(toDateSafe(NaN)).toBeNull();
    });

    it("survives a toDate() that throws", () => {
        const hostile = { toDate: () => { throw new Error("boom"); } };
        expect(toDateSafe(hostile)).toBeNull();
    });
});

describe("toMillisSafe", () => {
    it("gives millis, or the fallback when there is no date", () => {
        expect(toMillisSafe(stamp(new Date(5000)))).toBe(5000);
        expect(toMillisSafe(null)).toBe(0);
        expect(toMillisSafe(undefined, -1)).toBe(-1);
    });
});

describe("it never throws — the whole reason this exists", () => {
    const nasty: unknown[] = [
        null, undefined, "", 0, NaN, Infinity, -1,
        "not a date", "2026-13-45",
        {}, [], [1, 2], true, false,
        { seconds: null }, { seconds: "x" }, { toDate: null }, { toDate: 42 },
        { toDate: () => { throw new Error("boom"); } },
        { toDate: () => "not a date" },
        new Date("invalid"),
        Symbol("s"), () => {},
    ];

    it.each(nasty.map((v, i) => [i, v]))("input %i", (_i, value) => {
        expect(() => toDateSafe(value)).not.toThrow();
        const out = toDateSafe(value);
        // Whatever comes back is either a usable Date or null — never an
        // Invalid Date, which formats as "Invalid Date" on screen.
        if (out !== null) expect(Number.isNaN(out.getTime())).toBe(false);
    });
});
