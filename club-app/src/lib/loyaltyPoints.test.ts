/**
 * The loyalty rules, exercised on their awkward edges.
 *
 * These are the ones worth pinning down: a month that has not finished yet, a
 * couple who came on different days, a guest whose inviter was written as the
 * printed member code rather than the document id, and a correction that takes
 * points off. Everything else is addition.
 */

import { describe, it, expect } from "vitest";
import { scoreLoyalty, monthEnd, type LoyaltyInputs } from "@/lib/loyaltyPoints";
import { tierProgress } from "@/lib/loyaltyProgram";

/**
 * June, read from inside June.
 *
 * `today` sits in the middle of the range on purpose, so the month-end 100%
 * Attendance bonus never fires and each test below measures only the rule it
 * names. The tests that are about that bonus move `today` past the month
 * themselves.
 */
const base = (over: Partial<LoyaltyInputs> = {}): LoyaltyInputs => ({
    members: [],
    attendance: [],
    guests: [],
    payments: [],
    btcSessions: [],
    awards: [],
    from: "2026-06-01",
    to: "2026-06-30",
    today: "2026-06-20",
    ...over,
});

const member = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: id,
    memberCode: `MNC-${id}`,
    photo: "",
    ...over,
});

const pointsOf = (r: ReturnType<typeof scoreLoyalty>, id: string) =>
    r.standings.find((s) => s.memberId === id)?.points ?? 0;

const ruleOf = (r: ReturnType<typeof scoreLoyalty>, id: string, ruleId: string) =>
    r.standings.find((s) => s.memberId === id)?.breakdown.find((b) => b.ruleId === ruleId);

describe("monthEnd", () => {
    it("finds the last day of a month, including February in a leap year", () => {
        expect(monthEnd("2026-06")).toBe("2026-06-30");
        expect(monthEnd("2026-02")).toBe("2026-02-28");
        expect(monthEnd("2024-02")).toBe("2024-02-29");
        expect(monthEnd("2026-12")).toBe("2026-12-31");
    });
});

describe("daily attendance", () => {
    it("gives one point per day and ignores a second record for the same day", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            attendance: [
                { memberId: "a", date: "2026-06-01" },
                { memberId: "a", date: "2026-06-01" },
                { memberId: "a", date: "2026-06-02" },
            ],
        }));
        expect(pointsOf(r, "a")).toBe(2);
    });

    it("does not count volunteer hours as loyalty", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            attendance: [
                { memberId: "a", date: "2026-06-01", type: "volunteer" },
                { memberId: "a", date: "2026-06-02", type: "member" },
            ],
        }));
        expect(pointsOf(r, "a")).toBe(1);
    });

    it("ignores records outside the range and members who no longer exist", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            attendance: [
                { memberId: "a", date: "2026-05-31" },
                { memberId: "a", date: "2026-07-01" },
                { memberId: "ghost", date: "2026-06-02" },
                { memberId: "a", date: "2026-06-02" },
            ],
        }));
        expect(pointsOf(r, "a")).toBe(1);
        expect(r.standings).toHaveLength(1);
    });
});

describe("100% attendance", () => {
    // The club was open on two days that June; "a" came to both, "b" to one.
    // Read in July, so the month is over and the bonus can be judged.
    const june = base({
        today: "2026-07-15",
        members: [member("a"), member("b")],
        attendance: [
            { memberId: "a", date: "2026-06-10" },
            { memberId: "a", date: "2026-06-11" },
            { memberId: "b", date: "2026-06-10" },
        ],
    });

    it("awards ten points only to the member who came every open day", () => {
        const r = scoreLoyalty(june);
        expect(ruleOf(r, "a", "full_attendance")?.points).toBe(10);
        expect(ruleOf(r, "b", "full_attendance")).toBeUndefined();
        expect(r.completedMonths).toEqual(["2026-06"]);
    });

    it("withholds it while the month is still running", () => {
        // Same records, but today is inside June — nobody has finished the month.
        const r = scoreLoyalty({ ...june, today: "2026-06-20" });
        expect(ruleOf(r, "a", "full_attendance")).toBeUndefined();
        expect(r.completedMonths).toEqual([]);
        expect(pointsOf(r, "a")).toBe(2); // the two daily points still stand
    });

    it("withholds it when the range only covers part of the month", () => {
        // Reading 10–30 June cannot prove anyone attended every open day of it.
        const r = scoreLoyalty({ ...june, from: "2026-06-10" });
        expect(ruleOf(r, "a", "full_attendance")).toBeUndefined();
        expect(r.completedMonths).toEqual([]);
    });
});

describe("couple attendance", () => {
    it("awards ten points on a day a single-account couple came together", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            attendance: [
                { memberId: "a", date: "2026-06-10", couplePresence: "both" },
                { memberId: "a", date: "2026-06-11", couplePresence: "husband" },
            ],
        }));
        expect(ruleOf(r, "a", "couple_attendance")?.points).toBe(10);
        expect(ruleOf(r, "a", "couple_attendance")?.count).toBe(1);
    });

    it("awards both halves of a linked couple, only on days they overlap", () => {
        const r = scoreLoyalty(base({
            members: [
                member("a", { couplePartnerId: "b" }),
                member("b", { couplePartnerId: "a" }),
            ],
            attendance: [
                { memberId: "a", date: "2026-06-10" },
                { memberId: "b", date: "2026-06-10" },
                { memberId: "a", date: "2026-06-11" }, // came alone
            ],
        }));
        expect(ruleOf(r, "a", "couple_attendance")?.points).toBe(10);
        expect(ruleOf(r, "b", "couple_attendance")?.points).toBe(10);
    });

    it("awards nothing to a linked couple who never overlap", () => {
        const r = scoreLoyalty(base({
            members: [
                member("a", { couplePartnerId: "b" }),
                member("b", { couplePartnerId: "a" }),
            ],
            attendance: [
                { memberId: "a", date: "2026-06-10" },
                { memberId: "b", date: "2026-06-11" },
            ],
        }));
        expect(ruleOf(r, "a", "couple_attendance")).toBeUndefined();
        expect(ruleOf(r, "b", "couple_attendance")).toBeUndefined();
    });
});

describe("new guests", () => {
    it("credits the inviter whether reception wrote the doc id or the printed code", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            guests: [
                { invitedByMemberId: "a" },
                { invitedByMemberId: "MNC-a" },
            ],
        }));
        expect(ruleOf(r, "a", "new_guest")?.points).toBe(20);
    });

    it("ignores a guest that was deleted, and one with no inviter", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            guests: [
                { invitedByMemberId: "a", deleted: true },
                { invitedByMemberId: undefined },
                { invitedByMemberId: "a" },
            ],
        }));
        expect(ruleOf(r, "a", "new_guest")?.points).toBe(10);
    });
});

describe("renewals and BTC", () => {
    it("counts plan payments only, and never a deleted one", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            payments: [
                { type: "plan_purchase", memberId: "a" },
                { type: "plan_purchase", memberId: "a", deleted: true },
                { type: "product_sale", memberId: "a" },
                { type: "plan_purchase", humanMemberId: "MNC-a" },
            ],
        }));
        expect(ruleOf(r, "a", "ums_renewal")?.points).toBe(20);
    });

    it("gives five points per BTC weigh-in", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            btcSessions: [{ memberId: "a" }, { memberId: "a" }],
        }));
        expect(ruleOf(r, "a", "btc_session")?.points).toBe(10);
    });
});

describe("hand-awarded points", () => {
    it("adds a manual award to the calculated ones", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            attendance: [{ memberId: "a", date: "2026-06-10" }],
            awards: [{ memberId: "a", ruleId: "health_talk", points: 10 }],
        }));
        expect(pointsOf(r, "a")).toBe(11);
    });

    it("lets a negative adjustment take points back off the total", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            payments: [{ type: "plan_purchase", memberId: "a" }], // a late renewal
            attendance: [{ memberId: "a", date: "2026-06-10" }],
            awards: [{ memberId: "a", ruleId: "adjustment", points: -10 }],
        }));
        expect(pointsOf(r, "a")).toBe(1);
    });

    it("drops a member whose points net to nothing", () => {
        const r = scoreLoyalty(base({
            members: [member("a")],
            payments: [{ type: "plan_purchase", memberId: "a" }],
            awards: [{ memberId: "a", ruleId: "adjustment", points: -10 }],
        }));
        expect(r.standings).toHaveLength(0);
    });
});

describe("ranking", () => {
    it("orders by points, then by name so the list never jitters", () => {
        const r = scoreLoyalty(base({
            members: [member("z", { name: "Zara" }), member("a", { name: "Anil" }), member("m", { name: "Meena" })],
            attendance: [
                { memberId: "z", date: "2026-06-01" },
                { memberId: "a", date: "2026-06-01" },
                { memberId: "m", date: "2026-06-01" },
                { memberId: "m", date: "2026-06-02" },
            ],
        }));
        expect(r.standings.map((s) => s.name)).toEqual(["Meena", "Anil", "Zara"]);
    });

    it("reports the club's open days, counted once each", () => {
        const r = scoreLoyalty(base({
            members: [member("a"), member("b")],
            attendance: [
                { memberId: "a", date: "2026-06-01" },
                { memberId: "b", date: "2026-06-01" },
                { memberId: "b", date: "2026-06-02" },
            ],
        }));
        expect(r.clubOpenDays).toBe(2);
        expect(r.memberCount).toBe(2);
    });
});

describe("gift tiers", () => {
    it("knows which gift is unlocked and how far the next one is", () => {
        expect(tierProgress(40)).toMatchObject({ reached: null, toNext: 60 });
        expect(tierProgress(100).reached?.points).toBe(100);
        expect(tierProgress(100).toNext).toBe(100);
        expect(tierProgress(250).reached?.points).toBe(200);
        expect(tierProgress(300).reached?.points).toBe(300);
        expect(tierProgress(300).next).toBeNull();
    });
});
