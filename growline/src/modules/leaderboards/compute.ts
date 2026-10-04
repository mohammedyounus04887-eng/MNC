import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { dailyLogs, proofs, prospects, targets, users } from "@/lib/collections";
import { APP_TIMEZONE, startOfDayInZone } from "@/lib/day";
import { shiftKey } from "@/lib/daily-log";
import {
  currentPeriod,
  longestRunWithin,
  WINDOWS,
  type Period,
} from "@/modules/shared-new/period";
import {
  lineOwnerId,
  normaliseScopeKey,
  orgRootId,
  type Scope,
  type ScopeSubject,
} from "@/modules/shared-new/scopes";
import { METRIC_SPECS, METRICS, type MetricId } from "./metrics";
import {
  MAX_ROSTER_ENTRIES,
  MIN_PARTICIPANTS,
  PODIUM_SIZE,
  rankEntries,
  type RankRow,
} from "./ranking";
import {
  LEADERBOARD_COLLECTION,
  podiumDocId,
  rosterDocId,
  type BoardIdentity,
} from "./snapshots";

/**
 * Building the board snapshots. Runs on a schedule, on the server, never in a browser.
 *
 * ## Why a snapshot at all
 *
 * A board is an aggregation across an entire organisation. Firestore has no group-by,
 * so a client-side board would be "read every log in the company and add them up",
 * once per coach, per screen open, on a ₹10K Android. This job does it once per run
 * for everybody, and the screen then reads two documents.
 *
 * ## What is counted, and what is deliberately not
 *
 * Counts only — people, follow-ups, days, points (RULES L4). No money appears in this
 * file, and nothing here derives a rate, a projection or a conversion.
 *
 * Prospect IDENTITY never leaves this function. The rows carry a coach's own name and
 * a number; the people they met are counted, never named. That is the P1 line: counts
 * flow, names do not — and here they do not flow even to the coach's own upline,
 * because a board is read sideways by peers as well as upward.
 *
 * ## Opt-outs are applied before ranking
 *
 * A coach who has opted out is removed from the rows, not hidden from the render. If
 * they were filtered later the ranks would have holes in them, and a hole is an
 * observation about the person missing from it.
 */

type UserRow = ScopeSubject & { workspaceId: string };

type Values = {
  peopleMet: number;
  followUps: number;
  /** Longest run of consecutive logged days INSIDE the window. */
  streak: number;
  /** Days logged in the window — the silent tiebreak behind an equal streak. */
  daysLogged: number;
  volumeValidated: number;
  volumeUnvalidated: number;
};

const EMPTY: Values = {
  peopleMet: 0,
  followUps: 0,
  streak: 0,
  daysLogged: 0,
  volumeValidated: 0,
  volumeUnvalidated: 0,
};

function valueFor(metric: MetricId, v: Values): { value: number; unvalidated?: number; tiebreak?: number } {
  switch (metric) {
    case "peopleMet":
      return { value: v.peopleMet };
    case "followUps":
      return { value: v.followUps };
    case "streak":
      return { value: v.streak, tiebreak: v.daysLogged };
    case "volume":
      // Ranked on the CHECKED number only. An unchecked claim is carried alongside
      // so the card can show it dimmed, and it orders coaches who have nothing
      // checked yet among themselves — it can never lift one above a checked figure.
      return {
        value: v.volumeValidated,
        unvalidated: v.volumeUnvalidated,
        tiebreak: v.volumeUnvalidated,
      };
  }
}

/** Somebody belongs on a board when they have something to show on it. */
function participates(row: { value: number; unvalidated?: number }): boolean {
  return row.value > 0 || (row.unvalidated ?? 0) > 0;
}

async function loadUsers(): Promise<UserRow[]> {
  const snap = await boundedJobRead(users());
  const rows = snap.docs.filter((d) => typeof d.get("workspaceId") === "string" && d.get("workspaceId") && d.get("disabled") !== true).map((d) => {
    const u = d.data();
    return {
      id: d.id,
      workspaceId: u.workspaceId as string,
      name: (u.name as string) ?? "",
      uplineId: (u.uplineId as string | null) ?? null,
      uplinePath: (u.uplinePath as string[]) ?? [],
      levelName: (u.levelName as string | null) ?? null,
      city: (u.city as string | null) ?? null,
    };
  });
  const workspaces = new Map(rows.map((row) => [row.id, row.workspaceId]));
  return rows.map((row) => ({ ...row, uplineId: row.uplineId && workspaces.get(row.uplineId) === row.workspaceId ? row.uplineId : null, uplinePath: row.uplinePath.filter((uid) => workspaces.get(uid) === row.workspaceId) }));
}

async function loadOptOuts(): Promise<Set<string>> {
  const snap = await boundedJobRead(db
    .collection(LEADERBOARD_COLLECTION)
    .where("kind", "==", "optOut"));
  return new Set(snap.docs.map((d) => d.data().userId as string));
}

/** Every metric, for every coach, for one period. */
async function collectValues(period: Period, people: UserRow[]): Promise<Map<string, Values>> {
  const workspaces = new Map(people.map((person) => [person.id, person.workspaceId]));
  const out = new Map<string, Values>();
  const bump = (id: string, f: (v: Values) => void) => {
    const v = out.get(id) ?? { ...EMPTY };
    f(v);
    out.set(id, v);
  };

  // People met: prospects created inside the window. The bounds are real instants
  // derived from the coach's own day keys (E1) — a UTC midnight would put every
  // capture made before 05:30 IST in the wrong week.
  const from = startOfDayInZone(period.fromKey, APP_TIMEZONE);
  const until = startOfDayInZone(shiftKey(period.toKey, 1), APP_TIMEZONE);
  const captured = await boundedJobRead(prospects()
    .where("createdAt", ">=", Timestamp.fromDate(from))
    .where("createdAt", "<", Timestamp.fromDate(until)));
  for (const doc of captured.docs) {
    if (doc.get("workspaceId") !== workspaces.get(doc.get("coachId"))) continue;
    bump(doc.data().coachId as string, (v) => (v.peopleMet += 1));
  }

  // Follow-ups and streaks both come out of the daily logs for the window.
  const logs = await boundedJobRead(dailyLogs()
    .where("dayKey", ">=", period.fromKey)
    .where("dayKey", "<=", period.toKey));
  const keysByUser = new Map<string, string[]>();
  for (const doc of logs.docs) {
    const d = doc.data();
    const userId = d.userId as string;
    if (d.workspaceId !== workspaces.get(userId)) continue;
    bump(userId, (v) => {
      v.followUps += (d.followupsDone as number) ?? 0;
      v.daysLogged += 1;
    });
    keysByUser.set(userId, [...(keysByUser.get(userId) ?? []), d.dayKey as string]);
  }
  for (const [userId, keys] of keysByUser) {
    bump(userId, (v) => (v.streak = longestRunWithin(keys, period)));
  }

  // Volume is a monthly figure by construction (F7): one cumulative number per coach
  // per month, with no per-day history to slice a week from.
  if (period.window === "monthly") {
    const monthTargets = await boundedJobRead(targets().where("month", "==", period.key));
    const byTargetId = new Map<string, { coachId: string; points: number }>();
    for (const doc of monthTargets.docs) {
      const d = doc.data();
      if (d.workspaceId !== workspaces.get(d.coachId)) continue;
      byTargetId.set(doc.id, {
        coachId: d.coachId as string,
        points: (d.progressPoints as number) ?? 0,
      });
    }

    // Which targets have been checked. `in` takes at most 30 values per query, the
    // same chunking targets-queries.ts uses.
    const ids = [...byTargetId.keys()];
    const latestProof = new Map<string, { at: number; status: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await boundedJobRead(proofs().where("targetId", "in", ids.slice(i, i + 30)));
      for (const doc of snap.docs) {
        const p = doc.data();
        const at = (
          (p.reviewedAt as Timestamp | null) ??
          (p.submittedAt as Timestamp | null) ??
          (p.createdAt as Timestamp | null)
        )?.toMillis?.() ?? 0;
        const targetId = p.targetId as string;
        const seen = latestProof.get(targetId);
        if (!seen || at >= seen.at) {
          latestProof.set(targetId, { at, status: p.status as string });
        }
      }
    }

    for (const [targetId, t] of byTargetId) {
      // Validation is per TARGET, not per point: nothing records how many points
      // stood when the upline approved. So a target whose most recent proof is
      // approved counts in full, and a later proof request — pending, submitted or
      // rejected — puts it straight back into the unchecked column.
      const validated = latestProof.get(targetId)?.status === "approved";
      bump(t.coachId, (v) => {
        if (validated) v.volumeValidated += t.points;
        else v.volumeUnvalidated += t.points;
      });
    }
  }

  return out;
}

/** Every scope that exists in the data. No names are invented here (RULES L8). */
function enumerateScopes(people: UserRow[]): (Scope & { workspaceId: string })[] {
  const out = new Map<string, Scope & { workspaceId: string }>();

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  for (const p of people) {
    const add = (s: Scope) => out.set(`${p.workspaceId}:${s.type}:${s.key}`, { ...s, workspaceId: p.workspaceId });
    add({ type: "org", key: orgRootId(p), label: "Organisation" });
    const owner = lineOwnerId(p);
    add({ type: "line", key: owner, label: `${nameById.get(owner) ?? "Coach"}'s line` });
    const level = p.levelName?.trim();
    // The only way a level group exists is a coach having typed its name (D29).
    if (level) add({ type: "level", key: normaliseScopeKey(level), label: level });
    const city = p.city?.trim();
    if (city) add({ type: "club", key: normaliseScopeKey(city), label: city });
  }
  return [...out.values()];
}

function membersOfScope(scope: Scope & { workspaceId: string }, candidates: UserRow[]): UserRow[] {
  const people = candidates.filter((person) => person.workspaceId === scope.workspaceId);
  switch (scope.type) {
    case "org":
      return people.filter((p) => orgRootId(p) === scope.key);
    case "line":
      return people.filter((p) => p.id === scope.key || p.uplinePath.includes(scope.key));
    case "level":
      return people.filter(
        (p) => !!p.levelName && normaliseScopeKey(p.levelName) === scope.key
      );
    case "club":
      return people.filter((p) => !!p.city && normaliseScopeKey(p.city) === scope.key);
  }
}

export type ComputeResult = {
  boardsWritten: number;
  boardsSkipped: number;
  scopes: number;
  generatedAt: Date;
};

/**
 * Rebuilds every board for the CURRENT weekly and monthly period.
 *
 * Past periods are left exactly as they were last written — a finished week is a
 * finished week, and recomputing it would only let a late edit rewrite history.
 */
export async function computeAllBoards(now = new Date()): Promise<ComputeResult> {
  const people = await loadUsers();
  const optedOut = await loadOptOuts();
  const scopes = enumerateScopes(people);
  const generatedAt = Timestamp.fromDate(now);

  let boardsWritten = 0;
  let boardsSkipped = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if (pending >= 400 || (force && pending > 0)) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (const window of WINDOWS) {
    const period = currentPeriod(window, APP_TIMEZONE, now);
    const values = await collectValues(period, people);

    for (const scope of scopes) {
      const members = membersOfScope(scope, people).filter((m) => !optedOut.has(m.id));

      for (const metric of METRICS) {
        if (!METRIC_SPECS[metric].windows.includes(window)) continue;

        const rows: RankRow[] = [];
        for (const m of members) {
          const v = valueFor(metric, values.get(m.id) ?? EMPTY);
          if (!participates(v)) continue;
          rows.push({ userId: m.id, name: m.name, ...v });
        }

        const identity: BoardIdentity = {
          workspaceId: scope.workspaceId,
          metric,
          window,
          periodKey: period.key,
          scopeType: scope.type,
          scopeKey: scope.key,
        };

        /**
         * Below the floor there is no board to publish (ranking.ts).
         *
         * The documents are DELETED rather than merely not written. Skipping the
         * write leaves whatever the last run published sitting in Firestore, still
         * readable by everyone in the scope — and the case that puts a board below
         * the floor is most often a coach opting out of it. A board of five that
         * loses one to the opt-out drops to four, is skipped, and the previous
         * document keeps that coach's name and numbers on a listing they have just
         * left, for the rest of the period. Opting out has to remove you from the
         * boards even when removing you is what unpublishes them.
         *
         * Deleting a document that is not there is a no-op, so this is correct
         * without a read to find out. It costs two writes per skipped board per run
         * — the dominant term in this job's write budget, since most scope-metric
         * pairs are below the floor at pilot scale. That is the price of the opt-out
         * being honoured; if it ever needs cutting, cut it by reading which boards
         * exist, never by going back to a silent skip.
         */
        if (rows.length < MIN_PARTICIPANTS) {
          batch.delete(db.collection(LEADERBOARD_COLLECTION).doc(podiumDocId(identity)));
          batch.delete(db.collection(LEADERBOARD_COLLECTION).doc(rosterDocId(identity)));
          pending += 2;
          boardsSkipped++;
          await flush();
          continue;
        }

        const ranked = rankEntries(rows).slice(0, MAX_ROSTER_ENTRIES);
        const common = {
          ...identity,
          scopeLabel: scope.label,
          generatedAt,
        };

        batch.set(db.collection(LEADERBOARD_COLLECTION).doc(podiumDocId(identity)), {
          ...common,
          kind: "podium",
          entries: ranked.slice(0, PODIUM_SIZE),
        });
        batch.set(db.collection(LEADERBOARD_COLLECTION).doc(rosterDocId(identity)), {
          ...common,
          kind: "roster",
          entries: ranked,
          participantCount: ranked.length,
        });
        pending += 2;
        boardsWritten++;
        await flush();
      }
    }
  }

  await flush(true);
  return { boardsWritten, boardsSkipped, scopes: scopes.length, generatedAt: now };
}
