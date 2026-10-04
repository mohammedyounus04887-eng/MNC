import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { shiftKey } from "@/lib/daily-log";
import { MAX_DEADLINE_DAYS } from "@/modules/qualifications/model";
import { audienceSizes } from "@/modules/qualifications/queries";
import CreateForm from "@/modules/qualifications/CreateForm";

/**
 * Setting a qualification (F14).
 *
 * The two date bounds are computed HERE and handed to the form. The client never
 * decides what today is: a browser in another zone would offer a "today" that the
 * server then rejects, and E1 exists because this app has already had a day boundary
 * wrong once. India is UTC+5:30, so the wrong answer is available for five and a half
 * hours of every day.
 */
export default async function NewQualificationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const todayKey = dayKey(new Date(), APP_TIMEZONE);
  const { direct, all } = await audienceSizes(user);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">
          Set a qualification
        </h1>
        <p className="mt-1 text-text-dim">
          A few conditions and a closing date. Everyone it applies to gets a live
          tracker, and you get to see who is close.
        </p>
      </div>

      <CreateForm
        todayKey={todayKey}
        maxKey={shiftKey(todayKey, MAX_DEADLINE_DAYS)}
        directCount={direct}
        allCount={all}
      />

      {/* Said before they commit, because there is no edit screen and no unsend — a
          qualification whose conditions can move is not a qualification. */}
      <p className="rounded-xl border border-hairline px-4 py-3 text-sm text-text-dim">
        Once you announce it, the name, the conditions and the date are fixed. Counting
        starts today and runs to the closing date.
      </p>

      <Link
        href="/qualifications"
        className="min-h-12 px-1 py-3 font-medium text-text-dim"
      >
        Back
      </Link>
    </div>
  );
}
