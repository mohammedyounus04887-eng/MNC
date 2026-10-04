import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMyTarget } from "@/lib/targets-queries";
import { currentMonth } from "@/lib/targets";
import { todayKey } from "@/lib/daily-log";
import { getOwnSheet } from "@/modules/goals/queries";
import { getConversation } from "@/modules/goals/conversations";
import { buildMonthReview } from "@/modules/goals/review";
import GoalSheetForm from "@/modules/goals/GoalSheetForm";

/**
 * "My Why" — the coach's own Goal Sheet (A1).
 *
 * Loaded on the server so the form opens already filled; a coach returning to finish step
 * three should not watch three fields appear one at a time on a bad connection.
 *
 * `updatedAt` is dropped rather than passed through: it is a Date, the form is a client
 * component, and a value nothing renders is not worth serialising.
 */
export default async function GoalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [sheet, target] = await Promise.all([
    getOwnSheet(user.id),
    getMyTarget(user.id, currentMonth()),
  ]);

  // The month-end review (A1). `todayKey` goes through day.ts, so this is the coach's
  // own day in IST and not a UTC one — which for a month-boundary card is the whole
  // difference between the right month and the wrong one (E1).
  const conversation = target ? await getConversation(target.id) : null;
  const review = buildMonthReview({
    dayKey: todayKey(),
    sheet,
    targetPoints: target?.targetPoints ?? null,
    progressPoints: target?.progressPoints ?? null,
    actionsDone: conversation?.actions.filter((a) => a.done).length ?? 0,
    actionsTotal: conversation?.actions.length ?? 0,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">My Why</h1>
        <p className="mt-1 text-text-dim">
          Three short steps. Fill what you can — you can come back to the rest.
        </p>
      </div>

      {review && (
        <section className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
          <h2 className="font-semibold">How this month went</h2>
          <p className="text-text/80">{review.headline}</p>
          {review.actionsTotal > 0 && (
            <p className="text-sm text-text-dim">
              {review.actionsDone} of {review.actionsTotal} agreed{" "}
              {review.actionsTotal === 1 ? "action" : "actions"} done.
            </p>
          )}
          {review.revisitShortTerm && (
            <p className="text-sm text-text-dim">
              You wrote: “{sheet.shortTermGoal}”. Still the right one? Change it below if
              not.
            </p>
          )}
        </section>
      )}

      <GoalSheetForm
        initial={{
          why: sheet.why,
          hoursPerDay: sheet.hoursPerDay,
          shortTermGoal: sheet.shortTermGoal,
          shortTermByKey: sheet.shortTermByKey,
          longTermGoal: sheet.longTermGoal,
          blockers: sheet.blockers,
          blockerNote: sheet.blockerNote,
          needs: sheet.needs,
          needsAmount: sheet.needsAmount,
          shareNeeds: sheet.shareNeeds,
        }}
      />
    </div>
  );
}
