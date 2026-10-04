import { describe, expect, it } from "vitest";
import { parseMagicianTranscript, __internal } from "./parser";
import type { User as Member, Product } from "@/types/firestore";

// ─── fixtures ──────────────────────────────────────────────────────────
// Tests use a tiny made-up roster so failures point at the parser logic,
// not at name-collision corner cases in real data.

const mkMember = (id: string, memberId: string, name: string, extras: Partial<Member> = {}): Member => ({
    id, memberId, name,
    phone: "", email: "", photo: "",
    role: "member", clubId: "club1",
    parentUserId: null, treePath: "", status: "active",
    dob: null, anniversary: null, qrCode: "",
    isClubOwner: false, ownedClubId: null,
    originalClubId: "club1", referredBy: null,
    createdAt: { toMillis: () => 0 } as any,
    updatedAt: { toMillis: () => 0 } as any,
    ...extras,
});

const mkProduct = (id: string, name: string): Product => ({
    id, clubId: "club1", name, category: "shake", price: 100,
    stock: 100, lowStockThreshold: 5,
} as Product);

const members: Member[] = [
    mkMember("u1", "MNC-042", "Prasad Kumar"),
    mkMember("u2", "MNC-088", "Devansh Reddy"),
    mkMember("u3", "MNC-103", "Shekhar Iyer"),
    mkMember("u4", "MNC-117", "Usha Rao"),
    mkMember("u5", "MNC-011", "Suzetta Dsouza"),
    mkMember("u6", "MNC-012", "Sridhar Menon"),
    mkMember("u7", "MNC-013", "Arun Kumar"),
    mkMember("u8", "MNC-014", "Vinod P"),
    mkMember("u9", "MNC-015", "Gowri S"),
    // Couple
    mkMember("u10", "MNC-020", "Ramesh A", { couplePartnerId: "u11", gender: "male", coupleId: "c1" }),
    mkMember("u11", "MNC-021", "Latha A", { couplePartnerId: "u10", gender: "female", coupleId: "c1" }),
];

const specials: Product[] = [
    mkProduct("p1", "Mango Tango"),
    mkProduct("p2", "Strawberry Burst"),
    mkProduct("p3", "Banana Caramel"),
    mkProduct("p4", "Special Shake"),
];

// ─── digit normalization ───────────────────────────────────────────────

describe("normalizeDigits", () => {
    const n = __internal.normalizeDigits;

    it("converts spoken digits to numerals", () => {
        expect(n("member zero four two")).toContain("042");
        expect(n("member one")).toContain("1");
    });

    it("composes tens + ones", () => {
        expect(n("member forty two")).toContain("42");
        expect(n("member twenty 5")).toContain("25");
    });

    it("collapses ONLY zero-prefixed digit runs (padded ids)", () => {
        expect(n("0 4 2")).toContain("042");
    });

    it("does NOT collapse non-zero digit runs (those are separate ids)", () => {
        // Critical: "1 2 3" must stay as three separate IDs, never become "123"
        const out = n("for 1 2 3");
        expect(out).not.toContain("123");
        expect(out).toContain("1");
        expect(out).toContain("2");
        expect(out).toContain("3");
    });
});

describe("regression — '1, 2, 3' bug fix", () => {
    it("parses comma-separated single digits as separate ids", () => {
        const r = parseMagicianTranscript({
            transcript: "Mark attendance for 011, 012, 013",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(3);
        expect(r.actions.map((a) => a.memberMatch?.memberId)).toEqual(["MNC-011", "MNC-012", "MNC-013"]);
    });

    it("does NOT merge 'for 1 2 3' into '123'", () => {
        // With the bug, this returned 1 action matched to id 123.
        // After the fix, it should be 3 separate subjects.
        const r = parseMagicianTranscript({
            transcript: "Attendance for 011 012 013",
            members, products: specials,
        });
        // Should be 3 actions, not 1
        expect(r.actions.length).toBeGreaterThanOrEqual(3);
    });
});

describe("name recognition", () => {
    it("matches a single member by first name", () => {
        const r = parseMagicianTranscript({
            transcript: "Mark attendance for Devansh",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        expect(r.actions[0].memberMatch?.id).toBe("u2");
        expect(r.actions[0].status).toBe("ready");
    });

    it("matches by full name", () => {
        const r = parseMagicianTranscript({
            transcript: "Order mango shake for Shekhar Iyer",
            members, products: specials,
        });
        expect(r.actions[0].memberMatch?.id).toBe("u3");
        expect(r.actions[0].itemMatch?.name).toBe("Mango Tango");
    });

    it("flags ambiguous names with candidates", () => {
        // Two "Arun"s would normally exist but our roster has only one
        // Arun. Use "Kumar" which appears twice (Prasad Kumar + Arun Kumar).
        const r = parseMagicianTranscript({
            transcript: "Attendance for Kumar",
            members, products: specials,
        });
        expect(r.actions[0].status).toBe("needs_member");
        expect(r.actions[0].candidates?.length).toBeGreaterThanOrEqual(2);
    });

    it("mixes names and ids in one clause", () => {
        const r = parseMagicianTranscript({
            transcript: "Mango shake for 042, Devansh, 103",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(3);
        expect(r.actions[0].memberMatch?.id).toBe("u1");  // 042
        expect(r.actions[1].memberMatch?.id).toBe("u2");  // Devansh
        expect(r.actions[2].memberMatch?.id).toBe("u3");  // 103
    });

    it("smart-splits space-separated names when each is unambiguous", () => {
        // User reported: "Mark volunteer attendance Vignesh Shek Sujata Ashwini"
        // was being parsed as ONE name phrase. With smart split, each word
        // that uniquely identifies a member becomes a separate subject.
        const r = parseMagicianTranscript({
            transcript: "Mark attendance Devansh Shekhar Usha",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(3);
        expect(r.actions.map((a) => a.memberMatch?.id)).toEqual(["u2", "u3", "u4"]);
    });

    it("does NOT smart-split when individual words are ambiguous (e.g. Arun Kumar)", () => {
        // "Arun Kumar" — splitting would make "Kumar" ambiguous (Prasad
        // Kumar + Arun Kumar). Keep as a single phrase so the candidates
        // list shows the right Arun Kumar specifically.
        const r = parseMagicianTranscript({
            transcript: "Attendance for Arun Kumar",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        expect(r.actions[0].memberMatch?.id).toBe("u7");
    });
});

describe("id + name shortcut", () => {
    it("'Prasad 042' resolves by id, name is just confirmation", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for Prasad 042",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        expect(r.actions[0].memberMatch?.id).toBe("u1");  // 042
    });

    it("'42 Prasad' (id-first form) also resolves by id", () => {
        const r = parseMagicianTranscript({
            transcript: "Order mango for 42 Prasad",
            members, products: specials,
        });
        expect(r.actions[0].memberMatch?.id).toBe("u1");  // 042
        expect(r.actions[0].itemMatch?.name).toBe("Mango Tango");
    });

    it("mixes id+name and pure-name subjects in one clause", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for 42 Prasad, Devansh, 88",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(3);
        expect(r.actions.map((a) => a.memberMatch?.id)).toEqual(["u1", "u2", "u2"]);
    });
});

describe("first day intent", () => {
    it("extracts name, phone, inviter", () => {
        const r = parseMagicianTranscript({
            transcript: "First day for David, number 9876543210, invited by Devansh",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        const a = r.actions[0];
        expect(a.action).toBe("first_day");
        expect(a.firstDay?.name).toBe("David");
        expect(a.firstDay?.phoneDigits).toBe("9876543210");
        expect(a.firstDay?.inviterMatch?.id).toBe("u2");
        expect(a.status).toBe("ready");
    });

    it("accepts compact phone digits without separator words", () => {
        const r = parseMagicianTranscript({
            transcript: "First day David 9876543210 by Prasad",
            members, products: specials,
        });
        expect(r.actions[0].firstDay?.phoneDigits).toBe("9876543210");
        // "Prasad" alone matches Prasad Kumar uniquely (Kumar is a separate person)
        expect(r.actions[0].firstDay?.inviterMatch?.name).toBe("Prasad Kumar");
    });

    it("resolves inviter by member id", () => {
        const r = parseMagicianTranscript({
            transcript: "First day for Anita 9123456789 invited by member 042",
            members, products: specials,
        });
        expect(r.actions[0].firstDay?.inviterMatch?.id).toBe("u1");
    });

    it("flags ambiguous inviter with candidates", () => {
        const r = parseMagicianTranscript({
            transcript: "First day for Vikas 9000000000 invited by Kumar",
            members, products: specials,
        });
        const fd = r.actions[0].firstDay!;
        expect(fd.inviterMatch).toBeNull();
        expect(fd.inviterCandidates?.length).toBeGreaterThanOrEqual(2);
    });

    it("handles a first day with no inviter", () => {
        const r = parseMagicianTranscript({
            transcript: "First day Sneha 9988776655",
            members, products: specials,
        });
        const a = r.actions[0];
        expect(a.firstDay?.name).toBe("Sneha");
        expect(a.firstDay?.inviterMatch).toBeNull();
        expect(a.status).toBe("ready");  // inviter is optional
    });
});

// ─── pattern 1: single member, single action ────────────────────────────

describe("P1 — single member, single action", () => {
    it("marks attendance for one member by id", () => {
        const r = parseMagicianTranscript({
            transcript: "Mark attendance for member 042",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        expect(r.actions[0].action).toBe("attendance");
        expect(r.actions[0].memberMatch?.id).toBe("u1");
    });

    it("orders a shake for one member by id (auto-marks attendance too)", () => {
        const r = parseMagicianTranscript({
            transcript: "Order mango shake for member 088",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        // Ordering at reception implies attendance — they just arrived.
        expect(r.actions[0].action).toBe("both");
        expect(r.actions[0].memberMatch?.id).toBe("u2");
        expect(r.actions[0].itemMatch?.id).toBe("p1");
    });

    it("handles attendance + order in one clause", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance and mango shake for member 042",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(1);
        expect(r.actions[0].action).toBe("both");
        expect(r.actions[0].itemMatch?.id).toBe("p1");
    });
});

// ─── pattern 2: multiple members, same action ───────────────────────────

describe("P2 — multiple members, same action", () => {
    it("orders the same shake for several members", () => {
        const r = parseMagicianTranscript({
            transcript: "Mango shake for members 042, 088, 103",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(3);
        expect(r.actions.map((a) => a.memberMatch?.id)).toEqual(["u1", "u2", "u3"]);
        expect(r.actions.every((a) => a.itemMatch?.id === "p1")).toBe(true);
    });

    it("accepts 'and' as a separator between ids", () => {
        const r = parseMagicianTranscript({
            transcript: "Strawberry for 011 and 012",
            members, products: specials,
        });
        expect(r.actions.map((a) => a.memberMatch?.id)).toEqual(["u5", "u6"]);
    });
});

// ─── pattern 3: range ───────────────────────────────────────────────────

describe("P3 — range", () => {
    it("expands 'to' ranges", () => {
        const r = parseMagicianTranscript({
            transcript: "Strawberry for members 011 to 015",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(5);
        expect(r.actions.map((a) => a.memberMatch?.id)).toEqual(["u5", "u6", "u7", "u8", "u9"]);
    });

    it("rejects absurd ranges to guard against typos", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for 011 to 9999",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(0);
    });
});

// ─── pattern 4: combined complex sentence ───────────────────────────────

describe("P4 — combined", () => {
    it("parses multiple clauses with different items + an 'all' attendance", () => {
        const r = parseMagicianTranscript({
            transcript:
                "Mango for 042, 088. Strawberry for 103, 117. Special for 011 to 013. Mark attendance for all.",
            members, products: specials,
        });
        // 2 mango + 2 strawberry + 3 special + 7 attendance = 14 actions.
        // Order rows are now "both" (order implies attendance), pure-
        // attendance rows from the "for all" clause stay "attendance".
        expect(r.actions).toHaveLength(14);
        const ordersOrBoth = r.actions.filter((a) => a.action === "both");
        const attendances = r.actions.filter((a) => a.action === "attendance");
        expect(ordersOrBoth).toHaveLength(7);
        expect(attendances).toHaveLength(7);
        // All 7 ids should be covered by attendance
        const attendanceIds = new Set(attendances.map((a) => a.memberMatch?.memberId));
        expect(attendanceIds.size).toBe(7);
    });
});

// ─── pattern 5: "for all" ───────────────────────────────────────────────

describe("P5 — 'for all'", () => {
    it("reuses every id mentioned earlier in the session", () => {
        const r = parseMagicianTranscript({
            transcript: "Order mango for 042, 088, 103. Attendance for all.",
            members, products: specials,
        });
        const attendances = r.actions.filter((a) => a.action === "attendance");
        expect(attendances).toHaveLength(3);
        expect(new Set(attendances.map((a) => a.memberMatch?.id))).toEqual(new Set(["u1", "u2", "u3"]));
    });
});

// ─── validation states ─────────────────────────────────────────────────

describe("validation states", () => {
    it("flags unknown member ids as needs_member", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for member 999",
            members, products: specials,
        });
        expect(r.actions[0].status).toBe("needs_member");
    });

    it("flags couple members as needs_couple", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for member 020",
            members, products: specials,
        });
        expect(r.actions[0].status).toBe("needs_couple");
    });

    it("flags duplicate (same member + same action) rows", () => {
        const r = parseMagicianTranscript({
            transcript: "Attendance for 042. Attendance for 042.",
            members, products: specials,
        });
        expect(r.actions[0].status).toBe("ready");
        expect(r.actions[1].status).toBe("duplicate");
    });

    it("flags order rows that couldn't resolve an item", () => {
        const r = parseMagicianTranscript({
            transcript: "Order chocolate cosmic blast for 042",
            members, products: specials,
        });
        expect(r.actions[0].status).toBe("needs_item");
    });
});

// ─── item matching nuance ──────────────────────────────────────────────

describe("item matching", () => {
    it("recognizes 'special' as the Special Shake product", () => {
        // make Special Shake first in the list for the "special" alias
        const ordered = [mkProduct("ps", "Special Shake"), ...specials];
        const r = parseMagicianTranscript({
            transcript: "Special for 042",
            members, products: ordered,
        });
        expect(r.actions[0].itemMatch?.name).toBe("Special Shake");
    });

    it("matches by shared word ('mango' → Mango Tango)", () => {
        const r = parseMagicianTranscript({
            transcript: "Mango for 042",
            members, products: specials,
        });
        expect(r.actions[0].itemMatch?.name).toBe("Mango Tango");
    });

    it("carries item context across clauses when item is unspecified", () => {
        const r = parseMagicianTranscript({
            transcript: "Mango for 042. For 088.",
            members, products: specials,
        });
        expect(r.actions).toHaveLength(2);
        expect(r.actions[1].itemMatch?.name).toBe("Mango Tango");
    });
});
