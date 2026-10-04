import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  assessLeg,
  pickForOneRun,
  shouldAlert,
  type Assessment,
  type Leg,
} from "@/modules/silence/detect";
import {
  LOOKBACK_DAYS,
  MAX_ALERTS_PER_RUN,
  QUIET_DAYS,
  REALERT_DAYS,
  silenceAlertDocId,
  type SilenceAlertDoc,
} from "@/modules/silence/model";
import * as copy from "@/modules/silence/copy";
import { shiftKey } from "@/lib/daily-log";

/**
 * Unit tests for the silence alert (session 4, feature 3).
 *
 * ## What these are defending
 *
 * This is the only feature in these modules that says something about one person TO
 * somebody else. The arithmetic is easy and the judgement is not, so nearly every test
 * below is about an alert that must NOT be sent, or a sentence that must not be said.
 *
 * The failure to design around, stated once: an alert fires while a coach is on
 * honeymoon, in hospital, or has had their phone stolen. All three look exactly like
 * "nobody logged". The upline reads it and rings them. Everything here exists so that
 * conversation starts well — and so that a wrong alert is a single remark rather than a
 * daily drumbeat that gets the whole notification channel muted.
 */

const TODAY = "2026-08-12";

function leg(over: Partial<Leg> & { ownerId: string }): Leg {
  return {
    ownerName: "Asha",
    memberIds: [over.ownerId, "d1", "d2"],
    earliestJoinKey: "2026-01-01",
    lastLoggedKey: null,
    ...over,
  };
}

function assessment(over: Partial<Assessment> = {}): Assessment {
  return {
    ownerId: "asha",
    ownerName: "Asha",
    state: "quiet",
    legSize: 3,
    daysQuiet: 9,
    quietSinceKey: "2026-08-04",
    ...over,
  };
}

describe("assessLeg", () => {
  test("somebody logged inside the window — nothing to say", () => {
    const a = assessLeg(leg({ ownerId: "asha", lastLoggedKey: shiftKey(TODAY, -2) }), TODAY);
    assert.equal(a.state, "active");
  });

  test("the boundary belongs to active, not to quiet", () => {
    // Exactly QUIET_DAYS - 1 is still fine. An off-by-one here is a notification about
    // somebody's week that arrives a day early, every time, forever.
    const a = assessLeg(
      leg({ ownerId: "asha", lastLoggedKey: shiftKey(TODAY, -(QUIET_DAYS - 1)) }),
      TODAY
    );
    assert.equal(a.state, "active");

    const b = assessLeg(leg({ ownerId: "asha", lastLoggedKey: shiftKey(TODAY, -QUIET_DAYS) }), TODAY);
    assert.equal(b.state, "quiet");
    assert.equal(b.daysQuiet, QUIET_DAYS);
  });

  test("a leg too young to have been quiet is not assessable at all", () => {
    // A team that has existed four days cannot have been silent for seven. Reporting it
    // would be the app inventing a problem out of its own arithmetic — and doing it to
    // the newest, most fragile relationship an upline has.
    const a = assessLeg(
      leg({ ownerId: "new", earliestJoinKey: shiftKey(TODAY, -4), lastLoggedKey: null }),
      TODAY
    );
    assert.equal(a.state, "tooNew");
  });

  test("a leg exactly old enough IS assessable", () => {
    const a = assessLeg(
      leg({ ownerId: "new", earliestJoinKey: shiftKey(TODAY, -QUIET_DAYS), lastLoggedKey: null }),
      TODAY
    );
    assert.equal(a.state, "dormant");
  });

  test("age is the EARLIEST join in the leg, not the owner's", () => {
    // A coach who joined last week may sit above people who joined last year — the
    // owner is not the leg's history, the leg is.
    const a = assessLeg(
      leg({
        ownerId: "asha",
        earliestJoinKey: "2025-01-01",
        lastLoggedKey: null,
      }),
      TODAY
    );
    assert.equal(a.state, "dormant");
  });

  test("nothing in the whole lookback is dormant, with no day count attached", () => {
    // A precise number stops being meaningful past the lookback, and quoting one would
    // be false precision about somebody's months.
    const a = assessLeg(leg({ ownerId: "asha", lastLoggedKey: null }), TODAY);
    assert.equal(a.state, "dormant");
    assert.equal(a.daysQuiet, null);
    assert.equal(a.quietSinceKey, null);
  });

  test("a log older than the lookback is dormant too, not a very large number", () => {
    const a = assessLeg(
      leg({ ownerId: "asha", lastLoggedKey: shiftKey(TODAY, -(LOOKBACK_DAYS + 5)) }),
      TODAY
    );
    assert.equal(a.state, "dormant");
    assert.equal(a.daysQuiet, null);
  });

  test("the silence starts the day AFTER the last log", () => {
    // The episode's identity. If it were the last log's own day, a leg that logged and
    // fell quiet again would look like the same episode and be held back.
    const a = assessLeg(leg({ ownerId: "asha", lastLoggedKey: "2026-08-03" }), TODAY);
    assert.equal(a.quietSinceKey, "2026-08-04");
  });

  test("anybody logging keeps the whole leg active, not just the owner", () => {
    // "Nobody in this leg has logged" is the brief's wording and the right definition:
    // an upline does not need telling when the leg owner is quiet but their own team
    // is working.
    const a = assessLeg(
      leg({ ownerId: "asha", memberIds: ["asha", "d1"], lastLoggedKey: shiftKey(TODAY, -1) }),
      TODAY
    );
    assert.equal(a.state, "active");
  });
});

describe("shouldAlert", () => {
  const previous = (over: Partial<SilenceAlertDoc> = {}): SilenceAlertDoc => ({
    uplineId: "root",
    legOwnerId: "asha",
    lastAlertedKey: "2026-08-11",
    quietSinceKey: "2026-08-04",
    lastState: "quiet",
    legSize: 3,
    ...over,
  });

  test("the first time a leg goes quiet, it is said", () => {
    const d = shouldAlert(assessment(), null, TODAY);
    assert.deepEqual(d, { send: true, reason: "first" });
  });

  test("an active leg is never mentioned", () => {
    assert.equal(shouldAlert(assessment({ state: "active" }), null, TODAY).send, false);
  });

  test("a leg too new is never mentioned, even with no memory of it", () => {
    assert.deepEqual(shouldAlert(assessment({ state: "tooNew" }), null, TODAY), {
      send: false,
      reason: "tooNew",
    });
  });

  test("the same continuing silence is not repeated the next morning", () => {
    // The single most important restraint here. A scheduled job with no memory sends
    // this sentence every day, and an upline who mutes Growline to stop it also loses
    // the follow-up reminder — the nagging costs a feature that was working.
    const d = shouldAlert(assessment(), previous(), TODAY);
    assert.deepEqual(d, { send: false, reason: "alreadySaid" });
  });

  test("after a fortnight the same silence may be raised once more", () => {
    const d = shouldAlert(
      assessment(),
      previous({ lastAlertedKey: shiftKey(TODAY, -REALERT_DAYS) }),
      TODAY
    );
    assert.deepEqual(d, { send: true, reason: "cooldownPassed" });
  });

  test("a day short of the fortnight is still too soon", () => {
    const d = shouldAlert(
      assessment(),
      previous({ lastAlertedKey: shiftKey(TODAY, -(REALERT_DAYS - 1)) }),
      TODAY
    );
    assert.equal(d.send, false);
  });

  test("a leg that came back and went quiet again is a NEW fact, cooldown or not", () => {
    // Yesterday's alert was about a different silence. Holding this one back would mean
    // an upline hears nothing about a team that logged, stopped, and stayed stopped.
    const d = shouldAlert(
      assessment({ quietSinceKey: "2026-08-05" }),
      previous({ quietSinceKey: "2026-07-01", lastAlertedKey: shiftKey(TODAY, -1) }),
      TODAY
    );
    assert.deepEqual(d, { send: true, reason: "newEpisode" });
  });

  test("a dormant leg is mentioned once and then left alone, however long it runs", () => {
    // A team that has not logged in months does not become news again every fortnight.
    // Repeating it is how the whole channel gets muted, and the team tree shows the
    // state whenever the upline chooses to look.
    const dormant = assessment({ state: "dormant", daysQuiet: null, quietSinceKey: null });
    const said = previous({
      quietSinceKey: null,
      lastState: "dormant",
      lastAlertedKey: shiftKey(TODAY, -200),
    });
    assert.deepEqual(shouldAlert(dormant, said, TODAY), {
      send: false,
      reason: "dormantAlreadySaid",
    });
  });

  test("a dormant leg that comes back to life and stops again IS mentioned", () => {
    const quietAgain = assessment({ quietSinceKey: "2026-08-04" });
    const saidWhenDormant = previous({ quietSinceKey: null, lastState: "dormant" });
    assert.equal(shouldAlert(quietAgain, saidWhenDormant, TODAY).send, true);
  });
});

describe("pickForOneRun", () => {
  const row = (ownerId: string, daysQuiet: number | null) => ({
    assessment: assessment({ ownerId, daysQuiet, state: daysQuiet === null ? "dormant" : "quiet" }),
  });

  test("at most two legs are mentioned in one morning", () => {
    // Two names is somebody to ring. Six is a report, and a report arriving as six
    // lock-screen buzzes gets the channel muted.
    const picked = pickForOneRun([row("a", 8), row("b", 9), row("c", 10), row("d", 11)]);
    assert.equal(picked.length, MAX_ALERTS_PER_RUN);
  });

  test("the SHORTEST silences are chosen, which is the opposite of a dashboard", () => {
    // A leg quiet for eight days is a conversation that can still be picked up; one
    // quiet for fifty is a different problem a call this morning will not solve.
    const picked = pickForOneRun([row("long", 40), row("short", 8), row("mid", 20)]);
    assert.deepEqual(picked.map((p) => p.assessment.ownerId), ["short", "mid"]);
  });

  test("dormant legs sort last — least recoverable, least urgent today", () => {
    const picked = pickForOneRun([row("dormant", null), row("recent", 8)], 1);
    assert.equal(picked[0].assessment.ownerId, "recent");
  });

  test("ties are stable, so two runs on one morning agree", () => {
    const rows = [row("b", 9), row("a", 9), row("c", 9)];
    assert.deepEqual(
      pickForOneRun(rows).map((p) => p.assessment.ownerId),
      pickForOneRun([...rows].reverse()).map((p) => p.assessment.ownerId)
    );
  });

  test("fewer than the cap is returned as-is, never padded", () => {
    assert.equal(pickForOneRun([row("a", 8)]).length, 1);
    assert.equal(pickForOneRun([]).length, 0);
  });
});

describe("the sentence — assume it is wrong and read it anyway", () => {
  const bodies = [
    copy.silenceBody(assessment({ legSize: 3, daysQuiet: 9 })),
    copy.silenceBody(assessment({ legSize: 1, daysQuiet: 9, ownerName: "Bhavana Rao" })),
    copy.silenceBody(assessment({ state: "dormant", daysQuiet: null, quietSinceKey: null })),
    copy.silenceBody(
      assessment({ state: "dormant", daysQuiet: null, quietSinceKey: null, legSize: 1 })
    ),
  ];

  test("no fault language, no imperative, no urgency punctuation", () => {
    // This is the test that keeps the feature humane. Every word here is one that turns
    // a notice into an accusation about somebody who may simply be on holiday.
    const banned =
      /fail|lazy|excuse|neglect|ignor|slack|inactive|dropped off|must |should |chase them|!/i;
    for (const body of bodies) {
      assert.ok(!banned.test(body), `accusatory wording in: ${body}`);
    }
  });

  test("no income or earnings framing (L4)", () => {
    // "Your team's quiet week is costing you" would be an income claim and a guilt trip
    // in one sentence, and it is exactly the sentence a growth-minded rewrite reaches for.
    const banned = /₹|rupee|earn|income|cost|losing|missing out|revenue|target slipping/i;
    for (const body of bodies) assert.ok(!banned.test(body), `income framing in: ${body}`);
  });

  test("no company or rank names anywhere (L1, L8)", () => {
    for (const body of bodies) {
      assert.ok(!/\b(gold|silver|diamond|president|supervisor|distributor)\b/i.test(body), body);
    }
  });

  test("it fits on a lock screen without losing its second clause", () => {
    // Android truncates the body. The clause that stops this reading as an accusation
    // is the second one, so the whole sentence has to survive.
    for (const body of bodies) {
      assert.ok(body.length <= 110, `${body.length} chars is too long: ${body}`);
    }
  });

  test("one person is spoken about as a person, a team as a team", () => {
    const solo = copy.silenceBody(assessment({ legSize: 1, ownerName: "Bhavana Rao" }));
    const team = copy.silenceBody(assessment({ legSize: 4, ownerName: "Asha" }));
    assert.match(solo, /^Bhavana hasn't logged/);
    assert.ok(!/team/.test(solo), "a lone downline is not a team");
    assert.match(team, /Nobody in Asha's team/);
  });

  test("a precise day count only appears when it is actually known", () => {
    assert.match(copy.silenceBody(assessment({ daysQuiet: 9 })), /for 9 days/);
    assert.match(
      copy.silenceBody(assessment({ state: "dormant", daysQuiet: null })),
      /in a long time/
    );
    assert.ok(!/\d/.test(copy.silenceBody(assessment({ state: "dormant", daysQuiet: null }))));
  });

  test("the nudge is a suggestion, never an instruction", () => {
    assert.match(bodies[0], /worth a call, not a chase/);
    assert.match(bodies[1], /worth a hello, not a chase/);
    assert.match(bodies[2], /No pressure to act/);
  });

  test("a missing name degrades to something readable, never to 'undefined'", () => {
    const anon = copy.silenceBody(assessment({ ownerName: "", legSize: 4 }));
    assert.ok(!/undefined|null/.test(anon), anon);
    assert.match(anon, /Nobody in your team/);
  });

  test("the app states the limit of what it knows", () => {
    // Not decoration. If this sentence is ever cut for brevity, the feature becomes a
    // productivity dashboard reporting who is behind.
    assert.match(copy.WHAT_THE_APP_KNOWS, /does not know nobody worked/i);
    assert.match(copy.WHO_HEARS_IT, /does not travel further up the line/i);
    assert.match(copy.WHAT_IT_CARRIES, /never leave the phone that captured them/i);
  });
});

describe("document ids and routing", () => {
  test("one row per upline and leg — the pair is the identity", () => {
    assert.equal(silenceAlertDocId("root", "asha"), "root__asha");
  });

  test("an id that could escape its collection is refused", () => {
    assert.throws(() => silenceAlertDocId("a/b", "asha"));
    assert.throws(() => silenceAlertDocId("", "asha"));
  });

  test("one notification tag per leg, so two quiet legs do not replace each other", () => {
    assert.notEqual(copy.notificationTag("asha"), copy.notificationTag("bhav"));
  });

  test("tapping it lands on a screen that already exists and names no prospect", () => {
    assert.equal(copy.NOTIFICATION_URL, "/team");
  });
});
