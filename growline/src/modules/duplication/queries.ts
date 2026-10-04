import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import type { AppUser } from "@/lib/users";
import { DUPLICATION_SCORES, duplicationScoreDocId, type DuplicationScoreDoc } from "./docs";
import type { LevelResult, ScoreReason } from "./score";

/**
 * The read side. Server only — the page is rendered on the server and the browser is
 * handed the finished view, exactly as the boards and the qualification screens are.
 *
 * ## One coach, their own reading, and nothing else
 *
 * `getDuplicationFor` reads the CALLER'S OWN document and takes no id from anywhere.
 * There is no authorization decision in this file because there is no request that
 * could name somebody else's reading — which is the cheapest way to be sure of one.
 *
 * A screen showing an upline a downline's reading is a real and obvious next feature,
 * and it does not belong here as a parameter with a check bolted on. It has to decide
 * membership against the CURRENT tree (D64 — never a `uplinePath` frozen at write
 * time; every reading in this collection carries one from whenever the job last ran)
 * and it has to answer for itself whether a per-level breakdown of somebody's team is
 * a count that flows up under P1 or a judgement that should not. Neither question is
 * answered by widening a function that currently cannot get it wrong.
 *
 * ## Nothing is recomputed on open
 *
 * Unlike a qualification tracker (N21), which refreshes one qualification when it
 * goes stale, this reading is the aggregation of an entire organisation. Refreshing
 * it on open would mean a coach's page load costs a whole-tree read, which is the
 * exact expense the scheduled job exists to pay once. So the view carries
 * `generatedAt` and the screen states it plainly.
 */

export type DuplicationView = {
  score: number | null;
  reason: ScoreReason;
  levels: LevelResult[];
  lineSize: number;
  pendingCount: number;
  deepestLevel: number | null;
  deepestActiveLevel: number | null;
  own: { daysLogged: number; active: boolean };
  fromKey: string;
  toKey: string;
  windowDays: number;
  generatedAt: Date | null;
};

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/**
 * This coach's reading, or null when no job has produced one for them yet.
 *
 * Null is NOT "score zero" and the screen must never render it as one. It means
 * either that nothing has been computed yet or that this coach has no line at all,
 * and those two are different sentences — `hasLine` tells them apart without a
 * second read, off a counter the signup transaction already maintains.
 */
export async function getDuplicationFor(user: AppUser): Promise<DuplicationView | null> {
  const snap = await db
    .collection(DUPLICATION_SCORES)
    .doc(duplicationScoreDocId(user.id))
    .get();
  if (!snap.exists) return null;

  const d = snap.data() as DuplicationScoreDoc;
  if (!user.workspaceId || d.workspaceId !== user.workspaceId) return null;
  return {
    score: d.score ?? null,
    reason: d.reason ?? "noLine",
    levels: d.levels ?? [],
    lineSize: d.lineSize ?? 0,
    pendingCount: d.pendingCount ?? 0,
    deepestLevel: d.deepestLevel ?? null,
    deepestActiveLevel: d.deepestActiveLevel ?? null,
    own: d.own ?? { daysLogged: 0, active: false },
    fromKey: d.fromKey,
    toKey: d.toKey,
    windowDays: d.windowDays,
    generatedAt: toDate(d.generatedAt),
  };
}

/**
 * Whether this coach has anybody below them at all.
 *
 * Read off `directDownlineCount`, which the signup transaction maintains (D36's
 * neighbourhood) — a count query over `users` would cost a read of the whole line to
 * answer a yes/no the user document already holds. Depth 2 cannot exist without
 * depth 1, so this one number settles it.
 */
export function hasLine(user: AppUser): boolean {
  return user.directDownlineCount > 0;
}
