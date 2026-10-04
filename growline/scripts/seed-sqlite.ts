/**
 * Builds a representative dev.db to migrate FROM.
 *
 * The container clones without a database (dev.db is gitignored), so there would
 * otherwise be nothing to test the migration against — and a migration verified
 * against zero rows is not verified. This seeds the shapes that actually stress
 * the migration: a three-level tree, a prospect captured offline (clientId set)
 * next to one from a QR self-fill (clientId null), a report with a real token,
 * logs across a month boundary, and a target with a proof attached.
 *
 *   npx tsx scripts/seed-sqlite.ts
 */
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createHash, randomUUID } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { APP_TIMEZONE, dayKey, startOfDayInZone } from "../src/lib/day";
import { shiftKey } from "../src/lib/daily-log";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

/**
 * Every date below is RELATIVE to the real clock. It used to be pinned to a fixed
 * "2026-08-09", and that is a fixture with an expiry date on it.
 *
 * What went wrong: `nextFollowupAt` was hardcoded to 2026-08-11 so that Meera read as
 * "1 day late" — which was true on the 12th, and became "2 days late" on the 13th, and
 * grows by one every day after that. `e2e/session4.spec.ts` asserts the exact wording, so
 * the suite went red on a day nobody touched the code. A fixture that encodes "yesterday"
 * as an absolute date is only correct for 24 hours.
 *
 * So the fixtures now say what they MEAN — yesterday, three days ago, this month — and
 * stay true whenever they are run.
 *
 * Day keys go through `day.ts` rather than raw date arithmetic (RULES E1): IST is UTC+5:30,
 * and "yesterday" between midnight and 05:30 IST is a different day in UTC. Getting that
 * wrong here would seed a fixture that is off by one for five and a half hours a day,
 * which is precisely the flake this change exists to remove.
 */
const NOW = new Date();
const TODAY = dayKey(NOW, APP_TIMEZONE);

/** Local midnight, N days back — the instant a date-only fixture should carry. */
const daysAgo = (n: number) => startOfDayInZone(shiftKey(TODAY, -n), APP_TIMEZONE);
const daysAhead = (n: number) => startOfDayInZone(shiftKey(TODAY, n), APP_TIMEZONE);

const monthKey = TODAY.slice(0, 7);

async function main() {
  // Order matters: children reference parents.
  await prisma.proof.deleteMany();
  await prisma.target.deleteMany();
  await prisma.report.deleteMany();
  await prisma.prospect.deleteMany();
  await prisma.dailyLog.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.user.deleteMany();

  const mk = async (
    id: string,
    name: string,
    phone: string,
    code: string,
    uplineId: string | null,
    shareProspects = false
  ) =>
    prisma.user.create({
      data: {
        id,
        name,
        phone,
        referralCode: code,
        uplineId,
        shareProspects,
        city: "Bengaluru",
        plan: "trial",
        // 60 days out (v1 F10). Fixed, this went negative and every coach read as expired.
        trialEndsAt: daysAhead(60),
        createdAt: NOW,
      },
    });

  // Three levels. `asha` shares prospects, `bhavana` does not — the pair the
  // mandatory privacy-rule test in v2.1b needs.
  const root = await mk("usr_root0000000000000000", "Root Coach", "+919000000001", "ROOT01", null);
  const asha = await mk("usr_asha0000000000000000", "Asha", "+919000000002", "ASHA01", root.id, true);
  const bhav = await mk("usr_bhav0000000000000000", "Bhavana", "+919000000003", "BHAV01", root.id, false);
  const chan = await mk("usr_chan0000000000000000", "Chandan", "+919000000004", "CHAN01", asha.id);

  // Two capture paths: offline queue (clientId set, D6) and QR self-fill (null).
  const queued = await prisma.prospect.create({
    data: {
      id: "prs_queued000000000000000",
      coachId: asha.id,
      clientId: randomUUID(),
      name: "Meera",
      phone: "+919111111101",
      age: 34,
      gender: "female",
      heightCm: 160,
      weightKg: 68,
      stage: "interested",
      source: "manual",
      // Promised a call YESTERDAY, so the call list reads "1 day late". This is the
      // fixture that used to be an absolute date and broke a day later.
      nextFollowupAt: daysAgo(1),
      createdAt: daysAgo(3),
    },
  });
  await prisma.prospect.create({
    data: {
      id: "prs_qrfill000000000000000",
      coachId: asha.id,
      clientId: null,
      name: "Ravi",
      phone: "+919111111102",
      stage: "spoken",
      source: "qr",
      // Met three days ago and never given a date — the "quiet" band, which must rank
      // BELOW a broken promise however long the silence.
      createdAt: daysAgo(3),
    },
  });
  await prisma.prospect.create({
    data: {
      id: "prs_bhavana0000000000000",
      coachId: bhav.id,
      clientId: null,
      name: "Sunita",
      phone: "+919111111103",
      stage: "member",
      source: "manual",
      createdAt: NOW,
    },
  });

  const metrics = JSON.stringify({ v: 1, bmi: 26.6, band: "above" });
  await prisma.report.create({
    data: {
      id: "rpt_0000000000000000000",
      prospectId: queued.id,
      token: "Xk7mQp2RtY9wLb4NcF6vHs3JdG8zA5eU",
      metricsJson: metrics,
      inputsHash: createHash("sha256").update(metrics).digest("hex").slice(0, 32),
      createdAt: NOW,
    },
  });

  /**
   * Log days, relative, and deliberately NOT today or yesterday.
   *
   * The month boundary is the point (D26): the first of this month and the last of the
   * previous one, so a roll-up that groups by UTC month instead of the coach's own month
   * is caught. The other two are recent-but-past days.
   *
   * Nothing here is dated today, and that is load-bearing rather than incidental. A
   * qualification counts `daysActive` and `newMembers` inside a window that opens when
   * somebody creates it, so any log dated today lands inside every freshly created
   * qualification — and `e2e/qualifications.spec.ts` asserts a coach starting from zero.
   * The old fixed seed got this right by accident, because it had gone stale. Keeping the
   * logs a few days back makes it deliberate.
   *
   * The trade: the seeded coaches have no live streak, so the flame is unlit on a fresh
   * dev database. That is the lesser problem — a fixture that quietly changes what a
   * qualification counts is worse than an unlit flame.
   *
   * Deduped: near the start of a month these sets overlap, and `unique(userId, logDate)`
   * would reject the repeat.
   */
  const firstOfMonth = `${TODAY.slice(0, 8)}01`;
  const lastOfPrevMonth = shiftKey(firstOfMonth, -1);
  const logKeys = [
    ...new Set([shiftKey(TODAY, -4), shiftKey(TODAY, -5), firstOfMonth, lastOfPrevMonth]),
  ];
  for (const key of logKeys) {
    for (const u of [asha, chan]) {
      await prisma.dailyLog.create({
        data: {
          userId: u.id,
          logDate: startOfDayInZone(key, APP_TIMEZONE),
          servings: 3,
          /**
           * One membership, on the OLDEST seeded day, and the choice of day matters.
           *
           * A qualification counts memberships inside its own window, which starts when
           * somebody creates it — so a membership dated today lands inside every freshly
           * created qualification and a coach the fixtures intend to be at zero starts at
           * one. `e2e/qualifications.spec.ts` asserts "2 members away" on exactly that
           * assumption.
           *
           * The old fixed seed satisfied this by accident: its membership was four days
           * stale, so it fell outside any window created now. Dating it to last month
           * makes that deliberate and keeps it true however long the fixture lives.
           *
           * (Every log key above is already outside a fresh window, so this could sit on
           * any of them; last month is the one that stays outside even if a future
           * qualification opens its window earlier in the month.)
           */
          memberships: key === lastOfPrevMonth ? 1 : 0,
          sessions: 1,
          invites: 4,
          followupsDone: 2,
          createdAt: NOW,
        },
      });
    }
  }

  const target = await prisma.target.create({
    data: {
      id: "tgt_0000000000000000000",
      coachId: asha.id,
      setById: root.id,
      month: monthKey,
      targetPoints: 400,
      progressPoints: 420,
      status: "active", // deliberately stale — D31 derives achievement from numbers
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  await prisma.proof.create({
    data: {
      id: "prf_0000000000000000000",
      targetId: target.id,
      requestedById: root.id,
      requestNote: "Send a photo of the session register.",
      status: "submitted",
      submitNote: "Attached.",
      mediaUrl: "data:image/jpeg;base64,/9j/PLACEHOLDER",
      createdAt: NOW,
      submittedAt: NOW,
    },
  });

  // An OTP row, to prove the migration drops it rather than carrying it over.
  await prisma.otpCode.create({
    data: { phone: "+919000000002", codeHash: "deadbeef", expiresAt: NOW },
  });

  const counts = {
    users: await prisma.user.count(),
    prospects: await prisma.prospect.count(),
    reports: await prisma.report.count(),
    dailyLogs: await prisma.dailyLog.count(),
    targets: await prisma.target.count(),
    proofs: await prisma.proof.count(),
    otpCodes: await prisma.otpCode.count(),
  };
  console.log("Seeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
