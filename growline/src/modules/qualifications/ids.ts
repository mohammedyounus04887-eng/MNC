import { createHash } from "crypto";

/**
 * Document ids for the two qualification collections.
 *
 * Separated from `docs.ts` for one practical reason: that file opens a Firestore
 * handle, and these functions are pure enough to unit-test. `tests/qualifications.test.ts`
 * runs under `node --test` with no environment, where importing firebase-admin
 * throws before a single assertion runs. Leaderboards' `snapshots.ts` keeps ids
 * db-free for the same reason.
 *
 * ## Deterministic, for D35's reason
 *
 * The evaluator runs repeatedly over the same people, so every row it writes has to
 * overwrite the one it wrote last time rather than accumulate a copy per run.
 *
 * The qualification's own id is a hash of (creator, title, deadline) rather than an
 * auto-id, and that buys something worth having: a double-tapped Create button lands
 * on the same document instead of putting identical twins on a whole line's screen,
 * with no way to tell which is real and no delete to fix it. The route refuses an id
 * that already exists, so this is never a silent overwrite of live conditions.
 */

const SEPARATOR = "__";

export function qualificationDocId(
  creatorId: string,
  title: string,
  deadlineKey: string
): string {
  /**
   * The title is free text: any length, any character, possibly a "/" which Firestore
   * forbids in an id. So identity goes through a hash and the title is stored in full
   * on the document.
   *
   * Normalised for case and surrounding space and nothing else — the same two
   * operations these modules normalise every free-text key with (N5), so "Summer
   * Push" and "summer push " on one day are one qualification rather than two.
   */
  const key = `${creatorId}${SEPARATOR}${title.trim().toLowerCase()}${SEPARATOR}${deadlineKey}`;
  return `qual_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function progressDocId(qualificationId: string, userId: string): string {
  return `qp_${qualificationId}${SEPARATOR}${userId}`;
}

export function summaryDocId(qualificationId: string): string {
  return `qs_${qualificationId}`;
}
