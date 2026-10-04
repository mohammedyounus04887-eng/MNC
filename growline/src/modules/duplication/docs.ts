import type { Timestamp } from "firebase-admin/firestore";
import type { LevelResult, ScoreReason } from "./score";

/**
 * The Firestore shape for `duplicationScores`, and the id that keys it.
 *
 * ## One document per coach, and no history
 *
 * The id is `dup_<uid>`: deterministic, for D35's reason and N7's — a scheduled job
 * that reruns must OVERWRITE the reading it wrote three hours ago, not leave a
 * second copy of it beside the first. A query returning two readings for one coach
 * is a bug that only shows up as a number flickering between two values.
 *
 * No trend is stored, and that is deliberate rather than an omission. The window is
 * 28 days and rolls one day at a time, so a day-on-day delta is mostly noise; a
 * meaningful "up 12 since last month" needs a stored series and a sampling interval
 * chosen on purpose, and inventing one to put an arrow on the card would be
 * decoration without behaviour (G6). It is the obvious next thing to build, with a
 * second `kind` of document in this collection holding monthly samples.
 *
 * ## What is NOT in here
 *
 * No names. Not one. The document holds counts of people per level and nothing that
 * identifies any of them — which is what lets a line's activity be summarised at all
 * under P1 (counts flow up the line, identities do not). If a future screen wants
 * "which four people at level 2 have gone quiet", that is a different document with
 * a different rule, and it has to answer the privacy question from scratch.
 *
 * No money, no rate of change, no projection (L4).
 */

export const DUPLICATION_SCORES = "duplicationScores";

/**
 * The uid is used raw. It comes from Firebase Auth, so it is already a safe document
 * id — unlike a level name or a city, which the boards had to hash (N7). Keeping it
 * legible means the Security Rule can name its subject from `resource.data.userId`
 * and a support question can be answered by reading one document id.
 */
export function duplicationScoreDocId(userId: string): string {
  return `dup_${userId}`;
}

export type DuplicationScoreDoc = {
  workspaceId?: string;
  /** The coach whose LINE this is about. Also recoverable from the id. */
  userId: string;
  /** 0–100, or null when there is nothing to measure. Never rendered as zero. */
  score: number | null;
  reason: ScoreReason;
  /** Every level that holds anybody, shallowest first — the breakdown. */
  levels: LevelResult[];
  /** Eligible people across the three measured levels. */
  lineSize: number;
  /** People who joined too recently to be counted yet. */
  pendingCount: number;
  deepestLevel: number | null;
  deepestActiveLevel: number | null;
  /**
   * The coach's OWN logging, carried as context and deliberately not part of the
   * score (see score.ts). Stored so the card can show it beside the number without a
   * second query, and so it is obvious to anybody reading the raw document that the
   * two are separate figures.
   */
  own: { daysLogged: number; active: boolean };
  /** The rolling window this reading covers, as local day keys (E1). */
  fromKey: string;
  toKey: string;
  windowDays: number;
  timeZone: string;
  generatedAt: Timestamp;
};
