import type { WindowId } from "@/modules/shared-new/period";

/**
 * The four boards. FOUR, never one with a metric switcher.
 *
 * ## Why this is load-bearing rather than a layout preference
 *
 * One board means one kind of person wins. Volume is the number the top of a line
 * is already best at, so a single volume board ranks the same five people forever
 * and tells everybody else that opening the app is pointless — which is the exact
 * behaviour a leaderboard is supposed to prevent. Four boards means the coach who
 * cannot yet move volume can still be first at meeting people, or at answering every
 * follow-up, or at simply turning up every single day. Each board is winnable by a
 * different person on a different strength.
 *
 * The screen therefore renders all four AT ONCE, stacked, with no metric switcher.
 * A switcher would technically satisfy "four boards" while making three of them
 * something you have to know to go looking for — the second-class outcome the brief
 * names. Scope and week/month are FILTERS (they change which people and which days
 * are in view, not which board matters), so those are controls; the metric is not.
 *
 * ## No money, ever (RULES L4)
 *
 * Every unit here is a count: points, people, follow-ups, days. No ₹, no conversion,
 * no "at this rate you would…". A leaderboard is the single easiest screen in the app
 * on which to break that rule, so the unit lives in this table and the components
 * render `unit` rather than inventing a suffix.
 */

export const METRICS = ["volume", "peopleMet", "followUps", "streak"] as const;
export type MetricId = (typeof METRICS)[number];

export function isMetricId(v: string): v is MetricId {
  return (METRICS as readonly string[]).includes(v);
}

export type MetricSpec = {
  id: MetricId;
  /** Simple words (S6). Never "engagement", never "pipeline analytics". */
  title: string;
  /** One line under the title: what this board is counting. */
  blurb: string;
  /** Teaches a coach how to get onto it. Shown when the board is empty. */
  howToJoin: string;
  unit: { one: string; many: string };
  /**
   * Volume is recorded once a month as a cumulative target figure (F7, D30) — there
   * is no per-day history to slice a week out of. Rather than invent a weekly volume
   * number, the weekly view of this board says so and points at the monthly one.
   */
  windows: readonly WindowId[];
};

export const METRIC_SPECS: Record<MetricId, MetricSpec> = {
  volume: {
    id: "volume",
    title: "Volume",
    blurb: "Points your upline has checked and approved.",
    howToJoin: "Update your progress on My Target, then ask your upline to check it.",
    unit: { one: "point", many: "points" },
    windows: ["monthly"],
  },
  peopleMet: {
    id: "peopleMet",
    title: "People met",
    blurb: "New people saved to your list.",
    howToJoin: "Save the next person you meet — walk and talk, or let them scan your QR.",
    unit: { one: "person", many: "people" },
    windows: ["weekly", "monthly"],
  },
  followUps: {
    id: "followUps",
    title: "Follow-ups done",
    blurb: "Follow-ups you logged as completed.",
    howToJoin: "Log today's work and put in the follow-ups you finished.",
    unit: { one: "follow-up", many: "follow-ups" },
    windows: ["weekly", "monthly"],
  },
  streak: {
    id: "streak",
    title: "Logging streak",
    blurb: "Your longest run of days logged, inside this window.",
    howToJoin: "Log today, then tomorrow. Two days is already a run.",
    unit: { one: "day", many: "days" },
    windows: ["weekly", "monthly"],
  },
};

export function metricsForWindow(window: WindowId): MetricSpec[] {
  return METRICS.map((m) => METRIC_SPECS[m]).filter((m) => m.windows.includes(window));
}

export function formatValue(spec: MetricSpec, value: number): string {
  const n = value.toLocaleString("en-IN");
  return `${n} ${value === 1 ? spec.unit.one : spec.unit.many}`;
}
