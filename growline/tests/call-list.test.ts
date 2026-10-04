import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_LIST,
  rankCallList,
  telLink,
  whatsappLink,
  type Candidate,
} from "@/modules/call-list/rank";
import * as copy from "@/modules/call-list/copy";
import { startOfDayInZone } from "@/lib/day";

/**
 * Unit tests for "who to call today" (session 4, feature 2).
 *
 * ## What these are defending
 *
 * The ordering is the feature, and three of its properties would pass review while
 * being wrong in ways a coach would feel immediately:
 *
 *   the promise    a missed promise must outrank everything, and must escalate with the
 *   comes first    days — but must CAP, or the same two forgotten names pin themselves
 *                  to the top forever and the list stops moving.
 *
 *   nobody         a follow-up set for next Tuesday is not today's work. A "who to call
 *   from the       today" that lists it is the pipeline with a different heading.
 *   future
 *
 *   the reason     the sentence on the row and the score come from one calculation. A
 *   is the same    row reading "3 days late" while sorted as though it were two would
 *   calculation    make the whole screen untrustworthy, and nothing else on it could
 *                  recover that.
 *
 * The clock is passed in, never read (E1). IST is UTC+5:30 and a follow-up set for 9am
 * tomorrow is a UTC timestamp on the same calendar day as this evening — a ranker that
 * asked `new Date()` and compared instants would put tomorrow's call in today's list.
 */

const TZ = "Asia/Kolkata";
const TODAY = "2026-08-12";

/** 9am IST on a given day key — the instant `presetToDate` actually produces. */
const at9am = (key: string) => new Date(startOfDayInZone(key, TZ).getTime() + 9 * 3_600_000);
const midday = (key: string) => new Date(startOfDayInZone(key, TZ).getTime() + 12 * 3_600_000);

function person(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    name: `Person ${over.id}`,
    phone: "919000000000",
    stage: "spoken",
    nextFollowupAt: null,
    createdAt: midday("2026-08-01"),
    ...over,
  };
}

describe("rankCallList — the bands", () => {
  test("a missed promise outranks one falling due today", () => {
    // The person already let down comes first. Anything else quietly teaches a coach
    // that being forgotten once means being forgotten again.
    const list = rankCallList(
      [
        person({ id: "due", nextFollowupAt: at9am(TODAY) }),
        person({ id: "late", nextFollowupAt: at9am("2026-08-09") }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls.map((c) => c.id), ["late", "due"]);
  });

  test("a promise falling due outranks anyone nobody promised anything", () => {
    const list = rankCallList(
      [
        person({ id: "quiet", stage: "attended", createdAt: midday("2026-06-01") }),
        person({ id: "due", stage: "spoken", nextFollowupAt: at9am(TODAY) }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls.map((c) => c.id), ["due", "quiet"]);
  });

  test("later promises are more urgent than recent ones, and the reason says how late", () => {
    const list = rankCallList(
      [
        person({ id: "two", nextFollowupAt: at9am("2026-08-10") }),
        person({ id: "nine", nextFollowupAt: at9am("2026-08-03") }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls.map((c) => c.id), ["nine", "two"]);
    assert.match(list.calls[0].reason, /9 days late/);
    assert.match(list.calls[1].reason, /2 days late/);
  });

  test("lateness caps, so two forgotten names cannot own the top of the list forever", () => {
    const ancient = rankCallList(
      [person({ id: "a", nextFollowupAt: at9am("2025-01-01") })],
      TODAY,
      TZ
    ).calls[0];
    const merelyOld = rankCallList(
      [person({ id: "b", nextFollowupAt: at9am("2026-07-01") })],
      TODAY,
      TZ
    ).calls[0];
    // Both are pinned at the cap: 400 days late is not ten times more urgent than 42.
    assert.equal(ancient.score, merelyOld.score);
  });

  test("a follow-up in the future is not on today's list, and is counted instead", () => {
    const list = rankCallList(
      [
        person({ id: "tuesday", nextFollowupAt: at9am("2026-08-18") }),
        person({ id: "tomorrow", nextFollowupAt: at9am("2026-08-13") }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls, []);
    assert.equal(list.scheduledLater, 2);
    // The nearest one, so the empty state can say when today stops being clear.
    assert.equal(list.nextInDays, 1);
  });

  test("9am tomorrow IST is tomorrow, not tonight (E1)", () => {
    // The regression this whole timezone discipline exists for. 9am IST on the 13th is
    // 03:30 UTC on the 13th — an instant comparison against "now" on the evening of the
    // 12th would place it in the past for a UTC server and put it in today's list.
    const list = rankCallList(
      [person({ id: "t", nextFollowupAt: at9am("2026-08-13") })],
      TODAY,
      TZ
    );
    assert.equal(list.calls.length, 0);
    assert.equal(list.scheduledLater, 1);
  });

  test("a follow-up earlier today still counts as today, not as late", () => {
    const list = rankCallList(
      [person({ id: "t", nextFollowupAt: at9am(TODAY) })],
      TODAY,
      TZ
    );
    assert.equal(list.calls[0].urgency, "today");
    assert.equal(list.calls[0].reason, "You said today");
  });
});

describe("rankCallList — the quiet band", () => {
  test("further through the conversation surfaces first", () => {
    // Someone who came to a session and went quiet is a half-finished conversation;
    // someone spoken to once on a road is not.
    const list = rankCallList(
      [
        person({ id: "spoken", stage: "spoken" }),
        person({ id: "attended", stage: "attended" }),
        person({ id: "invited", stage: "invited" }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls.map((c) => c.id), ["attended", "invited", "spoken"]);
  });

  test("longer silence outranks shorter silence at the same stage", () => {
    const list = rankCallList(
      [
        person({ id: "recent", createdAt: midday("2026-08-10") }),
        person({ id: "old", createdAt: midday("2026-06-10") }),
      ],
      TODAY,
      TZ
    );
    assert.deepEqual(list.calls.map((c) => c.id), ["old", "recent"]);
  });

  test("stage never overturns a promise", () => {
    // The stage weights break ties inside a band. If they could lift a cold contact
    // above a missed promise, the top of the list would stop meaning anything.
    const list = rankCallList(
      [
        person({ id: "attended-quiet", stage: "attended", createdAt: midday("2025-01-01") }),
        person({ id: "spoken-late", stage: "spoken", nextFollowupAt: at9am("2026-08-11") }),
      ],
      TODAY,
      TZ
    );
    assert.equal(list.calls[0].id, "spoken-late");
  });

  test("someone met today with no date is on the list, at the bottom", () => {
    const list = rankCallList(
      [
        person({ id: "today", createdAt: midday(TODAY) }),
        person({ id: "older", createdAt: midday("2026-07-01") }),
      ],
      TODAY,
      TZ
    );
    assert.equal(list.calls.length, 2);
    assert.equal(list.calls[1].id, "today");
    assert.match(list.calls[1].reason, /Met today/);
  });
});

describe("rankCallList — exclusions and shape", () => {
  test("a member is not a call, and is counted so the empty state can tell why", () => {
    const list = rankCallList([person({ id: "m", stage: "member" })], TODAY, TZ);
    assert.deepEqual(list.calls, []);
    assert.equal(list.members, 1);
    assert.equal(list.total, 0);
  });

  test("the list is capped, and the total is reported so the screen can admit it", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      person({ id: `p${String(i).padStart(2, "0")}`, nextFollowupAt: at9am("2026-08-05") })
    );
    const list = rankCallList(many, TODAY, TZ);
    assert.equal(list.calls.length, MAX_LIST);
    assert.equal(list.total, 30);
    assert.match(copy.cappedNote(MAX_LIST, 30), /Showing 12 of 30/);
  });

  test("no prospects at all is a clean zero, never a crash", () => {
    const list = rankCallList([], TODAY, TZ);
    assert.deepEqual(list.calls, []);
    assert.equal(list.total, 0);
    assert.equal(list.nextInDays, null);
  });

  test("the order is stable when scores tie", () => {
    // A list that reshuffles between two page loads reads as broken, and a coach
    // halfway down it loses their place.
    const tied = [person({ id: "b" }), person({ id: "a" }), person({ id: "c" })];
    const first = rankCallList(tied, TODAY, TZ).calls.map((c) => c.id);
    const second = rankCallList([...tied].reverse(), TODAY, TZ).calls.map((c) => c.id);
    assert.deepEqual(first, second);
  });

  test("the reason on a row is generated from the value that produced its score", () => {
    // One calculation, so the sentence and the position cannot disagree. A row reading
    // "3 days late" while sorted as though it were two makes the screen untrustworthy.
    const list = rankCallList(
      [person({ id: "x", nextFollowupAt: at9am("2026-08-07") })],
      TODAY,
      TZ
    );
    const daysLate = 5;
    assert.match(list.calls[0].reason, new RegExp(`${daysLate} days late`));
    assert.equal(list.calls[0].score, 100 + daysLate * 2 + 6 + Math.min(11, 60) * 0.4);
  });
});

describe("links", () => {
  test("WhatsApp goes through wa.me only (S4)", () => {
    assert.equal(whatsappLink("+91 90000 00000"), "https://wa.me/919000000000");
  });

  test("the dial link keeps a leading plus and drops nothing else that matters", () => {
    assert.equal(telLink("+91 90000 00000"), "tel:+919000000000");
  });
});

describe("copy", () => {
  const sentences = (Object.values(copy) as unknown[]).filter(
    (v): v is string => typeof v === "string"
  );

  test("no money, no earnings, no projection (L4)", () => {
    // The easiest rule to break on a ranked list: a "priority" score is one adjective
    // away from being a value estimate, and this audience would read it as one.
    const banned = /₹|rupee|earn|income|worth|value|revenue|commission|at this rate/i;
    for (const s of sentences) assert.ok(!banned.test(s), `income language in: ${s}`);
  });

  test("no clinical words (L2, L3)", () => {
    const banned = /obese|overweight|underweight|cholesterol|blood pressure|diagnos/i;
    for (const s of sentences) assert.ok(!banned.test(s), `clinical language in: ${s}`);
  });

  test("no SaaS jargon (S6)", () => {
    const banned = /\bCRM\b|pipeline analytics|engagement metric|lead scor|conversion rate/i;
    for (const s of sentences) assert.ok(!banned.test(s), `jargon in: ${s}`);
  });

  test("the screen states that the list is the coach's own (P1)", () => {
    assert.match(copy.YOURS_ONLY, /your people only/i);
    assert.match(copy.YOURS_ONLY, /never see theirs/i);
  });

  test("every empty state teaches what will fill it", () => {
    assert.match(copy.NO_PROSPECTS_BODY, /fills itself/i);
    assert.match(copy.allScheduledBody(3), /in 3 days/);
    assert.match(copy.allScheduledBody(1), /tomorrow/);
    assert.match(copy.ALL_MEMBERS_BODY, /starts again/i);
  });

  test("the cap is admitted rather than hidden", () => {
    assert.equal(copy.cappedNote(12, 12), "");
    assert.match(copy.cappedNote(12, 40), /here tomorrow/);
  });
});
