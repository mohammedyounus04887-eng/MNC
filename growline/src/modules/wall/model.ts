/**
 * The Recognition Wall (Feature B).
 *
 * ## What it is
 *
 * A feed of things coaches in the same workspace have DONE. Every card is earned by an
 * event the app already records — a streak milestone, a target reached, a first
 * prospect — and no card is ever typed by anyone. Nothing manually posted means nothing
 * to moderate, nothing to boast in, and no card that says something the app cannot
 * vouch for. This audience runs on recognition (v1 §4.8) and the wall is where the
 * recognition already happening privately becomes visible to the room.
 *
 * ## The four rules that keep it a wall and not a feed
 *
 * 1. **Own workspace only.** A card is visible to the members of the earner's workspace
 *    and nobody else. Cross-workspace visibility would turn recognition into
 *    comparison between organisations, which is a different product with different
 *    problems (RULES S7 — no social feed).
 * 2. **One reaction, 👏, and no comments.** A single reaction is recognition; a comment
 *    thread is a group chat, and RULES S3 forbids exactly that. One person can clap
 *    once per card; the count is what the earner sees.
 * 3. **14-day expiry.** A wall that never clears becomes a leaderboard by another name,
 *    and old cards make new ones invisible. Fourteen days is long enough that a coach
 *    who opens the app twice a week sees it, short enough that the wall is always about
 *    now. Expiry is DERIVED at read time from `earnedAt` — no job, no deletion.
 * 4. **Per-user opt-out, and it is retroactive.** A coach who turns the wall off is not
 *    shown on it — including cards already earned — and does not see it. Their events
 *    still fire for their own screens; only the room's view changes. Enforced at write
 *    (no card is minted) AND at read (existing cards drop out), so flipping the switch
 *    is instant in both directions.
 *
 * ## What the wall must never say
 *
 * No money, no rank names, no company names (RULES L1/L4/L8). A "target reached" card
 * shows the points, never a rupee equivalent. A "milestone" card names days, never a
 * level. Every string that can appear on a card is enumerated below in `CARD_COPY`, and
 * the unit suite sweeps that table — there is no free-text path onto the wall.
 *
 * PURE ONLY — no database import (RULES E2; the wall renders client-side reactions).
 */

export const CARD_KINDS = [
  "first-prospect",
  "first-member",
  "streak",
  "target-reached",
  "first-downline",
  "qualified",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
}

/** Days a card stays on the wall. Derived at read time; nothing is deleted. */
export const CARD_TTL_DAYS = 14;

/**
 * Only these streak days mint a card. Every streak milestone the log celebrates
 * privately would flood the wall — 3 and 7 days happen constantly across a workspace.
 * The wall shows the ones worth a room noticing.
 */
export const WALL_STREAK_DAYS = new Set([30, 100, 365]);

/**
 * A card, as read. `earnerName` is denormalised at write time so rendering a wall of
 * forty cards is forty reads of one collection, not forty joins into `users`.
 */
export type WallCard = {
  id: string;
  workspaceId: string;
  earnerId: string;
  earnerName: string;
  earnerPhotoUrl: string | null;
  kind: CardKind;
  /** The one number the card carries. Days for streaks, points for targets, else null. */
  value: number | null;
  earnedAt: Date;
  claps: number;
  /** Whether the CURRENT viewer has clapped this card. Set at read for the viewer. */
  clappedByMe: boolean;
};

/**
 * Every word that can appear on a card. Enumerated so it can be swept for L1/L4/L8.
 *
 * `{name}` is the earner's first name, `{value}` the number. Points are "points" — the
 * word RULES L4 permits — never converted, never given a symbol.
 */
export const CARD_COPY: Record<CardKind, { title: string; line: string }> = {
  "first-prospect": {
    title: "First person",
    line: "{name} met their first person and saved them.",
  },
  "first-member": {
    title: "First member",
    line: "{name}'s first person became a member.",
  },
  streak: {
    title: "{value} days in a row",
    line: "{name} has logged every day for {value} days.",
  },
  "target-reached": {
    title: "Target reached",
    line: "{name} reached this month's target — {value} points.",
  },
  "first-downline": {
    title: "First coach in the line",
    line: "Somebody joined {name}'s line — their team has started.",
  },
  qualified: {
    title: "Qualified",
    line: "{name} met every condition of a qualification.",
  },
};

export function cardText(card: Pick<WallCard, "kind" | "earnerName" | "value">): {
  title: string;
  line: string;
} {
  const first = card.earnerName.trim().split(/\s+/)[0] || "A coach";
  const value = card.value === null ? "" : card.value.toLocaleString("en-IN");
  const fill = (s: string) => s.replace(/\{name\}/g, first).replace(/\{value\}/g, value);
  const copy = CARD_COPY[card.kind];
  return { title: fill(copy.title), line: fill(copy.line) };
}

/**
 * Whether a card is still on the wall. Pure and keyed on the caller's `now` so the
 * boundary is testable without a clock (RULES E1: never `new Date()` for a boundary
 * inside logic — the caller supplies it).
 */
export function isLive(earnedAt: Date, now: Date): boolean {
  return now.getTime() - earnedAt.getTime() < CARD_TTL_DAYS * 86_400_000;
}

/**
 * The share text for WhatsApp Status. First person, plain, and it is the earner's own
 * achievement in their own voice — never "look what X did" from a third party, which
 * would make sharing somebody else's card the default. No income, no rank (RULES L4/L8).
 */
export function shareText(card: Pick<WallCard, "kind" | "value">): string {
  const value = card.value === null ? "" : card.value.toLocaleString("en-IN");
  switch (card.kind) {
    case "first-prospect":
      return "Met my first person on Growline today. Small start. 🌱";
    case "first-member":
      return "My first member. It works. 🙌";
    case "streak":
      return `${value} days in a row of showing up. 🔥`;
    case "target-reached":
      return `Reached my target this month — ${value} points. 🎯`;
    case "first-downline":
      return "Somebody just joined my line. My team has started. 🌳";
    case "qualified":
      return "Qualified. Every condition met. ✅";
  }
}
