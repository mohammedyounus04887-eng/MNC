import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { Timestamp } from "firebase-admin/firestore";
import { scopedJobPeople } from "@/modules/shared-new/job-scope";
import { db } from "@/lib/firebase-admin";
import { dailyLogs, proofs, prospects, targets, users } from "@/lib/collections";
import {
  monthsInWindow,
  windowInstants,
  type DayWindow,
} from "@/modules/shared-new/window";
import { baselineTypes, type CriterionType } from "./criteria";
import {
  qualificationProgress,
  qualifications,
  type CriterionCounts,
  type ProgressDoc,
  type QualificationDoc,
} from "./docs";
import { progressDocId, summaryDocId } from "./ids";
import { inAudience, windowOf } from "./model";
import { dropOff, standingOf, type Standing } from "./progress";

/**
 * Working out where everybody stands. Server only, never a browser.
 *
 * ## Why this is a job rather than a page calculation
 *
 * A qualification's numbers are an aggregation across a whole line: prospects, logs,
 * targets and proofs for every participant. Doing that per screen open, per coach, on
 * a ₹10K Android's connection is the shape leaderboards' compute.ts exists to avoid.
 * This runs once and writes one small document per participant; the screens read
 * those.
 *
 * It is called from three places: once synchronously when a qualification is created
 * (so the tracker is populated the moment it exists rather than after the next
 * scheduled run), by the scheduled evaluator, and by a page whose stored numbers have
 * gone stale (`ensureFresh`).
 *
 * ## The audience is resolved LIVE, every time
 *
 * D64's rule. No participant list is stored: membership is recomputed from the
 * CURRENT user documents on each run. A coach who joins the line mid-qualification is
 * in it from that moment, and a coach who moves out stops being in it — including
 * having their progress row deleted, for N6a's reason. Leaving the row behind would
 * keep somebody who is no longer in this line on a qualifier list their old upline's
 * team is reading.
 *
 * ## Prospect identity never enters this file
 *
 * People met is a COUNT. No prospect name, phone or health field is read, stored or
 * rolled up here — P1's line, and it holds sideways as well as upward, because a
 * qualifier list is read by peers.
 */

/** Nearest ancestor first (D36), so `[0]` is the direct upline. */
type UserRow = {
  id: string;
  workspaceId: string;
  name: string;
  uplineId: string | null;
  uplinePath: string[];
  createdAt: Date;
};

async function loadUsers(): Promise<UserRow[]> {
  const snap = await boundedJobRead(users());
  return scopedJobPeople(snap.docs.filter((d) => d.get("disabled") !== true).map((d) => {
    const u = d.data();
    return {
      id: d.id,
      workspaceId: typeof u.workspaceId === "string" ? u.workspaceId : "",
      name: (u.name as string) ?? "",
      uplineId: (u.uplineId as string | null) ?? null,
      uplinePath: (u.uplinePath as string[]) ?? [],
      createdAt: (u.createdAt as Timestamp | undefined)?.toDate() ?? new Date(0),
    };
  }));
}

/**
 * Who a qualification applies to, decided against the tree as it is right now.
 *
 * The predicate itself lives in `model.ts` and is shared with the read side, so the
 * set of people who GET a progress row and the set who may OPEN the screen cannot
 * drift apart. It is pure, and `tests/qualifications.test.ts` pins it — including the
 * property this filter is the only guard on: a coach outside the creator's line is
 * never in the audience, so no row about them is ever written and the creator's
 * dashboard cannot show them.
 */
export function audienceOf(q: QualificationDoc, people: UserRow[]): UserRow[] {
  const creatorWorkspace = people.find((person) => person.id === q.creatorId)?.workspaceId;
  const workspace = q.workspaceId === creatorWorkspace ? creatorWorkspace : null;
  return workspace ? people.filter((p) => p.workspaceId === workspace && inAudience(q.audience, q.creatorId, p)) : [];
}

type Collected = {
  values: Map<string, CriterionCounts>;
  unchecked: Map<string, CriterionCounts>;
};

function bump(
  map: Map<string, CriterionCounts>,
  userId: string,
  type: CriterionType,
  by: number
) {
  const row = map.get(userId) ?? {};
  row[type] = (row[type] ?? 0) + by;
  map.set(userId, row);
}

/**
 * Every criterion's raw number, for everyone in the audience.
 *
 * Only the criteria a qualification actually uses are collected — a qualification
 * with one condition does not read the whole organisation's targets to fill in four
 * numbers nobody asked for.
 *
 * ## Adding a sixth criterion
 *
 * One `if (want("…"))` block here and one entry in CRITERION_SPECS. Nothing else in
 * the module has to change, which is the property the data model was chosen for.
 */
async function collect(
  q: QualificationDoc,
  window: DayWindow,
  audience: UserRow[],
  people: UserRow[]
): Promise<Collected> {
  const values = new Map<string, CriterionCounts>();
  const unchecked = new Map<string, CriterionCounts>();
  const inAudience = new Set(audience.map((a) => a.id));
  const wanted = new Set(q.criteria.map((c) => c.type));
  const want = (t: CriterionType) => wanted.has(t);

  // Real instants from the window's own day keys (E1). A UTC midnight would put
  // everything captured before 05:30 IST on the wrong side of the deadline.
  const { from, untilExclusive } = windowInstants(window);

  if (want("prospects")) {
    const snap = await boundedJobRead(prospects()
      .where("createdAt", ">=", Timestamp.fromDate(from))
      .where("createdAt", "<", Timestamp.fromDate(untilExclusive)));
    for (const doc of snap.docs) {
      const coachId = doc.data().coachId as string;
      // Nothing but the owning coach's id is read off a prospect document here.
      if (inAudience.has(coachId) && doc.get("workspaceId") === audience.find((person) => person.id === coachId)?.workspaceId) bump(values, coachId, "prospects", 1);
    }
  }

  if (want("newMembers") || want("daysActive")) {
    const snap = await boundedJobRead(dailyLogs()
      .where("dayKey", ">=", window.fromKey)
      .where("dayKey", "<=", window.toKey));
    for (const doc of snap.docs) {
      const d = doc.data();
      const userId = d.userId as string;
      if (!inAudience.has(userId) || d.workspaceId !== audience.find((person) => person.id === userId)?.workspaceId) continue;
      if (want("newMembers")) {
        bump(values, userId, "newMembers", (d.memberships as number) ?? 0);
      }
      // One log per coach per local day is a document-id invariant (D26), so a
      // document IS a distinct day and no de-duplication is needed here.
      if (want("daysActive")) bump(values, userId, "daysActive", 1);
    }
  }

  if (want("newCoaches")) {
    for (const p of people) {
      if (!p.uplineId || !inAudience.has(p.uplineId)) continue;
      if (p.createdAt >= from && p.createdAt < untilExclusive) {
        bump(values, p.uplineId, "newCoaches", 1);
      }
    }
  }

  if (want("volume")) {
    /**
     * Volume counts only points whose most recent proof is APPROVED.
     *
     * Progress points are typed in by the coach they belong to (F7), so a
     * qualification gated on the raw figure is one a coach awards themselves — they
     * would only have to type a big enough number. N4 made the same call on the
     * boards and recorded the same known approximation: validation is per target
     * rather than per point, because nothing stores how many points stood at the
     * moment an upline approved. Any newer proof — pending, submitted or rejected —
     * puts the whole target back in the unchecked column.
     *
     * The unchecked figure is carried alongside so the tracker can say "400 of yours
     * are waiting to be checked" instead of silently showing zero, which would read
     * as the app having lost the work.
     */
    const months = monthsInWindow(window);
    const byTargetId = new Map<string, { coachId: string; points: number }>();
    // `in` takes at most 30 values; a window is capped at a year, so 13 at worst.
    for (let i = 0; i < months.length; i += 30) {
      const snap = await boundedJobRead(targets()
        .where("month", "in", months.slice(i, i + 30)));
      for (const doc of snap.docs) {
        const d = doc.data();
        const coachId = d.coachId as string;
        if (!inAudience.has(coachId) || d.workspaceId !== audience.find((person) => person.id === coachId)?.workspaceId) continue;
        byTargetId.set(doc.id, {
          coachId,
          points: (d.progressPoints as number) ?? 0,
        });
      }
    }

    const ids = [...byTargetId.keys()];
    const latestProof = new Map<string, { at: number; status: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await boundedJobRead(proofs().where("targetId", "in", ids.slice(i, i + 30)));
      for (const doc of snap.docs) {
        const p = doc.data();
        const at =
          (
            (p.reviewedAt as Timestamp | null) ??
            (p.submittedAt as Timestamp | null) ??
            (p.createdAt as Timestamp | null)
          )?.toMillis?.() ?? 0;
        const targetId = p.targetId as string;
        const seen = latestProof.get(targetId);
        if (!seen || at >= seen.at) latestProof.set(targetId, { at, status: p.status });
      }
    }

    for (const [targetId, t] of byTargetId) {
      const approved = latestProof.get(targetId)?.status === "approved";
      bump(approved ? values : unchecked, t.coachId, "volume", t.points);
    }
  }

  return { values, unchecked };
}

export type EvaluationResult = {
  qualificationId: string;
  audienceSize: number;
  qualifiedCount: number;
  oneStepCount: number;
  removed: number;
  evaluatedAt: Date;
};

/**
 * How long a closed qualification keeps being re-evaluated.
 *
 * Not zero, and the reason is proof approval. A coach whose last piece of work lands
 * on the deadline needs an upline to approve it, and that happens when the upline
 * next opens the app — often the following week. Stopping the moment the window
 * closes would mean the work counted for nothing because somebody else was slow.
 *
 * For the four WINDOWED criteria the intent holds exactly: only the checking arrives
 * late, because every underlying row carries a time and the day-key bounds refuse
 * anything outside the window.
 *
 * For VOLUME it does not, and an audit corrected an earlier claim here that said it
 * did. `progressPoints` is one self-typed running total per month with no per-point
 * history (N4, N14), so what the bounds select is which MONTHS are read, never when
 * a point inside one was entered. Two consequences, both real and neither fixable
 * from this module:
 *
 *   late entry    points typed into a window month AFTER the deadline count, for as
 *                 long as this late-checking period runs. Usually that is a coach
 *                 catching up on paperwork, which is the behaviour we want; it is
 *                 also the one an upline would have to approve to make it pay.
 *
 *   back-fill     the baseline records what a coach had TYPED when they entered, not
 *                 what they had EARNED. A coach who logs the month's points in one go
 *                 afterwards has the whole month credited to the qualification.
 *
 * The fix for both is a per-point or per-approval record — `progressPointsAtReview`
 * on the proof, in `src/lib/targets-queries.ts`, an existing file this branch may not
 * touch. Reported, not done. See N14a.
 */
export const LATE_CHECK_DAYS = 7;

/** Recompute one qualification and write every row it owns. */
export async function evaluateQualification(
  qualificationId: string,
  q: QualificationDoc,
  now = new Date(),
  people?: UserRow[]
): Promise<EvaluationResult> {
  const all = people ?? (await loadUsers());
  const window = windowOf(q);
  const audience = audienceOf(q, all);
  const { values, unchecked } = await collect(q, window, audience, all);

  // Existing rows, for the baselines and for anything that must survive a rerun.
  const existingSnap = await boundedJobRead(qualificationProgress()
    .where("qualificationId", "==", qualificationId)
    .where("kind", "==", "progress"));
  const existing = new Map(
    existingSnap.docs.map((d) => [d.data().userId as string, d.data() as ProgressDoc])
  );

  const evaluatedAt = Timestamp.fromDate(now);
  const standings: Standing[] = [];
  let qualifiedCount = 0;
  let oneStepCount = 0;

  let batch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if (pending >= 400 || (force && pending > 0)) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (const member of audience) {
    const raw = values.get(member.id) ?? {};
    const claimed = unchecked.get(member.id) ?? {};
    const prior = existing.get(member.id);

    /**
     * The baseline is captured the first time this coach is seen on this
     * qualification, and never moves again. For the audience that existed at
     * creation that is the moment of creation, because the create route evaluates
     * synchronously. A coach who joins the line later starts from where they are on
     * the run that first sees them — which is the honest reading of "since you
     * joined this qualification" and errs towards under-counting rather than
     * handing them credit for work done under a different upline.
     */
    const baseline: CriterionCounts =
      prior?.baseline ??
      Object.fromEntries(
        // Driven by `measure` in the registry, never by a literal type name — a
        // hardcoded "volume" here would give a sixth cumulative criterion no
        // baseline at all, and it would count a lifetime total in silence (N13a).
        baselineTypes(q.criteria).map((type) => [type, raw[type] ?? 0])
      );

    const standing = standingOf(q.criteria, raw, baseline, claimed);
    standings.push(standing);

    /**
     * Qualifying LATCHES.
     *
     * Once a coach has been told they are in, they stay in. The only way a met
     * criterion can un-meet itself is an upline asking for fresh proof on a target
     * that was already approved — somebody else's action, after the fact — and
     * taking a badge back off a person who has already shared it is not something
     * this app is going to do. The per-criterion rows keep telling the truth, so a
     * tracker can show "You are in" beside a condition that has slipped; that is
     * rare, honest, and better than a bouncing badge.
     */
    const qualified = standing.qualified || prior?.qualified === true;
    const qualifiedAt =
      prior?.qualifiedAt ?? (qualified ? evaluatedAt : null);

    if (qualified) qualifiedCount++;
    else if (standing.stepsAway === 1) oneStepCount++;

    const doc: ProgressDoc = {
      workspaceId: member.workspaceId,
      kind: "progress",
      qualificationId,
      creatorId: q.creatorId,
      userId: member.id,
      userName: member.name,
      values: raw,
      baseline,
      unchecked: claimed,
      met: Object.fromEntries(standing.states.map((s) => [s.spec.id, s.met])),
      metCount: standing.metCount,
      stepsAway: standing.stepsAway,
      qualified,
      qualifiedAt,
      remindersSent: prior?.remindersSent ?? [],
      updatedAt: evaluatedAt,
    };
    batch.set(
      qualificationProgress().doc(progressDocId(qualificationId, member.id)),
      doc
    );
    pending++;
    await flush();
  }

  /**
   * Rows for coaches who are no longer in this line are DELETED, not left behind.
   *
   * N6a's finding, in a different feature: skipping a write leaves the previous run's
   * document readable, and here that document carries a person's name and numbers on
   * a qualifier list belonging to a line they have left.
   */
  const inAudience = new Set(audience.map((a) => a.id));
  let removed = 0;
  for (const doc of existingSnap.docs) {
    if (inAudience.has(doc.data().userId as string)) continue;
    batch.delete(doc.ref);
    pending++;
    removed++;
    await flush();
  }

  batch.set(qualificationProgress().doc(summaryDocId(qualificationId)), {
    kind: "summary",
    qualificationId,
    creatorId: q.creatorId,
    audienceSize: audience.length,
    qualifiedCount,
    oneStepCount,
    byCriterion: Object.fromEntries(
      dropOff(q.criteria, standings).map((r) => [r.type, r.drop])
    ),
    evaluatedAt,
  });
  pending++;
  await flush(true);

  return {
    qualificationId,
    audienceSize: audience.length,
    qualifiedCount,
    oneStepCount,
    removed,
    evaluatedAt: now,
  };
}

/**
 * Every qualification that is still open, plus those that closed recently enough for
 * a late proof approval to still count (see LATE_CHECK_DAYS).
 */
export async function evaluateOpenQualifications(
  now = new Date()
): Promise<EvaluationResult[]> {
  const cutoff = new Date(now.getTime() - LATE_CHECK_DAYS * 86_400_000);
  const snap = await boundedJobRead(qualifications()
    .where("closesAt", ">", Timestamp.fromDate(cutoff)));
  if (snap.empty) return [];

  // Loaded once and shared: every qualification resolves its audience against the
  // same tree, and re-reading the user collection per qualification is the fan-out
  // team.ts refuses to do.
  const people = await loadUsers();
  const out: EvaluationResult[] = [];
  for (const doc of snap.docs) {
    out.push(
      await evaluateQualification(doc.id, doc.data() as QualificationDoc, now, people)
    );
  }
  return out;
}

/**
 * How stale a stored evaluation may be before a page opening re-runs it.
 *
 * The scheduled evaluator is written but not deployed (its Cloud Function has to be
 * exported from an existing file this branch may not edit — see
 * the N-series in DECISIONS.md), so a tracker relying on it alone would show whatever the
 * creation-time run wrote and nothing after that. Fifteen minutes bounds the cost the
 * other way: however many coaches open the screen, one qualification is evaluated at
 * most four times an hour, instead of once per visitor.
 *
 * Concurrent refreshes are harmless — every write is an upsert on a deterministic id
 * with the same computed values, so two racing evaluations converge rather than
 * duplicate.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Re-evaluate if the stored numbers have aged out AND the qualification is still
 * within its late-checking period. A closed-and-settled qualification is never
 * recomputed: it is a finished record, and rebuilding it would let a late edit
 * rewrite who qualified.
 */
export async function ensureFresh(
  qualificationId: string,
  q: QualificationDoc,
  evaluatedAt: Date | null,
  now = new Date()
): Promise<boolean> {
  const settledAt = q.closesAt.toMillis() + LATE_CHECK_DAYS * 86_400_000;
  if (now.getTime() > settledAt) return false;
  if (evaluatedAt && now.getTime() - evaluatedAt.getTime() < STALE_AFTER_MS) return false;
  await evaluateQualification(qualificationId, q, now);
  return true;
}
