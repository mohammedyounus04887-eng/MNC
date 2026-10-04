import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getLogState } from "@/lib/daily-log-queries";
import { todayHeading } from "@/lib/dates";
import LogForm from "./LogForm";
import StreakFlame from "@/components/StreakFlame";

export default async function LogPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const state = await getLogState(user.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-text">
            Today&apos;s Work
          </h1>
          <p className="mt-1 text-text-dim">{todayHeading()}</p>
        </div>
        {state.streak > 0 && (
          /*
           * `live` is deliberately NOT `hasLoggedToday`.
           *
           * It used to be, and that greyed the flame out with "Log today to start
           * again" from IST midnight until the coach logged — showing an intact
           * ten-day streak as already lost, which is the exact outcome D27 was
           * written to prevent.
           *
           * Whenever this renders, the streak IS live: `streakState` anchors on
           * today OR yesterday, so it already returns 0 once a whole day has lapsed,
           * and the `streak > 0` guard above means a broken streak shows no flame at
           * all. There is nothing left for this prop to express here.
           *
           * `shieldUsed` is what the Streak Shield tells the coach: the miss was
           * caught, and this month's grace day is now spent. Before D67 nothing ever
           * passed it and the copy described a state that could not occur.
           */
          <StreakFlame days={state.streak} shieldUsed={state.shieldUsed} />
        )}
      </div>
      <LogForm
        dayKey={state.today}
        initial={state.values}
        alreadyLogged={state.hasLoggedToday}
        initialStreak={state.streak}
      />
    </div>
  );
}
