import type { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import type { Criterion, CriterionType } from "./criteria";
import type { Audience } from "./model";

/**
 * Firestore shapes and document ids for the two qualification collections.
 *
 * ## Two collections, and the split is the privacy line
 *
 *   qualifications        the DEFINITION: who made it, what it is called, the
 *                         conditions, the closing date. Readable by the creator and
 *                         by the coaches it applies to — it is an announcement, and
 *                         a condition nobody can read is not a condition.
 *
 *   qualificationProgress everybody's NUMBERS, plus the roll-up over them. Denied to
 *                         every client, always.
 *
 * The split is deliberate and mirrors N7's podium/roster split for the same reason.
 * If the counts lived on the definition document, "readable by the audience" would
 * hand every participant the audience size, every other coach's shortfall, and the
 * full distribution — and the honest qualifier list this module renders would be a
 * courtesy rather than a guarantee. The screens read the numbers server-side with the
 * Admin SDK and hand the browser only what that reader is entitled to.
 *
 * ## Two kinds in the progress collection
 *
 * `progress` (one per participant) and `summary` (one per qualification), separated
 * by a `kind` field — the same arrangement as N7, and for the same reason: this
 * branch may create `qualificationProgress` and nothing else, so the roll-up lives
 * beside the rows it rolls up.
 *
 * Document ids are deterministic and live in `ids.ts` — kept out of this file so a
 * unit test can import them without booting firebase-admin.
 */

export const QUALIFICATIONS = "qualifications";
export const QUALIFICATION_PROGRESS = "qualificationProgress";

/** Numbers keyed by criterion type. Absent means zero — see `readCounts`. */
export type CriterionCounts = Partial<Record<CriterionType, number>>;
export type CriterionFlags = Partial<Record<CriterionType, boolean>>;

export type QualificationDoc = {
  workspaceId?: string;
  creatorId: string;
  /** Denormalised so a participant's card needs no user read. */
  creatorName: string;
  title: string;
  criteria: Criterion[];
  audience: Audience;
  /** First local day that counts — the day it was created. */
  fromKey: string;
  /** Last local day that counts, inclusive. */
  deadlineKey: string;
  /** The zone those two keys name days in (E1). */
  timeZone: string;
  /** Derived from `deadlineKey`: the instant after its last day. Stored to query on. */
  closesAt: Timestamp;
  createdAt: Timestamp;
};

export type ProgressDoc = {
  workspaceId?: string;
  kind: "progress";
  qualificationId: string;
  /** Denormalised: lets the server gather one creator's rows without a join. */
  creatorId: string;
  userId: string;
  /** Denormalised so the qualifier list needs no user read per row. */
  userName: string;
  /** What this coach has done, per criterion, inside the window. */
  values: CriterionCounts;
  /**
   * Where a cumulative criterion stood when this coach entered the qualification.
   * Progress is `value - baseline`; windowed criteria are always 0 here. See
   * `evaluate.ts` for why a cumulative figure cannot be used raw.
   */
  baseline: CriterionCounts;
  /** Claimed but unchecked — carried alongside, never added to `values` (L4/N4). */
  unchecked: CriterionCounts;
  met: CriterionFlags;
  metCount: number;
  /** Criteria still unmet. 0 means qualified; 1 is what "one step away" means. */
  stepsAway: number;
  qualified: boolean;
  qualifiedAt: Timestamp | null;
  /** Reminder bands already sent, so an escalation never repeats itself. */
  remindersSent: string[];
  updatedAt: Timestamp;
};

export type CriterionDropOff = {
  /** How many participants have cleared it. */
  met: number;
  /** How many have not. */
  blocked: number;
  /** How many have this as their ONLY remaining condition — the sharp number. */
  soleBlocker: number;
  /** Middle remaining amount among the blocked. Median, not mean — see progress.ts. */
  medianRemaining: number;
};

export type SummaryDoc = {
  kind: "summary";
  qualificationId: string;
  creatorId: string;
  audienceSize: number;
  qualifiedCount: number;
  /** Participants with exactly one criterion left. */
  oneStepCount: number;
  byCriterion: Partial<Record<CriterionType, CriterionDropOff>>;
  evaluatedAt: Timestamp;
};

export const qualifications = () => db.collection(QUALIFICATIONS);
export const qualificationProgress = () => db.collection(QUALIFICATION_PROGRESS);

/** A stored map with holes in it reads as zeroes, never as NaN on a coach's screen. */
export function readCount(counts: CriterionCounts | undefined, type: CriterionType) {
  return counts?.[type] ?? 0;
}
