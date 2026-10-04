import { APP_TIMEZONE, dayKey } from "./day";

/**
 * Targets and proof requests (F7).
 *
 * Two hard rules shape everything here:
 *
 *  - Section 5.1 — a level label is ALWAYS the coach's own words. Nothing in this
 *    file may supply, suggest or default a level name, because any direct-selling or
 *    nutrition company's rank names are forbidden anywhere in this app.
 *  - Section 5.3 — a target is a count of points and nothing else. No currency, no
 *    conversion, no projection, no "at this rate you would…". A number and a bar.
 *
 * PURE ONLY — no database import; the progress controls are client components.
 */

export const TARGET_STATUSES = ["active", "achieved", "missed"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const PROOF_STATUSES = [
  "pending",
  "submitted",
  "approved",
  "rejected",
] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** A month's target is a count; six figures is already implausible. */
export const MAX_TARGET_POINTS = 999_999;
export const MAX_NOTE = 280;
export const MAX_LEVEL_NAME = 40;

export function currentMonth(timeZone: string = APP_TIMEZONE, now = new Date()) {
  return dayKey(now, timeZone).slice(0, 7);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "August 2026" from "2026-08", for headings. */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Whole percent, clamped for the bar. Uncapped value is kept separately so a coach
 *  who overshoots still sees that they did. */
export function progressPercent(progress: number, target: number) {
  if (target <= 0) return { pct: 0, clamped: 0 };
  const pct = Math.round((progress / target) * 100);
  return { pct, clamped: Math.max(0, Math.min(100, pct)) };
}

/**
 * Whether a target is met, from the numbers alone.
 *
 * Display uses THIS rather than the stored `status`, which is only refreshed when a
 * target or its progress is written. A row last touched before it was met — an old
 * month, a migrated row — would otherwise show "105%" next to no "Reached" badge and
 * a bar that never turns green, which reads as a bug to the coach.
 */
export function isAchieved(progress: number, target: number): boolean {
  return target > 0 && progress >= target;
}

/**
 * A target's status is derived, never trusted from the client: achieved once the
 * points are in, missed once the month is over without them.
 */
export function deriveStatus(
  progress: number,
  target: number,
  month: string,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): TargetStatus {
  if (target > 0 && progress >= target) return "achieved";
  return month < currentMonth(timeZone, now) ? "missed" : "active";
}

export function isProofStatus(value: unknown): value is ProofStatus {
  return typeof value === "string" && (PROOF_STATUSES as readonly string[]).includes(value);
}

/**
 * Celebration copy for a reached target. Recognition of effort only — no earnings,
 * no rank, no implication of income (Section 5.3).
 */
export function targetReachedMessage(levelName: string | null): string {
  return levelName
    ? `Target reached for ${levelName}. Your line can see this.`
    : "Target reached. Your line can see this.";
}

export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  pending: "Waiting for you",
  submitted: "Sent for checking",
  approved: "Approved",
  rejected: "Needs another look",
};
