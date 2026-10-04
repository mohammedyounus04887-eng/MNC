import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { getUserById, type AppUser } from "@/lib/users";
import {
  EMPTY_SHEET,
  checkBlockerNote,
  checkBlockers,
  checkGoal,
  checkNeeds,
  checkNeedsAmount,
  checkWhy,
  isHoursOption,
  type GoalSheet,
} from "./model";

/**
 * Server side of the Goal Sheet.
 *
 * ## Why the private part is a separate document
 *
 * A2 requires two different visibilities on one sheet: the goals, blockers and hours are
 * COACHING MATERIAL the direct upline should see, while the personal reason — school fees,
 * a loan, leaving a job — is private unless the coach turns it on.
 *
 * Firestore Security Rules have no field-level reads. A rule that lets the upline read the
 * sheet lets them read every field on it, so "private by default" cannot be expressed on a
 * single document without moving the enforcement into app code — which A2 explicitly
 * forbids ("enforce in Security Rules, not only in the UI").
 *
 * So the sheet is split:
 *
 *   goalSheets/{userId}                 why, goals, blockers, hours, and the shareNeeds
 *                                       switch. Owner and DIRECT upline.
 *   goalSheets/{userId}/private/needs   the personal reason and its amount. Owner always;
 *                                       direct upline only while shareNeeds is true.
 *
 * The private document is a subcollection rather than a second top-level collection so the
 * two can never drift apart in the rules: the child's rule reads the parent's `shareNeeds`
 * with a `get()`, exactly the shape the F11 prospect toggle uses.
 *
 * ## Direct upline only, never the chain
 *
 * `uplinePath` would be the cheap check and it is the wrong one — it contains every
 * ancestor up to 100 hops (D36). A2 says the DIRECT upline, so both the rules and this
 * file compare `uplineId`. A goal sheet is a conversation between two people.
 */

export const GOAL_SHEETS = "goalSheets";
export const PRIVATE_SUB = "private";
export const NEEDS_DOC = "needs";

export const goalSheets = () => db.collection(GOAL_SHEETS);

const needsRef = (userId: string) =>
  goalSheets().doc(userId).collection(PRIVATE_SUB).doc(NEEDS_DOC);

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

function toSheet(userId: string, snap: DocumentSnapshot | null): GoalSheet {
  const d = snap?.data();
  if (!d) return { userId, ...EMPTY_SHEET, updatedAt: null };
  return {
    userId,
    why: (d.why as string) ?? "",
    hoursPerDay: isHoursOption(d.hoursPerDay) ? d.hoursPerDay : null,
    shortTermGoal: (d.shortTermGoal as string) ?? "",
    shortTermByKey: (d.shortTermByKey as string) ?? null,
    longTermGoal: (d.longTermGoal as string) ?? "",
    blockers: checkBlockers(d.blockers),
    blockerNote: (d.blockerNote as string) ?? "",
    // Never populated from this document — the private half lives elsewhere and is only
    // merged in by a caller that has established it may see it.
    needs: "",
    needsAmount: null,
    shareNeeds: d.shareNeeds === true,
    dreamPhotoUrl: (d.dreamPhotoUrl as string) ?? null,
    updatedAt: toDate(d.updatedAt),
  };
}

/** The coach's own sheet, private half included. Only ever called for the owner. */
export async function getOwnSheet(userId: string): Promise<GoalSheet> {
  const [sheetSnap, needsSnap] = await Promise.all([
    goalSheets().doc(userId).get(),
    needsRef(userId).get(),
  ]);
  const sheet = toSheet(userId, sheetSnap);
  const n = needsSnap.data();
  return {
    ...sheet,
    needs: (n?.needs as string) ?? "",
    needsAmount: typeof n?.needsAmount === "number" ? (n.needsAmount as number) : null,
  };
}

export type UplineSheetView =
  | { ok: false; reason: "not-direct-upline" }
  | { ok: true; sheet: GoalSheet; sawPrivate: boolean };

/**
 * The sheet as the DIRECT upline is allowed to see it.
 *
 * Two decisions are re-derived here rather than trusted: that the reader is the coach's
 * direct upline, and whether the private half may be merged in. The Security Rules say the
 * same thing for a hand-written query; this is what governs what the server renders.
 */
export async function getSheetForUpline(
  coachId: string,
  readerId: string
): Promise<UplineSheetView> {
  const coach = await getUserById(coachId);
  if (!coach || coach.uplineId !== readerId) return { ok: false, reason: "not-direct-upline" };

  const sheetSnap = await goalSheets().doc(coachId).get();
  const sheet = toSheet(coachId, sheetSnap);

  if (!sheet.shareNeeds) return { ok: true, sheet, sawPrivate: false };

  const n = (await needsRef(coachId).get()).data();
  return {
    ok: true,
    sawPrivate: true,
    sheet: {
      ...sheet,
      needs: (n?.needs as string) ?? "",
      needsAmount: typeof n?.needsAmount === "number" ? (n.needsAmount as number) : null,
    },
  };
}

export type SheetUpdate = Partial<{
  why: unknown;
  hoursPerDay: unknown;
  shortTermGoal: unknown;
  shortTermByKey: unknown;
  longTermGoal: unknown;
  blockers: unknown;
  blockerNote: unknown;
  needs: unknown;
  needsAmount: unknown;
  shareNeeds: unknown;
}>;

export type SaveResult = { ok: true; sheet: GoalSheet } | { ok: false; error: string };

/**
 * Saves whatever the coach edited. A partial update by design: A1 requires three short
 * skippable steps, so every save is a fragment and an absent key means "unchanged" rather
 * than "cleared".
 *
 * The private fields are written to the subcollection, never to the parent — putting them
 * on the parent even once would hand them to every direct upline permitted to read it.
 */
export async function saveOwnSheet(
  userId: string,
  update: SheetUpdate
): Promise<SaveResult> {
  const parent: Record<string, unknown> = {};
  const priv: Record<string, unknown> = {};

  if (update.why !== undefined) {
    const c = checkWhy(update.why);
    if (!c.ok) return { ok: false, error: c.error };
    parent.why = c.value;
  }
  if (update.shortTermGoal !== undefined) {
    const c = checkGoal(update.shortTermGoal);
    if (!c.ok) return { ok: false, error: c.error };
    parent.shortTermGoal = c.value;
  }
  if (update.longTermGoal !== undefined) {
    const c = checkGoal(update.longTermGoal);
    if (!c.ok) return { ok: false, error: c.error };
    parent.longTermGoal = c.value;
  }
  if (update.blockerNote !== undefined) {
    const c = checkBlockerNote(update.blockerNote);
    if (!c.ok) return { ok: false, error: c.error };
    parent.blockerNote = c.value;
  }
  if (update.hoursPerDay !== undefined) {
    parent.hoursPerDay = isHoursOption(update.hoursPerDay) ? update.hoursPerDay : null;
  }
  if (update.blockers !== undefined) parent.blockers = checkBlockers(update.blockers);
  if (update.shortTermByKey !== undefined) {
    const key = update.shortTermByKey;
    // "YYYY-MM-DD" or nothing. A malformed date is dropped rather than rejected: the
    // date is optional and a coach should not be stopped by a picker quirk.
    parent.shortTermByKey =
      typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  }
  if (update.shareNeeds !== undefined) {
    // Strict boolean, no coercion — same reasoning as the F11 toggle (D50).
    // `Boolean("false")` is true, and turning sharing ON when the coach meant off is the
    // one mistake this field must not be able to make.
    if (typeof update.shareNeeds !== "boolean") {
      return { ok: false, error: "Could not save that setting." };
    }
    parent.shareNeeds = update.shareNeeds;
  }

  if (update.needs !== undefined) {
    const c = checkNeeds(update.needs);
    if (!c.ok) return { ok: false, error: c.error };
    priv.needs = c.value;
  }
  if (update.needsAmount !== undefined) {
    priv.needsAmount = checkNeedsAmount(update.needsAmount);
  }

  const writes: Promise<unknown>[] = [];
  if (Object.keys(parent).length > 0) {
    writes.push(
      goalSheets().doc(userId).set({ ...parent, updatedAt: Timestamp.now() }, { merge: true })
    );
  }
  if (Object.keys(priv).length > 0) {
    writes.push(needsRef(userId).set({ ...priv, updatedAt: Timestamp.now() }, { merge: true }));
  }
  await Promise.all(writes);

  return { ok: true, sheet: await getOwnSheet(userId) };
}

/**
 * The talking-points card (A3): what the upline sees before they set a number.
 *
 * Assembled from the sheet plus real activity, and deliberately NOT from anything
 * financial — no amount is read here even when the coach has shared one, because this
 * string sits next to a target and RULES L4 governs what may appear there. The private
 * reason belongs on the sheet the upline reads first, not stapled to a number.
 */
export function talkingPoints(
  sheet: GoalSheet,
  activity: { loggedDays: number; ofDays: number; invitesPerDay: number | null }
): string[] {
  const points: string[] = [];
  if (sheet.shortTermGoal.trim()) points.push(`Working towards: ${sheet.shortTermGoal.trim()}`);
  if (sheet.hoursPerDay !== null) points.push(`Has about ${sheet.hoursPerDay}h a day`);
  if (sheet.blockers.length > 0 || sheet.blockerNote.trim()) {
    points.push(
      `In the way: ${[...sheet.blockers, sheet.blockerNote.trim()].filter(Boolean).join(", ")}`
    );
  }
  points.push(`Logged ${activity.loggedDays} of the last ${activity.ofDays} days`);
  if (activity.invitesPerDay !== null) {
    points.push(`Currently about ${activity.invitesPerDay} invites a day`);
  }
  return points;
}

export type AppUserLike = Pick<AppUser, "id" | "uplineId">;
