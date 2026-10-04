import { dailyLogs, users } from "./collections";
import { streakFromKeys, todayKey } from "./daily-log";

/**
 * Coach lists and per-coach detail for the admin panel (F12).
 *
 * Counts only — see lib/admin.ts. A coach's OWN name, phone and city are here because the
 * coach is the customer and support exists to help them; what never appears is anything
 * belonging to the people they captured.
 *
 * ## Cheap list, detailed drill-down
 *
 * The list shows only what lives on the user document, so it costs one query however wide
 * the table gets. Last-logged and streak need that coach's log history, so they are
 * computed on the DETAIL page for one coach at a time. Putting them in the list would
 * multiply a page view by the number of rows — the classic admin-panel N+1 that is
 * invisible at ten users and a bill at ten thousand.
 */

export type CoachRow = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  plan: string;
  uplineId: string | null;
  directDownlineCount: number;
  createdAt: string;
};

/**
 * Every coach, newest first, filtered in memory.
 *
 * Firestore has no substring search, and the alternatives are a prefix-only index (which
 * cannot find "asha" in "Vidya Asha") or a search service. At pilot scale reading the user
 * documents and filtering here is correct and honest; `LIST_CAP` bounds it so this can
 * never become an unbounded scan by accident, and the page says when it truncates.
 *
 * When the cap starts biting, the answer is a real search index, not a bigger cap.
 */
export const LIST_CAP = 500;

export async function listCoaches(query: string): Promise<{
  rows: CoachRow[];
  total: number;
  truncated: boolean;
}> {
  const snap = await users().orderBy("createdAt", "desc").limit(LIST_CAP + 1).get();
  const truncated = snap.size > LIST_CAP;

  const all: CoachRow[] = snap.docs.slice(0, LIST_CAP).map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name ?? "",
      phone: d.phone ?? "",
      city: d.city ?? null,
      plan: d.plan ?? "trial",
      uplineId: d.uplineId ?? null,
      directDownlineCount: d.directDownlineCount ?? 0,
      createdAt: (d.createdAt?.toDate?.() ?? new Date(0)).toISOString(),
    };
  });

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const rows = q
    ? all.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.city ?? "").toLowerCase().includes(q) ||
          (digits.length > 0 && r.phone.replace(/\D/g, "").includes(digits))
      )
    : all;

  return { rows, total: all.length, truncated };
}

export type CoachDetail = {
  coach: CoachRow;
  upline: { id: string; name: string } | null;
  directLine: { id: string; name: string; directDownlineCount: number }[];
  /** Whole line, any depth — the number that matters for a Leader-tier decision. */
  lineSize: number;
  lastLoggedDay: string | null;
  streak: number;
  logsLast30: number;
};

const STREAK_WINDOW = 400;

export async function getCoachDetail(id: string): Promise<CoachDetail | null> {
  const snap = await users().doc(id).get();
  const d = snap.data();
  if (!d) return null;

  const coach: CoachRow = {
    id: snap.id,
    name: d.name ?? "",
    phone: d.phone ?? "",
    city: d.city ?? null,
    plan: d.plan ?? "trial",
    uplineId: d.uplineId ?? null,
    directDownlineCount: d.directDownlineCount ?? 0,
    createdAt: (d.createdAt?.toDate?.() ?? new Date(0)).toISOString(),
  };

  const [uplineSnap, lineSnap, directSnap, logSnap] = await Promise.all([
    coach.uplineId ? users().doc(coach.uplineId).get() : Promise.resolve(null),
    users().where("uplinePath", "array-contains", id).count().get(),
    users().where("uplineId", "==", id).orderBy("createdAt", "asc").get(),
    // Ids only: the id is `${userId}__${dayKey}` (D26), so the day keys come free.
    dailyLogs().where("userId", "==", id).orderBy("dayKey", "desc").limit(STREAK_WINDOW).select().get(),
  ]);

  const days = logSnap.docs
    .map((doc) => doc.id.split("__")[1])
    .filter((k): k is string => Boolean(k));

  const today = todayKey();
  const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return {
    coach,
    upline: uplineSnap?.exists
      ? { id: uplineSnap.id, name: (uplineSnap.data()?.name as string) ?? "" }
      : null,
    directLine: directSnap.docs.map((doc) => ({
      id: doc.id,
      name: (doc.data().name as string) ?? "",
      directDownlineCount: (doc.data().directDownlineCount as number) ?? 0,
    })),
    lineSize: lineSnap.data().count,
    lastLoggedDay: days[0] ?? null,
    streak: streakFromKeys(days, today),
    logsLast30: days.filter((k) => k >= thirtyAgo).length,
  };
}
