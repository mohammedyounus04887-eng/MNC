import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { daysBetweenKeys } from "@/lib/daily-log";
import { checkText } from "@/modules/shared-new/text";
import { isDayKey, makeWindow, type DayWindow } from "@/modules/shared-new/window";
import { checkCriteria, type Criterion } from "./criteria";

/**
 * What a qualification IS, and what a client is allowed to say about one (F14).
 *
 * PURE ONLY — no database import, no Node built-ins. The create form is a client
 * component, so everything it needs to validate a draft before sending it lives
 * here and the API route runs the same checks again on the server (E2).
 *
 * ## Who it applies to
 *
 * "Which part of their line it applies to" is two answers, not four. A qualification
 * runs down a LINE — the creator's own people — so the audience is either the
 * coaches they brought in themselves, or everyone beneath them at any depth. The
 * leaderboards' four scopes (org / line / level / city) deliberately do NOT appear
 * here: a city board crosses organisations on purpose, and "everyone in Bengaluru
 * qualifies for my event" is not a thing an upline can offer.
 *
 * Both words are the ones F8 already put in front of these coaches for the same
 * choice, so nobody has to learn a second vocabulary for the same tree.
 *
 * ## The audience is resolved LIVE, never stored
 *
 * D64, applied: no list of participant ids is written onto the qualification, and no
 * `uplinePath` snapshot is trusted. Membership is recomputed from the current user
 * documents on every evaluation, which is what makes a coach who joins the line
 * mid-qualification a participant from that moment, and a coach who moves out of it
 * stop being one. A frozen audience would keep paying out to somebody who left and
 * would silently exclude every new recruit — the exact staleness D64 was written
 * about.
 */

export const AUDIENCES = ["direct", "all"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  direct: "My direct line only",
  all: "My whole line",
};

export const AUDIENCE_HELP: Record<Audience, string> = {
  direct: "Only the coaches you brought in yourself.",
  all: "Everyone in your line, however deep it goes.",
};

/** Everything the audience rule needs off a coach, and nothing else. */
export type LinePosition = { uplineId: string | null; uplinePath: string[] };

/**
 * Is this coach inside a qualification's audience?
 *
 * THE single app-side answer. The evaluator asks it to decide whose progress row to
 * write, and the read side asks it to decide who may open the screen — and before an
 * audit those were two separate expressions of the same rule, in two files that both
 * import firebase-admin and therefore neither of which a unit test could reach. One
 * of them drifting would mean a coach with a tracker who cannot open it, or a page
 * served to somebody the evaluator never counted.
 *
 * `firestore.rules` states the same rule a third time, independently and in its own
 * language. That copy is not duplication to remove: it is what stops a hand-written
 * query, and it is covered by e2e/qualifications-rules.test.ts.
 *
 * Resolved from the coach's CURRENT position (D64) — `uplineId` for the direct line,
 * `uplinePath` for the whole line. Nothing is read off the qualification but the
 * creator and the scope.
 */
export function inAudience(
  audience: Audience,
  creatorId: string,
  coach: LinePosition
): boolean {
  return audience === "direct"
    ? coach.uplineId === creatorId
    : coach.uplinePath.includes(creatorId);
}

/**
 * Long enough to name an event, short enough to read on a card at a glance.
 *
 * There is NO placeholder text and NO example anywhere in this feature. RULES L8 and
 * D29: a rank name reaches a screen exactly one way, which is a coach typing their
 * own. An example title in grey text is a suggestion, and a suggestion is a default
 * with better manners.
 */
export const MAX_TITLE = 80;

/**
 * How far ahead a deadline may be set.
 *
 * A year is already generous for something meant to create urgency; beyond it the
 * countdown is noise and the criteria will have been forgotten. The lower bound is
 * today — a qualification that closed before it opened has no participants and no
 * way to say so.
 */
export const MAX_DEADLINE_DAYS = 365;

export type QualificationDefinition = {
  title: string;
  criteria: Criterion[];
  audience: Audience;
  /** Last local day that counts, inclusive. */
  deadlineKey: string;
  timeZone: string;
};

export type DefinitionCheck =
  | { ok: true; definition: QualificationDefinition }
  | { ok: false; error: string };

/**
 * Validates a draft. Run by the form so a coach is told before they tap, and again
 * by the route because the form is not the only thing that can POST.
 */
export function checkDefinition(
  raw: {
    title?: unknown;
    criteria?: unknown;
    audience?: unknown;
    deadlineKey?: unknown;
  },
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): DefinitionCheck {
  const title = checkText(raw.title, MAX_TITLE, {
    empty: "Give it a name.",
    long: `Keep the name under ${MAX_TITLE} characters.`,
  });
  if (!title.ok) return { ok: false, error: title.error };

  if (!isAudience(raw.audience)) {
    return { ok: false, error: "Choose who this is for." };
  }

  if (!isDayKey(raw.deadlineKey)) {
    return { ok: false, error: "Pick a closing date." };
  }
  // E1: "today" is today where the coach is standing, not on the server. A deadline
  // compared against a UTC day would refuse a same-day qualification created during
  // the Indian evening, because it is already tomorrow in UTC.
  const today = dayKey(now, timeZone);
  const away = daysBetweenKeys(today, raw.deadlineKey);
  if (away < 0) return { ok: false, error: "That date has already passed." };
  if (away > MAX_DEADLINE_DAYS) {
    return { ok: false, error: "Pick a date within the next year." };
  }

  const criteria = checkCriteria(raw.criteria);
  if (!criteria.ok) return { ok: false, error: criteria.error };

  return {
    ok: true,
    definition: {
      title: title.value,
      criteria: criteria.criteria,
      audience: raw.audience,
      deadlineKey: raw.deadlineKey,
      timeZone,
    },
  };
}

/**
 * The window a qualification measures over: the day it was created, to its deadline.
 *
 * Starting at creation rather than at the start of the month is the honest choice and
 * the one the brief's "not padded" clause points at. A qualification announced on the
 * 20th that counted the whole month would hand its criteria to whoever had already
 * had a good month, and would tell everybody else they were behind on a race that had
 * not started.
 */
export function windowOf(q: {
  fromKey: string;
  deadlineKey: string;
  timeZone: string;
}): DayWindow {
  return makeWindow(q.fromKey, q.deadlineKey, q.timeZone);
}
