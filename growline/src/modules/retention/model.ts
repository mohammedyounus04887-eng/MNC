/**
 * The retention rules, with no database in them (RULES P5, v2 §5.3).
 *
 * Split from `activity.ts` for RULES E2 — and for a second reason that matters more
 * here: `activity.ts` imports the admin SDK, so a test importing it needs credentials or
 * an emulator. The staleness boundary is the single most consequential number in this
 * codebase, because being wrong by one day either destroys a prospect's health data early
 * or keeps it past the window the privacy notice promises. It must be testable in the
 * plain unit suite, with nothing running.
 *
 * PURE ONLY — no imports at all.
 */

/**
 * How stale the stored value must be before a touch writes.
 *
 * A report view is an unauthenticated page load. Writing on every one puts an unbounded
 * write on a public route — a cost bomb, and a trivial way for anybody holding a link to
 * run up a bill. The precision given up is a day against a window of 180, so it cannot
 * change a purge decision.
 */
export const TOUCH_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** v2 §5.3. A config constant, as the spec asks. */
export const RETENTION_DAYS = 180;

/**
 * Whether a prospect's health data is past its retention window.
 *
 * A MISSING value is never stale, and that direction is deliberate. A row the backfill
 * has not reached must not be mistaken for one nobody has touched in six months, because
 * the action it triggers cannot be undone. Keeping data too long is a fixable problem
 * with a script; deleting it early is not fixable at all.
 *
 * A future value is not stale either — a clock skew should not delete anything.
 */
export function isStale(
  lastActivityAt: Date | null,
  retentionDays: number = RETENTION_DAYS,
  now: Date = new Date()
): boolean {
  if (!lastActivityAt) return false;
  return now.getTime() - lastActivityAt.getTime() >= retentionDays * 86_400_000;
}
