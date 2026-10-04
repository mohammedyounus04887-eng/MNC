import { Timestamp } from "firebase-admin/firestore";
import { dailyLogs, prospects, reports, threads, users } from "./collections";
import { shiftKey, todayKey } from "./daily-log";

/**
 * The six metrics v1 §13 says to instrument from day one, and which nothing was
 * measuring. Until now the honest answer to "is the app working?" was that nobody knew.
 *
 * ## Two rules this file follows
 *
 * **Counts, never identities.** No prospect name or phone is read here, and none can be
 * — every query is a `count()` or an id-only `select()`. See lib/admin.ts for why that is
 * the line rather than a preference.
 *
 * **A metric that cannot be computed says so.** It does NOT return zero. Month-2 paid
 * retention and trial→paid conversion both need paid users, and payments are not built
 * (v2.6) — so a dashboard showing "0% retention" would be read as a catastrophe rather
 * than as an unbuilt feature. Unmeasurable is its own state.
 *
 * ## Cost
 *
 * `count()` aggregations bill per index entry scanned, not per document read, so five of
 * these are cheap at any size. The exception is the distinct-logger count: Firestore
 * cannot count distinct values, so it reads seven days of log ids. That is bounded by
 * (coaches × 7) and fine at pilot scale; the note on `activeLoggers` says what to do
 * before it is not.
 */

export type Measured = { value: number; of?: number };
export type Metric =
  | { kind: "measured"; label: string; help: string; data: Measured; unit: "%" | "n" }
  | { kind: "unmeasurable"; label: string; help: string; why: string };

const pct = (value: number, of: number) => (of === 0 ? 0 : Math.round((value / of) * 100));

/** Coaches with any activity in the window — the denominator for "active users". */
const WINDOW_DAYS = 7;

/**
 * How many distinct coaches logged their work in the last seven days, over how many
 * coaches exist. v1 §13's "daily-log completion rate", and the closest thing this app has
 * to a heartbeat: the daily log is the habit the whole retention model rests on.
 *
 * Reads log ids for the window because Firestore has no COUNT(DISTINCT). The document ids
 * are `${userId}__${dayKey}` (D26), so the distinct set is derivable from the ids alone
 * with no document bodies fetched at all.
 *
 * **Before this gets slow** — around the point a week of logs exceeds a few thousand
 * documents — replace it with a counter maintained by a Cloud Function on log write. Do
 * not "optimise" it by sampling; a heartbeat you cannot trust is worse than none.
 */
async function activeLoggers(): Promise<Measured> {
  const since = shiftKey(todayKey(), -(WINDOW_DAYS - 1));
  const [logSnap, totalSnap] = await Promise.all([
    dailyLogs().where("dayKey", ">=", since).select().get(),
    users().count().get(),
  ]);

  const coaches = new Set<string>();
  for (const doc of logSnap.docs) {
    // `${userId}__${dayKey}` — take the part before the separator.
    const [userId] = doc.id.split("__");
    if (userId) coaches.add(userId);
  }
  return { value: coaches.size, of: totalSnap.data().count };
}

/** Prospects captured in the window, and the per-coach-per-week figure §13 names. */
async function capturesPerCoach(): Promise<{ total: Measured; perCoach: number }> {
  const cutoff = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86_400_000);
  const [capturedSnap, totalSnap] = await Promise.all([
    prospects().where("createdAt", ">=", cutoff).count().get(),
    users().count().get(),
  ]);
  const captured = capturedSnap.data().count;
  const coaches = totalSnap.data().count;
  return {
    total: { value: captured },
    // One decimal: the difference between 0.4 and 1.2 people a week per coach is the
    // difference between a dead product and a live one, and rounding hides it.
    perCoach: coaches === 0 ? 0 : Math.round((captured / coaches) * 10) / 10,
  };
}

/**
 * Reports that reached WhatsApp, over reports generated. §13's "report → send rate".
 *
 * A low number here is the most actionable signal in the set: it means coaches are
 * capturing people and then not sending, which is a UI problem two taps from the money.
 */
async function sendRate(): Promise<Measured> {
  const [sentSnap, totalSnap] = await Promise.all([
    reports().where("sentAt", "!=", null).count().get(),
    reports().count().get(),
  ]);
  return { value: sentSnap.data().count, of: totalSnap.data().count };
}

/**
 * Acknowledgements over the people who saw a thread. §13's "team engagement health".
 *
 * Denominator is `seenCount`, not the size of the line: a thread nobody opened says
 * something about delivery, not about responsiveness, and mixing the two would hide both.
 */
async function ackRate(): Promise<Measured> {
  const snap = await threads().select("seenCount", "ackCount").get();
  let seen = 0;
  let acked = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    seen += (d.seenCount as number) ?? 0;
    acked += (d.ackCount as number) ?? 0;
  }
  return { value: acked, of: seen };
}

export type Overview = {
  coaches: number;
  metrics: Metric[];
  windowDays: number;
};

export async function getOverview(): Promise<Overview> {
  const [totalSnap, loggers, captures, sends, acks] = await Promise.all([
    users().count().get(),
    activeLoggers(),
    capturesPerCoach(),
    sendRate(),
    ackRate(),
  ]);

  const coaches = totalSnap.data().count;

  return {
    coaches,
    windowDays: WINDOW_DAYS,
    metrics: [
      {
        kind: "unmeasurable",
        label: "Month-2 paid retention",
        help: "The north star — the number v1 §13 says decides the company's future.",
        why: "Needs paying users. Payments and tiers are not built yet (v2.6).",
      },
      {
        kind: "measured",
        unit: "%",
        label: "Coaches logging their work",
        help: `Distinct coaches who logged at least once in ${WINDOW_DAYS} days. The habit the whole retention model rests on.`,
        data: loggers,
      },
      {
        kind: "measured",
        unit: "n",
        label: "People captured per coach",
        help: `Per coach over ${WINDOW_DAYS} days. Below about 1 means the front door is not being used.`,
        data: { value: captures.perCoach },
      },
      {
        kind: "measured",
        unit: "%",
        label: "Reports actually sent",
        help: "Reports opened into WhatsApp, over reports generated. A low number is a UI problem two taps from the money.",
        data: sends,
      },
      {
        kind: "measured",
        unit: "%",
        label: "Thread acknowledgements",
        help: "Acknowledged over seen. Team responsiveness, not delivery.",
        data: acks,
      },
      {
        kind: "unmeasurable",
        label: "Trial → paid conversion",
        help: "Including the annual vs monthly mix.",
        why: "Needs the tier model and Razorpay (v2.6). Every coach currently has the same placeholder plan.",
      },
    ],
  };
}

export { pct };
