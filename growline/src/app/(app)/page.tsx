import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { todayHeading } from "@/lib/dates";
import { followupCounts } from "@/lib/followup-queries";
import { getLogState } from "@/lib/daily-log-queries";
import {
  getMyTarget,
  pendingProofCount,
  proofsAwaitingReview,
} from "@/lib/targets-queries";
import { currentMonth, progressPercent } from "@/lib/targets";
import InviteButtons from "@/components/InviteButtons";
import { TeamIcon } from "@/components/icons";
import TodaysMission, { buildMissions } from "@/components/TodaysMission";
import StreakFlame from "@/components/StreakFlame";
import CountUp from "@/components/CountUp";
import MiniRing from "@/components/MiniRing";
import { getWeeklyRecap, recapShareText } from "@/lib/weekly-recap";
import WeeklyRecap from "@/components/WeeklyRecap";
import { getUserById } from "@/lib/users";
import { getConversation } from "@/modules/goals/conversations";
import { shouldNudgeGoalSheet } from "@/modules/goals/nudge";
import TargetToAccept from "@/modules/goals/TargetToAccept";
import { getTierState } from "@/modules/tiers/queries";
import TrialOfferCard from "@/modules/tiers/TrialOfferCard";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // directDownlineCount is materialised on the user document, maintained in the
  // same transaction as the signup that creates a downline — Firestore cannot
  // count children, and this page should not pay for a query to find out.
  const directCount = user.directDownlineCount;
  const [followups, logState, myTarget, proofsToAnswer, proofsToReview, nudgeGoals, tierState] =
    await Promise.all([
      followupCounts(user.id),
      getLogState(user.id),
      getMyTarget(user.id, currentMonth()),
      pendingProofCount(user.id),
      proofsAwaitingReview(user.id),
      shouldNudgeGoalSheet(user.id),
      getTierState(user),
    ]);
  const firstName = user.name.split(" ")[0];
  const today = todayHeading();

  const recap = await getWeeklyRecap(user.id, logState.streak);

  /*
   * The target conversation (A3), and the nudge for it.
   *
   * Fetched only when a target exists, and rendered only when there is something to do:
   * a number to answer, or an agreed action still open. Accepted with everything ticked
   * shows nothing — a card that never goes away is a card people stop reading.
   *
   * A target with no conversation is every target set before this feature existed. It
   * reads as unproposed rather than as broken, and simply shows nothing here.
   */
  const conversation = myTarget ? await getConversation(myTarget.id) : null;
  const conversationUpline =
    conversation && conversation.uplineId ? await getUserById(conversation.uplineId) : null;
  const openActions = conversation?.actions.some((a) => !a.done) ?? false;
  const showConversation =
    conversation !== null &&
    conversationUpline !== null &&
    (conversation.status !== "accepted" || openActions);

  // The recommendation engine of v2 (§4): what to do next, from their own data.
  const missions = buildMissions({
    streak: logState.streak,
    loggedToday: logState.hasLoggedToday,
    followupsDue: followups.due,
    followupsOverdue: followups.overdue,
    targetPoints: myTarget?.targetPoints ?? null,
    progressPoints: myTarget?.progressPoints ?? null,
  });

  return (
    <div className="flex flex-col gap-5">
      {/*
        The greeting and the flame share the header, because v2 §4's dopamine map
        names both places for it — "the log screen AND home header" — and only the
        log screen ever had it. The flame is the app's one ambient reminder of the
        habit everything else rests on, so it belongs on the screen a coach opens
        first, not the one they open last.

        `live` is the streak being alive at all: a zero streak shows the dim flame
        and "Log today to start again", which is the honest state and not a scold.
      */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-text">
            Hello, {firstName} 👋
          </h1>
          <p className="mt-1 text-text-dim">{today}</p>
        </div>
        <StreakFlame
          days={logState.streak}
          shieldUsed={logState.shieldUsed}
          live={logState.streak > 0}
        />
      </div>

      <TodaysMission missions={missions} />

      {/* The 2nd-downline recognition (v2 §8). Once, dismissible for good. */}
      {tierState.showOffer && <TrialOfferCard downlineCount={directCount} />}

      {showConversation && (
        <TargetToAccept
          targetId={conversation.targetId}
          uplineName={conversationUpline.name}
          status={conversation.status}
          proposedPoints={conversation.proposedPoints}
          changeNote={conversation.changeNote}
          actions={conversation.actions}
        />
      )}

      {/* The brag loop (§4). Hidden on an empty week — there is nothing to be
          proud of yet, and a card of zeroes is the opposite of motivating. */}
      {!recap.empty && (
        <WeeklyRecap
          data={{
            peopleMet: recap.peopleMet,
            invites: recap.invites,
            memberships: recap.memberships,
            sessions: recap.sessions,
            streak: recap.streak,
            shareText: recapShareText(recap),
          }}
        />
      )}

      {/* The v1 trial countdown card is deleted, not hidden (v2 §8: "delete any
          remnants"). It counted down to a day on which nothing happened — no charge,
          no lock — and a countdown to nothing teaches users the app's numbers are
          decorative. Starter is free forever; Settings and /plans now say so. */}

      {/* Today's work, above everything else. Overdue people are named as late so
          the number cannot be read as "all caught up" (F5). */}
      {followups.due > 0 && (
        <Link
          href="/prospects?due=1"
          className="flex items-center justify-between gap-3 rounded-2xl bg-elevated px-5 py-4"
        >
          <span>
            <CountUp value={followups.due} className="numeral block text-4xl text-text" />
            <span className="text-sm text-text-dim">
              {followups.due === 1 ? "person to follow up" : "people to follow up"}
              {followups.overdue > 0 && ` · ${followups.overdue} from earlier`}
            </span>
          </span>
          <span className="shrink-0 text-sm font-medium text-gold-ink">See them</span>
        </Link>
      )}

      {/* Proof requests are the only thing here that is waiting on another person,
          so they sit above the routine daily prompts. */}
      {proofsToAnswer > 0 && (
        <Link
          href="/targets"
          className="flex items-center justify-between gap-3 rounded-2xl bg-elevated px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">
              {proofsToAnswer === 1
                ? "Your upline asked for proof"
                : `${proofsToAnswer} proof requests`}
            </span>
            <span className="text-sm text-text-dim">Send a photo or a line</span>
          </span>
          <span className="shrink-0 text-sm font-medium text-gold-ink">Open</span>
        </Link>
      )}

      {proofsToReview > 0 && (
        <Link
          href="/targets"
          className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">
              {proofsToReview === 1
                ? "1 proof to check"
                : `${proofsToReview} proofs to check`}
            </span>
            <span className="text-sm text-text-dim">Your line is waiting on you</span>
          </span>
          <span className="shrink-0 text-sm font-medium text-gold-ink">Review</span>
        </Link>
      )}

      {/* A1's nudge — after their first prospect, never at signup. Below the day's work
          because it is an invitation, not a job that is waiting on them. */}
      {nudgeGoals && (
        <Link
          href="/goals"
          className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-4"
        >
          <span>
            <span className="block text-lg font-semibold">Why did you start this?</span>
            <span className="text-sm text-text-dim">
              Three short questions. Your upline uses it to set fair targets with you.
            </span>
          </span>
          <span className="shrink-0 text-sm font-medium text-gold-ink">Write it</span>
        </Link>
      )}

      {/* The habit prompt (F6). Framed as an invitation when unlogged and as
          recognition once done — never as a scolding. */}
      <Link
        href="/log"
        className={`flex items-center justify-between gap-3 rounded-2xl px-5 py-4 ${
          logState.hasLoggedToday ? "bg-surface" : "bg-elevated text-text"
        }`}
      >
        <span>
          <span className="block text-lg font-semibold">
            {logState.hasLoggedToday ? "Today is logged" : "Log today's work"}
          </span>
          <span
            className={`text-sm ${
              logState.hasLoggedToday ? "text-text-dim" : "text-text-dim"
            }`}
          >
            {logState.streak > 0
              ? `${logState.streak} ${logState.streak === 1 ? "day" : "days"} in a row 🔥`
              : "Takes about 30 seconds"}
          </span>
        </span>
        <span
          className={`shrink-0 text-sm font-medium ${
            logState.hasLoggedToday ? "text-gold-ink" : "text-gold-ink"
          }`}
        >
          {logState.hasLoggedToday ? "Change it" : "Open"}
        </span>
      </Link>

      {/* Fastest path to the day's most common action (Section 4.1) */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/prospects/new"
          className="neopop metal-gold flex h-14 flex-1 items-center justify-center text-lg font-semibold"
        >
          + New Person
        </Link>
        <Link
          href="/prospects/qr"
          className="flex h-14 items-center justify-center rounded-xl border border-hairline px-4 font-medium"
        >
          My QR code
        </Link>
      </div>

      <section className="rounded-2xl bg-elevated p-5 text-text">
        <h2 className="text-sm font-medium text-text-dim">My referral code</h2>
        <p className="mt-1 text-4xl font-bold tracking-[0.25em] text-gold-ink">
          {user.referralCode}
        </p>
        <p className="mb-4 mt-2 text-sm text-text-dim">
          Every coach who signs up with your code joins your line — automatically.
        </p>
        <InviteButtons code={user.referralCode} dark />
      </section>

      {/* My Target lives here rather than in the bottom nav, which Section 9 fixes
          at five tabs. */}
      <Link
        href="/targets"
        className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-4"
      >
        {/* The ring, not just the number. v2 §4's mechanic #2 is the tension an
            unclosed arc creates, and it only does its work on the screen a coach
            opens without deciding to. The celebration stays on /targets — see
            MiniRing's own note on why this is a separate component. */}
        {myTarget ? (
          <MiniRing
            progress={myTarget.progressPoints}
            target={myTarget.targetPoints}
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-text-dim">My Target</span>
          {myTarget ? (
            <>
              <span className="block text-2xl font-bold tabular-nums">
                {myTarget.progressPoints.toLocaleString("en-IN")}
                <span className="text-base font-medium text-text-dim">
                  {" / "}
                  {myTarget.targetPoints.toLocaleString("en-IN")}
                </span>
              </span>
              <span className="text-sm text-text-dim">
                {progressPercent(myTarget.progressPoints, myTarget.targetPoints).pct}% this
                month
              </span>
            </>
          ) : (
            <span className="block font-medium">Not set for this month</span>
          )}
        </span>
        <span className="shrink-0 text-sm font-medium text-gold-ink">
          {myTarget ? "Update" : "See"}
        </span>
      </Link>

      <Link
        href="/team"
        className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-4"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-gold-ink">
          <TeamIcon className="h-6 w-6" />
        </span>
        <span className="flex-1">
          <CountUp value={directCount} className="numeral block text-3xl text-text" />
          <span className="text-sm text-text-dim">
            {directCount === 1 ? "coach" : "coaches"} in my direct line
          </span>
        </span>
        <span className="text-sm font-medium text-gold-ink">My Team</span>
      </Link>

      {/* The coming-soon card is gone, not trimmed. Both features it promised — targets
          with your upline, messages from your line — now exist, and a card promising
          what the user already has reads as a dead app (STATUS.md bug #7). It returns
          only when there is a real next thing to promise. */}
    </div>
  );
}
