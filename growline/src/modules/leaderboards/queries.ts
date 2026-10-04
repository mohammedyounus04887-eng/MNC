import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import type { AppUser } from "@/lib/users";
import { APP_TIMEZONE } from "@/lib/day";
import {
  currentPeriod,
  type Period,
  type WindowId,
} from "@/modules/shared-new/period";
import {
  SCOPE_TYPES,
  scopeFor,
  type Scope,
  type ScopeSubject,
  type ScopeType,
} from "@/modules/shared-new/scopes";
import { METRICS, METRIC_SPECS, type MetricId, type MetricSpec } from "./metrics";
import { buildViewerBoard, type RankedEntry, type ViewerBoard } from "./ranking";
import {
  LEADERBOARD_COLLECTION,
  optOutDocId,
  rosterDocId,
  type BoardIdentity,
} from "./snapshots";

/**
 * The read side: turning stored snapshots into what one coach is shown.
 *
 * Everything here runs on the SERVER. The page is a server component and the
 * browser is handed only the finished view — a podium, the few coaches directly
 * ahead of the reader, and a gap. The full ordering is read out of the roster
 * document with the Admin SDK and never leaves this process, which is what makes
 * "nobody can see the bottom of the board" a property of the system rather than a
 * property of the markup.
 */

export function viewerAsSubject(user: AppUser): ScopeSubject {
  return {
    id: user.id,
    name: user.name,
    uplineId: user.uplineId,
    uplinePath: user.uplinePath,
    levelName: user.levelName,
    city: user.city,
  };
}

export type ScopeOption = {
  type: ScopeType;
  /** Null when this coach has no such group — the screen teaches instead. */
  scope: Scope | null;
  /** Viewer-facing name of the filter. */
  label: string;
  /** Shown in place of the filter when `scope` is null. */
  missingHint: string;
};

/**
 * The scopes this coach can look at.
 *
 * A missing scope is never rendered as an empty dropdown or a dead option. A coach
 * who has not typed a level name has no level group, and the honest thing to show is
 * the sentence that tells them how one comes into existence — without ever
 * suggesting what to call it (RULES L8, D29).
 */
export function scopeOptions(user: AppUser): ScopeOption[] {
  const subject = viewerAsSubject(user);
  return SCOPE_TYPES.map((type) => {
    const scope = scopeFor(type, subject);
    switch (type) {
      case "org":
        return { type, scope, label: "Everyone", missingHint: "" };
      case "line":
        return { type, scope, label: "My team", missingHint: "" };
      case "level":
        return {
          type,
          scope,
          label: scope?.label ?? "My level",
          missingHint:
            "Level groups are named by your own organisation, not by us. Add your level name on My Target and you will see how you rank among the coaches at your level.",
        };
      case "club":
        return {
          type,
          scope,
          label: scope?.label ?? "My city",
          missingHint:
            "Add your city in Settings to see the coaches near you on these boards.",
        };
    }
  });
}

export type BoardView = {
  spec: MetricSpec;
  /** Null when this metric does not run in the chosen window (volume is monthly). */
  unavailableReason: string | null;
  /** Null when no snapshot exists yet — too few coaches, or nothing logged. */
  view: ViewerBoard | null;
  generatedAt: Date | null;
};

async function readRoster(
  identity: BoardIdentity
): Promise<{ entries: RankedEntry[]; generatedAt: Date } | null> {
  const snap = await db
    .collection(LEADERBOARD_COLLECTION)
    .doc(rosterDocId(identity))
    .get();
  const d = snap.data();
  if (!identity.workspaceId || !d || d.workspaceId !== identity.workspaceId) return null;
  return {
    entries: (d.entries as RankedEntry[]) ?? [],
    generatedAt: (d.generatedAt as Timestamp | undefined)?.toDate() ?? new Date(0),
  };
}

export type BoardsForViewer = {
  period: Period;
  scope: Scope;
  boards: BoardView[];
};

/** All four boards for one scope and window, from the reader's point of view. */
export async function getBoardsForViewer(
  user: AppUser,
  scope: Scope,
  window: WindowId,
  now = new Date()
): Promise<BoardsForViewer> {
  const period = currentPeriod(window, APP_TIMEZONE, now);

  const boards = await Promise.all(
    METRICS.map(async (metric: MetricId): Promise<BoardView> => {
      const spec = METRIC_SPECS[metric];
      if (!spec.windows.includes(window)) {
        return {
          spec,
          unavailableReason:
            "Volume is counted for the whole month, so this board only runs monthly.",
          view: null,
          generatedAt: null,
        };
      }
      const roster = await readRoster({
        workspaceId: user.workspaceId,
        metric,
        window,
        periodKey: period.key,
        scopeType: scope.type,
        scopeKey: scope.key,
      });
      if (!roster) {
        return { spec, unavailableReason: null, view: null, generatedAt: null };
      }
      return {
        spec,
        unavailableReason: null,
        view: buildViewerBoard(roster.entries, user.id),
        generatedAt: roster.generatedAt,
      };
    })
  );

  return { period, scope, boards };
}

/** Has this coach asked not to be listed? */
export async function isOptedOut(userId: string): Promise<boolean> {
  const snap = await db
    .collection(LEADERBOARD_COLLECTION)
    .doc(optOutDocId(userId))
    .get();
  return snap.exists;
}

/**
 * Turning listing off and on.
 *
 * Off is the absence of a document, on is its presence — so the default for every
 * coach who has never touched this is "listed", which is what a leaderboard is for,
 * and turning it off is a create rather than an update to a field that might not
 * exist yet. The change takes effect at the next rebuild; the screen says so rather
 * than pretending the boards have already forgotten them.
 */
export async function setOptedOut(userId: string, optedOut: boolean): Promise<void> {
  const ref = db.collection(LEADERBOARD_COLLECTION).doc(optOutDocId(userId));
  if (optedOut) {
    await ref.set({ kind: "optOut", userId, optedOutAt: Timestamp.now() });
  } else {
    await ref.delete();
  }
}
