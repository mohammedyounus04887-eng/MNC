import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { daysBetweenKeys } from "@/lib/daily-log";
import { STAGE_LABELS, type Stage } from "@/lib/pipeline";

/**
 * "Who to call today" (session 4, feature 2) — the order, and the reason for it.
 *
 * PURE. No database import, so the ranking can be unit-tested against fixed dates
 * rather than against a seeded emulator, and so nothing here can accidentally widen a
 * query (E2's rule, and P1's).
 *
 * ## The problem this solves
 *
 * A coach with sixty prospects opens the pipeline and sees sixty names in the order
 * they were captured. The six people who actually matter today are scattered through
 * it. F5 already surfaces overdue follow-ups, but "overdue" is one signal and the
 * decision a coach makes at 6pm uses three: who was promised a call, who is close to
 * joining, and who is quietly going cold.
 *
 * ## Every position is explainable, and the explanation is on the row
 *
 * A ranked list a coach cannot audit is a list they will override or ignore. So the
 * score is built from named signals, the dominant one is rendered as a sentence next to
 * the name, and the sentence is generated from the same value that produced the score —
 * they cannot drift, because there is one calculation.
 *
 * ## What is deliberately NOT a signal
 *
 * Anything about money (L4). No stage is worth more because of what it might become,
 * nothing is projected, and the word "value" appears nowhere. A prospect at "attended"
 * ranks above one at "spoken" because they are further through a conversation the coach
 * started, not because they are worth more.
 *
 * There is also no "last contacted" field in the data model, and this module does not
 * invent one by writing to `prospects` — it reads and writes nothing there. So the
 * silence signal is honest about what it actually knows: days since the coach saved
 * them, which is the last moment there is any record of contact.
 */

/** A list you cannot finish is a list you do not start. Twelve is an evening. */
export const MAX_LIST = 12;

/** Beyond this, more silence is not more urgent — it is the same problem. */
const COLD_CAP_DAYS = 60;
const LATE_CAP_DAYS = 30;

/**
 * How far through a conversation this person is.
 *
 * Someone who has been to a session and gone quiet is mid-conversation; someone
 * spoken to once on a road is not. The gaps are small on purpose — this breaks ties
 * between people with the same follow-up situation, it does not overturn a promise.
 */
const STAGE_WEIGHT: Record<Stage, number> = {
  spoken: 6,
  interested: 12,
  invited: 16,
  attended: 20,
  member: 0,
};

export type Candidate = {
  id: string;
  name: string;
  phone: string;
  stage: Stage;
  nextFollowupAt: Date | null;
  createdAt: Date;
};

export type Urgency = "late" | "today" | "quiet";

export type RankedCall = {
  id: string;
  name: string;
  phone: string;
  stage: Stage;
  urgency: Urgency;
  score: number;
  /** The dominant signal, as the sentence shown beside the name. */
  reason: string;
  /** The context under it: where they are, and how long you have known them. */
  detail: string;
};

export type CallList = {
  calls: RankedCall[];
  /** How many qualified before the cap, so the screen can say "12 of 31". */
  total: number;
  /** Everyone excluded because their follow-up is still in the future. */
  scheduledLater: number;
  /** Days until the nearest of those, or null when there are none. */
  nextInDays: number | null;
  /** People at "Member". Counted so the empty state can tell the two cases apart. */
  members: number;
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "8 days late", "Today", "known 12 days" — plain words, no dates to decode (S6). */
function reasonFor(urgency: Urgency, daysLate: number, daysKnown: number): string {
  if (urgency === "late") {
    return daysLate === 1
      ? "1 day late — you said you would call"
      : `${daysLate} days late — you said you would call`;
  }
  if (urgency === "today") return "You said today";
  if (daysKnown === 0) return "Met today, no date set";
  return `No date set since you met, ${plural(daysKnown, "day")} ago`;
}

function detailFor(stage: Stage, daysKnown: number): string {
  const known =
    daysKnown === 0 ? "met today" : `known ${plural(daysKnown, "day")}`;
  return `${STAGE_LABELS[stage]} · ${known}`;
}

/**
 * The call list for one coach's own prospects, most urgent first.
 *
 * `todayKeyValue` is passed in rather than read from the clock: E1 says a day boundary
 * never comes from a bare `new Date()`, and a function that asks the clock itself
 * cannot be tested against the 05:30 IST case that has already broken roll-ups once.
 *
 * Ordering, and why each band sits where it does:
 *
 *   late (100+)   A promise the coach made and missed. Nothing outranks it, and it
 *                 escalates with the days — but caps, because a person forgotten for
 *                 four months is not eight times more urgent than one forgotten for a
 *                 fortnight, and letting it run would pin the same two names to the top
 *                 forever while the rest of the list never moved.
 *
 *   today (90)    A promise falling due now. Below every late one deliberately: the
 *                 person already let down comes first.
 *
 *   quiet (0-44)  Nobody promised them anything. Ranked by how far through the
 *                 conversation they are and how long the silence has run, so the
 *                 half-finished conversations surface before the cold introductions.
 *
 * People whose follow-up is still ahead of them are NOT here. "Who to call today" that
 * lists someone due next Tuesday is a pipeline with a different heading.
 */
export function rankCallList(
  candidates: Candidate[],
  todayKeyValue: string,
  timeZone: string = APP_TIMEZONE
): CallList {
  const ranked: RankedCall[] = [];
  let scheduledLater = 0;
  let nextInDays: number | null = null;
  let members = 0;

  for (const c of candidates) {
    // Someone who has joined is not a call list entry. They are the outcome.
    if (c.stage === "member") {
      members++;
      continue;
    }

    const daysKnown = Math.max(0, daysBetweenKeys(dayKey(c.createdAt, timeZone), todayKeyValue));
    const followupKey = c.nextFollowupAt ? dayKey(c.nextFollowupAt, timeZone) : null;

    let urgency: Urgency;
    let base: number;
    let daysLate = 0;

    if (followupKey === null) {
      urgency = "quiet";
      base = 0;
    } else if (followupKey > todayKeyValue) {
      scheduledLater++;
      const away = daysBetweenKeys(todayKeyValue, followupKey);
      if (nextInDays === null || away < nextInDays) nextInDays = away;
      continue;
    } else if (followupKey === todayKeyValue) {
      urgency = "today";
      base = 90;
    } else {
      urgency = "late";
      daysLate = daysBetweenKeys(followupKey, todayKeyValue);
      base = 100 + Math.min(daysLate, LATE_CAP_DAYS) * 2;
    }

    const coldness = Math.min(daysKnown, COLD_CAP_DAYS) * 0.4;
    const score = base + STAGE_WEIGHT[c.stage] + coldness;

    ranked.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      stage: c.stage,
      urgency,
      score: Math.round(score * 10) / 10,
      reason: reasonFor(urgency, daysLate, daysKnown),
      detail: detailFor(c.stage, daysKnown),
    });
  }

  // Ties break toward whoever has waited longest, then by id so the order is stable
  // across renders — a list that reshuffles between two page loads reads as broken.
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    calls: ranked.slice(0, MAX_LIST),
    total: ranked.length,
    scheduledLater,
    nextInDays,
    members,
  };
}

/** `wa.me` only (S4) — the coach presses send in their own WhatsApp. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
