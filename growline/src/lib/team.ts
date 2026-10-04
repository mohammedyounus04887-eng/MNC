import { dailyLogs, targets, users } from "./collections";
import { APP_TIMEZONE, dayKey } from "./day";
import { getUserById, toAppUser, type AppUser } from "./users";

export type TeamNode = {
  id: string;
  name: string;
  photoUrl: string | null;
  city: string | null;
  logsThisMonth: number;
  /** F6's accountability loop: has this coach logged today, right now. */
  loggedToday: boolean;
  targetPct: number | null;
  directCount: number;
  children: TeamNode[];
  /** true when this node has downlines in the DB beyond the rendered depth */
  hasMore: boolean;
};

export function currentMonthKey(
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): string {
  return dayKey(now, timeZone).slice(0, 7);
}

/**
 * Day keys are "YYYY-MM-DD" strings, so lexicographic comparison IS chronological
 * comparison — `>= "2026-08-01"` is a correct month filter with no date maths and
 * no timezone drift. The keys were written in the coach's own zone (D26), which is
 * what makes this right rather than merely convenient.
 */
function monthStartKey(timeZone: string = APP_TIMEZONE, now = new Date()): string {
  return `${currentMonthKey(timeZone, now)}-01`;
}

/**
 * True if uplineId is an ancestor of userId (or is the user).
 *
 * Was: a loop walking up `uplineId` with one query per hop, up to 100 hops. Now a
 * single document read and an array membership test — the payoff D36 was written
 * for.
 */
export async function isInDownline(uplineId: string, userId: string): Promise<boolean> {
  if (uplineId === userId) return true;
  const user = await getUserById(userId);
  return user ? user.uplinePath.includes(uplineId) : false;
}

/**
 * Tree of rootId + downlines, capped at `depth` levels per Section 11.
 * Nodes carry this month's activity summary (logs done, target %).
 *
 * ## Why this is not a per-node fan-out
 *
 * Firestore has no `groupBy`, so the four grouped aggregations this used to run
 * cannot be expressed. The replacement is NOT "one count query per node" — that
 * grows with team size and is exactly the shape a team screen should never have.
 *
 * Instead `uplinePath` (D36) makes the entire line reachable in one query:
 * everything below the root has rootId in its path, at any depth. So the whole
 * subtree's logs and targets arrive in a fixed number of queries regardless of
 * how many coaches are in it, and the grouping happens in memory.
 *
 * The root's own rows need a separate query, because a user is not in their own
 * uplinePath.
 */
export async function buildTeamTree(rootId: string, depth = 3): Promise<TeamNode | null> {
  const root = await getUserById(rootId);
  if (!root) return null;

  // Breadth-first by uplineId, one query per level (depth is capped at 3).
  const all: AppUser[] = [root];
  let frontier = [rootId];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: AppUser[] = [];
    // `in` accepts at most 30 values per query, so wide levels are chunked.
    for (let i = 0; i < frontier.length; i += 30) {
      const snap = await users()
        .where("uplineId", "in", frontier.slice(i, i + 30))
        .orderBy("createdAt", "asc")
        .get();
      next.push(...snap.docs.map(toAppUser).filter((u): u is AppUser => u !== null));
    }
    all.push(...next);
    frontier = next.map((u) => u.id);
  }

  const fromKey = monthStartKey();
  const todayK = dayKey(new Date(), APP_TIMEZONE);
  const month = currentMonthKey();

  const [lineLogs, ownLogs, lineTargets, ownTargets] = await Promise.all([
    dailyLogs()
      .where("uplinePath", "array-contains", rootId)
      .where("dayKey", ">=", fromKey)
      .get(),
    dailyLogs().where("userId", "==", rootId).where("dayKey", ">=", fromKey).get(),
    targets().where("uplinePath", "array-contains", rootId).where("month", "==", month).get(),
    targets().where("coachId", "==", rootId).where("month", "==", month).get(),
  ]);

  const logsBy = new Map<string, number>();
  const loggedTodayIds = new Set<string>();
  for (const doc of [...lineLogs.docs, ...ownLogs.docs]) {
    const d = doc.data();
    logsBy.set(d.userId, (logsBy.get(d.userId) ?? 0) + 1);
    if (d.dayKey === todayK) loggedTodayIds.add(d.userId);
  }

  const targetBy = new Map<string, number | null>();
  for (const doc of [...lineTargets.docs, ...ownTargets.docs]) {
    const d = doc.data();
    targetBy.set(
      d.coachId,
      d.targetPoints > 0 ? Math.round((d.progressPoints / d.targetPoints) * 100) : null
    );
  }

  const nodeBy = new Map<string, TeamNode>();
  for (const u of all) {
    nodeBy.set(u.id, {
      id: u.id,
      name: u.name,
      photoUrl: u.photoUrl,
      city: u.city,
      logsThisMonth: logsBy.get(u.id) ?? 0,
      loggedToday: loggedTodayIds.has(u.id),
      targetPct: targetBy.get(u.id) ?? null,
      // Materialised on the user document — Firestore cannot count children, and
      // this is maintained in the same transaction as the signup that creates one.
      directCount: u.directDownlineCount,
      children: [],
      hasMore: false,
    });
  }
  for (const u of all) {
    if (u.id !== rootId && u.uplineId && nodeBy.has(u.uplineId)) {
      nodeBy.get(u.uplineId)!.children.push(nodeBy.get(u.id)!);
    }
  }
  for (const node of nodeBy.values()) {
    node.hasMore = node.children.length === 0 && node.directCount > 0;
  }
  return nodeBy.get(rootId)!;
}
