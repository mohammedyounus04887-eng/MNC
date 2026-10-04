import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { isPushConfigured, sendToUser } from "@/lib/push";
import { daysLeft } from "@/modules/shared-new/window";
import {
  qualificationProgress,
  qualifications,
  type ProgressDoc,
  type QualificationDoc,
} from "./docs";
import { windowOf } from "./model";
import { nudgeFor, standingOf } from "./progress";
import { bandId, dueBand, reminderMessage } from "./reminders";

/**
 * Sending the escalating reminders. Server only; the schedule and the copy are in
 * `reminders.ts`, which is pure.
 *
 * ## What stops a reminder being sent twice
 *
 * `remindersSent` on the coach's own progress row, written with `arrayUnion` so two
 * runs racing each other converge on one entry instead of two. It lives there rather
 * than on the user document for the reason N6 records about the opt-out flag: this
 * branch may not write to an existing collection, and the row is keyed by
 * (qualification, coach) anyway, which is exactly the grain the bookkeeping needs.
 *
 * The band is marked as sent even when the coach turned out to have no working device.
 * Otherwise a coach who has never enabled notifications is "due" on every run for the
 * rest of the qualification, and the job spends its budget rediscovering that.
 *
 * ## Dry run
 *
 * `dryRun` computes exactly what would be sent and writes nothing, which is how this
 * is verified without a push service configured — the same affordance
 * `/api/notifications/daily` has, and for the same reason.
 */

export type ReminderOutcome = {
  qualificationId: string;
  title: string;
  daysLeft: number;
  band: string;
  /** Coaches the band was due for. */
  due: number;
  /** Coaches marked as reminded (equal to `due` outside a dry run). */
  notified: number;
  /** Push endpoints that accepted it. Zero is normal — most coaches have no device. */
  devices: number;
};

export type ReminderRun = {
  pushConfigured: boolean;
  dryRun: boolean;
  qualificationsConsidered: number;
  outcomes: ReminderOutcome[];
};

export async function sendDueReminders(
  now = new Date(),
  dryRun = false
): Promise<ReminderRun> {
  // Open only. A closed qualification is never reminded about — see `dueBand`.
  const snap = await boundedJobRead(qualifications()
    .where("closesAt", ">", Timestamp.fromDate(now)));

  const outcomes: ReminderOutcome[] = [];

  for (const doc of snap.docs) {
    const q = doc.data() as QualificationDoc;
    const creator = await db.doc(`users/${q.creatorId}`).get();
    if (!q.workspaceId || creator.get("workspaceId") !== q.workspaceId || creator.get("disabled") === true) continue;
    const left = daysLeft(windowOf(q), now);
    const band = dueBand(left);
    if (band === null) continue;
    const id = bandId(band);

    const rows = await boundedJobRead(qualificationProgress()
      .where("qualificationId", "==", doc.id)
      .where("kind", "==", "progress"));

    let due = 0;
    let notified = 0;
    let devices = 0;

    for (const rowDoc of rows.docs) {
      const row = rowDoc.data() as ProgressDoc;
      const participant = await db.doc(`users/${row.userId}`).get();
      if (row.workspaceId !== q.workspaceId || participant.get("workspaceId") !== q.workspaceId || participant.get("disabled") === true ||
          !(q.audience === "direct" ? participant.get("uplineId") === q.creatorId : Array.isArray(participant.get("uplinePath")) && participant.get("uplinePath").includes(q.creatorId))) continue;
      // Nobody who is already in is nagged about being in.
      if (row.qualified) continue;
      if ((row.remindersSent ?? []).includes(id)) continue;
      due++;
      if (dryRun) continue;

      // Claim a band before network I/O. Provider delivery is at most once per
      // band; an unknown delivery needs operator review, never a duplicate push.
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(rowDoc.ref);
        const member = await tx.get(participant.ref);
        const owner = await tx.get(creator.ref);
        if (!fresh.exists || fresh.get("qualified") === true || (fresh.get("remindersSent") ?? []).includes(id) ||
            member.get("workspaceId") !== q.workspaceId || owner.get("workspaceId") !== q.workspaceId ||
            member.get("disabled") === true || owner.get("disabled") === true ||
            !(q.audience === "direct" ? member.get("uplineId") === q.creatorId : Array.isArray(member.get("uplinePath")) && member.get("uplinePath").includes(q.creatorId))) return false;
        tx.update(rowDoc.ref, { remindersSent: FieldValue.arrayUnion(id) });
        return true;
      });
      if (!claimed) continue;

      const standing = standingOf(q.criteria, row.values, row.baseline, row.unchecked);
      const result = await sendToUser(
        row.userId,
        reminderMessage(doc.id, q.title, left, nudgeFor(standing, left))
      );
      devices += result.sent;

      notified++;
    }

    outcomes.push({
      qualificationId: doc.id,
      title: q.title,
      daysLeft: left,
      band: id,
      due,
      notified,
      devices,
    });
  }

  return {
    pushConfigured: isPushConfigured(),
    dryRun,
    qualificationsConsidered: snap.size,
    outcomes,
  };
}
