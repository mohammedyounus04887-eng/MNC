import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  currentPeriod,
  daysInPeriod,
  longestRunWithin,
  periodFor,
  weekStartKey,
} from "@/modules/shared-new/period";
import {
  isInScope,
  membersOf,
  normaliseScopeKey,
  orgRootId,
  scopeFor,
  type ScopeSubject,
} from "@/modules/shared-new/scopes";
import {
  buildViewerBoard,
  rankEntries,
  MIN_PARTICIPANTS,
  PODIUM_SIZE,
  WINDOW_ABOVE,
  type RankRow,
} from "@/modules/leaderboards/ranking";
import { METRIC_SPECS, METRICS, formatValue } from "@/modules/leaderboards/metrics";
import { optOutDocId, podiumDocId, rosterDocId } from "@/modules/leaderboards/snapshots";

/**
 * Unit tests for the leaderboards (F13).
 *
 * ## What these are actually defending
 *
 * Three of the things under test are product guarantees rather than conveniences,
 * and the tests are written as attempts to break them:
 *
 *   `buildViewerBoard`   decides what one coach is shown. Its single most important
 *                        property is what it REFUSES to return: nobody below the
 *                        reader, ever, because that is the only thing standing
 *                        between the coach in last place and finding out. A change
 *                        that adds "and the person just behind you" would look like
 *                        a friendly touch and would break the whole feature.
 *
 *   `longestRunWithin`   is why a weekly board resets. If it ever measured the live
 *                        streak instead, one coach's 200-day run would win every
 *                        weekly board for the rest of their life.
 *
 *   the copy tables      carry the L4 line: a leaderboard is the easiest screen in
 *                        this app on which to write "₹" or "at this rate", so the
 *                        strings are asserted, not merely reviewed.
 *
 * Fixed dates only, never `Date.now()` — E1 exists because a day boundary has been
 * got wrong in this codebase before, and `currentPeriod` is exactly that question.
 */

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

describe("periods", () => {
  test("a week starts on Monday, and Sunday belongs to the week behind it", () => {
    // 2026-08-10 is a Monday.
    assert.equal(weekStartKey("2026-08-10"), "2026-08-10");
    assert.equal(weekStartKey("2026-08-13"), "2026-08-10");
    // Sunday closes the week that began six days earlier — not the one starting
    // tomorrow. Get this wrong and every Sunday's work lands in next week's board.
    assert.equal(weekStartKey("2026-08-16"), "2026-08-10");
    assert.equal(weekStartKey("2026-08-17"), "2026-08-17");
  });

  test("a weekly period spans exactly seven days, Monday to Sunday", () => {
    const p = periodFor("weekly", "2026-08-13");
    assert.equal(p.key, "2026-08-10");
    assert.equal(p.fromKey, "2026-08-10");
    assert.equal(p.toKey, "2026-08-16");
    assert.equal(daysInPeriod(p).length, 7);
  });

  test("a monthly period covers the whole month, including a leap February", () => {
    const august = periodFor("monthly", "2026-08-13");
    assert.equal(august.key, "2026-08");
    assert.equal(august.fromKey, "2026-08-01");
    assert.equal(august.toKey, "2026-08-31");
    assert.equal(august.label, "August 2026");

    const feb = periodFor("monthly", "2028-02-05");
    assert.equal(feb.toKey, "2028-02-29");
    assert.equal(daysInPeriod(feb).length, 29);
  });

  /**
   * E1, on the screen it would break. India is UTC+5:30, so 23:00 UTC on Sunday is
   * already 04:30 Monday morning in Bengaluru. A board built from a UTC day would
   * put that coach's Monday work in the week that just ended — into a board that has
   * already reset and that nobody will look at again.
   */
  test("the current period is decided in India, not in UTC", () => {
    const sundayNightUtc = new Date("2026-08-09T23:00:00Z"); // Monday 04:30 IST
    assert.equal(currentPeriod("weekly", "Asia/Kolkata", sundayNightUtc).key, "2026-08-10");
    assert.equal(currentPeriod("weekly", "UTC", sundayNightUtc).key, "2026-08-03");

    // And the same trap at a month boundary: 31 July 23:00 UTC is 1 August in IST.
    const monthEdge = new Date("2026-07-31T23:00:00Z");
    assert.equal(currentPeriod("monthly", "Asia/Kolkata", monthEdge).key, "2026-08");
    assert.equal(currentPeriod("monthly", "UTC", monthEdge).key, "2026-07");
  });
});

describe("the streak board's run", () => {
  const week = periodFor("weekly", "2026-08-10");

  test("counts the longest unbroken run inside the window", () => {
    const keys = ["2026-08-10", "2026-08-11", "2026-08-13", "2026-08-14", "2026-08-15"];
    assert.equal(longestRunWithin(keys, week), 3);
  });

  test("ignores days outside the window, so the weekly board really does reset", () => {
    // A 40-day run ending on Sunday the 9th. On the week beginning the 10th it is
    // worth nothing — otherwise one long streak would win every weekly board there
    // will ever be, which is the failure four boards exist to prevent.
    const before = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      return d.toISOString().slice(0, 10);
    });
    assert.equal(longestRunWithin(before, week), 0);
  });

  test("a coach who logged nothing has a run of zero, not a crash", () => {
    assert.equal(longestRunWithin([], week), 0);
  });
});

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const root: ScopeSubject = {
  id: "root", name: "Root", uplineId: null, uplinePath: [],
  levelName: null, city: "Bengaluru",
};
const asha: ScopeSubject = {
  id: "asha", name: "Asha", uplineId: "root", uplinePath: ["root"],
  levelName: "Team Leader", city: "Bengaluru",
};
const chan: ScopeSubject = {
  id: "chan", name: "Chandan", uplineId: "asha", uplinePath: ["asha", "root"],
  levelName: "  team leader  ", city: "Mysuru",
};
const bhav: ScopeSubject = {
  id: "bhav", name: "Bhavana", uplineId: "root", uplinePath: ["root"],
  levelName: null, city: null,
};
const stranger: ScopeSubject = {
  id: "out", name: "Outsider", uplineId: null, uplinePath: [],
  levelName: "Team Leader", city: "Bengaluru",
};

describe("scopes", () => {
  test("a root coach is their own organisation", () => {
    assert.equal(orgRootId(root), "root");
    assert.equal(orgRootId(chan), "root");
  });

  test("two unrelated trees are two organisations, never one board", () => {
    const scope = scopeFor("org", chan)!;
    assert.equal(isInScope(scope, asha), true);
    assert.equal(isInScope(scope, stranger), false);
  });

  test("a line contains its owner and everyone below, and nobody above", () => {
    const line = scopeFor("line", chan)!; // Chandan's line is Asha's
    assert.equal(line.key, "asha");
    assert.equal(isInScope(line, asha), true);
    assert.equal(isInScope(line, chan), true);
    // The upline is above the line, not in it. The Security Rule agrees, and
    // e2e/leaderboards-rules.test.ts says why that costs them nothing.
    assert.equal(isInScope(line, root), false);
    assert.equal(isInScope(line, bhav), false);
  });

  /**
   * RULES L8 / D29. This app ships no rank names: not as defaults, not as
   * placeholders, not as a suggestion list. A coach with no level name simply has no
   * level group, and the screen has to teach rather than invent one.
   */
  test("a coach who has typed no level name has NO level group", () => {
    assert.equal(scopeFor("level", bhav), null);
    assert.equal(scopeFor("club", bhav), null);
  });

  test("level groups are matched on trim and lower — the coach's spelling stands", () => {
    const level = scopeFor("level", asha)!;
    assert.equal(level.key, "team leader");
    // The label is what THEY typed, never a canonical form we chose for them.
    assert.equal(level.label, "Team Leader");
    assert.equal(isInScope(level, chan), true);
    assert.equal(isInScope(level, bhav), false);
    assert.equal(normaliseScopeKey("  Team Leader  "), "team leader");
  });

  test("a city board deliberately crosses organisations — it is who is near you", () => {
    const city = scopeFor("club", asha)!;
    assert.deepEqual(
      membersOf(city, [root, asha, chan, bhav, stranger]).map((m) => m.id),
      ["root", "asha", "out"]
    );
  });
});

// ---------------------------------------------------------------------------
// Ranking, and the window
// ---------------------------------------------------------------------------

const rows = (...values: number[]): RankRow[] =>
  values.map((v, i) => ({ userId: `u${i}`, name: `Coach ${i}`, value: v }));

describe("ranking", () => {
  test("highest first", () => {
    const ranked = rankEntries(rows(5, 40, 20));
    assert.deepEqual(ranked.map((r) => r.value), [40, 20, 5]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
  });

  test("equals share a rank, and the next one skips — nobody is ordered below an equal", () => {
    const ranked = rankEntries(rows(40, 40, 20, 20, 5));
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3, 3, 5]);
  });

  test("a tiebreak orders equals without changing their rank", () => {
    const ranked = rankEntries([
      { userId: "a", name: "A", value: 7, tiebreak: 2 },
      { userId: "b", name: "B", value: 7, tiebreak: 5 },
    ]);
    assert.deepEqual(ranked.map((r) => r.userId), ["b", "a"]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1]);
  });

  test("the order is stable between runs when everything ties", () => {
    const once = rankEntries(rows(3, 3, 3)).map((r) => r.userId);
    const again = rankEntries(rows(3, 3, 3).reverse()).map((r) => r.userId);
    assert.deepEqual(once, again);
  });
});

describe("the viewer's window", () => {
  // Twelve coaches, values 120 down to 10. The viewer is u8, well down the board.
  const board = rankEntries(
    Array.from({ length: 12 }, (_, i) => ({
      userId: `u${i}`,
      name: `Coach ${i}`,
      value: 120 - i * 10,
    }))
  );

  test("shows the top three", () => {
    const view = buildViewerBoard(board, "u8");
    assert.equal(view.podium.length, PODIUM_SIZE);
    assert.deepEqual(view.podium.map((e) => e.userId), ["u0", "u1", "u2"]);
  });

  /**
   * THE rule. Everything else on this screen is a layout decision; this is the
   * feature working or not working. The window a coach is given must never contain
   * anybody behind them, because a coach who is never shown anybody behind them
   * cannot tell whether anybody is there — which is what makes last place
   * unobservable to the person in it and to everybody else.
   *
   * The podium is the deliberate exception and cannot leak the same thing: it is the
   * top three whatever the size of the field, so it says nothing about where the
   * field ends. Being on it is the point.
   */
  test("MANDATORY: the window never contains anybody ranked below the viewer", () => {
    for (const viewer of board.map((e) => e.userId)) {
      const view = buildViewerBoard(board, viewer);
      const me = view.me!;
      for (const entry of view.above) {
        assert.ok(
          entry.rank < me.rank,
          `${entry.userId} (rank ${entry.rank}) is not above ${viewer} (rank ${me.rank}) and must not be in the window`
        );
      }
    }
  });

  test("MANDATORY: the podium is three names whatever the size of the field", () => {
    // So it cannot be read as a measure of how many coaches there are, and therefore
    // cannot be combined with a rank to work out who is at the bottom.
    const small = rankEntries(rows(9, 8, 7, 6, 5));
    const large = rankEntries(rows(...Array.from({ length: 300 }, (_, i) => 300 - i)));
    assert.equal(buildViewerBoard(small, "u4").podium.length, PODIUM_SIZE);
    assert.equal(buildViewerBoard(large, "u299").podium.length, PODIUM_SIZE);
  });

  test("MANDATORY: the coach in last place sees the same shape as a coach mid-board", () => {
    const last = buildViewerBoard(board, "u11");
    const middle = buildViewerBoard(board, "u7");
    // Same number of names above, same podium, and a gap sentence either way.
    // Nothing in the shape of the view says "you have run out of board".
    assert.equal(last.above.length, middle.above.length);
    assert.equal(last.podium.length, middle.podium.length);
    assert.ok(last.gap);
    assert.ok(middle.gap);
  });

  test("the window looks four places up, and does not repeat the podium", () => {
    const view = buildViewerBoard(board, "u8");
    assert.deepEqual(view.above.map((e) => e.userId), ["u4", "u5", "u6", "u7"]);

    const nearTop = buildViewerBoard(board, "u4");
    // u0..u2 are already on the podium, so only u3 is added.
    assert.deepEqual(nearTop.above.map((e) => e.userId), ["u3"]);
  });

  /**
   * Found against the emulator, on the volume board, where a whole field can sit on
   * zero validated points. Slicing the window by POSITION put coaches with the SAME
   * value under the heading "just ahead of you" — they are not ahead, they are level,
   * and the order between them comes from a tiebreak nobody is shown. The window now
   * filters by value, which also makes `rank < me.rank` true of every entry in it.
   */
  test("the window holds only coaches who are genuinely ahead, never equals", () => {
    const tied = rankEntries([
      { userId: "a", name: "A", value: 0, tiebreak: 30 },
      { userId: "b", name: "B", value: 0, tiebreak: 20 },
      { userId: "c", name: "C", value: 0, tiebreak: 10 },
      { userId: "d", name: "D", value: 0, tiebreak: 5 },
      { userId: "e", name: "E", value: 0, tiebreak: 1 },
    ]);
    const view = buildViewerBoard(tied, "d");
    assert.deepEqual(view.above, []);
    assert.equal(view.gap, null);
    assert.equal(view.me!.rank, 1);
  });

  test("the gap is to the next coach who can actually be passed", () => {
    const view = buildViewerBoard(board, "u8");
    assert.deepEqual(view.gap, { points: 10, rank: 8 });

    // On a tie the coach ahead of you shares your rank, and "0 behind #3" is true and
    // useless. The gap skips to the next real step up.
    const tied = rankEntries([
      { userId: "a", name: "A", value: 50 },
      { userId: "b", name: "B", value: 20 },
      { userId: "c", name: "C", value: 20 },
    ]);
    assert.deepEqual(buildViewerBoard(tied, "c").gap, { points: 30, rank: 1 });
  });

  test("the leader has no gap, and is told they are top", () => {
    assert.equal(buildViewerBoard(board, "u0").gap, null);
  });

  test("a coach not on the board gets a podium and nothing about themselves", () => {
    const view = buildViewerBoard(board, "nobody");
    assert.equal(view.me, null);
    assert.equal(view.gap, null);
    assert.deepEqual(view.above, []);
    assert.equal(view.podium.length, PODIUM_SIZE);
  });

  /**
   * MANDATORY, and the one that caught a live leak.
   *
   * "The window never contains anybody below you" is necessary and NOT sufficient.
   * The podium and the window are two sets, and when they touch, the coach is handed
   * ranks 1..R unbroken, ending on their own name — the whole board, for anybody in
   * last place. No entry in it is behind them; the reveal is that there is nothing
   * between them either.
   *
   * The earlier version of this suite could not see it: every case ran against a
   * twelve-coach board, and the leak lives at 5..8 — which, at a pilot club, is the
   * size of nearly every real board. The floor was 5 and the assertion below was
   * `MIN_PARTICIPANTS > PODIUM_SIZE + 1`, which is true of 5 and says nothing about
   * the window.
   *
   * So this sweeps every field size a board can be published at and demands a hidden
   * rank for the reader who has the most to lose by there not being one.
   */
  test("MANDATORY: the last-placed coach is never shown the complete board", () => {
    for (let n = MIN_PARTICIPANTS; n <= MIN_PARTICIPANTS + 12; n++) {
      const ranked = rankEntries(
        Array.from({ length: n }, (_, i) => ({
          userId: `u${i}`,
          name: `Coach ${i}`,
          value: (n - i) * 10,
        }))
      );
      const view = buildViewerBoard(ranked, `u${n - 1}`);
      const shown = new Set(
        [...view.podium, ...view.above, view.me!].map((e) => e.rank)
      );

      assert.ok(
        shown.size < n,
        `a field of ${n} shows all ${n} ranks to the coach in last place`
      );
      // Not merely fewer — there must be a VISIBLE break, or an unbroken 1..R read
      // against a group whose membership the coach knows is the same reveal.
      const ordered = [...shown].sort((a, b) => a - b);
      assert.ok(
        ordered.some((rank, i) => rank !== i + 1),
        `a field of ${n} shows an unbroken 1..${n} to the coach in last place`
      );
    }
  });

  test("the floor is derived from the podium and the window, not chosen", () => {
    // Pinned as an equation so that moving PODIUM_SIZE or WINDOW_ABOVE cannot leave
    // the floor behind at a number that used to be safe.
    assert.equal(MIN_PARTICIPANTS, PODIUM_SIZE + WINDOW_ABOVE + 2);
  });
});

// ---------------------------------------------------------------------------
// Copy and shapes
// ---------------------------------------------------------------------------

describe("the four boards", () => {
  test("there are four, and volume is the only monthly-only one", () => {
    assert.equal(METRICS.length, 4);
    assert.deepEqual(METRIC_SPECS.volume.windows, ["monthly"]);
    for (const m of METRICS.filter((m) => m !== "volume")) {
      assert.deepEqual(METRIC_SPECS[m].windows, ["weekly", "monthly"]);
    }
  });

  /**
   * RULES L4 — no income promises, no money, no projections. A leaderboard is the
   * easiest place in this app to break that ("₹12,000 ahead of you", "at this rate
   * you would…"), so the copy is asserted rather than reviewed.
   */
  test("no money and no earnings language in any board's copy", () => {
    const banned = /₹|rs\.?\s|rupee|earn|income|salary|payout|commission|at this rate/i;
    for (const m of METRICS) {
      const spec = METRIC_SPECS[m];
      for (const text of [spec.title, spec.blurb, spec.howToJoin, spec.unit.one, spec.unit.many]) {
        assert.ok(!banned.test(text), `"${text}" reads as money or earnings`);
      }
    }
  });

  test("units are counts, and read correctly at one", () => {
    assert.equal(formatValue(METRIC_SPECS.peopleMet, 1), "1 person");
    assert.equal(formatValue(METRIC_SPECS.peopleMet, 12), "12 people");
    assert.equal(formatValue(METRIC_SPECS.streak, 1), "1 day");
    assert.equal(formatValue(METRIC_SPECS.volume, 1800), "1,800 points");
  });
});

describe("snapshot document ids", () => {
  const identity = {
    metric: "peopleMet" as const,
    window: "weekly" as const,
    periodKey: "2026-08-10",
    scopeType: "level" as const,
    scopeKey: "team leader",
  };

  test("are deterministic, so a rerun overwrites rather than duplicates", () => {
    assert.equal(podiumDocId(identity), podiumDocId({ ...identity }));
    assert.equal(rosterDocId(identity), rosterDocId({ ...identity }));
  });

  test("podium and roster are different documents — that split is the privacy line", () => {
    assert.notEqual(podiumDocId(identity), rosterDocId(identity));
  });

  test("free-text scope keys never reach the id raw", () => {
    // A level name or a city can contain a slash, which Firestore forbids in an id,
    // and can be any length. Hashing is what makes "whatever they typed" safe here.
    const awkward = podiumDocId({ ...identity, scopeKey: "north / south a".repeat(200) });
    assert.ok(!awkward.includes("/"));
    assert.ok(awkward.length < 200);
  });

  test("two different groups never share a board document", () => {
    assert.notEqual(
      podiumDocId(identity),
      podiumDocId({ ...identity, scopeKey: "team leaders" })
    );
    assert.notEqual(
      podiumDocId(identity),
      podiumDocId({ ...identity, scopeType: "club" })
    );
    assert.notEqual(optOutDocId("asha"), optOutDocId("asha2"));
  });
});
