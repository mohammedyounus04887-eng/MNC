import type { GoalSheet } from "./model";

/**
 * The month-end goal review (A1).
 *
 * ## Why a sheet needs one at all
 *
 * A goal sheet filled once in March and never opened again is a diary entry, not a working
 * document. The reason coaches abandon written goals is that nothing ever asks about them,
 * so the sheet quietly becomes a record of who they were in March and the target
 * conversation drifts away from it. The review is the ask.
 *
 * ## No clock in this file
 *
 * Every function takes the day key it should reason about. RULES E1 exists because a
 * `new Date()` here would be a UTC day, and a coach in IST would get their review five and
 * a half hours early on the wrong date — which for a month-boundary feature means on the
 * wrong MONTH. The caller passes a key that already went through day.ts.
 */

/**
 * Days in a calendar month. `Date.UTC(y, m, 0)` is the last day of month `m` because day
 * zero of the next month rolls back one — the same explicit-components idiom `shiftKey`
 * uses. This is calendar arithmetic on numbers the caller supplied, not a reading of the
 * clock, so E1 is satisfied: there is no "now" anywhere in it.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The window in which the review appears — the last stretch of the month. */
export const REVIEW_WINDOW_DAYS = 5;

export function isReviewTime(dayKey: string): boolean {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  return d > daysInMonth(y, m) - REVIEW_WINDOW_DAYS;
}

export type MonthReview = {
  /** "YYYY-MM" — the month being reviewed, always the one the day key is in. */
  month: string;
  daysLeft: number;
  targetPoints: number | null;
  progressPoints: number | null;
  /** Whether the target was reached. Null when there was no target to reach. */
  reached: boolean | null;
  actionsDone: number;
  actionsTotal: number;
  /**
   * Whether the 90-day goal is worth re-reading.
   *
   * True whenever they wrote one, because the question at month end is not "did you fail"
   * — it is "is this still what you want". A goal that survives the question unchanged is
   * a goal they have re-chosen, which is worth as much as a revised one.
   */
  revisitShortTerm: boolean;
  /**
   * The one line the card leads with.
   *
   * Never a verdict on the person. A coach who missed a target is told the number and
   * asked what got in the way — not that they fell short. RULES L4 also means nothing here
   * can mention money, and nothing here can promise what next month will bring.
   */
  headline: string;
};

export function buildMonthReview(params: {
  dayKey: string;
  sheet: Pick<GoalSheet, "shortTermGoal" | "shortTermByKey">;
  targetPoints: number | null;
  progressPoints: number | null;
  actionsDone: number;
  actionsTotal: number;
}): MonthReview | null {
  const { dayKey } = params;
  if (!isReviewTime(dayKey)) return null;

  const [y, m, d] = dayKey.split("-").map(Number);
  const month = dayKey.slice(0, 7);
  const daysLeft = daysInMonth(y, m) - d;

  const target = params.targetPoints;
  const progress = params.progressPoints;
  const reached =
    target !== null && target > 0 && progress !== null ? progress >= target : null;

  let headline: string;
  if (reached === true) {
    headline = "You got there. Worth writing down what worked.";
  } else if (reached === false) {
    // Framed as the gap and the days remaining, not as a shortfall. There is still a
    // month left to work in, and the point of this card is the next conversation.
    const left = Math.max(0, (target ?? 0) - (progress ?? 0));
    headline =
      daysLeft > 0
        ? `${left.toLocaleString("en-IN")} points to go, ${daysLeft} ${
            daysLeft === 1 ? "day" : "days"
          } left.`
        : "The month is done. What got in the way?";
  } else {
    headline = "No target this month. Worth agreeing one with your upline.";
  }

  return {
    month,
    daysLeft,
    targetPoints: target,
    progressPoints: progress,
    reached,
    actionsDone: params.actionsDone,
    actionsTotal: params.actionsTotal,
    revisitShortTerm: params.sheet.shortTermGoal.trim().length > 0,
    headline,
  };
}
