/**
 * The Loyalty Program — one definition, every screen.
 *
 * The club announced this on a slide: eleven ways to earn points, three gift
 * tiers you can spend them on. That slide is now this file. The TV board, the
 * leaderboard and the admin award screen all read it, so the wall and the app
 * can never drift apart — which is exactly how the rest of this app grew five
 * copies of the same rule.
 *
 * Change a point value here and it changes everywhere, including the numbers
 * already on the leaderboard (they are calculated, not stored).
 */

/** How a rule's points are produced. */
export type LoyaltySource =
    /** Calculated from what the club already records. Nobody types it in. */
    | "auto"
    /** Someone at the club awards it by hand from Admin → Loyalty. */
    | "manual";

export interface LoyaltyRule {
    /** Stable id — stored on manual award documents, so never rename one. */
    id: string;
    /** Exactly as written on the club's slide. */
    label: string;
    /** Points per occurrence. `null` = variable, decided when awarded (PPV). */
    points: number | null;
    /** What the slide prints in the points column. */
    pointsLabel: string;
    source: LoyaltySource;
    /** Plain-language note shown under the rule on the admin screen. */
    note: string;
}

/**
 * The eleven earning rules, in the order they appear on the club's slide.
 *
 * "auto" means the app already records the thing itself, so the points appear
 * without anyone entering them. "manual" means nothing in the app knows the
 * event happened yet — a volunteer records it from Admin → Loyalty.
 */
export const LOYALTY_RULES: LoyaltyRule[] = [
    {
        id: "ums_renewal",
        label: "UMS Renewal (ON Time)",
        points: 10,
        pointsLabel: "10 points",
        source: "auto",
        note: "Counted from every membership plan payment recorded for the member.",
    },
    {
        id: "daily_attendance",
        label: "Daily Attendance",
        points: 1,
        pointsLabel: "1 Point",
        source: "auto",
        note: "One point for each day the member is marked present.",
    },
    {
        id: "full_attendance",
        label: "100% Attendance",
        points: 10,
        pointsLabel: "10 Points",
        source: "auto",
        note: "Awarded for any month the member attended every day the club was open.",
    },
    {
        id: "couple_attendance",
        label: "Couple Attendance",
        points: 10,
        pointsLabel: "Each 10 Points",
        source: "auto",
        note: "Awarded on each day a couple is marked present together at check-in.",
    },
    {
        id: "lifestyle_day",
        label: "Life Style Day",
        points: 10,
        pointsLabel: "10 Points",
        source: "manual",
        note: "Award by hand after a Life Style Day.",
    },
    {
        id: "btc_session",
        label: "BTC Session",
        points: 5,
        pointsLabel: "5 Points",
        source: "auto",
        note: "Counted from BTC weigh-ins recorded by the coordinator.",
    },
    {
        id: "mission_ideal_weight",
        label: "Mission Ideal Weight",
        points: 5,
        pointsLabel: "5 Points",
        source: "manual",
        note: "Award by hand when the member takes part.",
    },
    {
        id: "wellness_living",
        label: "Wellness Living Program",
        points: 5,
        pointsLabel: "5 Points",
        source: "manual",
        note: "Award by hand when the member takes part.",
    },
    {
        id: "new_guest",
        label: "New Guest",
        points: 10,
        pointsLabel: "10 Points",
        source: "auto",
        note: "Counted from guests entered at reception with this member as the inviter.",
    },
    {
        id: "health_talk",
        label: "Health Talk / Home Visit",
        points: 10,
        pointsLabel: "10 Points",
        source: "manual",
        note: "Award by hand after a health talk or a home visit.",
    },
    {
        id: "ppv",
        label: "PPV from your ID",
        points: null,
        pointsLabel: "Equal Points Awarded",
        source: "manual",
        note: "Points equal the PPV — type the number when awarding.",
    },
];

/**
 * Not on the club's slide, and deliberately not printed on the board.
 *
 * The five calculated rules are only as right as the records behind them — a
 * renewal taken late still counts as a renewal, and a guest entered without an
 * inviter earns nobody anything. Rather than let those quietly stand, the club
 * can correct a total here, in the open, with a reason attached. It is the only
 * entry allowed to be negative.
 */
export const LOYALTY_ADJUSTMENT: LoyaltyRule = {
    id: "adjustment",
    label: "Manual adjustment",
    points: null,
    pointsLabel: "As entered",
    source: "manual",
    note: "Corrects a total. May be negative — always write down why.",
};

export const LOYALTY_RULES_BY_ID: Record<string, LoyaltyRule> = Object.fromEntries(
    [...LOYALTY_RULES, LOYALTY_ADJUSTMENT].map((r) => [r.id, r]),
);

/**
 * What a person may award by hand.
 *
 * The five calculated rules are missing on purpose: awarding one of those would
 * add points the club is already counting, and the member would be paid twice
 * for the same visit. Use the adjustment for anything they missed.
 */
export const AWARDABLE_RULES: LoyaltyRule[] = [
    ...LOYALTY_RULES.filter((r) => r.source === "manual"),
    LOYALTY_ADJUSTMENT,
];

/**
 * Official Herbalife India product photography.
 *
 * Every image below is the product's own canister shot from Herbalife's India
 * asset host, addressed by its product code — `pc-<code>-in.png`. They are
 * 1500x770 PNGs with a transparent background, which is why they sit cleanly on
 * the board's dark ground with no cut-out work.
 *
 * Each URL was fetched and checked before being written here: 200, a valid PNG,
 * and the right dimensions. The three skincare items are the **vritilife** line,
 * which is what India sells — the Herbalife SKIN codes used elsewhere (0765 and
 * friends) 404 on this host.
 *
 * They are linked, not copied, so the club is showing Herbalife's own picture of
 * a Herbalife product from Herbalife's own server. If a path ever changes the
 * board degrades to the product name on its own rather than a broken image, and
 * the service worker keeps a long-lived copy so a CDN hiccup mid-service is not
 * visible on the TV.
 */
const HL = "https://www.herbalife.com/assets/market-reusable-assets/emea/india/images/canister";
const shot = (code: string) => `${HL}/pc-${code}-in.png`;

export interface LoyaltyGift {
    name: string;
    /** Product photograph. Optional: the board copes without one. */
    image?: string;
}

/** A gift tier: spend this many points, choose any one product. */
export interface LoyaltyTier {
    points: number;
    /** Choose any one of these. */
    products: LoyaltyGift[];
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
    {
        points: 100,
        products: [
            { name: "Aloe Plus", image: shot("1293") },
            { name: "Triphala", image: shot("186k") },
            { name: "Dino Shake", image: shot("1279") },
            { name: "Cleanser", image: shot("275k") },
        ],
    },
    {
        points: 200,
        products: [
            { name: "Woman's Choice", image: shot("127k") },
            { name: "Moisturizer", image: shot("277k") },
            { name: "Sleep Enhance", image: shot("426k") },
            { name: "Toner", image: shot("315k") },
            { name: "Herbalife Calcium", image: shot("0020") },
        ],
    },
    {
        points: 300,
        products: [
            { name: "H24 Hydrate", image: shot("1458") },
            { name: "Beta Heart", image: shot("051k") },
            { name: "Simply Probiotic", image: shot("025k") },
            { name: "Cell Activator", image: shot("3123") },
        ],
    },
];

/**
 * The heading printed above each column.
 *
 * The club's slide reads "acclimate" and "Acclimated", which is a different
 * word — it means adjusting to a climate. The word meant is **accumulate**, and
 * that is what the board says now. Corrected here deliberately rather than
 * copied faithfully: this goes on a wall in front of members.
 */
export const LOYALTY_HEADINGS = {
    earn: "100% Involvement to accumulate the below Points",
    spend: "Accumulated Points = Below Gift",
    chooseOne: "Choose any one product",
} as const;

/**
 * The highest tier a member has reached, and how far to the next one.
 * Returns `null` for `reached` when they are not at 100 yet.
 */
export function tierProgress(points: number): {
    reached: LoyaltyTier | null;
    next: LoyaltyTier | null;
    toNext: number;
} {
    let reached: LoyaltyTier | null = null;
    for (const t of LOYALTY_TIERS) {
        if (points >= t.points) reached = t;
    }
    const next = LOYALTY_TIERS.find((t) => points < t.points) ?? null;
    return { reached, next, toNext: next ? next.points - points : 0 };
}
