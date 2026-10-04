/**
 * Loyalty points — one calculation, read by every screen that shows a number.
 *
 * Points are **not** stored on the member. They are worked out from the records
 * the club already keeps, plus the hand-awarded ones in `loyaltyAwards`. That
 * is deliberate: a stored total is a sixth copy of the truth, and this app's
 * whole problem was copies drifting apart. A member wrongly removed from
 * today's attendance loses the point again the moment it is corrected, with
 * nothing to reconcile.
 *
 * Where each rule's points come from:
 *
 *   Daily Attendance      one point per attendance record in the range
 *   100% Attendance       ten points for each COMPLETED month in which the
 *                         member was present on every day the club was open
 *   Couple Attendance     ten points per day a couple was present together —
 *                         either a single-account couple marked "both" at
 *                         check-in, or two linked members both present
 *   New Guest             ten per guest entered with them as the inviter
 *   UMS Renewal           ten per membership plan payment recorded for them
 *   BTC Session           five per weigh-in recorded by the coordinator
 *   everything else       hand-awarded from Admin, Loyalty
 *
 * The file is in two halves on purpose. `scoreLoyalty` is the rules, and takes
 * plain arrays — no Firestore, no clock — so the awkward parts (a month that
 * is not over, a couple who came on different days) can be tested directly.
 * `computeLoyaltyStandings` only fetches and hands over.
 *
 * Cost: this reads the club's records across the range, so callers should scope
 * it (the leaderboard runs it for a month, or from the club's programme start
 * date) and cache the result rather than calling it on a timer.
 */

import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayLocal } from "@/lib/clubDay";
import { LOYALTY_RULES_BY_ID } from "@/lib/loyaltyProgram";
import { fetchLoyaltyAwards } from "@/lib/loyaltyAwards";

export interface LoyaltyBreakdownItem {
    ruleId: string;
    label: string;
    /** How many times it happened. */
    count: number;
    /** Points earned from this rule. */
    points: number;
}

export interface LoyaltyStanding {
    memberId: string;
    name: string;
    /** The human club id printed on the card (MNC-A-183), when they have one. */
    memberCode: string;
    photo: string;
    points: number;
    /** Only the rules that actually earned something, biggest first. */
    breakdown: LoyaltyBreakdownItem[];
}

export interface LoyaltyStandings {
    from: string;
    to: string;
    /** Every member with at least one point, highest first. */
    standings: LoyaltyStanding[];
    /** Members read, including those on zero. */
    memberCount: number;
    /** Days in the range on which the club had anyone in. */
    clubOpenDays: number;
    /** Months fully inside the range that 100% Attendance was judged on. */
    completedMonths: string[];
}

// ─── what the rules need to know ─────────────────────────────────────────

export interface MemberLite {
    id: string;
    name: string;
    memberCode: string;
    photo: string;
    /** The other half of a linked couple — two memberships, one household. */
    couplePartnerId?: string;
}

export interface AttendanceLite {
    memberId: string;
    date: string;
    /** "volunteer" records are club service, not loyalty. */
    type?: string;
    /** Single-account couples: who actually came that day. */
    couplePresence?: string;
}

export interface GuestLite {
    /** Reception writes either the document id or the human code here. */
    invitedByMemberId?: string;
    deleted?: boolean;
}

export interface PaymentLite {
    type?: string;
    memberId?: string | null;
    humanMemberId?: string | null;
    deleted?: boolean;
}

export interface AwardLite {
    memberId: string;
    ruleId: string;
    points: number;
}

export interface LoyaltyInputs {
    members: MemberLite[];
    attendance: AttendanceLite[];
    guests: GuestLite[];
    payments: PaymentLite[];
    /** One entry per BTC weigh-in already filtered to the range. */
    btcSessions: { memberId: string }[];
    awards: AwardLite[];
    /** LOCAL YYYY-MM-DD, inclusive. */
    from: string;
    /** LOCAL YYYY-MM-DD, inclusive. */
    to: string;
    /** Today, so "has this month finished" is decidable without a clock. */
    today: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────

const monthOf = (date: string) => date.slice(0, 7); // YYYY-MM

/** Last day of the month a YYYY-MM belongs to, as YYYY-MM-DD. */
export function monthEnd(month: string): string {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m, 0); // day 0 of the next month is the last of this one
    return todayLocal(d);
}

type Tally = Map<string, { count: number; points: number }>;

function add(tally: Tally, ruleId: string, points: number, count = 1) {
    const cur = tally.get(ruleId) ?? { count: 0, points: 0 };
    cur.count += count;
    cur.points += points;
    tally.set(ruleId, cur);
}

/**
 * Anything that points at a member. Reception has written the inviter as the
 * human code on some guest entries and the document id on others, so both are
 * accepted and resolved to the document id.
 */
function buildResolver(members: MemberLite[]): (raw: unknown) => string | null {
    const byAny = new Map<string, string>();
    for (const m of members) {
        byAny.set(m.id, m.id);
        if (m.memberCode) byAny.set(m.memberCode, m.id);
    }
    return (raw: unknown) => {
        if (typeof raw !== "string" || !raw) return null;
        return byAny.get(raw) ?? byAny.get(raw.trim()) ?? null;
    };
}

// ─── the rules ───────────────────────────────────────────────────────────

/** The whole programme, applied to records already read. No I/O, no clock. */
export function scoreLoyalty(input: LoyaltyInputs): LoyaltyStandings {
    const { members, from, to, today } = input;

    const memberById = new Map(members.map((m) => [m.id, m]));
    const resolve = buildResolver(members);

    const tallies = new Map<string, Tally>();
    const tallyFor = (memberId: string): Tally => {
        let t = tallies.get(memberId);
        if (!t) {
            t = new Map();
            tallies.set(memberId, t);
        }
        return t;
    };

    // ── Attendance ───────────────────────────────────────────────────────
    // One pass builds all three attendance-based rules plus the club's open
    // days, so the same records are never walked twice.
    const daysPresent = new Map<string, Set<string>>(); // memberId to dates
    const coupleBothDays = new Map<string, Set<string>>(); // memberId to dates
    const openDays = new Set<string>();

    for (const a of input.attendance) {
        if (a.type === "volunteer") continue; // volunteer hours are not loyalty
        if (!a.memberId || !a.date) continue;
        if (!memberById.has(a.memberId)) continue;
        if (a.date < from || a.date > to) continue;

        openDays.add(a.date);
        let set = daysPresent.get(a.memberId);
        if (!set) {
            set = new Set();
            daysPresent.set(a.memberId, set);
        }
        set.add(a.date);

        // Single-account couple: one membership, two people, and the
        // receptionist recorded who actually came.
        if (a.couplePresence === "both") {
            let cs = coupleBothDays.get(a.memberId);
            if (!cs) {
                cs = new Set();
                coupleBothDays.set(a.memberId, cs);
            }
            cs.add(a.date);
        }
    }

    // Linked couples: two separate memberships that are partners. They earn the
    // couple point on any day both of them were marked present.
    for (const m of members) {
        if (!m.couplePartnerId) continue;
        const mine = daysPresent.get(m.id);
        const theirs = daysPresent.get(m.couplePartnerId);
        if (!mine || !theirs) continue;
        let cs = coupleBothDays.get(m.id);
        if (!cs) {
            cs = new Set();
            coupleBothDays.set(m.id, cs);
        }
        for (const date of mine) if (theirs.has(date)) cs.add(date);
    }

    for (const [memberId, dates] of daysPresent) {
        add(tallyFor(memberId), "daily_attendance", dates.size * 1, dates.size);
    }
    for (const [memberId, dates] of coupleBothDays) {
        if (dates.size) add(tallyFor(memberId), "couple_attendance", dates.size * 10, dates.size);
    }

    // ── 100% Attendance ──────────────────────────────────────────────────
    // Judged per month, and only on months that have finished. Mid-month a
    // member is on course for it, not entitled to it, and a number that can go
    // down is worse than one that arrives late.
    const openByMonth = new Map<string, Set<string>>();
    for (const date of openDays) {
        const mo = monthOf(date);
        let s = openByMonth.get(mo);
        if (!s) {
            s = new Set();
            openByMonth.set(mo, s);
        }
        s.add(date);
    }
    const completedMonths: string[] = [];
    for (const [mo, dates] of [...openByMonth].sort()) {
        // The month must be over, and the range must actually cover all of it,
        // otherwise "every open day" only means "every open day we looked at".
        if (monthEnd(mo) >= today) continue;
        if (monthEnd(mo) > to || `${mo}-01` < from) continue;
        if (dates.size === 0) continue;
        completedMonths.push(mo);
        for (const [memberId, present] of daysPresent) {
            let all = true;
            for (const date of dates) {
                if (!present.has(date)) {
                    all = false;
                    break;
                }
            }
            if (all) add(tallyFor(memberId), "full_attendance", 10);
        }
    }

    // ── New Guest ────────────────────────────────────────────────────────
    for (const g of input.guests) {
        if (g.deleted) continue;
        const memberId = resolve(g.invitedByMemberId);
        if (!memberId) continue;
        add(tallyFor(memberId), "new_guest", 10);
    }

    // ── UMS Renewal ──────────────────────────────────────────────────────
    for (const p of input.payments) {
        if (p.deleted) continue;
        if (p.type !== "plan_purchase") continue;
        const memberId = resolve(p.memberId) ?? resolve(p.humanMemberId);
        if (!memberId) continue;
        add(tallyFor(memberId), "ums_renewal", 10);
    }

    // ── BTC Session ──────────────────────────────────────────────────────
    for (const w of input.btcSessions) {
        const memberId = resolve(w.memberId);
        if (!memberId) continue;
        add(tallyFor(memberId), "btc_session", 5);
    }

    // ── Hand-awarded ─────────────────────────────────────────────────────
    for (const a of input.awards) {
        const memberId = resolve(a.memberId);
        if (!memberId) continue;
        add(tallyFor(memberId), a.ruleId, Number(a.points) || 0);
    }

    // ── Rank ─────────────────────────────────────────────────────────────
    const standings: LoyaltyStanding[] = [];
    for (const [memberId, tally] of tallies) {
        const m = memberById.get(memberId);
        if (!m) continue;
        const breakdown: LoyaltyBreakdownItem[] = [...tally]
            .map(([ruleId, v]) => ({
                ruleId,
                label: LOYALTY_RULES_BY_ID[ruleId]?.label ?? ruleId,
                count: v.count,
                points: v.points,
            }))
            // A manual adjustment may be negative, so the total is the sum of
            // everything — only entries worth exactly nothing are hidden.
            .filter((b) => b.points !== 0)
            .sort((a, b) => b.points - a.points);
        const points = breakdown.reduce((s, b) => s + b.points, 0);
        if (points <= 0) continue;
        standings.push({ memberId, name: m.name, memberCode: m.memberCode, photo: m.photo, points, breakdown });
    }

    // Highest first; a tie is broken by name so the order never jitters between
    // two loads of the same data.
    standings.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    return {
        from,
        to,
        standings,
        memberCount: members.length,
        clubOpenDays: openDays.size,
        completedMonths,
    };
}

// ─── reading the records ─────────────────────────────────────────────────

export interface ComputeInput {
    clubId: string;
    /** LOCAL YYYY-MM-DD, inclusive. */
    from: string;
    /** LOCAL YYYY-MM-DD, inclusive. */
    to: string;
}

export async function computeLoyaltyStandings(input: ComputeInput): Promise<LoyaltyStandings> {
    const { clubId, from, to } = input;

    const [memberSnap, attSnap, guestSnap, paySnap, awards, btcSessions] = await Promise.all([
        getDocs(collection(db, "clubs", clubId, "members")),
        getDocs(
            query(
                collectionGroup(db, "attendance"),
                where("clubId", "==", clubId),
                where("date", ">=", from),
                where("date", "<=", to),
            ),
        ),
        getDocs(
            query(
                collection(db, "clubs", clubId, "guestEntries"),
                where("date", ">=", from),
                where("date", "<=", to),
            ),
        ),
        getDocs(
            query(
                collection(db, "clubs", clubId, "payments"),
                where("date", ">=", from),
                where("date", "<=", to),
            ),
        ),
        fetchLoyaltyAwards(clubId, from, to),
        fetchBtcWeighIns(clubId, from, to),
    ]);

    // Members, stripped to what a leaderboard needs. The full documents carry a
    // 128-number face descriptor each, and reading those into a list of 200 is
    // what made the reception screen crawl.
    const members: MemberLite[] = memberSnap.docs.map((d) => {
        const v = d.data() as Record<string, unknown>;
        return {
            id: d.id,
            name: String(v.name ?? v.fullName ?? "Unnamed"),
            memberCode: String(v.memberId ?? ""),
            photo: String(v.photo ?? v.photoUrl ?? ""),
            couplePartnerId: typeof v.couplePartnerId === "string" ? v.couplePartnerId : undefined,
        };
    });

    const attendance: AttendanceLite[] = attSnap.docs.map((d) => {
        const v = d.data() as Record<string, unknown>;
        return {
            // Older records were filed under a generated id rather than the
            // date, and a few never carried userId — the parent document is
            // the member either way.
            memberId: typeof v.userId === "string" ? v.userId : (d.ref.parent.parent?.id ?? ""),
            date: typeof v.date === "string" ? v.date : d.id,
            type: typeof v.type === "string" ? v.type : undefined,
            couplePresence: typeof v.couplePresence === "string" ? v.couplePresence : undefined,
        };
    });

    const guests: GuestLite[] = guestSnap.docs.map((d) => {
        const v = d.data() as Record<string, unknown>;
        const invitedBy = v.invitedBy as { memberId?: string } | undefined;
        return { invitedByMemberId: invitedBy?.memberId, deleted: !!v.deleted };
    });

    const payments: PaymentLite[] = paySnap.docs.map((d) => {
        const v = d.data() as Record<string, unknown>;
        return {
            type: typeof v.type === "string" ? v.type : undefined,
            memberId: typeof v.memberId === "string" ? v.memberId : null,
            humanMemberId: typeof v.humanMemberId === "string" ? v.humanMemberId : null,
            deleted: !!v.deleted,
        };
    });

    return scoreLoyalty({
        members,
        attendance,
        guests,
        payments,
        btcSessions,
        awards: awards.map((a) => ({ memberId: a.memberId, ruleId: a.ruleId, points: a.points })),
        from,
        to,
        today: todayLocal(),
    });
}

// ─── BTC weigh-ins ───────────────────────────────────────────────────────

/**
 * Every weigh-in the coordinator recorded in the range, across all challenges.
 *
 * Weigh-ins live under each challenge rather than in one collection, and there
 * are only a handful of challenges with a few hundred weigh-ins between them,
 * so reading them per challenge is cheaper than a collection-group index that
 * would have to be deployed first.
 */
async function fetchBtcWeighIns(
    clubId: string,
    from: string,
    to: string,
): Promise<{ memberId: string; date: string }[]> {
    try {
        const challenges = await getDocs(collection(db, "clubs", clubId, "btcChallenges"));
        if (challenges.empty) return [];
        const perChallenge = await Promise.all(
            challenges.docs.map((c) =>
                getDocs(collection(db, "clubs", clubId, "btcChallenges", c.id, "weighIns")).catch(
                    () => null,
                ),
            ),
        );
        const out: { memberId: string; date: string }[] = [];
        for (const snap of perChallenge) {
            if (!snap) continue;
            for (const d of snap.docs) {
                const v = d.data() as Record<string, unknown>;
                const memberId = typeof v.memberId === "string" ? v.memberId : "";
                if (!memberId) continue;
                const recordedAt = v.recordedAt as { toDate?: () => Date } | undefined;
                const when = recordedAt?.toDate?.();
                if (!when) continue;
                const date = todayLocal(when);
                if (date < from || date > to) continue;
                out.push({ memberId, date });
            }
        }
        return out;
    } catch {
        // A club with no BTC set up, or rules that decline the read. The rest
        // of the leaderboard is still correct without it.
        return [];
    }
}
