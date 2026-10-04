/**
 * Ranking, and the ranking WINDOW — the part of this feature that is a product
 * decision rather than a sort.
 *
 * ## Nobody is shown the bottom of a board
 *
 * The brief is explicit and it is the rule the rest of this file is built around:
 * someone in last place must never be able to see that they are in last place, and
 * nor must anyone else. So the view a coach is given is:
 *
 *   - the top 3 (a podium is aspirational, and three names is not a ranking of
 *     everybody), and
 *   - a window looking UPWARD from their own position — the few people just ahead —
 *     with the exact gap to the one immediately above.
 *
 * The window never looks down. That single asymmetry is what makes last place
 * unobservable: if no coach is ever shown anyone below them, then no coach can tell
 * whether anybody is below them, and the person at the bottom sees the same screen
 * as the person in the middle — a few names ahead and a number to chase.
 *
 * Two things that follow from it, and must survive future edits:
 *
 *   - the participant COUNT is not part of what a client is given. "You are #14"
 *     alongside "41 coaches" is a bottom-of-the-board reveal with extra steps.
 *   - the full ordered list is never handed to the browser. `buildViewerBoard` runs
 *     on the server against the private roster document, and only its result ships.
 *
 * ## Ties
 *
 * Standard competition ranking: two coaches on 40 both hold rank 3, and the next is
 * 5th. Nobody is ordered below an equal on a tiebreak they cannot see.
 */

export type RankRow = {
  userId: string;
  name: string;
  /** The number that ranks you. For volume this is the VALIDATED figure only. */
  value: number;
  /**
   * Shown, but never ranked on: volume a coach has claimed that no upline has
   * checked yet. Rendered distinctly so a claim is never mistaken for a fact.
   */
  unvalidated?: number;
  /** Silent tiebreak (e.g. days logged behind an equal-length streak). */
  tiebreak?: number;
};

export type RankedEntry = RankRow & { rank: number };

/**
 * Highest first. Ties share a rank; `tiebreak` only orders equal values within a
 * shared rank, and name is the last resort so the order is stable between runs.
 */
export function rankEntries(rows: RankRow[]): RankedEntry[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.value - a.value ||
      (b.tiebreak ?? 0) - (a.tiebreak ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId)
  );

  const out: RankedEntry[] = [];
  let rank = 0;
  let previous: number | null = null;
  sorted.forEach((row, i) => {
    if (previous === null || row.value !== previous) rank = i + 1;
    previous = row.value;
    out.push({ ...row, rank });
  });
  return out;
}

/** How many entries above the viewer are shown. Four is a screenful, not a list. */
export const WINDOW_ABOVE = 4;

export const PODIUM_SIZE = 3;

export type ViewerBoard = {
  podium: RankedEntry[];
  /** The people just ahead of the viewer, nearest last. Never anyone behind them. */
  above: RankedEntry[];
  /** The viewer's own entry, or null when they are not on this board. */
  me: RankedEntry | null;
  /** Exact distance to the person immediately above — "180 behind #13". */
  gap: { points: number; rank: number } | null;
};

/**
 * The whole ordered board in, one coach's view out.
 *
 * Entries already in the podium are not repeated in the window, so a coach at rank 4
 * sees three names above them rather than three plus the same three again.
 */
export function buildViewerBoard(
  entries: RankedEntry[],
  viewerId: string | null
): ViewerBoard {
  const podium = entries.slice(0, PODIUM_SIZE);
  const index = entries.findIndex((e) => e.userId === viewerId);
  if (index < 0) {
    return { podium, above: [], me: null, gap: null };
  }

  const me = entries[index];

  /**
   * Strictly ahead, not merely earlier in the array.
   *
   * Ties are ordered inside a shared rank by a tiebreak the coach cannot see, so
   * slicing by POSITION would put people level with the reader under a heading that
   * says "just ahead of you" — a small lie, and one that quietly publishes an
   * ordering that is not a ranking. Filtering by value means the window contains
   * only coaches the reader can actually pass, and `rank < me.rank` holds for every
   * entry in it.
   */
  const strictlyAhead = entries.filter((e) => e.value > me.value);
  const above = strictlyAhead
    .slice(-WINDOW_ABOVE)
    .filter((e) => !podium.some((p) => p.userId === e.userId));

  // The nearest coach who is genuinely ahead. On a tie, "0 behind #3" is a true and
  // useless sentence; the gap that means something is to the next real step up.
  const ahead = strictlyAhead[strictlyAhead.length - 1] ?? null;

  return {
    podium,
    above,
    me,
    gap: ahead ? { points: ahead.value - me.value, rank: ahead.rank } : null,
  };
}

/**
 * A board is published only once this many coaches are on it.
 *
 * Not a performance threshold — a privacy one, and it is DERIVED rather than chosen
 * because the number that makes it work depends on the two constants above.
 *
 * ## Why it cannot be a hand-picked constant
 *
 * A coach at rank R is shown the podium (ranks 1..PODIUM_SIZE) and the window
 * (the WINDOW_ABOVE coaches immediately ahead of them), plus themselves. When
 * R <= PODIUM_SIZE + WINDOW_ABOVE + 1 those sets meet, and the coach is shown ranks
 * 1..R with no gap in them — the complete board, ending on their own name.
 *
 * The upward-only window alone does not save it. The window never contains anybody
 * behind the reader and never will; what leaks is CONTIGUITY. A coach who is shown
 * an unbroken 1..R, on a group whose membership they already know (their own team is
 * on the team tree), can see that the board has run out. That is the reveal this
 * feature exists to prevent, and it was live at every board size from
 * MIN_PARTICIPANTS up to PODIUM_SIZE + WINDOW_ABOVE — which at a pilot club is most
 * of them.
 *
 * So the floor is the smallest field in which at least one rank is always hidden
 * between the podium and the window, for every reader including the last-placed one.
 * Verified by sweep in tests/leaderboards.test.ts rather than by this comment.
 *
 * ## The dial, if 9 is too many
 *
 * This is now a consequence of WINDOW_ABOVE, not an independent product number.
 * Showing fewer coaches ahead lowers the floor one for one: WINDOW_ABOVE = 2 gives a
 * floor of 7, WINDOW_ABOVE = 1 gives 6. Lowering the FLOOR on its own is not
 * available — it re-opens the leak. Whoever wants more boards published at pilot
 * scale trades window depth for it, deliberately.
 */
export const MIN_PARTICIPANTS = PODIUM_SIZE + WINDOW_ABOVE + 2;

/** Roster cap: enough for any pilot-scale scope, small enough to stay a document. */
export const MAX_ROSTER_ENTRIES = 2000;
