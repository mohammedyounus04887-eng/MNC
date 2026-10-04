/**
 * The Goal Sheet ("My Why") — Feature A.
 *
 * ## What it is for
 *
 * Target-setting today is top-down: an upline picks a number and pushes it down. An
 * imposed quota gets resented and quietly ignored. A target somebody agreed to, built from
 * their own reason for being here, gets worked. This is the sheet that makes the second
 * one possible.
 *
 * ## The compliance line, stated once here because everything else obeys it
 *
 * RULES L4 forbids income, earnings or commission anywhere — no ₹ figure, no conversion,
 * no projection. That sits awkwardly beside a feature whose whole point is somebody's real
 * reason for joining, which is usually money. The resolution:
 *
 *   - A coach may WRITE their own reason in their own words, including an amount. That is
 *     their statement about their life, not the app's claim about their earnings, and it
 *     is private by default (A2).
 *   - The app never COMPUTES with that amount. The reverse-math below takes a volume
 *     target and returns activity — invites per day. Money is never an input and never an
 *     output. `suggestActivityPath` cannot see the amount; it is not passed one.
 *
 * That is the difference between recording what somebody said and the product implying
 * what they will earn. The first is the feature; the second is the thing that gets an app
 * taken down.
 *
 * PURE ONLY — no database import. The sheet is a client component (RULES E2).
 */

/**
 * The blockers a coach can name. Chosen to be the things an upline can actually DO
 * something about, because A3 turns each one into an assigned action — a blocker with no
 * possible response is just a complaint box.
 */
export const BLOCKERS = [
  { key: "time", label: "Not enough time" },
  { key: "confidence", label: "Not confident talking to people" },
  { key: "invites", label: "People say yes, then don't come" },
  { key: "family", label: "Family isn't supportive" },
  { key: "customers", label: "No customers yet" },
  { key: "knowledge", label: "Don't know the products well enough" },
] as const;

export type BlockerKey = (typeof BLOCKERS)[number]["key"];

export function isBlockerKey(value: unknown): value is BlockerKey {
  return (
    typeof value === "string" && BLOCKERS.some((b) => b.key === value)
  );
}

/** Hours a coach can realistically give. A picker, not a free number — see checkHours. */
export const HOURS_OPTIONS = [1, 2, 3, 4, 6, 8] as const;
export type HoursPerDay = (typeof HOURS_OPTIONS)[number];

export function isHoursOption(value: unknown): value is HoursPerDay {
  return typeof value === "number" && (HOURS_OPTIONS as readonly number[]).includes(value);
}

export const MAX_WHY = 400;
export const MAX_GOAL = 200;
export const MAX_NEEDS = 400;
export const MAX_BLOCKER_NOTE = 300;

/** ~90 days, per A1. Kept as a number of days so the check has no clock in it (E1). */
export const SHORT_TERM_MAX_DAYS = 120;

export type GoalSheet = {
  userId: string;
  /** Step 1 */
  why: string;
  hoursPerDay: HoursPerDay | null;
  /** Step 2 */
  shortTermGoal: string;
  shortTermByKey: string | null;
  longTermGoal: string;
  /** Step 3 */
  blockers: BlockerKey[];
  blockerNote: string;
  /**
   * The real reason — school fees, a vehicle, a loan. PRIVATE BY DEFAULT (A2).
   *
   * `shareNeeds` is the coach's own switch and defaults false. Nothing reads `needs` or
   * `needsAmount` unless it is true, and the Security Rules enforce that rather than the
   * UI — the same shape as the F11 prospect toggle, and for the same reason.
   */
  needs: string;
  needsAmount: number | null;
  shareNeeds: boolean;
  /** Optional dream photo. Not built yet — Storage is deny-all (D49). */
  dreamPhotoUrl: string | null;
  updatedAt: Date | null;
};

export const EMPTY_SHEET: Omit<GoalSheet, "userId" | "updatedAt"> = {
  why: "",
  hoursPerDay: null,
  shortTermGoal: "",
  shortTermByKey: null,
  longTermGoal: "",
  blockers: [],
  blockerNote: "",
  needs: "",
  needsAmount: null,
  shareNeeds: false, // A2 — never default this to true
  dreamPhotoUrl: null,
};

/**
 * The three steps, and what counts as having done each.
 *
 * A1 requires the sheet never be presented as one long form, so completion is measured in
 * steps rather than fields — a coach who filled step 1 has genuinely made progress and the
 * meter should say so. Nothing here is required: every step is skippable, and an empty
 * sheet is a valid sheet belonging to somebody who has not got to it yet.
 */
export const GOAL_STEPS = [
  { key: "why", title: "Why you joined" },
  { key: "goals", title: "What you're working towards" },
  { key: "blockers", title: "What's in the way" },
] as const;

export type GoalStepKey = (typeof GOAL_STEPS)[number]["key"];

export function stepDone(
  sheet: Pick<
    GoalSheet,
    "why" | "hoursPerDay" | "shortTermGoal" | "longTermGoal" | "blockers" | "blockerNote"
  >,
  step: GoalStepKey
): boolean {
  if (step === "why") return sheet.why.trim().length > 0 || sheet.hoursPerDay !== null;
  if (step === "goals") {
    return sheet.shortTermGoal.trim().length > 0 || sheet.longTermGoal.trim().length > 0;
  }
  return sheet.blockers.length > 0 || sheet.blockerNote.trim().length > 0;
}

/** Completed steps out of three, plus a whole percent for the meter. */
export function completion(
  sheet: Parameters<typeof stepDone>[0]
): { done: number; total: number; pct: number } {
  const done = GOAL_STEPS.filter((s) => stepDone(sheet, s.key)).length;
  return { done, total: GOAL_STEPS.length, pct: Math.round((done / GOAL_STEPS.length) * 100) };
}

/**
 * Whether the coach has enough on the sheet for a target conversation to be worth having.
 *
 * A3 says an upline cannot open target-setting without seeing the sheet. It does NOT say
 * the sheet must be complete — blocking a coach's target because their downline has not
 * filled a form would punish the wrong person. So this decides what the talking-points
 * card can say, not whether the flow may proceed.
 */
export function hasSomethingToTalkAbout(sheet: Parameters<typeof stepDone>[0]): boolean {
  return completion(sheet).done > 0;
}

export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

function checkText(raw: unknown, max: number, label: string): TextCheck {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: `Could not read your ${label}.` };
  const value = raw.trim();
  if (value.length > max) return { ok: false, error: `Keep your ${label} under ${max} characters.` };
  return { ok: true, value };
}

export const checkWhy = (raw: unknown) => checkText(raw, MAX_WHY, "reason");
export const checkGoal = (raw: unknown) => checkText(raw, MAX_GOAL, "goal");
export const checkNeeds = (raw: unknown) => checkText(raw, MAX_NEEDS, "note");
export const checkBlockerNote = (raw: unknown) => checkText(raw, MAX_BLOCKER_NOTE, "note");

/** Blockers, deduped, unknown keys dropped rather than rejected. */
export function checkBlockers(raw: unknown): BlockerKey[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<BlockerKey>();
  for (const entry of raw) if (isBlockerKey(entry)) seen.add(entry);
  return BLOCKERS.map((b) => b.key).filter((k) => seen.has(k));
}

/**
 * The amount a coach types beside their personal reason.
 *
 * Stored, never computed with. It exists so an upline reading a shared sheet understands
 * the scale of what somebody is working towards; it is not an input to any suggestion and
 * never appears next to a target. See the compliance note at the top of this file.
 */
export function checkNeedsAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export type ActivityPath = {
  /** The monthly volume the humans are discussing. Points, never currency. */
  volumeTarget: number;
  /** Volume one member typically accounts for, from the upline's own experience. */
  volumePerMember: number;
  membersNeeded: number;
  /** How many invites it takes to gain one member, from the upline's own experience. */
  invitesPerMember: number;
  invitesNeeded: number;
  workingDays: number;
  invitesPerDay: number;
};

export const DEFAULT_VOLUME_PER_MEMBER = 100;
export const DEFAULT_INVITES_PER_MEMBER = 10;
export const DEFAULT_WORKING_DAYS = 26;

/**
 * The reverse-math: a volume target becomes a daily activity number.
 *
 * **Money is neither an input nor an output.** It takes volume points and two conversion
 * assumptions and returns invites per day. There is no rupee figure in the signature,
 * which is the point — a function that cannot see an amount cannot project an income from
 * it, and RULES L4 stops being something to remember and starts being something the type
 * system enforces.
 *
 * Every assumption is a parameter with a default, because A3 is explicit that the app
 * SUGGESTS and humans decide. The upline knows their own line's real conversion; the
 * defaults are a starting point to argue with, never an answer. Nothing here is ever
 * auto-applied to a target.
 */
export function suggestActivityPath(params: {
  volumeTarget: number;
  volumePerMember?: number;
  invitesPerMember?: number;
  workingDays?: number;
}): ActivityPath | null {
  const volumeTarget = Math.max(0, Math.round(params.volumeTarget || 0));
  const volumePerMember = Math.max(1, Math.round(params.volumePerMember ?? DEFAULT_VOLUME_PER_MEMBER));
  const invitesPerMember = Math.max(1, Math.round(params.invitesPerMember ?? DEFAULT_INVITES_PER_MEMBER));
  const workingDays = Math.max(1, Math.round(params.workingDays ?? DEFAULT_WORKING_DAYS));

  if (volumeTarget <= 0) return null;

  // Ceilings throughout: two-and-a-bit members is three people, and a path that rounds
  // down is a path that misses the target it was derived from.
  const membersNeeded = Math.ceil(volumeTarget / volumePerMember);
  const invitesNeeded = membersNeeded * invitesPerMember;
  const invitesPerDay = Math.ceil(invitesNeeded / workingDays);

  return {
    volumeTarget,
    volumePerMember,
    membersNeeded,
    invitesPerMember,
    invitesNeeded,
    workingDays,
    invitesPerDay,
  };
}

/**
 * Whether a suggested path is realistic against the hours the coach said they have.
 *
 * A3's blockers-become-actions only works if the app is honest when the arithmetic asks
 * for more than somebody has. This does not block anything — it gives the upline a reason
 * to lower the number or to solve the time problem first, which is the conversation the
 * whole feature exists to start.
 */
export const INVITES_PER_HOUR = 3;

export function pathFitsHours(path: ActivityPath, hoursPerDay: HoursPerDay | null): boolean {
  if (hoursPerDay === null) return true; // unknown is not a warning
  return path.invitesPerDay <= hoursPerDay * INVITES_PER_HOUR;
}
