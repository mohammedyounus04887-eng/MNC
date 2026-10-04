import { NextResponse } from "next/server";
import { COLLECTIONS } from "@/lib/collections";
import { db } from "@/lib/firebase-admin";
import { getUserById, updateUser } from "@/lib/users";
import { dayKey, hourInZone } from "@/lib/day";
import { MORNING_HOURS, followupNotificationBody } from "@/lib/followup";
import { followupCounts } from "@/lib/followup-queries";
import { isPushConfigured, sendToUser } from "@/lib/push";
import { checkCronSecret } from "@/modules/shared-new/cron";

/**
 * The morning follow-up reminder (F5).
 *
 * Meant to be called HOURLY by a scheduler (Vercel Cron or equivalent). Each coach
 * is sent only when it is morning in their own timezone and only once per local
 * day, so one hourly job serves coaches in any zone without ever double-notifying.
 *
 * `?dryRun=1` computes and reports exactly what would be sent without sending or
 * recording anything, which is how this is verified without a live push service.
 */
export async function POST(req: Request) {
  // Fails closed with no secret configured. Without one this endpoint would let anyone
  // on the internet trigger a push to every coach.
  const guard = checkCronSecret(req, "Reminders");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const now = new Date();

  // Only coaches who actually asked for reminders.
  const subSnap = await db
    .collection(COLLECTIONS.pushSubscriptions)
    .orderBy("createdAt", "desc")
    .get();
  const subscribers = subSnap.docs.map((d) => ({
    userId: d.data().userId as string,
    timezone: (d.data().timezone as string) ?? "Asia/Kolkata",
  }));

  // One timezone per coach — the most recently registered device wins.
  const zoneByUser = new Map<string, string>();
  for (const s of subscribers) {
    if (!zoneByUser.has(s.userId)) zoneByUser.set(s.userId, s.timezone);
  }

  const considered: {
    userId: string;
    timezone: string;
    localHour: number;
    due: number;
    skipped: string | null;
    body?: string;
  }[] = [];
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const [userId, timezone] of zoneByUser) {
    const localHour = hourInZone(now, timezone);
    const localDay = dayKey(now, timezone);

    const record = (skipped: string | null, due: number, body?: string) =>
      considered.push({ userId, timezone, localHour, due, skipped, body });

    if (localHour < MORNING_HOURS.from || localHour > MORNING_HOURS.to) {
      record("not-morning-there", 0);
      continue;
    }

    const user = await getUserById(userId);
    if (!user) {
      record("no-user", 0);
      continue;
    }
    if (user.followupPushOn === localDay) {
      record("already-sent-today", 0);
      continue;
    }

    const counts = await followupCounts(userId, timezone, now);
    if (counts.due === 0) {
      record("nothing-due", 0);
      continue;
    }

    const body = followupNotificationBody(counts);
    record(null, counts.due, body);
    if (dryRun) continue;

    const result = await sendToUser(userId, {
      title: "Growline",
      body,
      url: "/prospects?due=1",
      // One notification per coach per day replaces rather than stacks.
      tag: "followups",
    });
    sent += result.sent;
    removed += result.removed;
    failed += result.failed;

    // Recorded even when every device turned out to be dead, so a broken
    // subscription cannot cause a retry loop that notifies all day.
    await updateUser(userId, { followupPushOn: localDay });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    pushConfigured: isPushConfigured(),
    coachesConsidered: considered.length,
    toNotify: considered.filter((c) => c.skipped === null).length,
    devices: { sent, removed, failed },
    detail: considered,
  });
}

/** Constant-time compare so the secret can't be probed a character at a time. */
