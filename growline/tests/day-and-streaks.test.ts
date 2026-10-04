import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APP_TIMEZONE,
  dayKey,
  hourInZone,
  startOfDayInZone,
  todayRange,
} from "@/lib/day";
import {
  EMPTY_LOG,
  LOG_FIELDS,
  MAX_BACKFILL_DAYS,
  MAX_COUNT,
  MAX_NOTE,
  STREAK_MILESTONES,
  daysBetweenKeys,
  logDateFor,
  loggedToday,
  milestoneFor,
  milestoneMessage,
  shiftKey,
  streakFromKeys,
  streakState,
  todayKey,
  totalActivity,
  type DailyLogValues,
} from "@/lib/daily-log";
import { MORNING_HOURS } from "@/lib/followup";

/**
 * `src/lib/day.ts` and `src/lib/daily-log.ts` — the timezone floor the whole app
 * stands on, and the streak maths that sits on top of it.
 *
 * ## Why this file exists at all
 *
 * RULES E1: "Never `new Date()` for a day boundary. IST is UTC+5:30; go through
 * `day.ts`. This has already broken roll-ups once." A rule written in the past tense
 * is a rule that was learned the expensive way, and D24/D26 record what it cost: a
 * server in UTC is 5.5 hours behind India, so every follow-up between 00:00 and
 * 05:30 IST landed on the wrong day, the morning reminder fired in the middle of the
 * night, and `unique(user_id, log_date)` split one Indian evening across two rows.
 * None of that is visible in a code review. It is only visible in a test that names
 * the instants either side of the boundary.
 *
 * ## How the expected values here were derived
 *
 * From the spec and from arithmetic, never by running the code and writing down what
 * it said. A test that copies current output cannot fail, which means it cannot
 * protect anything — it only makes a future bug look intentional. So:
 *
 *   - IST is UTC+05:30 by statute, and India observes no DST. Therefore IST midnight
 *     is 18:30 UTC on the previous calendar day, always, in every month of every
 *     year. Every instant below was chosen by hand from that one fact.
 *   - D24 states the boundary explicitly: "18:29Z is still 9 August in India while
 *     18:30Z is already the 10th". Those exact instants are asserted.
 *   - D27 states the streak rule ("anchors on today if today is logged, otherwise on
 *     yesterday") and the backfill cap (14 days).
 *   - v2 §4 dopamine map #1 states the Streak Shield: "one auto grace-day per month".
 *
 * Where a single expected value would under-state the intent, the assertion is a
 * PROPERTY instead — a day range is exactly 24 hours, `shiftKey` is invertible, a
 * streak is monotonic, `logDateFor` is idempotent. Properties survive refactors that
 * hardcoded values do not, and they say what the code is *for*.
 *
 * ## What is deliberately NOT covered, and why
 *
 * The six-counter validation (negative / fractional / over-max / non-numeric) lives
 * in `src/app/api/logs/route.ts:43`, and the backfill gate lives in
 * `src/lib/daily-log-queries.ts:92`. Neither is importable from a unit test: both
 * modules reach `src/lib/firebase-admin.ts`, which calls `resolveTarget()` at module
 * scope (line 115) and throws unless a service account or an emulator pair is in the
 * environment. So this file asserts the pure arithmetic those gates depend on and
 * names the duplication; the gates themselves belong to the rules/e2e suites.
 */

/**
 * IST midnight, as a UTC instant, stated once.
 *
 * Not imported from anywhere: the whole point is to check `day.ts` against an
 * independently known fact rather than against itself.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed instants, chosen for what each one breaks. Never `Date.now()` — a test that
 * depends on the day it runs on means nothing tomorrow, and the bug being guarded
 * against is specifically a bug about which day it is.
 */
const FIXED_INSTANTS: { iso: string; ist: string; why: string }[] = [
  {
    iso: "2026-08-09T18:29:59.999Z",
    ist: "2026-08-09",
    why: "last millisecond of 9 August in India",
  },
  {
    iso: "2026-08-09T18:30:00.000Z",
    ist: "2026-08-10",
    why: "first millisecond of 10 August in India",
  },
  {
    iso: "2026-08-09T23:59:59.999Z",
    ist: "2026-08-10",
    why: "already the 10th in India, still the 9th in UTC",
  },
  {
    iso: "2026-08-10T00:00:00.000Z",
    ist: "2026-08-10",
    why: "UTC midnight is 05:30 the same IST day",
  },
  {
    iso: "2026-08-31T18:30:00.000Z",
    ist: "2026-09-01",
    why: "month rollover happens at 18:30Z, not 00:00Z",
  },
  {
    iso: "2026-12-31T18:30:00.000Z",
    ist: "2027-01-01",
    why: "year rollover",
  },
  {
    iso: "2024-02-28T18:30:00.000Z",
    ist: "2024-02-29",
    why: "into 29 February of a leap year",
  },
  {
    iso: "2024-02-29T18:30:00.000Z",
    ist: "2024-03-01",
    why: "out of 29 February",
  },
  {
    iso: "2026-02-28T18:30:00.000Z",
    ist: "2026-03-01",
    why: "no 29 February in 2026",
  },
  {
    iso: "2026-06-15T12:00:00.000Z",
    ist: "2026-06-15",
    why: "an ordinary midday, so the boundary cases are not the only ones passing",
  },
];

// ---------------------------------------------------------------------------
// day.ts — the offset itself
// ---------------------------------------------------------------------------

test("the app timezone is India, named once and not scattered", () => {
  // v1 §1: this audience is in India. `day.ts` resolves the offset through `Intl`
  // rather than hardcoding it, which is the right call — but it means the zone NAME
  // is the only thing under our control, so it is the thing worth pinning.
  assert.equal(APP_TIMEZONE, "Asia/Kolkata");
});

test("the resolved offset is exactly +05:30, not merely 'some offset'", () => {
  // `day.ts` never writes 5.5 hours down anywhere; it asks `Intl` (zoneOffsetMs,
  // day.ts:38). That is more correct than a constant and also completely unverified
  // by inspection — a broken ICU build, or a zone name typo that silently falls back
  // to UTC, both look like working code. So derive the offset from the public API
  // and check it against the statutory value.
  //
  // startOfDayInZone("2026-08-10") is the instant IST midnight happened. UTC
  // midnight of the same calendar date is 5.5 hours LATER, because India is ahead.
  const utcMidnight = Date.UTC(2026, 7, 10);
  const istMidnight = startOfDayInZone("2026-08-10").getTime();
  assert.equal(utcMidnight - istMidnight, IST_OFFSET_MS);
  assert.equal(
    new Date(istMidnight).toISOString(),
    "2026-08-09T18:30:00.000Z",
    "IST midnight is 18:30Z on the previous calendar day"
  );
});

test("India has no DST, so the offset is the same in January and July", () => {
  // Asserted rather than assumed. Most zones this app could be pointed at DO shift,
  // and `startOfDayInZone` carries a two-pass refinement (day.ts:60-61) precisely
  // because of them. If Asia/Kolkata ever resolved differently across the year, the
  // 24-hour property every roll-up query depends on would quietly stop holding.
  for (const key of ["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]) {
    const [y, m, d] = key.split("-").map(Number);
    assert.equal(
      Date.UTC(y, m - 1, d) - startOfDayInZone(key).getTime(),
      IST_OFFSET_MS,
      `${key} should be +05:30 like every other day of the Indian year`
    );
  }
});

// ---------------------------------------------------------------------------
// day.ts — dayKey across the two midnights
// ---------------------------------------------------------------------------

test("two instants two minutes apart on the same UTC date are DIFFERENT IST days", () => {
  // This is the bug RULES E1 exists to prevent, written out as the test that would
  // have caught it. Both instants are 9 August in UTC. One is 9 August in India and
  // the other is the 10th, because IST midnight falls at 18:30Z.
  const before = new Date("2026-08-09T18:29:00Z");
  const after = new Date("2026-08-09T18:31:00Z");

  assert.equal(dayKey(before), "2026-08-09");
  assert.equal(dayKey(after), "2026-08-10");
  assert.notEqual(dayKey(before), dayKey(after));

  // And here is what the naive implementation saw — the same day for both. Asserting
  // this too is what makes the test above meaningful: it proves the two instants were
  // genuinely capable of being confused, rather than being trivially far apart.
  assert.equal(dayKey(before, "UTC"), dayKey(after, "UTC"));
  assert.equal(dayKey(before, "UTC"), "2026-08-09");
});

test("the IST day boundary is inclusive of its own midnight", () => {
  // 18:30:00.000Z belongs to the NEW day, 18:29:59.999Z to the old one. Off by one
  // millisecond here means one follow-up filed under the wrong date, which is exactly
  // how "6 follow-ups today" becomes 5.
  assert.equal(dayKey(new Date("2026-08-09T18:29:59.999Z")), "2026-08-09");
  assert.equal(dayKey(new Date("2026-08-09T18:30:00.000Z")), "2026-08-10");
});

test("two instants either side of UTC midnight are the SAME IST day", () => {
  // The mirror of the case above, and the one people forget. 23:59Z and 00:01Z look
  // like different days to a server and are 05:29 and 05:31 on one Indian morning —
  // so a coach doing an early walk-and-talk must not have it split across two days.
  const late = new Date("2026-08-09T23:59:00Z");
  const early = new Date("2026-08-10T00:01:00Z");

  assert.equal(dayKey(late), "2026-08-10");
  assert.equal(dayKey(early), "2026-08-10");
  assert.equal(dayKey(late), dayKey(early));

  // Naive again: to UTC these are two different days.
  assert.notEqual(dayKey(late, "UTC"), dayKey(early, "UTC"));
});

test("dayKey rolls month, year and leap-day over at 18:30Z", () => {
  // Every one of these is a real date-arithmetic trap, and all of them are decided by
  // the offset rather than by the calendar: the Indian 1st of the month begins on the
  // UTC evening of the last day of the previous one.
  for (const { iso, ist, why } of FIXED_INSTANTS) {
    assert.equal(dayKey(new Date(iso)), ist, `${iso} — ${why}`);
  }
});

test("dayKey always emits a zero-padded YYYY-MM-DD, because keys are sorted as strings", () => {
  // Not cosmetic. `getLogState` queries `dayKey >= since` and orders by `dayKey`
  // (daily-log-queries.ts:39-40), and `saveLog` compares `key > today` as strings
  // (line 86). An unpadded "2026-8-9" sorts after "2026-08-10" and both the streak
  // window and the future-date guard break silently.
  for (const { iso } of FIXED_INSTANTS) {
    assert.match(dayKey(new Date(iso)), /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(dayKey(new Date("2026-01-02T18:31:00Z")), "2026-01-03");
});

// ---------------------------------------------------------------------------
// day.ts — startOfDayInZone and todayRange
// ---------------------------------------------------------------------------

test("startOfDayInZone contains its own day and excludes the next", () => {
  // The defining property of a day boundary, and the one that catches essentially any
  // offset error without needing a table of expected instants:
  //
  //     startOfDay(dayKey(t)) <= t < startOfDay(dayKey(t) + 1 day)
  //
  // If the offset is wrong in either direction, some instant falls outside its own day
  // and this fails.
  for (const { iso, why } of FIXED_INSTANTS) {
    const t = new Date(iso);
    const key = dayKey(t);
    const start = startOfDayInZone(key);
    const nextStart = startOfDayInZone(shiftKey(key, 1));

    assert.ok(start.getTime() <= t.getTime(), `${iso} precedes its own day start — ${why}`);
    assert.ok(t.getTime() < nextStart.getTime(), `${iso} spills into the next day — ${why}`);
  }
});

test("startOfDayInZone round-trips through dayKey", () => {
  // The first instant of a day must itself report that day. This is the pair of
  // functions the daily-log document id is built from (D26), so a disagreement between
  // them means one evening can produce two documents.
  for (const { ist } of FIXED_INSTANTS) {
    assert.equal(dayKey(startOfDayInZone(ist)), ist);
    // And one millisecond earlier belongs to yesterday — the boundary is a boundary,
    // not a fuzzy region.
    const oneMsBefore = new Date(startOfDayInZone(ist).getTime() - 1);
    assert.equal(dayKey(oneMsBefore), shiftKey(ist, -1));
  }
});

test("todayRange is exactly 24 hours and starts at IST midnight", () => {
  // Exactly 24 hours holds because India has no DST; the assertion is here to notice
  // if that ever stops being true of the resolved zone, not because 24 is arbitrary.
  for (const { iso, ist, why } of FIXED_INSTANTS) {
    const now = new Date(iso);
    const { key, start, end } = todayRange(APP_TIMEZONE, now);

    assert.equal(key, ist, `${iso} — ${why}`);
    assert.equal(key, dayKey(now), "the range's key must be the key of `now`");
    assert.equal(start.getTime(), startOfDayInZone(key).getTime());
    assert.equal(end.getTime() - start.getTime(), DAY_MS, `${iso} is not a 24h day`);
    assert.equal(
      end.getTime(),
      startOfDayInZone(shiftKey(key, 1)).getTime(),
      "end must be the NEXT IST midnight, not start + 24h by arithmetic"
    );
  }
});

test("todayRange is half-open: start is inside the day, end is not", () => {
  // Established by reading the call sites, not by preference. Every consumer treats
  // the range as [start, end):
  //
  //   followup-queries.ts:40      nextFollowupAt <  start   -> overdue
  //   followup-queries.ts:44-45   >= start and <  end       -> today
  //   followup.ts:21-22           date < start / date < end -> overdue / today
  //
  // So `end` must belong to TOMORROW. If it belonged to today, the last millisecond of
  // the day would be counted in neither bucket and a follow-up set for 23:59 IST would
  // vanish from "today" without becoming overdue.
  const { key, start, end } = todayRange(APP_TIMEZONE, new Date("2026-08-10T09:00:00Z"));

  assert.equal(dayKey(start), key, "start is the first instant OF the day");
  assert.equal(dayKey(new Date(end.getTime() - 1)), key, "end - 1ms is still today");
  assert.equal(dayKey(end), shiftKey(key, 1), "end itself is tomorrow");
});

test("todayRange is stable for every instant within the day it describes", () => {
  // A coach opening the app at 00:01 IST and again at 23:59 IST must be told the same
  // "today", or the log they saved in the morning is not the log they see at night.
  // Idempotence across the whole open interval, checked at both ends and the middle.
  const anchor = new Date("2026-08-10T09:00:00Z");
  const base = todayRange(APP_TIMEZONE, anchor);

  const probes = [
    base.start,
    new Date(base.start.getTime() + 1),
    new Date(base.start.getTime() + DAY_MS / 2),
    new Date(base.end.getTime() - 1),
  ];
  for (const probe of probes) {
    const r = todayRange(APP_TIMEZONE, probe);
    assert.equal(r.key, base.key, `${probe.toISOString()} disagreed about today`);
    assert.equal(r.start.getTime(), base.start.getTime());
    assert.equal(r.end.getTime(), base.end.getTime());
  }

  // And the instant one past the end is a different day — the interval is genuinely
  // closed on the right.
  assert.equal(todayRange(APP_TIMEZONE, base.end).key, shiftKey(base.key, 1));
});

test("startOfDayInZone lands on local midnight even where the offset shifts mid-day", () => {
  // day.ts:58-61 runs the offset lookup TWICE, specifically so a DST zone lands on the
  // right instant when the offset differs either side of local midnight. Asia/Kolkata
  // can never exercise that code, so nothing else in this suite would notice if the
  // second pass were deleted. America/New_York on 2026-03-08 does: clocks go 02:00 ->
  // 03:00 that morning, so the 8th begins at UTC-5 and the 9th begins at UTC-4.
  //
  // Not a feature this app ships — it is the safety net under a future `timezone`
  // column, and dead safety nets are worse than none.
  const ny = "America/New_York";
  assert.equal(
    startOfDayInZone("2026-03-08", ny).toISOString(),
    "2026-03-08T05:00:00.000Z",
    "8 March begins at midnight EST (UTC-5)"
  );
  assert.equal(
    startOfDayInZone("2026-03-09", ny).toISOString(),
    "2026-03-09T04:00:00.000Z",
    "9 March begins at midnight EDT (UTC-4)"
  );

  // Which makes the spring-forward day 23 hours long — the exact case that proves the
  // 24-hour assertion above is a fact about IST and not an assumption baked into the
  // helper.
  const springForward = todayRange(ny, new Date("2026-03-08T18:00:00Z"));
  assert.equal(springForward.key, "2026-03-08");
  assert.equal(springForward.end.getTime() - springForward.start.getTime(), 23 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// day.ts — hourInZone
// ---------------------------------------------------------------------------

test("hourInZone normalises the midnight that Intl renders as hour 24", () => {
  // day.ts:31 does `hour % 24` because some ICU builds format midnight as "24" under
  // hour12:false. Without it, midnight reads as 24 and every `hour < 6` morning check
  // inverts. The instant below IS Indian midnight, so this is that exact case.
  assert.equal(hourInZone(new Date("2026-08-09T18:30:00Z")), 0);
  assert.equal(hourInZone(new Date("2026-01-14T18:30:00Z")), 0);
});

test("hourInZone reads the Indian hour, which is what decides the morning reminder", () => {
  // The consequence, stated concretely. `api/notifications/daily/route.ts:71,77` sends
  // the follow-up reminder only when the local hour is inside MORNING_HOURS. So a UTC
  // reading does not merely shift the reminder — it moves the whole window into the
  // Indian afternoon and sends "you have 6 follow-ups today" at teatime.
  const sixThirtyAmIst = new Date("2026-08-10T01:00:00Z");
  assert.equal(hourInZone(sixThirtyAmIst), 6);
  assert.ok(
    hourInZone(sixThirtyAmIst) >= MORNING_HOURS.from &&
      hourInZone(sixThirtyAmIst) <= MORNING_HOURS.to,
    "06:30 IST must fall inside the morning window"
  );
  assert.equal(hourInZone(sixThirtyAmIst, "UTC"), 1);
  assert.ok(
    hourInZone(sixThirtyAmIst, "UTC") < MORNING_HOURS.from,
    "a UTC reading of the same instant would skip the send entirely"
  );

  // The far edge of the window, and the first hour outside it.
  assert.equal(hourInZone(new Date("2026-08-10T06:00:00Z")), 11); // 11:30 IST, last hour in
  assert.equal(hourInZone(new Date("2026-08-10T06:30:00Z")), 12); // 12:00 IST, first hour out
  assert.ok(MORNING_HOURS.to < 12, "12:00 IST is not morning");
});

test("hourInZone covers the whole 0-23 range across a UTC day", () => {
  // Property: sampling every UTC hour of one day yields 24 distinct Indian hours, all
  // in range. Catches both a stuck reading and an out-of-band value without asserting
  // 24 individual numbers.
  const seen = new Set<number>();
  for (let h = 0; h < 24; h++) {
    const hour = hourInZone(new Date(Date.UTC(2026, 7, 10, h, 0, 0)));
    assert.ok(Number.isInteger(hour) && hour >= 0 && hour <= 23, `hour ${hour} out of range`);
    seen.add(hour);
  }
  assert.equal(seen.size, 24);
});

// ---------------------------------------------------------------------------
// daily-log.ts — day-key arithmetic
// ---------------------------------------------------------------------------

test("shiftKey does calendar arithmetic with no timezone drift", () => {
  assert.equal(shiftKey("2026-08-10", -1), "2026-08-09");
  assert.equal(shiftKey("2026-08-10", 1), "2026-08-11");
  assert.equal(shiftKey("2026-08-10", 0), "2026-08-10");
  // Month, year and leap boundaries, worked out by calendar and not by the code.
  assert.equal(shiftKey("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftKey("2026-03-01", -1), "2026-02-28", "2026 is not a leap year");
  assert.equal(shiftKey("2024-03-01", -1), "2024-02-29", "2024 is");
  assert.equal(shiftKey("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftKey("2026-12-31", 1), "2027-01-01");
  // 400 days is the streak window `getLogState` reads (daily-log-queries.ts:24,35).
  assert.equal(shiftKey("2026-08-10", -400), "2025-07-06");
});

test("shiftKey is invertible, which is the property the streak walk relies on", () => {
  // `streakFromKeys` steps backwards one day at a time; `getLogState` steps back 400 at
  // once. Both are wrong if shifting and unshifting is not a round trip.
  const keys = ["2026-08-10", "2026-01-01", "2024-02-29", "2026-12-31", "2025-03-01"];
  for (const key of keys) {
    for (const n of [0, 1, -1, 7, -7, 14, -14, 31, -31, 365, -365, 400, -400]) {
      assert.equal(shiftKey(shiftKey(key, n), -n), key, `${key} shifted by ${n} did not return`);
    }
  }
});

test("daysBetweenKeys is signed, antisymmetric, and agrees with shiftKey", () => {
  assert.equal(daysBetweenKeys("2026-08-10", "2026-08-10"), 0);
  assert.equal(daysBetweenKeys("2026-08-10", "2026-08-11"), 1, "forward is positive");
  assert.equal(daysBetweenKeys("2026-08-10", "2026-08-09"), -1, "backward is negative");
  // Leap arithmetic, by hand: 28 Feb -> 29 Feb -> 1 Mar is two days in 2024, one in 2026.
  assert.equal(daysBetweenKeys("2024-02-28", "2024-03-01"), 2);
  assert.equal(daysBetweenKeys("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetweenKeys("2025-12-31", "2026-01-01"), 1);

  const pairs: [string, string][] = [
    ["2026-08-10", "2026-09-01"],
    ["2024-02-28", "2024-03-01"],
    ["2025-12-31", "2026-12-31"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(daysBetweenKeys(a, b), -daysBetweenKeys(b, a), `${a}/${b} not antisymmetric`);
    assert.equal(shiftKey(a, daysBetweenKeys(a, b)), b, "the two helpers must agree");
  }
});

test("todayKey and dayKey never disagree about the same instant", () => {
  // `todayKey` goes through `todayRange`, `dayKey` does not. The API route defaults a
  // log's date with `todayKey()` (api/logs/route.ts:62) while `saveLog` compares it
  // against `todayKey` again (daily-log-queries.ts:82) — a drift between the two paths
  // would reject a coach's own log as being in the future.
  for (const { iso, ist } of FIXED_INSTANTS) {
    const now = new Date(iso);
    assert.equal(todayKey(APP_TIMEZONE, now), ist);
    assert.equal(todayKey(APP_TIMEZONE, now), dayKey(now, APP_TIMEZONE));
  }
});

test("logDateFor stores local midnight, so one evening cannot become two rows", () => {
  // D26, and the reason the daily-log document id is `{userId}__{dayKey}`
  // (collections.ts:105). Two instants from opposite ends of one Indian evening must
  // resolve to the same stored `logDate`, or a coach who corrects a number at 00:10
  // creates a second day.
  const beforeUtcMidnight = new Date("2026-08-09T21:00:00Z"); // 02:30 IST on the 10th
  const afterUtcMidnight = new Date("2026-08-10T02:00:00Z"); // 07:30 IST on the 10th
  const key = dayKey(beforeUtcMidnight);

  assert.equal(key, dayKey(afterUtcMidnight));
  assert.equal(logDateFor(key).toISOString(), "2026-08-09T18:30:00.000Z");

  // Idempotent: the same key always mints the same instant, which is what makes the
  // document id a real uniqueness constraint rather than a hopeful one.
  assert.equal(logDateFor(key).getTime(), logDateFor(key).getTime());
  assert.equal(logDateFor(key).getTime(), startOfDayInZone(key).getTime());

  // And consecutive days are exactly one day apart — no gaps, no overlaps, so no day
  // is unreachable and no two keys collide.
  assert.equal(logDateFor(shiftKey(key, 1)).getTime() - logDateFor(key).getTime(), DAY_MS);
});

// ---------------------------------------------------------------------------
// daily-log.ts — streaks
// ---------------------------------------------------------------------------

/** A run of consecutive keys ending `daysAgo` before `today`, newest first. */
function run(today: string, from: number, to: number): string[] {
  const keys: string[] = [];
  for (let n = from; n <= to; n++) keys.push(shiftKey(today, -n));
  return keys;
}

const TODAY = "2026-08-20";

test("an empty history is a zero streak", () => {
  assert.equal(streakFromKeys([], TODAY), 0);
});

test("logging today alone is a one-day streak", () => {
  assert.equal(streakFromKeys([TODAY], TODAY), 1);
});

test("consecutive days ending today count every one of them", () => {
  assert.equal(streakFromKeys(run(TODAY, 0, 2), TODAY), 3);
  assert.equal(streakFromKeys(run(TODAY, 0, 6), TODAY), 7);
  assert.equal(streakFromKeys(run(TODAY, 0, 29), TODAY), 30);
});

test("an unlogged today measures the streak from yesterday instead of zeroing it", () => {
  // D27, and the reason it exists: "a coach who logged ten days straight and opens the
  // app at 4pm should see 10, not a zero implying they already lost it."
  assert.equal(streakFromKeys(run(TODAY, 1, 10), TODAY), 10);
  assert.equal(streakFromKeys([shiftKey(TODAY, -1)], TODAY), 1);
});

test("the streak breaks only once a whole day has passed unlogged", () => {
  // D27's line: today missing is tolerated, because a coach opening the app at 4pm
  // has not lost anything yet.
  assert.equal(streakFromKeys(run(TODAY, 1, 10), TODAY), 10);

  // Today AND yesterday missing used to be a hard zero here. Since D67 that is the
  // Streak Shield's job — one miss a month is absorbed. The line D27 drew has not
  // moved; the shield sits in front of it.
  assert.equal(streakFromKeys(run(TODAY, 2, 11), TODAY), 10);

  // With this month's allowance already spent, the zero is back.
  const spent = [...run(TODAY, 2, 3), ...run(TODAY, 6, 12)]; // 08-19 and 08-16..15 gone
  assert.equal(streakFromKeys(spent, TODAY), 2);
});

test("a gap in the middle stops the count once the allowance is gone", () => {
  // Logged today, yesterday, then nothing the day before that. The shield covers
  // that single day, so the run continues through it (D67).
  const keys = [...run(TODAY, 0, 1), ...run(TODAY, 3, 9)];
  assert.equal(streakFromKeys(keys, TODAY), 9);

  // A second gap in the same month is where it stops — and it stops AT the gap,
  // which is the property this test was written for.
  const twoGaps = [...run(TODAY, 0, 1), ...run(TODAY, 3, 4), ...run(TODAY, 6, 12)];
  assert.equal(streakFromKeys(twoGaps, TODAY), 4, "the 20th, 19th, 17th and 16th");
});

test("streaks cross month, year and leap boundaries", () => {
  // Each of these is a run built with shiftKey, so the assertion is that the walk
  // backwards through the calendar does not lose a day at a boundary.
  assert.equal(streakFromKeys(run("2026-09-01", 0, 4), "2026-09-01"), 5);
  assert.equal(streakFromKeys(run("2027-01-01", 0, 4), "2027-01-01"), 5);
  assert.equal(streakFromKeys(run("2024-03-01", 0, 4), "2024-03-01"), 5);
  // Spot-check that the leap run really does include 29 February.
  assert.ok(run("2024-03-01", 0, 4).includes("2024-02-29"));
});

test("streakFromKeys ignores order and duplicates", () => {
  // Property: the input is a set of days, so shuffling it or repeating a day must not
  // change the answer. The offline queue re-sends days (D28) and a retried sync can
  // deliver the same key twice, so this is not hypothetical tidiness.
  const canonical = run(TODAY, 0, 9);
  const shuffled = [...canonical].reverse();
  const duplicated = [...canonical, ...canonical.slice(0, 4)];

  assert.equal(streakFromKeys(shuffled, TODAY), 10);
  assert.equal(streakFromKeys(duplicated, TODAY), 10);
  assert.equal(streakFromKeys(duplicated, TODAY), streakFromKeys(canonical, TODAY));
});

test("a future-dated log cannot inflate a streak", () => {
  // `saveLog` refuses `key > today` (daily-log-queries.ts:86), but a row written
  // before a clock correction, or a timezone change, can still leave one behind. The
  // count must anchor on today and walk backwards, never forwards.
  assert.equal(streakFromKeys([shiftKey(TODAY, 1), TODAY], TODAY), 1);
  assert.equal(streakFromKeys([shiftKey(TODAY, 1), ...run(TODAY, 0, 4)], TODAY), 5);
  // A future row on its own is not a streak at all.
  assert.equal(streakFromKeys([shiftKey(TODAY, 1)], TODAY), 0);
  assert.equal(streakFromKeys([shiftKey(TODAY, 5)], TODAY), 0);
});

test("extending a run by exactly one day extends the streak by exactly one", () => {
  // Monotonicity, as a property rather than a table. Adding the day immediately before
  // the run grows it by one; adding a day beyond the gap grows it by nothing.
  const base = run(TODAY, 0, 4);
  assert.equal(streakFromKeys(base, TODAY), 5);
  assert.equal(streakFromKeys([...base, shiftKey(TODAY, -5)], TODAY), 6);
  assert.equal(
    streakFromKeys([...base, shiftKey(TODAY, -7)], TODAY),
    5,
    "a day on the far side of a gap must not count"
  );
});

test("loggedToday is the live signal, independent of the streak length", () => {
  // The team view shows this separately from the streak, so a long streak with today
  // still unlogged must report false — that is the state the roll-up nudges on.
  assert.equal(loggedToday(run(TODAY, 0, 9), TODAY), true);
  assert.equal(loggedToday(run(TODAY, 1, 10), TODAY), false);
  assert.equal(loggedToday([], TODAY), false);
  assert.equal(streakFromKeys(run(TODAY, 1, 10), TODAY), 10, "…while the streak is still 10");
});

// ---------------------------------------------------------------------------
// daily-log.ts — the Streak Shield (v2 §4, dopamine map #1)
// ---------------------------------------------------------------------------

/**
 * These were `todo` while the mechanic did not exist (D58). It exists now (D67), so
 * the flags are gone and they are ordinary tests.
 *
 * v2 §4 dopamine map #1: "**Streak Shield:** one auto grace-day per month so a single
 * miss doesn't kill motivation … the shield absorbs it once."
 *
 * One assertion below changed on the way in, and the reason is recorded rather than
 * quietly applied — see the note on `allowance resets each calendar month`.
 */

test("Streak Shield absorbs a single missed day", () => {
  // Logged 9-18 August and today the 20th; missed only the 19th. The shield covers
  // that one day, so the run reaches back past it.
  const keys = [TODAY, ...run(TODAY, 2, 11)];
  const withoutShield = 1; // today alone — what a hard break yields
  assert.ok(
    streakFromKeys(keys, TODAY) > withoutShield,
    "one miss inside a month must not reset a twelve-day habit to one"
  );
  // Eleven days were logged across a twelve-day span. The shielded day is not one
  // of them: the shield stops the run breaking, it does not award a day.
  assert.equal(streakFromKeys(keys, TODAY), 11);
});

test("Streak Shield covers one day per month, not every day", () => {
  // Two misses in the same calendar month: the 19th and the 16th. The first is
  // absorbed, the second is not, so the streak must stop at the second gap — longer
  // than one day, and shorter than the whole unbroken run back to the 1st.
  const keys = [TODAY, ...run(TODAY, 2, 3), ...run(TODAY, 5, 19)];
  const streak = streakFromKeys(keys, TODAY);
  assert.ok(streak > 1, "the first miss should have been absorbed");
  assert.ok(streak < 15, "the second miss in the same month must break the streak");
  assert.equal(streak, 3, "the 20th, the 18th and the 17th");
});

test("Streak Shield allowance resets each calendar month", () => {
  // One miss in August (the 3rd) and one in July (the 28th), with a run of days
  // either side. Both fall in different months, so both are absorbed and the run
  // reaches back to 20 July.
  const today = "2026-08-05";
  const logged = [
    "2026-08-05", "2026-08-04", /* 08-03 missed */ "2026-08-02", "2026-08-01",
    "2026-07-31", "2026-07-30", "2026-07-29", /* 07-28 missed */ "2026-07-27",
    "2026-07-26", "2026-07-25", "2026-07-24", "2026-07-23", "2026-07-22",
    "2026-07-21", "2026-07-20",
  ];

  // WHAT CHANGED, AND WHY (D67). This assertion used to read
  // `>= daysBetweenKeys("2026-07-20", today) + 1`, i.e. >= 17 — the inclusive SPAN
  // from 20 July to 5 August. That silently required shielded days to count toward
  // the number, and D58 wrote it believing it was implementation-agnostic. It is not:
  // it rules out the Duolingo behaviour that v2 §4 cites by name, where a freeze
  // preserves the streak without incrementing it. Fifteen days were logged; printing
  // 17 would credit the coach for two days they know they missed. So the assertion
  // now pins the thing the test was actually named for — that July's allowance is
  // back in August — and states the counting rule explicitly.
  const reachedJuly20 = logged.length; // 15 logged days, back to 2026-07-20
  assert.equal(streakFromKeys(logged, today), reachedJuly20);

  // Without July's allowance the run would have stopped at the 28th — seven days.
  // That is the comparison the name of this test is about.
  assert.ok(streakFromKeys(logged, today) > 7, "a shield spent in July must be back by August");
});

test("a shield never bridges two missed days in a row", () => {
  // Not even across a month boundary, where two allowances are technically
  // available. "One auto grace-day so a single miss doesn't kill motivation" is
  // about the day somebody was ill — a two-day gap is a lapse, and a mechanic that
  // sometimes covers two days is one nobody can predict.
  const keys = [TODAY, ...run(TODAY, 3, 12)]; // the 19th AND the 18th missed
  assert.equal(streakFromKeys(keys, TODAY), 1, "today alone");

  const acrossMonths = [
    "2026-08-02", "2026-08-01", /* 07-31 and 07-30 missed */ "2026-07-29", "2026-07-28",
  ];
  assert.equal(streakFromKeys(acrossMonths, "2026-08-02"), 2);
});

test("the shield reaches the anchor, so yesterday's miss does not zero the streak", () => {
  // Today unlogged (fine, D27) and yesterday missed. Before the shield this was a
  // hard zero at IST midnight — the exact "punishment" v2 §4 rules out.
  const keys = run(TODAY, 2, 11); // the 18th back to the 9th; the 19th missed
  assert.equal(streakFromKeys(keys, TODAY), 10);

  // But a spent allowance is spent: add a second August gap and it breaks.
  const spent = [...run(TODAY, 2, 3), ...run(TODAY, 5, 11)];
  assert.equal(streakFromKeys(spent, TODAY), 2, "the 18th and the 17th");
});

test("streakState reports whether THIS month's shield is gone", () => {
  // The flame's "Shield used this month" copy hangs off this, and it is about the
  // month the coach is standing in — not about whether any shield was ever spent.
  const clean = streakState([TODAY, ...run(TODAY, 1, 10)], TODAY);
  assert.equal(clean.days, 11);
  assert.equal(clean.shieldUsed, false);
  assert.deepEqual(clean.shieldedKeys, []);
  assert.equal(clean.live, true);

  const usedThisMonth = streakState([TODAY, ...run(TODAY, 2, 11)], TODAY);
  assert.equal(usedThisMonth.shieldUsed, true);
  assert.deepEqual(usedThisMonth.shieldedKeys, ["2026-08-19"]);

  // Spent in July only: August's is still there, so the coach is not warned.
  const july = streakState(
    ["2026-08-02", "2026-08-01", "2026-07-31", /* 07-30 */ "2026-07-29", "2026-07-28"],
    "2026-08-02"
  );
  assert.equal(july.shieldUsed, false, "July's spend is not August's problem");
  assert.deepEqual(july.shieldedKeys, ["2026-07-30"]);

  // A dead streak is dead: no flame, no shield claim.
  const dead = streakState(["2026-07-01"], TODAY);
  assert.deepEqual(dead, { days: 0, shieldUsed: false, live: false, shieldedKeys: [] });
});

// ---------------------------------------------------------------------------
// daily-log.ts — limits and the field ceiling
// ---------------------------------------------------------------------------

test("the log is six fields exactly, which is the RULES S2 ceiling", () => {
  // v1 §5.6 / RULES S2: no screen over six input fields. `daily-log.ts:6-8` states the
  // shape as "five counts and one note" and says a seventh would break both the rule
  // and the 30-second evening entry it protects. So the count is the assertion.
  assert.equal(LOG_FIELDS.length, 5);
  assert.equal(LOG_FIELDS.length + 1, 6, "five counters plus the note");
  assert.ok(LOG_FIELDS.length + 1 <= 6, "RULES S2");

  // EMPTY_LOG must not have grown a field the LOG_FIELDS list does not know about —
  // that is how a seventh input reaches the form without anyone rereading the rule.
  const keys = Object.keys(EMPTY_LOG).sort();
  const expected = [...LOG_FIELDS.map((f) => f.key), "note"].sort();
  assert.deepEqual(keys, expected);
  assert.equal(new Set(LOG_FIELDS.map((f) => f.key)).size, LOG_FIELDS.length, "keys unique");

  // Every field is labelled and hinted; an unlabelled counter is unusable one-handed
  // on a road (RULES S1).
  for (const f of LOG_FIELDS) {
    assert.ok(f.label.trim().length > 0, `${f.key} has no label`);
    assert.ok(f.hint.trim().length > 0, `${f.key} has no hint`);
  }
});

test("an empty log is all zeroes and no note", () => {
  // The starting state of the form, and the value `getLogState` returns for an
  // unlogged day (daily-log-queries.ts:58). A non-zero default would silently claim
  // work the coach never did.
  for (const f of LOG_FIELDS) {
    assert.equal(EMPTY_LOG[f.key], 0, `${f.key} should default to 0`);
  }
  assert.equal(EMPTY_LOG.note, null);
  assert.equal(totalActivity(EMPTY_LOG), 0);
});

test("MAX_COUNT is a whole-number ceiling in the range a day's work can occupy", () => {
  // The exact figure is a judgement call, not a spec value — daily-log.ts:35 justifies
  // it as "a day's counts are small; anything larger is a typo or a stuck button". So
  // the assertions are the properties the two consumers depend on rather than the
  // number: `LogForm.tsx:45` clamps with `Math.min(MAX_COUNT, …)` and
  // `api/logs/route.ts:43` rejects `n > MAX_COUNT`, and both need an integer that a
  // real day can reach the top of without hitting.
  assert.ok(Number.isInteger(MAX_COUNT), "a count ceiling must be a whole number");
  assert.ok(MAX_COUNT >= 99, "too low a ceiling would reject a genuinely busy day");
  assert.ok(MAX_COUNT < 10_000, "too high a ceiling stops catching stuck buttons");
});

test("MAX_NOTE keeps the note to the one line F6 asks for", () => {
  // F6 specifies "an optional one-line note", and RULES S1's 30-second rule is what a
  // long free-text box would break. Bounded rather than pinned: the constant is read
  // by both `LogForm.tsx:171` (maxLength) and `api/logs/route.ts:54` (the gate), so
  // what matters is that it stays one line's worth.
  assert.ok(Number.isInteger(MAX_NOTE) && MAX_NOTE > 0);
  assert.ok(MAX_NOTE <= 200, "a one-line note, not a paragraph");
  assert.ok(MAX_NOTE >= 60, "long enough to be worth typing");
});

test("MAX_BACKFILL_DAYS is the fourteen days D27 committed to", () => {
  // This one IS a spec value: D27 — "Backfill is capped at 14 days
  // (MAX_BACKFILL_DAYS) — enough for any offline log to sync, but not enough to
  // manufacture a streak after the fact."
  assert.equal(MAX_BACKFILL_DAYS, 14);
});

test("the backfill window is inclusive at the limit and refuses the day past it", () => {
  // The gate is `age > MAX_BACKFILL_DAYS` (daily-log-queries.ts:92), where `age` is
  // whole days from the logged key to today. So exactly 14 days back is still
  // loggable and 15 is not — the boundary an offline sync lands on after two weeks in
  // a village with no signal.
  //
  // NOTE: that gate re-implements this arithmetic inline (daily-log-queries.ts:89-91)
  // instead of calling `daysBetweenKeys`. The ages are asserted here; the duplication
  // means the two can drift, and only the copy in this module is under test.
  const atLimit = shiftKey(TODAY, -MAX_BACKFILL_DAYS);
  const pastLimit = shiftKey(TODAY, -(MAX_BACKFILL_DAYS + 1));

  assert.equal(atLimit, "2026-08-06");
  assert.equal(pastLimit, "2026-08-05");
  assert.equal(daysBetweenKeys(atLimit, TODAY), MAX_BACKFILL_DAYS);
  assert.equal(daysBetweenKeys(pastLimit, TODAY), MAX_BACKFILL_DAYS + 1);

  // The gate's own comparison, applied to those ages.
  const refused = (key: string) => daysBetweenKeys(key, TODAY) > MAX_BACKFILL_DAYS;
  assert.equal(refused(TODAY), false);
  assert.equal(refused(atLimit), false, "fourteen days back must still be loggable");
  assert.equal(refused(pastLimit), true, "fifteen days back must be refused");
});

test("the longest streak reachable by backfill alone is fifteen days", () => {
  // MAX_BACKFILL_DAYS days of history plus today, all saved in one sitting. Recorded
  // as arithmetic because D27 claims the cap is "not enough to manufacture a streak
  // after the fact", and 15 consecutive days is enough to clear the 3, 7 and 14-day
  // milestones. What actually holds is narrower: `api/logs/route.ts:74-77` only
  // ANNOUNCES a milestone on the first save of today, so a fabricated 14 is displayed
  // but never celebrated. The number is worth pinning so the difference stays visible.
  const oldest = shiftKey(TODAY, -MAX_BACKFILL_DAYS);
  const fabricated = run(TODAY, 0, MAX_BACKFILL_DAYS);

  assert.equal(fabricated.length, MAX_BACKFILL_DAYS + 1);
  assert.equal(fabricated.at(-1), oldest);
  assert.equal(streakFromKeys(fabricated, TODAY), 15);
});

// ---------------------------------------------------------------------------
// daily-log.ts — milestones
// ---------------------------------------------------------------------------

test("milestones are ascending, unique and start above a single day", () => {
  const list = [...STREAK_MILESTONES];
  assert.deepEqual(list, [...list].sort((a, b) => a - b), "must be ascending");
  assert.equal(new Set(list).size, list.length, "must be unique");
  assert.ok(list.every((n) => Number.isInteger(n) && n > 1), "a one-day habit is not a milestone");
});

test("every step the streak flame grows at is also a celebrated milestone", () => {
  // v2 §4 dopamine map #1: the flame "grows subtly at 7/30/100 days", and
  // `StreakFlame.tsx:23-28` steps at exactly those. A growth step that fired no
  // milestone would be a visual change with no explanation attached — G6 bans a
  // mechanic that maps to no behaviour, and this is the coherence half of that.
  for (const step of [7, 30, 100]) {
    assert.ok(
      STREAK_MILESTONES.includes(step as (typeof STREAK_MILESTONES)[number]),
      `the flame grows at ${step} days but nothing marks it`
    );
  }
});

test("milestoneFor fires on a milestone and stays silent on every other day", () => {
  for (const n of STREAK_MILESTONES) {
    assert.equal(milestoneFor(n), n);
  }
  // The days either side of each milestone, plus the ones a coach passes first.
  for (const n of [0, 1, 2, 4, 5, 6, 8, 13, 15, 29, 31, 59, 61, 99, 101, 199, 201, 364, 366]) {
    assert.equal(milestoneFor(n), null, `${n} is not a milestone`);
  }
  // Negative and fractional streaks cannot occur, but a null here is cheaper than a
  // spurious celebration if they ever do.
  assert.equal(milestoneFor(-1), null);
  assert.equal(milestoneFor(7.5), null);
});

test("every milestone has its own message", () => {
  const messages = STREAK_MILESTONES.map((n) => milestoneMessage(n));
  for (const [i, m] of messages.entries()) {
    assert.ok(m.trim().length > 0, `${STREAK_MILESTONES[i]} has no copy`);
  }
  assert.equal(
    new Set(messages).size,
    messages.length,
    "a repeated message means one milestone borrowed another's moment"
  );
});

test("no celebration copy promises income (RULES L4)", () => {
  // v1 §5.3 / RULES L4: no income promises in UI copy, notifications or celebrations.
  // Milestone copy is the highest-risk string in the app after the report card — it is
  // written to be screenshotted — so it is worth a machine check rather than a habit.
  // D30 extends the same rule to points: no ₹, no conversion, no projection.
  // Word-bounded so the guard does not one day fail on "learn" or "enrich" and get
  // weakened by whoever hits the false positive.
  const banned =
    /₹|\$|\brs\.?\b|\brupees?\b|\blakhs?\b|\bcrores?\b|\bincome\b|\bearn(?:s|ed|ing|ings)?\b|\bsalary\b|\bprofits?\b|\bpayouts?\b|\bpaid\b|\bcash\b|\bmoney\b|\brich\b|\bwealth\b/i;

  for (const n of STREAK_MILESTONES) {
    const message = milestoneMessage(n);
    assert.doesNotMatch(message, banned, `milestone ${n}: ${message}`);
  }
  // The field labels and hints ride the same screen and the same rule.
  for (const f of LOG_FIELDS) {
    assert.doesNotMatch(f.label, banned, `label: ${f.label}`);
    assert.doesNotMatch(f.hint, banned, `hint: ${f.hint}`);
  }
  // The pattern is doing work, not passing vacuously.
  assert.match("your income doubles", banned);
  assert.match("worth ₹40,000", banned);
});

// ---------------------------------------------------------------------------
// daily-log.ts — totalActivity
// ---------------------------------------------------------------------------

test("totalActivity sums the five counters and nothing else", () => {
  const values: DailyLogValues = {
    servings: 4,
    memberships: 1,
    sessions: 2,
    invites: 9,
    followupsDone: 6,
    note: "met three people on the walk",
  };
  // Derived independently from LOG_FIELDS rather than written as 22, so adding a
  // counter without adding it to the sum is caught.
  const expected = LOG_FIELDS.reduce((sum, f) => sum + values[f.key], 0);
  assert.equal(expected, 22);
  assert.equal(totalActivity(values), expected);
});

test("the note never contributes to the activity total", () => {
  // It is the sixth field and the only non-numeric one; a note must not read as work.
  const withNote: DailyLogValues = { ...EMPTY_LOG, note: "x".repeat(MAX_NOTE) };
  assert.equal(totalActivity(withNote), 0);
  assert.equal(totalActivity({ ...EMPTY_LOG, note: null }), 0);
});

test("a corrupt counter is neutralised rather than poisoning the whole total", () => {
  // `api/logs/route.ts:43` rejects non-integers, negatives and anything over MAX_COUNT
  // before a value is stored, so this function should never see junk. But it also runs
  // on documents read back from Firestore, and a row written by an older build or by a
  // migration script never passed that route. `totalActivity` uses `|| 0`
  // (daily-log.ts:137), which means one NaN field contributes zero instead of turning
  // the coach's whole day into "NaN" on the team roll-up. Under-reporting one number
  // beats destroying five, so that behaviour is worth pinning.
  assert.equal(totalActivity({ ...EMPTY_LOG, servings: NaN, invites: 3 }), 3);
  assert.equal(totalActivity({ ...EMPTY_LOG, servings: NaN }), 0);

  // ±Infinity is NOT neutralised — it is truthy, so it passes straight through. Stated
  // rather than asserted as correct: the write path is the gate, and a pure summer is
  // the wrong place to invent a clamp the spec never asked for.
  assert.equal(totalActivity({ ...EMPTY_LOG, servings: Infinity }), Infinity);

  // The ceiling case: five counters at MAX_COUNT is still an ordinary number.
  const maxed: DailyLogValues = {
    servings: MAX_COUNT,
    memberships: MAX_COUNT,
    sessions: MAX_COUNT,
    invites: MAX_COUNT,
    followupsDone: MAX_COUNT,
    note: null,
  };
  assert.equal(totalActivity(maxed), 5 * MAX_COUNT);
  assert.ok(Number.isSafeInteger(totalActivity(maxed)));
});
