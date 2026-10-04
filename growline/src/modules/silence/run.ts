import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { Timestamp } from "firebase-admin/firestore";
import { scopedJobPeople } from "@/modules/shared-new/job-scope";
import { dailyLogs, users } from "@/lib/collections";
import { db } from "@/lib/firebase-admin";
import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { shiftKey, todayKey } from "@/lib/daily-log";
import { isPushConfigured, sendToUser } from "@/lib/push";
import { assessLeg, pickForOneRun, shouldAlert, type Assessment, type Leg } from "./detect";
import {
  LOOKBACK_DAYS,
  QUIET_DAYS,
  SILENCE_ALERTS,
  silenceAlertDocId,
  type SilenceAlertDoc,
} from "./model";
import { NOTIFICATION_TITLE, NOTIFICATION_URL, notificationTag, silenceBody } from "./copy";

/**
 * The scheduled silence run (session 4, feature 3).
 *
 * Reads the whole organisation once, builds every upline's legs in memory, and sends at
 * most two notifications per upline. Server only.
 *
 * ## Two queries, not one per leg
 *
 * The naive shape — for each upline, for each leg, query that leg's logs — is a query
 * count that grows with the square of the organisation, which is exactly the shape the
 * team tree was rewritten to avoid (D36). Instead: all users once, all recent logs once,
 * and the leg structure assembled from `uplinePath`, which already names every ancestor
 * of every coach.
 *
 * ## Counts only, never identity (P1)
 *
 * Nothing in this file touches `prospects`. What crosses from a downline to an upline is
 * a name they already see in their own team tree, a number of people, and a number of
 * days — which is precisely what v1 §5.4 allows to flow upward. There is no code path
 * here that could carry a prospect's name even by accident, because no prospect is ever
 * read.
 *
 * ## Live ancestry, never a stored snapshot (D64)
 *
 * Legs are rebuilt from the CURRENT `users` documents on every run. Nothing is trusted
 * off the stored alert row except what was already said and when — a coach moved to
 * another line stops appearing in their old upline's legs on the next run, with nothing
 * to migrate and no frozen path to go stale.
 */

type Person = {
  id: string;
  workspaceId: string;
  name: string;
  uplineId: string | null;
  uplinePath: string[];
  joinKey: string;
};

export type SilenceRunReport = {
  dryRun: boolean;
  pushConfigured: boolean;
  todayKey: string;
  quietDays: number;
  uplinesConsidered: number;
  legsConsidered: number;
  /** Every leg that qualified, including the ones held back, with the reason. */
  decisions: {
    uplineId: string;
    legOwnerId: string;
    state: Assessment["state"];
    legSize: number;
    daysQuiet: number | null;
    sent: boolean;
    reason: string;
    body?: string;
  }[];
  sent: number;
  devices: { sent: number; removed: number; failed: number };
};

export async function runSilenceCheck(
  now = new Date(),
  dryRun = false,
  timeZone: string = APP_TIMEZONE
): Promise<SilenceRunReport> {
  const today = todayKey(timeZone, now);
  const lookbackFrom = shiftKey(today, -LOOKBACK_DAYS);

  const [userSnap, logSnap] = await Promise.all([
    boundedJobRead(users()),
    // One range query over a lexicographic day key (D26) — no date maths on the query
    // side, and every log in the window regardless of who wrote it.
    boundedJobRead(dailyLogs().where("dayKey", ">=", lookbackFrom)),
  ]);

  let people: Person[] = [];
  for (const doc of userSnap.docs) {
    const d = doc.data();
    const created = d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date(0);
    people.push({
      id: doc.id,
      workspaceId: typeof d.workspaceId === "string" && d.disabled !== true ? d.workspaceId : "",
      name: d.name ?? "",
      uplineId: d.uplineId ?? null,
      uplinePath: Array.isArray(d.uplinePath) ? d.uplinePath : [],
      joinKey: dayKey(created, timeZone),
    });
  }

  people = scopedJobPeople(people);
  const workspaces = new Map(people.map((person) => [person.id, person.workspaceId]));
  /** Most recent day each coach logged, inside the lookback. */
  const lastLogBy = new Map<string, string>();
  for (const doc of logSnap.docs) {
    const d = doc.data();
    const userId = d.userId as string;
    if (!d.workspaceId || d.workspaceId !== workspaces.get(userId)) continue;
    const key = d.dayKey as string;
    const current = lastLogBy.get(userId);
    if (!current || key > current) lastLogBy.set(userId, key);
  }

  /**
   * Everyone below each coach, at any depth, in one pass.
   *
   * `uplinePath` holds every ancestor of a coach (D36), so pushing each person into
   * each of their ancestors' buckets builds every subtree at once — no recursion, no
   * per-node query, and it stays linear in the size of the organisation.
   */
  const descendants = new Map<string, string[]>();
  for (const p of people) {
    for (const ancestor of p.uplinePath) {
      const list = descendants.get(ancestor);
      if (list) list.push(p.id);
      else descendants.set(ancestor, [p.id]);
    }
  }

  const byId = new Map(people.map((p) => [p.id, p]));

  /** Direct downlines, which are the legs. */
  const legOwnersByUpline = new Map<string, Person[]>();
  for (const p of people) {
    if (!p.uplineId) continue;
    const list = legOwnersByUpline.get(p.uplineId);
    if (list) list.push(p);
    else legOwnersByUpline.set(p.uplineId, [p]);
  }

  const report: SilenceRunReport = {
    dryRun,
    pushConfigured: isPushConfigured(),
    todayKey: today,
    quietDays: QUIET_DAYS,
    uplinesConsidered: legOwnersByUpline.size,
    legsConsidered: 0,
    decisions: [],
    sent: 0,
    devices: { sent: 0, removed: 0, failed: 0 },
  };

  for (const [uplineId, legOwners] of legOwnersByUpline) {
    // An upline who has left the tree between runs has no legs to be told about.
    if (!byId.has(uplineId)) continue;

    const assessments: Assessment[] = [];
    for (const owner of legOwners) {
      const memberIds = [owner.id, ...(descendants.get(owner.id) ?? [])];

      let earliestJoinKey = owner.joinKey;
      let lastLoggedKey: string | null = null;
      for (const id of memberIds) {
        const member = byId.get(id);
        if (member && member.joinKey < earliestJoinKey) earliestJoinKey = member.joinKey;
        const logged = lastLogBy.get(id);
        if (logged && (lastLoggedKey === null || logged > lastLoggedKey)) lastLoggedKey = logged;
      }

      const leg: Leg = {
        ownerId: owner.id,
        ownerName: owner.name,
        memberIds,
        earliestJoinKey,
        lastLoggedKey,
      };
      assessments.push(assessLeg(leg, today));
      report.legsConsidered++;
    }

    const quiet = assessments.filter((a) => a.state === "quiet" || a.state === "dormant");
    if (quiet.length === 0) continue;

    // Only the quiet legs need their memory read — an active leg has nothing to check.
    const refs = quiet.map((a) =>
      db.collection(SILENCE_ALERTS).doc(silenceAlertDocId(uplineId, a.ownerId))
    );
    const previousSnaps = await db.getAll(...refs);
    const previousById = new Map<string, SilenceAlertDoc | null>();
    quiet.forEach((a, i) => {
      const data = previousSnaps[i].data();
      previousById.set(a.ownerId, data ? (data as SilenceAlertDoc) : null);
    });

    // Decided once per leg. The report and the sending both read this list, so a leg
    // can never be reported as held back and notified anyway.
    const judged = quiet.map((assessment) => ({
      assessment,
      decision: shouldAlert(assessment, previousById.get(assessment.ownerId) ?? null, today),
    }));

    const chosen = pickForOneRun(judged.filter((row) => row.decision.send));
    const chosenIds = new Set(chosen.map((c) => c.assessment.ownerId));

    for (const { assessment, decision } of judged) {
      const willSend = chosenIds.has(assessment.ownerId);
      report.decisions.push({
        uplineId,
        legOwnerId: assessment.ownerId,
        state: assessment.state,
        legSize: assessment.legSize,
        daysQuiet: assessment.daysQuiet,
        sent: willSend && !dryRun,
        reason: willSend ? decision.reason : decision.send ? "heldBackThisRun" : decision.reason,
        ...(willSend ? { body: silenceBody(assessment) } : {}),
      });
    }

    if (dryRun) continue;

    for (const { assessment } of chosen) {
      const memory = db.collection(SILENCE_ALERTS).doc(silenceAlertDocId(uplineId, assessment.ownerId));
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(memory);
        const owner = await tx.get(users().doc(assessment.ownerId));
        const upline = await tx.get(users().doc(uplineId));
        if (owner.get("workspaceId") !== byId.get(uplineId)?.workspaceId || upline.get("workspaceId") !== byId.get(uplineId)?.workspaceId ||
            owner.get("disabled") === true || upline.get("disabled") === true || owner.get("uplineId") !== uplineId ||
            !shouldAlert(assessment, fresh.exists ? fresh.data() as SilenceAlertDoc : null, today).send) return false;
        tx.set(memory, {
          uplineId, legOwnerId: assessment.ownerId, lastAlertedKey: today,
          quietSinceKey: assessment.quietSinceKey, lastState: assessment.state, legSize: assessment.legSize,
        } satisfies SilenceAlertDoc);
        return true;
      });
      if (!claimed) continue;
      const result = await sendToUser(uplineId, {
        title: NOTIFICATION_TITLE,
        body: silenceBody(assessment),
        url: NOTIFICATION_URL,
        tag: notificationTag(assessment.ownerId),
      });
      report.devices.sent += result.sent;
      report.devices.removed += result.removed;
      report.devices.failed += result.failed;
      report.sent++;

    }
  }

  return report;
}
