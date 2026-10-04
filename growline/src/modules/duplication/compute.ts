import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { Timestamp } from "firebase-admin/firestore";
import { scopedJobPeople } from "@/modules/shared-new/job-scope";
import { db } from "@/lib/firebase-admin";
import { dailyLogs, users } from "@/lib/collections";
import { dayKey } from "@/lib/day";
import type { DayWindow } from "@/modules/shared-new/window";
import { DUPLICATION_SCORES, duplicationScoreDocId, type DuplicationScoreDoc } from "./docs";
import { availableDaysFor, currentWindow, membersByCoach, type Person } from "./line";
import { WINDOW_DAYS, isActive, scoreLine } from "./score";

/**
 * Building every coach's duplication reading. Runs on a schedule, on the server.
 *
 * ## Why this is a scheduled job and not a page query
 *
 * A coach's score depends on everybody up to three levels below them, and on every
 * day those people logged in the last four weeks. Computed on page load that is a
 * whole-line read per open, on a ₹10K Android, for a number that moves by fractions
 * of a percent between one morning and the next. Computed here it is two collection
 * reads for the entire organisation, however many coaches then look at it.
 *
 * The consequence is that the number on the screen is as old as the last run, so the
 * screen SAYS how old it is — the same honesty N21a settled for the qualification
 * list. A reading presented as this minute's, that is actually Tuesday's, is worse
 * than a reading labelled Tuesday.
 *
 * ## What is here and what is in line.ts
 *
 * This file reads documents and writes documents. Everything that decides what they
 * MEAN — the window's two ends, how much of it a person has been present for, and
 * which coach's line each person belongs to at which depth — lives in `line.ts`,
 * which imports no database and is therefore testable against hand-worked examples.
 * Two collection reads happen here, whatever the size of the organisation.
 *
 * ## No names, no money
 *
 * Nothing written by this job identifies a person. Levels are counts of people, and
 * a count is what P1 lets flow up a line. Not one figure here is money, a rate of
 * change, or a projection (L4).
 */

export type ComputeResult = {
  /** Coaches who had a line and got a reading. */
  scored: number;
  /** Coaches with no line, whose stale reading was removed. */
  cleared: number;
  window: DayWindow;
  generatedAt: Date;
};

async function loadPeople(window: DayWindow): Promise<(Person & { workspaceId: string; uplineId: string | null })[]> {
  const [userSnap, logSnap] = await Promise.all([
    boundedJobRead(users()),
    // One range on one field — no composite index, same as the boards job.
    boundedJobRead(dailyLogs()
      .where("dayKey", ">=", window.fromKey)
      .where("dayKey", "<=", window.toKey)),
  ]);

  // A Set rather than a counter: the doc id already guarantees one log per coach per
  // day (D26), and counting rows would silently double a day if that ever changed.
  const daysBy = new Map<string, Set<string>>();
  const workspaces = new Map(userSnap.docs.map((doc) => [doc.id, doc.get("workspaceId")]));
  for (const doc of logSnap.docs) {
    const d = doc.data();
    const userId = d.userId as string;
    if (!d.workspaceId || d.workspaceId !== workspaces.get(userId)) continue;
    const set = daysBy.get(userId) ?? new Set<string>();
    set.add(d.dayKey as string);
    daysBy.set(userId, set);
  }

  return scopedJobPeople(userSnap.docs.filter((doc) => doc.get("disabled") !== true).map((doc) => {
    const u = doc.data();
    const createdAt = (u.createdAt as Timestamp | undefined)?.toDate?.() ?? new Date(0);
    return {
      id: doc.id,
      workspaceId: typeof u.workspaceId === "string" ? u.workspaceId : "",
      uplineId: typeof u.uplineId === "string" ? u.uplineId : null,
      uplinePath: (u.uplinePath as string[]) ?? [],
      availableDays: availableDaysFor(dayKey(createdAt, window.timeZone), window),
      daysLogged: daysBy.get(doc.id)?.size ?? 0,
    };
  }));
}

export async function computeAllDuplicationScores(now = new Date()): Promise<ComputeResult> {
  const window = currentWindow(now);
  const people = await loadPeople(window);
  const lines = membersByCoach(people);
  const generatedAt = Timestamp.fromDate(now);

  let scored = 0;
  let cleared = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if (pending >= 400 || (force && pending > 0)) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (const person of people) {
    const ref = db.collection(DUPLICATION_SCORES).doc(duplicationScoreDocId(person.id));
    const members = lines.get(person.id);

    /**
     * A coach with nobody below them has their reading DELETED rather than skipped.
     *
     * N6a's correction, in a second place and for the same reason: skipping leaves
     * whatever the last run wrote sitting in Firestore, still readable by the coach
     * it belongs to. The case that empties a line is most often the line moving —
     * a downline reparented to another upline — and the coach they left would keep
     * reading a breakdown of a team that is no longer theirs, indefinitely.
     *
     * Deleting a document that is not there is a no-op, so this needs no read to
     * find out. It costs one write per lineless coach per run. If that ever needs
     * cutting, cut it by reading which readings exist — never by going back to a
     * silent skip.
     */
    if (!members || members.length === 0) {
      batch.delete(ref);
      pending += 1;
      cleared++;
      await flush();
      continue;
    }

    const result = scoreLine(members);
    const doc: DuplicationScoreDoc = {
      userId: person.id,
      workspaceId: person.workspaceId,
      score: result.score,
      reason: result.reason,
      levels: result.levels,
      lineSize: result.lineSize,
      pendingCount: result.pendingCount,
      deepestLevel: result.deepestLevel,
      deepestActiveLevel: result.deepestActiveLevel,
      // Context beside the number, never inside it (score.ts).
      own: {
        daysLogged: person.daysLogged,
        active: isActive({
          userId: person.id,
          depth: 1,
          availableDays: person.availableDays,
          daysLogged: person.daysLogged,
        }),
      },
      fromKey: window.fromKey,
      toKey: window.toKey,
      windowDays: WINDOW_DAYS,
      timeZone: window.timeZone,
      generatedAt,
    };

    batch.set(ref, doc);
    pending += 1;
    scored++;
    await flush();
  }

  await flush(true);
  return { scored, cleared, window, generatedAt: now };
}
