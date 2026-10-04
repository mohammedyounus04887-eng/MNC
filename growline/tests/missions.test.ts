import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildMissions } from "../src/components/TodaysMission";

/**
 * Today's Mission — what the app tells a coach to do first.
 *
 * v2 §4 calls this card "the recommendation engine of v2", and it is the first
 * thing on the screen every morning. Its rules are worth pinning because every
 * one of them is invisible when broken: a card that quietly stops offering the
 * log, or offers four things, or puts the target above the follow-ups, still
 * renders perfectly and still costs the coach the day's most valuable minute.
 */

const NOTHING = {
  streak: 0,
  loggedToday: true,
  followupsDue: 0,
  targetPoints: null,
  progressPoints: null,
};

describe("what appears, and in what order", () => {
  test("the streak comes first — it is the only one with a deadline tonight", () => {
    const missions = buildMissions({
      ...NOTHING,
      loggedToday: false,
      streak: 12,
      followupsDue: 6,
      targetPoints: 1000,
      progressPoints: 100,
    });
    assert.deepEqual(
      missions.map((m) => m.key),
      ["log", "followups", "target"]
    );
  });

  test("never more than three — four is a to-do app", () => {
    const missions = buildMissions({
      streak: 3,
      loggedToday: false,
      followupsDue: 9,
      followupsOverdue: 2,
      targetPoints: 1000,
      progressPoints: 100,
    });
    assert.ok(missions.length <= 3, `got ${missions.length}`);
  });

  test("a logged, caught-up, on-target day offers nothing", () => {
    // The empty state is a feature: it is the only way the card can ever say
    // "you are done", and a card that always has something on it cannot.
    assert.deepEqual(buildMissions(NOTHING), []);
  });

  test("a coach with no streak yet is still asked to log", () => {
    const [first] = buildMissions({ ...NOTHING, loggedToday: false });
    assert.equal(first.key, "log");
    // Not "keep your 0-day streak", which is the failure a naive template gives
    // to exactly the person with the least reason to stay.
    assert.doesNotMatch(first.text, /0-day/);
  });
});

describe("the target row says points and stops (RULES L4 / D40)", () => {
  const [mission] = buildMissions({
    ...NOTHING,
    targetPoints: 2000,
    progressPoints: 400,
  });

  test("no currency, no conversion, no projection", () => {
    assert.doesNotMatch(mission.text, /₹|Rs|rupee|earn|income|worth/i);
  });

  test("it counts down to the next mark, not to the month", () => {
    // 400/2000 = 20%, so the next mark is 25% = 500 points: 100 to go.
    assert.match(mission.text, /^100 points to cross 25%$/);
  });

  test("no mission once the month is finished", () => {
    assert.deepEqual(
      buildMissions({ ...NOTHING, targetPoints: 1000, progressPoints: 1000 }),
      []
    );
  });
});

describe("the arc only appears where the denominator is real", () => {
  const missions = buildMissions({
    streak: 4,
    loggedToday: false,
    followupsDue: 6,
    followupsOverdue: 2,
    targetPoints: 2000,
    progressPoints: 400,
  });
  const by = (k: string) => missions.find((m) => m.key === k)!;

  test("the target row carries one, running to the next mark", () => {
    assert.deepEqual(by("target").progress, { done: 400, total: 500 });
  });

  test("the follow-up row does not", () => {
    // Nothing records follow-ups COMPLETED today, so any arc here would be a
    // picture of a number the app does not have. See the note in the component.
    assert.equal(by("followups").progress, undefined);
  });

  test("the streak row does not — its question is yes or no", () => {
    assert.equal(by("log").progress, undefined);
  });
});

describe("the overdue split, which changes what a coach opens first", () => {
  test("named when people have been waiting since earlier days", () => {
    const [m] = buildMissions({
      ...NOTHING,
      followupsDue: 6,
      followupsOverdue: 2,
    });
    assert.equal(m.text, "6 follow-ups waiting");
    assert.match(m.hint!, /^2 from earlier days — start there$/);
  });

  test("singular reads as English", () => {
    const [m] = buildMissions({
      ...NOTHING,
      followupsDue: 1,
      followupsOverdue: 1,
    });
    assert.equal(m.text, "1 follow-up waiting");
    assert.match(m.hint!, /1 from earlier day —/);
  });

  test("silent when nothing is late — a zero is not news", () => {
    const [m] = buildMissions({ ...NOTHING, followupsDue: 3, followupsOverdue: 0 });
    assert.equal(m.hint, undefined);
  });

  test("silent when the caller does not know, rather than claiming zero", () => {
    const [m] = buildMissions({ ...NOTHING, followupsDue: 3 });
    assert.equal(m.hint, undefined);
  });
});
