import { createHash } from "crypto";
import type { Timestamp } from "firebase-admin/firestore";
import type { ScopeType } from "@/modules/shared-new/scopes";
import type { WindowId } from "@/modules/shared-new/period";
import type { MetricId } from "./metrics";
import type { RankedEntry } from "./ranking";

/**
 * Document shapes and ids for `leaderboardSnapshots`.
 *
 * ## Three kinds of document in one collection, and why
 *
 * This module is allowed exactly one new collection for boards, so the three things
 * it must store live in it side by side, separated by a `kind` field:
 *
 *   podium  the top 3 of one board, plus what board it is. Readable by a client that
 *           belongs to the scope — the Security Rule proves membership.
 *   roster  the FULL ranked list and the participant count. Denied to every client,
 *           deliberately: it is the bottom-to-the-top ordering the brief forbids
 *           anyone from seeing, and the server slices each coach's upward-only
 *           window out of it (see ranking.ts).
 *   optOut  one per coach who has asked not to be listed.
 *
 * Splitting podium from roster is not tidiness. If a single document carried both,
 * "readable by members of the scope" would hand every member the whole ordering,
 * and the no-last-place guarantee would hold only in the UI — which is exactly the
 * "the UI hiding it proves nothing" failure that RULES P2 exists to stop.
 *
 * ## Why the opt-out flag lives here
 *
 * It belongs on the user document and cannot go there: this branch may not write to
 * an existing collection. So it is a document in this one, keyed by uid. The costs,
 * accepted knowingly:
 *
 *   - the compute job reads every opt-out document each run (one `kind` query),
 *     rather than getting the flag free with the user it already loaded;
 *   - a deleted user leaves an orphan. It fails safe — an orphan means "not listed";
 *   - nothing else in the app can see the flag, so a future Settings screen has to
 *     read this collection rather than the user's own document.
 *
 * When a session is allowed to touch `users`, this becomes a boolean there and the
 * migration is one script.
 *
 * ## Ids are deterministic
 *
 * Same reasoning as D35: a rerun of the compute job must overwrite the board it
 * wrote last hour, not add a second copy of it. `scopeKey` can be free text (a level
 * name, a city) so it is hashed into the id and stored in full in the document.
 */

export const LEADERBOARD_COLLECTION = "leaderboardSnapshots";

export type SnapshotKind = "podium" | "roster" | "optOut";

export type BoardIdentity = {
  /** Required by live writers/readers; omitted only by legacy pure ID fixtures. */
  workspaceId?: string;
  metric: MetricId;
  window: WindowId;
  /** "2026-08" for monthly, the Monday's day key for weekly. */
  periodKey: string;
  scopeType: ScopeType;
  scopeKey: string;
};

/** Short, collision-resistant, and safe in a document id whatever the label was. */
function scopeHash(scopeKey: string): string {
  return createHash("sha256").update(scopeKey).digest("hex").slice(0, 16);
}

function boardSuffix(b: BoardIdentity): string {
  return `${b.workspaceId ? `ws_${scopeHash(b.workspaceId)}_` : ""}${b.metric}_${b.window}_${b.periodKey}_${b.scopeType}_${scopeHash(b.scopeKey)}`;
}

export function podiumDocId(b: BoardIdentity): string {
  return `pod_${boardSuffix(b)}`;
}

export function rosterDocId(b: BoardIdentity): string {
  return `ros_${boardSuffix(b)}`;
}

export function optOutDocId(userId: string): string {
  return `opt_${userId}`;
}

export type BoardDoc = BoardIdentity & {
  kind: "podium" | "roster";
  /** Neutral description of the group, for logs and admin. The UI labels it itself. */
  scopeLabel: string;
  entries: RankedEntry[];
  generatedAt: Timestamp;
};

/** Roster only. Never copied onto the podium document — see ranking.ts. */
export type RosterDoc = BoardDoc & { kind: "roster"; participantCount: number };

export type OptOutDoc = {
  kind: "optOut";
  userId: string;
  optedOutAt: Timestamp;
};
