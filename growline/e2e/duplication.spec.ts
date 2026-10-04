import { test, expect, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * The duplication screen (F20), in a browser, on a phone-sized viewport.
 *
 * ## What this covers that no other test can
 *
 * The unit tests prove the maths and the rules tests prove who may open a reading.
 * Neither can tell you that a coach looking at this screen is shown a number they
 * can act on — or that the state a pilot club sees on day one teaches instead of
 * rendering an empty frame.
 *
 * The seeded organisation is three days old, so even a real run of the job would
 * find nobody who has been in a line long enough to count. That IS the first-day
 * state, and it is the easiest one to ship broken because it looks fine in a fixture
 * full of data.
 *
 * ## Why this writes a reading directly
 *
 * The compute job is behind CRON_SECRET, which is deliberately not in `.env` — an
 * endpoint that reads every user and four weeks of every log in the organisation
 * fails closed (asserted below). So the populated state is set up by writing the
 * document the job would have written, with the Admin SDK against the emulator. What
 * that document should CONTAIN is settled by the unit tests; what this checks is
 * that the screen turns it into sentences a coach can act on.
 *
 * The document is deleted again at the end. The emulator is shared state (D44), and
 * a reading left behind would silently change what a later run of any other spec is
 * looking at.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const ASHA = { phone: "9000000002", name: "Asha", uid: "usr_asha0000000000000000" };
const READING_ID = `dup_${ASHA.uid}`;

function db() {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  return getFirestore();
}

async function login(page: Page, who: { phone: string; name: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill(who.phone);
  await page.getByRole("button", { name: /get otp/i }).click();

  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === `+91${who.phone}`);
  await codeField.fill(mine[mine.length - 1].code);

  await expect(
    page.getByRole("heading", { name: new RegExp(`hello, ${who.name}`, "i") })
  ).toBeVisible({ timeout: 20_000 });
}

/** A top-heavy line: the direct line all logging, the level below it silent. */
const topHeavyReading = {
  userId: ASHA.uid,
  score: 39,
  reason: "ok",
  levels: [
    { depth: 1, people: 4, active: 4, pending: 0, rate: 1, weighted: 0.8333, weight: 1 },
    { depth: 2, people: 4, active: 0, pending: 2, rate: 0, weighted: 0.1667, weight: 2 },
  ],
  lineSize: 8,
  pendingCount: 2,
  deepestLevel: 2,
  deepestActiveLevel: 1,
  own: { daysLogged: 12, active: true },
  fromKey: "2026-07-16",
  toKey: "2026-08-12",
  windowDays: 28,
  timeZone: "Asia/Kolkata",
  generatedAt: new Date(),
};

test("with nothing counted yet, the screen teaches instead of showing a zero", async ({
  page,
}) => {
  await db().collection("duplicationScores").doc(READING_ID).delete();

  await login(page, ASHA);

  // Reachable from the hub, since the bottom bar is full and adding a sixth tab is
  // the owner's decision, not this branch's.
  await page.goto("/more");
  await page.getByRole("link", { name: /duplication/i }).click();
  await expect(page.getByRole("heading", { name: "Duplication", level: 1 })).toBeVisible();
  await expect(page.getByText(/only at the top, or all the way down/i)).toBeVisible();

  // The state a pilot club opens on day one. A zero here would be a verdict on a
  // line nobody has counted.
  await expect(page.getByTestId("duplication-empty")).toContainText(/nothing has been counted yet/i);
  await expect(page.getByTestId("duplication-score")).toHaveCount(0);
  // And it says what the number will mean when it arrives, rather than leaving a
  // labelled empty box.
  await expect(page.getByText(/how many are logging their work/i)).toBeVisible();
});

test("a reading is a number with the levels that produced it, and no money anywhere", async ({
  page,
}) => {
  await db().collection("duplicationScores").doc(READING_ID).set(topHeavyReading);

  await login(page, ASHA);
  await page.goto("/duplication");

  // The number, counted up to the score that was stored.
  const score = page.getByTestId("duplication-score");
  await expect(score).toHaveAttribute("data-score", "39");
  await expect(score).toContainText("39");
  await expect(page.getByTestId("duplication-reading")).toContainText(
    /starting to spread/i
  );

  // The breakdown is under the number, not behind a tap — a score with no breakdown
  // is a number nobody can act on.
  await expect(page.getByTestId("duplication-level-1")).toContainText("4 of 4 people logged.");
  await expect(page.getByTestId("duplication-level-2")).toContainText("0 of 4 people logged.");
  // People who joined this week are stated, never silently dropped from a level.
  await expect(page.getByTestId("duplication-level-2")).toContainText(
    /2 more people here joined in the last week/i
  );

  // The actionable half: which level to ring tonight, and who can reach it.
  await expect(page.getByTestId("duplication-stop")).toContainText(
    /level 2 is where it stops/i
  );
  // Depth reached is reported as what happens next, never as a level they are missing.
  await expect(page.getByTestId("duplication-next-level")).toContainText(/level 3 appears/i);

  // The misreading everybody will have first, answered on the screen itself.
  await expect(page.getByText(/not part of the number above/i)).toBeVisible();

  /**
   * RULES L4. A duplication score beside a rupee figure or a trajectory is an income
   * projection with the arithmetic left to the reader, and this is one of the two
   * easiest screens in the app to break that on.
   */
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const banned of ["₹", "earn", "income", "at this rate", "commission"]) {
    expect(body, `"${banned}" must not appear on this screen`).not.toContain(banned);
  }

  // Put the shared emulator back as it was found (D44).
  await db().collection("duplicationScores").doc(READING_ID).delete();
  await page.reload();
  await expect(page.getByTestId("duplication-empty")).toBeVisible();
});

test("the rebuild endpoint refuses anybody who cannot prove they are the scheduler", async ({
  page,
}) => {
  // 503 with no secret configured, 401 with one and a missing header. Never 200:
  // this endpoint makes the server read every user and four weeks of every log.
  const res = await page.request.post("/api/duplication/rebuild");
  expect([401, 503]).toContain(res.status());
});
