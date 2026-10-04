import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { boundedJobRead } from "@/modules/shared-new/job-scope";
import { APP_TIMEZONE, dayKey } from "@/lib/day";
import type { AppUser } from "@/lib/users";
import { audienceCount } from "@/lib/threads-queries";
import { closesAt, daysLeft, type DayWindow } from "@/modules/shared-new/window";
import type { CriterionType } from "./criteria";
import {
  qualificationProgress,
  qualifications,
  type CriterionDropOff,
  type ProgressDoc,
  type QualificationDoc,
  type SummaryDoc,
} from "./docs";
import { progressDocId, qualificationDocId, summaryDocId } from "./ids";
import {
  inAudience,
  windowOf,
  type Audience,
  type QualificationDefinition,
} from "./model";
import { ensureFresh, evaluateQualification } from "./evaluate";
import {
  dropOff,
  nudgeFor,
  standingOf,
  type Nudge,
  type Standing,
} from "./progress";

/**
 * The read side: stored rows in, one reader's view out. Server only.
 *
 * ## Who may see what
 *
 * Three positions, and they are decided here from the CURRENT user document rather
 * than from anything stored on a qualification (D64):
 *
 *   creator      sees the dashboard: counts, per-criterion drop-off, and the names of
 *                the coaches who are one condition away. Every one of those people is
 *                in their own line, so the counts already flow to them (P1) and the
 *                team tree already shows them coach by coach.
 *
 *   participant  sees their own tracker in full, the NAMES of everyone who has
 *                qualified, and a COUNT of how many are one condition away — never
 *                the names of that second group. Being in is good news and an event
 *                list is public by nature; being nearly-in is somebody's shortfall,
 *                and publishing a named list of shortfalls to their peers is the
 *                leaderboard leak N2 exists to prevent, wearing different clothes.
 *
 *   anybody else "Not found" — the same answer as a qualification that does not
 *                exist, so no route here can be used to discover what an upline in
 *                another line is running (the discipline targets-queries.ts uses).
 *
 * No prospect name, phone or health field is read anywhere in this file. The only
 * personal data that moves is a COACH's own name, to people already in their line.
 */

/** Enough names for a card; the counts beside them come from the summary, not this. */
export const MAX_LISTED = 12;

export type Viewer = "creator" | "participant";

/** The evaluator's own predicate (model.ts), so the two seats cannot disagree. */
export function isParticipant(q: QualificationDoc, user: AppUser): boolean {
  return Boolean(user.workspaceId && q.workspaceId === user.workspaceId) && inAudience(q.audience, q.creatorId, user);
}

function toStanding(q: QualificationDoc, row: ProgressDoc | null): Standing {
  const computed = standingOf(
    q.criteria,
    row?.values ?? {},
    row?.baseline ?? {},
    row?.unchecked ?? {}
  );
  // The stored flag latches (see evaluate.ts); the per-criterion rows keep telling
  // the truth. Both are shown, and the latch wins on "are you in".
  return { ...computed, qualified: computed.qualified || row?.qualified === true };
}

async function readSummary(id: string): Promise<SummaryDoc | null> {
  const snap = await qualificationProgress().doc(summaryDocId(id)).get();
  return snap.exists ? (snap.data() as SummaryDoc) : null;
}

async function readRows(id: string, q: QualificationDoc): Promise<ProgressDoc[]> {
  const snap = await boundedJobRead(qualificationProgress()
    .where("qualificationId", "==", id)
    .where("kind", "==", "progress"));
  const rows = snap.docs.map((d) => d.data() as ProgressDoc).filter((row) => row.workspaceId === q.workspaceId && typeof row.userId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(row.userId));
  const current: ProgressDoc[] = [];
  // Cached progress must not disclose the name of a coach who has moved away.
  for (let start = 0; start < rows.length; start += 128) {
    const page = rows.slice(start, start + 128);
    const members = await db.getAll(...page.map((row) => db.doc(`users/${row.userId}`)), { fieldMask: ["workspaceId", "uplineId", "uplinePath", "disabled"] });
    page.forEach((row, index) => {
      const member = members[index];
      const path: unknown = member.get("uplinePath");
      if (member.exists && member.get("workspaceId") === q.workspaceId && member.get("disabled") !== true &&
          (q.audience === "direct" ? member.get("uplineId") === q.creatorId : Array.isArray(path) && path.includes(q.creatorId))) current.push(row);
    });
  }
  return current;
}

export type QualificationView = {
  id: string;
  title: string;
  creatorId: string;
  creatorName: string;
  audience: Audience;
  criteria: QualificationDoc["criteria"];
  window: DayWindow;
  daysLeft: number;
  open: boolean;
  evaluatedAt: Date | null;
};

function toView(id: string, q: QualificationDoc, now: Date): QualificationView {
  const window = windowOf(q);
  return {
    id,
    title: q.title,
    creatorId: q.creatorId,
    creatorName: q.creatorName,
    audience: q.audience,
    criteria: q.criteria,
    window,
    daysLeft: daysLeft(window, now),
    open: dayKey(now, window.timeZone) <= window.toKey,
    evaluatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Writes the qualification and evaluates it in the same request.
 *
 * The synchronous evaluation is what makes the tracker real the moment it is
 * announced: a coach who taps through from the message their upline just sent sees
 * their own numbers, not an empty frame promising that a job will run later. It also
 * fixes the baseline for a cumulative criterion at the instant of creation rather
 * than at the first scheduled run, which is the only point in time a coach would
 * accept as "when this started".
 */
export async function createQualification(
  creator: AppUser,
  definition: QualificationDefinition,
  now = new Date()
): Promise<CreateResult> {
  const reach = await audienceCount(creator, definition.audience);
  if (reach === 0) {
    return {
      ok: false,
      error:
        definition.audience === "direct"
          ? "You have no direct line yet, so nobody would be in this."
          : "You have nobody in your line yet, so nobody would be in this.",
    };
  }

  const id = qualificationDocId(creator.id, definition.title, definition.deadlineKey);
  const ref = qualifications().doc(id);
  /**
   * The id is deterministic (ids.ts), so a double-tapped button lands on the same
   * document instead of creating a twin. Refusing an existing id rather than
   * overwriting it is the other half: a qualification people are already measured
   * against must not have its conditions silently replaced, and there is no edit
   * screen precisely because a moving target is not a target.
   */
  if ((await ref.get()).exists) {
    return {
      ok: false,
      error: "You already have one with this name and closing date.",
    };
  }

  const fromKey = dayKey(now, definition.timeZone);
  const doc: QualificationDoc = {
    creatorId: creator.id,
    workspaceId: creator.workspaceId,
    creatorName: creator.name,
    title: definition.title,
    criteria: definition.criteria,
    audience: definition.audience,
    fromKey,
    deadlineKey: definition.deadlineKey,
    timeZone: definition.timeZone,
    closesAt: Timestamp.fromDate(
      closesAt({ fromKey, toKey: definition.deadlineKey, timeZone: definition.timeZone })
    ),
    createdAt: Timestamp.fromDate(now),
  };
  await ref.set(doc);
  await evaluateQualification(id, doc, now);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type ListedQualification = QualificationView & {
  role: Viewer;
  /** Present only for a participant — a creator is never in their own audience. */
  standing: Standing | null;
  nudge: Nudge | null;
  /**
   * When the standing on this card was last computed, or null if it never has been.
   *
   * The list does NOT refresh stale rows the way the detail page does, and it must
   * not: `ensureFresh` reads a whole slice of the organisation, and doing that once
   * per card would turn opening a list into N of them. So the honest move is to say
   * how old the number is rather than to present it as this minute's — see N21a. It
   * costs nothing: `updatedAt` is already on the row the card reads.
   */
  countedAt: Date | null;
};

/**
 * Everything this coach can see: what they are in, and what they run.
 *
 * The "what am I in" half is answered from the reader's own ancestors rather than by
 * scanning qualifications for one whose audience matches — `uplinePath` is exactly the
 * list of people who could have addressed them (D36), the same trick F8's inbox uses.
 */
export async function listForCoach(
  user: AppUser,
  now = new Date()
): Promise<ListedQualification[]> {
  const creatorIds = [user.id, ...(user.uplineId ? [user.uplineId] : []), ...user.uplinePath];
  const unique = [...new Set(creatorIds)];

  const docs = new Map<string, QualificationDoc>();
  // `in` takes at most 30 values, and a line can be 100 deep (D36).
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await qualifications()
      .where("creatorId", "in", unique.slice(i, i + 30))
      .get();
    for (const d of snap.docs) docs.set(d.id, d.data() as QualificationDoc);
  }

  const mine: ListedQualification[] = [];
  for (const [id, q] of docs) {
    if (!user.workspaceId || q.workspaceId !== user.workspaceId) continue;
    const creator = q.creatorId === user.id;
    if (!creator && !isParticipant(q, user)) continue;

    const view = toView(id, q, now);
    if (creator) {
      mine.push({
        ...view,
        role: "creator",
        standing: null,
        nudge: null,
        countedAt: null,
      });
      continue;
    }
    const snap = await qualificationProgress().doc(progressDocId(id, user.id)).get();
    const row = snap.exists ? (snap.data() as ProgressDoc) : null;
    const standing = toStanding(q, row);
    mine.push({
      ...view,
      role: "participant",
      standing,
      nudge: nudgeFor(standing, view.daysLeft),
      countedAt: toDate(row?.updatedAt),
    });
  }

  // Closing soonest first: a deadline is the only ordering that matters here, and
  // the one a coach is scanning for. Closed ones sink to the bottom by the same rule.
  return mine.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    return a.window.toKey.localeCompare(b.window.toKey);
  });
}

// ---------------------------------------------------------------------------
// One qualification, from one reader's seat
// ---------------------------------------------------------------------------

export type Qualifier = { userId: string; name: string; qualifiedAt: Date | null };

export type ParticipantView = QualificationView & {
  role: "participant";
  standing: Standing;
  nudge: Nudge;
  /** When the reader themselves got in. Read off their own row, never matched by name. */
  qualifiedAt: Date | null;
  qualified: Qualifier[];
  qualifiedCount: number;
  /** A COUNT, never names — see the header. */
  oneStepCount: number;
};

export type CloseCoach = {
  userId: string;
  name: string;
  /** The one condition left, in its own words: "2 members away". */
  remaining: string;
  type: CriterionType;
  /**
   * How far through that last condition they are, 0–1. Not rendered — it is what the
   * list is ordered by, because "2 members away" and "600 points away" cannot be
   * compared as numbers and sorting the SENTENCES would order this list
   * alphabetically while claiming to order it by nearness.
   */
  fraction: number;
};

export type CreatorView = QualificationView & {
  role: "creator";
  audienceSize: number;
  qualifiedCount: number;
  oneStepCount: number;
  qualified: Qualifier[];
  close: CloseCoach[];
  dropOff: { type: CriterionType; drop: CriterionDropOff }[];
};

export type DetailView = ParticipantView | CreatorView | null;

const toDate = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : null;

/**
 * One qualification, rendered for whoever is asking.
 *
 * Refreshes the stored numbers first if they have gone stale (see
 * `ensureFresh`) — bounded to one evaluation per qualification per quarter hour,
 * however many people open the screen.
 */
export async function getQualificationFor(
  id: string,
  user: AppUser,
  now = new Date()
): Promise<DetailView> {
  const snap = await qualifications().doc(id).get();
  if (!snap.exists) return null;
  const q = snap.data() as QualificationDoc;
  if (!user.workspaceId || q.workspaceId !== user.workspaceId) return null;

  const creator = q.creatorId === user.id;
  // Same answer for "not yours" as for "does not exist".
  if (!creator && !isParticipant(q, user)) return null;

  let summary = await readSummary(id);
  if (await ensureFresh(id, q, toDate(summary?.evaluatedAt), now)) {
    summary = await readSummary(id);
  }

  const rows = await readRows(id, q);
  const view = { ...toView(id, q, now), evaluatedAt: toDate(summary?.evaluatedAt) };

  const qualified: Qualifier[] = rows
    .filter((r) => r.qualified)
    .map((r) => ({
      userId: r.userId,
      name: r.userName,
      qualifiedAt: toDate(r.qualifiedAt),
    }))
    // Earliest first: the order people got there in, which is the order a room
    // would read them out in.
    .sort((a, b) => (a.qualifiedAt?.getTime() ?? 0) - (b.qualifiedAt?.getTime() ?? 0));

  const standings = rows.map((r) => toStanding(q, r));

  if (!creator) {
    const own = rows.find((r) => r.userId === user.id) ?? null;
    const standing = toStanding(q, own);
    return {
      ...view,
      role: "participant",
      standing,
      nudge: nudgeFor(standing, view.daysLeft),
      qualifiedAt: toDate(own?.qualifiedAt),
      qualified: qualified.slice(0, MAX_LISTED),
      qualifiedCount: qualified.length,
      oneStepCount: standings.filter((s) => !s.qualified && s.stepsAway === 1).length,
    };
  }

  const close: CloseCoach[] = [];
  for (const row of rows) {
    if (row.qualified) continue;
    const standing = toStanding(q, row);
    if (standing.stepsAway !== 1) continue;
    const blocker = standing.states.find((s) => !s.met);
    if (!blocker) continue;
    close.push({
      userId: row.userId,
      name: row.userName,
      remaining: blocker.spec.remaining(blocker.remaining),
      type: blocker.spec.id,
      fraction: blocker.fraction,
    });
  }
  // Nearest first, so the people worth a phone call today are at the top.
  close.sort((a, b) => b.fraction - a.fraction || a.name.localeCompare(b.name));

  return {
    ...view,
    role: "creator",
    audienceSize: rows.length,
    qualifiedCount: qualified.length,
    oneStepCount: close.length,
    qualified: qualified.slice(0, MAX_LISTED),
    close: close.slice(0, MAX_LISTED),
    dropOff: dropOff(q.criteria, standings).map((r) => ({ type: r.type, drop: r.drop })),
  };
}

/** The two audience sizes, for the create form. */
export async function audienceSizes(user: AppUser) {
  const [direct, all] = await Promise.all([
    audienceCount(user, "direct"),
    audienceCount(user, "all"),
  ]);
  return { direct, all };
}

export const DEFAULT_TIMEZONE = APP_TIMEZONE;
