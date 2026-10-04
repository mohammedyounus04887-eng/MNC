/**
 * The criterion registry — the data model this feature is actually about (F14).
 *
 * ## The shape, and why it is a LIST of typed pairs
 *
 * A qualification is `{ criteria: [{ type, target }, …] }`: an array of
 * `Criterion`, each naming one entry in the table below and the number that clears
 * it. Any combination, in any order, each with its own target.
 *
 * The obvious alternative — five nullable fields on the qualification document
 * (`volumeTarget`, `membersTarget`, …) — was rejected before anything was written,
 * because of what the sixth criterion costs under each:
 *
 *   five fields          a schema change, a migration, a new branch in the evaluator,
 *                        a new branch in every progress renderer, a new key in the
 *                        summary map, and a rules change if the field is validated.
 *   a list of pairs      one entry in CRITERION_SPECS and one case in the collector.
 *                        Nothing that iterates `criteria` has to be edited at all —
 *                        the tracker, the nudge, the qualifier list, the drop-off
 *                        table and the reminder copy all loop over what is there.
 *
 * That is the whole design. Everything downstream is written as a loop over
 * `criteria` and a lookup in this table, never as five named branches, and the unit
 * suite asserts that a criterion type added here needs no other file to change.
 *
 * ## Two ways a number can be measured, and why the distinction is in the table
 *
 *   windowed     the underlying rows are stamped with a time, so the value IS a count
 *                inside the window: prospects captured, members added, coaches
 *                recruited, days logged. Nothing needs remembering.
 *
 *   cumulative   only a running total exists. Volume is a monthly cumulative figure
 *                by construction (F7, D30) with no per-day history — N4 records that
 *                same limitation on the boards. Counting the month's whole figure
 *                would credit a coach for points earned before the qualification was
 *                announced, which is padding of exactly the kind the brief forbids.
 *                So a cumulative criterion is measured against a BASELINE captured
 *                when the coach enters the qualification, and progress is the
 *                difference.
 *
 * A future criterion declares which it is and the evaluator does the rest.
 *
 * ## RULES L4 — there is no money in this file and there must never be
 *
 * Every unit here is a count: points, people, coaches, days. A qualification is the
 * second-easiest screen in this app on which to write "₹" or "at this rate you
 * would…", after a leaderboard. The copy therefore lives in this table and is
 * asserted by tests/qualifications.test.ts rather than reviewed by eye.
 *
 * PURE ONLY — no database import. The create form is a client component (E2).
 */

export const CRITERION_TYPES = [
  "volume",
  "newMembers",
  "newCoaches",
  "daysActive",
  "prospects",
] as const;

export type CriterionType = (typeof CRITERION_TYPES)[number];

export function isCriterionType(v: unknown): v is CriterionType {
  return typeof v === "string" && (CRITERION_TYPES as readonly string[]).includes(v);
}

/** One condition and the number that clears it. */
export type Criterion = { type: CriterionType; target: number };

export type MeasureMode = "windowed" | "cumulative";

export type CriterionSpec = {
  id: CriterionType;
  /** Simple words (S6). Never "engagement", never "conversion". */
  title: string;
  /** One line: what this counts. */
  blurb: string;
  /** Where the number comes from, so nobody has to guess why theirs is what it is. */
  source: string;
  /** What to do to move it. Shown on an unmet criterion and in the nudge. */
  howTo: string;
  unit: { one: string; many: string };
  measure: MeasureMode;
  /** Largest target this criterion accepts. Six figures for points; counts are small. */
  max: number;
  /**
   * True when the value has a companion figure the coach has claimed but nobody has
   * checked. Only volume has one, and it is never added to the value — see
   * `evaluate.ts`.
   */
  hasUnchecked: boolean;
  /** The plain-language gap. "2 members away" — the brief's own example. */
  remaining: (n: number) => string;
};

export const CRITERION_SPECS: Record<CriterionType, CriterionSpec> = {
  volume: {
    id: "volume",
    title: "Volume points",
    blurb: "Points your upline has checked and approved.",
    source: "From your monthly target, once a proof has been approved.",
    howTo: "Update your progress on My Target, then ask your upline to check it.",
    unit: { one: "point", many: "points" },
    measure: "cumulative",
    max: 999_999,
    hasUnchecked: true,
    remaining: (n) => `${n.toLocaleString("en-IN")} points away`,
  },
  newMembers: {
    id: "newMembers",
    title: "New members",
    blurb: "New members you logged during this qualification.",
    source: "From your daily log.",
    howTo: "Log today's work and put in the members who joined.",
    unit: { one: "member", many: "members" },
    measure: "windowed",
    max: 9_999,
    hasUnchecked: false,
    remaining: (n) => (n === 1 ? "1 member away" : `${n} members away`),
  },
  newCoaches: {
    id: "newCoaches",
    title: "New coaches",
    blurb: "Coaches who joined your line on your own referral code.",
    source: "From the coaches you brought in yourself.",
    howTo: "Share your invite link with someone ready to start.",
    unit: { one: "coach", many: "coaches" },
    measure: "windowed",
    max: 9_999,
    hasUnchecked: false,
    remaining: (n) => (n === 1 ? "1 coach away" : `${n} coaches away`),
  },
  daysActive: {
    id: "daysActive",
    title: "Days logged",
    blurb: "Days you logged your work during this qualification.",
    source: "From your daily log — one day counts once, however much you did.",
    howTo: "Log today. It takes under a minute.",
    unit: { one: "day", many: "days" },
    measure: "windowed",
    max: 999,
    hasUnchecked: false,
    remaining: (n) => (n === 1 ? "1 more day to log" : `${n} more days to log`),
  },
  prospects: {
    id: "prospects",
    title: "People met",
    blurb: "New people saved to your list during this qualification.",
    source: "From the people you save — walk and talk, or a QR self-fill.",
    howTo: "Save the next person you meet, or let them scan your QR.",
    unit: { one: "person", many: "people" },
    measure: "windowed",
    max: 9_999,
    hasUnchecked: false,
    remaining: (n) => (n === 1 ? "1 more person to meet" : `${n} more people to meet`),
  },
};

export const CRITERION_LIST: CriterionSpec[] = CRITERION_TYPES.map(
  (t) => CRITERION_SPECS[t]
);

/**
 * Does this criterion have to be measured against a baseline?
 *
 * The answer is `measure`, and it is asked THROUGH THIS FUNCTION rather than by
 * comparing a type to a literal. An audit found the evaluator filtering on
 * `c.type === "volume"` instead — behaviourally identical while volume is the only
 * cumulative criterion, and silently wrong the moment a sixth one is added: with no
 * baseline the difference collapses to the raw lifetime total, which is exactly the
 * padding a baseline exists to prevent, and nothing would fail. See N13a.
 */
export function needsBaseline(type: CriterionType): boolean {
  return CRITERION_SPECS[type].measure === "cumulative";
}

/**
 * The criteria in a set that a baseline has to be captured for, in registry order.
 *
 * The evaluator's single source for that question — so adding a sixth cumulative
 * criterion is still one entry in CRITERION_SPECS plus one collector, as the header
 * of this file claims.
 */
export function baselineTypes(criteria: Criterion[]): CriterionType[] {
  return criteria.map((c) => c.type).filter(needsBaseline);
}

/** "3 members", "1 point". Counts only — never a currency, never a projection (L4). */
export function formatAmount(spec: CriterionSpec, n: number): string {
  const shown = n.toLocaleString("en-IN");
  return `${shown} ${n === 1 ? spec.unit.one : spec.unit.many}`;
}

/**
 * Is a criterion target a number this app will store?
 *
 * Integers only, at least one, and inside the type's own ceiling. A target of zero
 * would be a condition that is met before it is announced, which makes a
 * qualification a thing people are handed rather than something they do.
 */
export function isValidTarget(spec: CriterionSpec, target: unknown): boolean {
  return (
    typeof target === "number" &&
    Number.isInteger(target) &&
    target >= 1 &&
    target <= spec.max
  );
}

export type CriteriaCheck =
  | { ok: true; criteria: Criterion[] }
  | { ok: false; error: string };

/**
 * Validates a whole set, in the order the registry declares rather than the order
 * they arrived in — so two qualifications with the same conditions have the same
 * document content, and a diff between them is about the numbers.
 *
 * At least one criterion: a qualification with none is a deadline with no way to
 * meet it, and everybody in the line would be shown "you have qualified" the moment
 * it was created.
 */
export function checkCriteria(raw: unknown): CriteriaCheck {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Choose at least one condition." };
  }
  const byType = new Map<CriterionType, number>();
  for (const item of raw) {
    const type = (item as Criterion | undefined)?.type;
    if (!isCriterionType(type)) {
      return { ok: false, error: "That condition is not one we can count." };
    }
    const spec = CRITERION_SPECS[type];
    const target = (item as Criterion).target;
    if (!isValidTarget(spec, target)) {
      return {
        ok: false,
        error: `Enter a number between 1 and ${spec.max.toLocaleString("en-IN")} for ${spec.title.toLowerCase()}.`,
      };
    }
    // Last one wins rather than erroring: a duplicated type is a client bug, and a
    // Map keyed by type makes the stored document well-formed whatever arrived.
    byType.set(type, target);
  }
  return {
    ok: true,
    criteria: CRITERION_TYPES.filter((t) => byType.has(t)).map((type) => ({
      type,
      target: byType.get(type)!,
    })),
  };
}
