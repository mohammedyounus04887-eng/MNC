import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CARD_COPY,
  CARD_KINDS,
  CARD_TTL_DAYS,
  WALL_STREAK_DAYS,
  cardText,
  isCardKind,
  isLive,
  shareText,
} from "@/modules/wall/model";

/**
 * The Recognition Wall (Feature B).
 *
 * The compliance sweep here matters more than usual: this is the only screen in the app
 * where one coach's achievement is shown to other coaches, which is exactly the surface
 * an income claim or a rank name would be most damaging on.
 */

/** Source with comments removed — see the S3 test for why every grep needs this. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DAY = 86_400_000;
const NOW = new Date("2026-08-14T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("card copy — nothing here is typed by a user", () => {
  test("every card kind has copy, and only enumerated kinds exist", () => {
    for (const kind of CARD_KINDS) {
      assert.ok(CARD_COPY[kind], `no copy for ${kind}`);
      assert.ok(CARD_COPY[kind].title.length > 0);
      assert.ok(CARD_COPY[kind].line.length > 0);
    }
    assert.equal(isCardKind("first-prospect"), true);
    assert.equal(isCardKind("anything-else"), false);
    assert.equal(isCardKind(null), false);
  });

  test("MANDATORY: no card copy mentions money or earnings (RULES L4)", () => {
    const all: string[] = [];
    for (const kind of CARD_KINDS) {
      all.push(CARD_COPY[kind].title, CARD_COPY[kind].line);
      all.push(shareText({ kind, value: 1200 }));
      const t = cardText({ kind, earnerName: "Priya Sharma", value: 1200 });
      all.push(t.title, t.line);
    }
    assert.ok(all.length > 20);
    for (const s of all) {
      assert.doesNotMatch(s, /₹|\$|rupee|earn|income|salary|commission|profit|paid/i, s);
    }
  });

  test("MANDATORY: no card copy names a rank or a company (RULES L1/L8)", () => {
    const src = readFileSync("src/modules/wall/model.ts", "utf8");
    assert.doesNotMatch(src, /\b(supervisor|president'?s team|diamond|chairman'?s club)\b/i);
    assert.doesNotMatch(src, /\b(herbalife|amway|oriflame|vestige|modicare)\b/i);
  });

  test("a card uses the earner's FIRST name only", () => {
    const t = cardText({ kind: "first-prospect", earnerName: "Priya Sharma", value: null });
    assert.match(t.line, /Priya/);
    assert.doesNotMatch(t.line, /Sharma/);
  });

  test("a nameless earner does not render an empty sentence", () => {
    const t = cardText({ kind: "first-member", earnerName: "   ", value: null });
    assert.match(t.line, /A coach/);
  });

  test("the value is formatted, and absent values leave no dangling placeholder", () => {
    const withValue = cardText({ kind: "target-reached", earnerName: "Ravi", value: 12000 });
    assert.match(withValue.line, /12,000 points/);
    for (const kind of CARD_KINDS) {
      const t = cardText({ kind, earnerName: "Ravi", value: null });
      assert.doesNotMatch(t.title + t.line, /\{value\}|\{name\}/, kind);
    }
  });
});

describe("the 14-day window", () => {
  test("a card is live for exactly the TTL and not a moment past it", () => {
    assert.equal(CARD_TTL_DAYS, 14);
    assert.equal(isLive(daysAgo(13), NOW), true);
    assert.equal(isLive(daysAgo(13.9), NOW), true);
    assert.equal(isLive(daysAgo(14), NOW), false);
    assert.equal(isLive(daysAgo(30), NOW), false);
  });

  test("expiry is derived, so nothing has to run for a card to leave the wall", () => {
    // Same card, two different nows, two different answers, zero writes.
    const earned = new Date("2026-08-01T00:00:00Z");
    assert.equal(isLive(earned, new Date("2026-08-10T00:00:00Z")), true);
    assert.equal(isLive(earned, new Date("2026-09-01T00:00:00Z")), false);
  });
});

describe("which streaks reach the wall", () => {
  test("only the ones worth a room noticing", () => {
    for (const d of [30, 100, 365]) assert.equal(WALL_STREAK_DAYS.has(d), true, String(d));
    // 3 and 7 fire constantly across a workspace and would drown everything else.
    for (const d of [3, 7, 14, 60, 200]) assert.equal(WALL_STREAK_DAYS.has(d), false, String(d));
  });

  test("the wall's set is a SUBSET of the private streak milestones", () => {
    // A card for a day the log itself does not celebrate would be a number the coach has
    // never seen before appearing in front of their whole group.
    const log = readFileSync("src/lib/daily-log.ts", "utf8");
    const declared = log.match(/STREAK_MILESTONES\s*=\s*\[([^\]]+)\]/);
    assert.ok(declared, "could not read STREAK_MILESTONES");
    const milestones = new Set(declared[1].split(",").map((s) => Number(s.trim())));
    for (const d of WALL_STREAK_DAYS) {
      assert.equal(milestones.has(d), true, `${d} is on the wall but not a log milestone`);
    }
  });
});

describe("sharing is the earner's own voice", () => {
  test("every share line is first person — never 'look what X did'", () => {
    for (const kind of CARD_KINDS) {
      const s = shareText({ kind, value: 500 });
      assert.ok(s.length > 0, kind);
      assert.doesNotMatch(s, /\{name\}|\bthey\b|\btheir\b/i, `${kind}: ${s}`);
    }
  });

  test("the share button is only on your own card", () => {
    const feed = readFileSync("src/modules/wall/WallFeed.tsx", "utf8");
    assert.match(feed, /isMine && \(/);
  });
});

describe("the shape of the interaction", () => {
  test("MANDATORY: there is no comment field anywhere on the wall (RULES S3)", () => {
    /*
     * Comments stripped before matching. The raw file contains the word "comment" in the
     * paragraph EXPLAINING why a comment box is banned — matching it would make the test
     * punish the explanation, and the fix would be to delete the reasoning. That is
     * exactly backwards, and it is the third time this trap has been hit in this repo.
     */
    const feed = code(readFileSync("src/modules/wall/WallFeed.tsx", "utf8"));
    assert.doesNotMatch(feed, /<textarea/);
    assert.doesNotMatch(feed, /type="text"/);
    assert.doesNotMatch(feed, /comment/i);
  });

  test("the only reaction is a clap, and it cannot be taken back or repeated", () => {
    const feed = readFileSync("src/modules/wall/WallFeed.tsx", "utf8");
    assert.match(feed, /if \(card\.clappedByMe\) return;/);
    const queries = readFileSync("src/modules/wall/queries.ts", "utf8");
    // The clap document's EXISTENCE is the one-per-person rule — not a counter somebody
    // has to keep honest.
    assert.match(queries, /clapSnap\.exists/);
    assert.match(queries, /tx\.create\(clapRef/);
  });

  test("opt-out is enforced at BOTH write and read", () => {
    const queries = readFileSync("src/modules/wall/queries.ts", "utf8");
    const mint = queries.slice(queries.indexOf("export async function mint"));
    assert.match(mint.slice(0, 900), /isOptedOut/, "mint must refuse an opted-out earner");
    const wall = queries.slice(queries.indexOf("export async function getWall"));
    assert.match(wall, /optedOut\.has\(c\.earnerId\)/, "read must drop opted-out earners");
  });

  test("a card is scoped to the earner's workspace, and clapping re-checks it", () => {
    const queries = readFileSync("src/modules/wall/queries.ts", "utf8");
    assert.match(queries, /where\("workspaceId", "==", viewer\.workspaceId\)/);
    assert.match(queries, /card\.workspaceId !== viewer\.workspaceId/);
  });
});

describe("the index the wall query needs", () => {
  test("(workspaceId, earnedAt desc) is declared", () => {
    // The emulator invents missing indexes, so nothing else here would notice.
    const idx = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as {
      indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
    };
    const match = idx.indexes.find(
      (i) =>
        i.collectionGroup === "recognitions" &&
        i.fields[0]?.fieldPath === "workspaceId" &&
        i.fields[1]?.fieldPath === "earnedAt" &&
        i.fields[1]?.order === "DESCENDING"
    );
    assert.ok(match, "no (workspaceId, earnedAt DESC) index for the wall");
  });
});

describe("layering (RULES E2)", () => {
  test("the model is pure and the feed never imports the query layer", () => {
    const model = readFileSync("src/modules/wall/model.ts", "utf8");
    assert.doesNotMatch(model, /^\s*import\s/m);
    const feed = readFileSync("src/modules/wall/WallFeed.tsx", "utf8");
    assert.match(feed, /^"use client";/);
    assert.doesNotMatch(
      feed,
      /^\s*import\s[^\n]*(firebase-admin|@\/lib\/collections|\.\/queries)/m
    );
  });
});
