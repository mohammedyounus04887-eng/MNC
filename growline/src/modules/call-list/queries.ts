import { prospects } from "@/lib/collections";
import { toAppProspect } from "@/lib/prospects";
import { todayKey } from "@/lib/daily-log";
import { APP_TIMEZONE } from "@/lib/day";
import { toStage } from "@/lib/pipeline";
import { rankCallList, type CallList, type Candidate } from "./rank";

/**
 * Reading the call list (session 4, feature 2).
 *
 * ## One query, filtered to one coach, and nothing written
 *
 * `where("coachId", "==", coachId)` and nothing else. This module writes NOTHING to
 * `prospects` — no "lastRankedAt", no cached score, no touch of any kind. The ranking is
 * derived on read from fields that already exist, which is what lets it be a pure
 * function with unit tests instead of a pipeline with state to get out of step.
 *
 * ## P1 is structural here, not a filter someone remembered
 *
 * The coach id comes from the session, never from a parameter a caller chose, and there
 * is no code path in this module that takes any other id. An upline cannot request this
 * list for a downline because no function here accepts the question. The Security Rules
 * say the same thing for a client that tries directly: reading `prospects` requires the
 * query be pinned to a single `coachId`, and reading someone else's needs their
 * `shareProspects` on — this screen never relies on that grant, because it never asks
 * about anybody but the signed-in coach.
 *
 * ## Why the whole set is read rather than a narrowed query
 *
 * Three of the ranking's signals — overdue, due today, and no date at all — cannot be
 * expressed as one Firestore query, because null sorts before every timestamp and an
 * inequality that catches the overdue also catches everyone with no date (the trap
 * `followup-queries.ts` documents). Three queries would then have to be merged and
 * de-duplicated in memory anyway. One coach's prospects is a small set — this is a
 * personal address book, not an organisation-wide read — so it is read once and ranked
 * in memory, which is also the only way the pure ranker can see all three bands at once.
 */
export async function getCallList(
  coachId: string,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): Promise<CallList> {
  const snap = await prospects().where("coachId", "==", coachId).get();

  const candidates: Candidate[] = snap.docs
    .map(toAppProspect)
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      stage: toStage(p.stage),
      nextFollowupAt: p.nextFollowupAt,
      createdAt: p.createdAt,
    }));

  return rankCallList(candidates, todayKey(timeZone, now), timeZone);
}
