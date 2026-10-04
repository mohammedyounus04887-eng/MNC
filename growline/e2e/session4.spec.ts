import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Session 4 in a browser: the call list, the voice-note screen, and the two scheduled
 * endpoints. Phone-sized viewport, real emulators, the seeded organisation.
 *
 * ## What this covers that no other test can
 *
 * The unit tests prove the ranking and the parser; the rules tests prove who may read a
 * recording. Neither can tell you that a coach opening these screens is shown something
 * they can act on, or that the first-day state teaches instead of rendering an empty
 * frame — the easiest thing in this whole branch to ship broken, because it looks fine
 * in a fixture full of data.
 *
 * ## Nothing here mutates the emulator
 *
 * The seeded organisation already contains all three call-list states, one per coach:
 * Asha has a missed promise and an undated contact, Bhavana's only prospect has joined,
 * and Root has captured nobody. So every state is reachable read-only, and the shared
 * emulator (D44) is left exactly as it was found.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const ASHA = { phone: "9000000002", name: "Asha" };
const ASHA_UID = "usr_asha0000000000000000";
const BHAVANA = { phone: "9000000003", name: "Bhavana" };
// The home screen greets by FIRST name, so that is what the login helper waits for.
const ROOT = { phone: "9000000001", name: "Root" };

/** Admin SDK against the emulator, used only to undo what a test wrote (D44). */
function adminDb() {
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

/** L4, checked against what is actually painted rather than against the source. */
async function expectNoMoneyLanguage(page: Page) {
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const banned of ["₹", "earn", "income", "at this rate", "commission", "worth"]) {
    expect(body, `"${banned}" must not appear on this screen`).not.toContain(banned);
  }
}

test("the call list ranks a missed promise above an undated contact, and says why", async ({
  page,
}) => {
  await login(page, ASHA);

  // Reachable from the hub, since the bottom bar is full and adding a sixth tab is the
  // owner's decision, not this branch's.
  await page.goto("/more");
  await page.getByRole("link", { name: /who to call today/i }).click();
  await expect(page.getByRole("heading", { name: "Who to call today", level: 1 })).toBeVisible();

  const rows = page.getByTestId("call-row");

  /**
   * Deliberately NOT an exact count.
   *
   * The emulator is shared and single-worker (D44): the offline-capture and realtime
   * specs run before this one and leave prospects on Asha's account. Asserting "two
   * rows" made this spec pass alone and fail in the suite, which is a test describing
   * the fixture rather than the feature.
   *
   * The ORDER is the feature, so the order is what is asserted. Those leftovers are
   * captured today, at "spoken", with no date — so the ranking puts them below Ravi,
   * who has been waiting three days at the same stage. That is the "longer silence
   * outranks shorter" rule proving itself on data no test wrote.
   */
  await expect(rows.first()).toBeVisible();

  /**
   * Meera was promised a call yesterday; Ravi was met three days ago with no date set.
   * The promise comes first — the person already let down must not be let down twice.
   */
  await expect(rows.nth(0)).toContainText("Meera");
  await expect(rows.nth(0)).toHaveAttribute("data-urgency", "late");
  await expect(rows.nth(0).getByTestId("call-reason")).toContainText(
    /1 day late — you said you would call/
  );

  await expect(rows.nth(1)).toContainText("Ravi");
  await expect(rows.nth(1)).toHaveAttribute("data-urgency", "quiet");
  await expect(rows.nth(1).getByTestId("call-reason")).toContainText(/No date set since you met/);

  // Only one promise in this organisation is late, so nothing below Meera may claim to
  // be — an urgency band leaking downward would put the wrong name at the top.
  const urgencies = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-urgency"))
  );
  expect(urgencies.slice(1).every((u) => u === "quiet")).toBe(true);

  // The reason is ON the row, not behind a tap: a ranked list a coach cannot audit is
  // one they override or ignore.
  await expect(page.getByText(/how this is ordered/i)).toBeVisible();

  // One tap to act, from the row itself (S1, S4).
  await expect(rows.nth(0).getByRole("link", { name: /whatsapp meera/i })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\d+$/
  );
  await expect(rows.nth(0).getByRole("link", { name: /call meera/i })).toHaveAttribute(
    "href",
    /^tel:/
  );

  // P1, said on the screen rather than only enforced underneath it.
  await expect(page.getByText(/your people only/i)).toBeVisible();

  await expectNoMoneyLanguage(page);
});

test("a coach whose only prospect has joined is told that, not shown an empty box", async ({
  page,
}) => {
  await login(page, BHAVANA);
  await page.goto("/who-to-call");

  await expect(page.getByTestId("call-row")).toHaveCount(0);
  await expect(page.getByTestId("call-list-empty")).toContainText(/everyone has joined/i);
  // It teaches what will fill it again, which a shared "no results" box could not.
  await expect(page.getByTestId("call-list-empty")).toContainText(/starts again/i);
});

test("a coach who has captured nobody is taught what will fill the list", async ({ page }) => {
  await login(page, ROOT);
  await page.goto("/who-to-call");

  // The state a pilot club opens on day one.
  await expect(page.getByTestId("call-list-empty")).toContainText(/nothing to call yet/i);
  await expect(page.getByTestId("call-list-empty")).toContainText(/fills itself/i);
  await expect(page.getByRole("link", { name: /save a new person/i })).toBeVisible();
});

test("the voice screen says a recording is not a log BEFORE anyone speaks", async ({ page }) => {
  await login(page, ASHA);

  await page.goto("/more");
  await page.getByRole("link", { name: /say today's work/i }).click();
  await expect(page.getByRole("heading", { name: /say today's work/i })).toBeVisible();

  /**
   * The sentence the whole feature rests on. If it were shown after recording, a coach
   * would already believe they had logged — and the accountability loop would break
   * silently, which is the failure this design exists to prevent.
   */
  await expect(page.getByText(/a recording on its own is not your log/i)).toBeVisible();
  // And the fate of one that never becomes numbers, before they make one.
  await expect(page.getByText(/counts for nothing/i)).toBeVisible();
  // Where the audio goes, in plain words, because the microphone leaves the app.
  await expect(page.getByText(/readable by you and nobody else/i)).toBeVisible();

  await expectNoMoneyLanguage(page);
});

test("a refused microphone lands on a screen that routes to the tap-in log", async ({ page }) => {
  /**
   * The most common degradation in the real world — permission declined — and here it
   * is genuine: this browser has no audio device, so `getUserMedia` rejects exactly as
   * it does when a coach taps "Block".
   *
   * What matters is that it is not a dead end. Every one of the six ways this feature
   * can fail has to end somewhere the coach can still log their day.
   */
  await login(page, ASHA);
  await page.goto("/voice-log");

  await page.getByTestId("voice-record").click();
  await expect(page.getByTestId("voice-nomic")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("voice-nomic")).toContainText(/nothing is broken/i);

  const out = page.getByRole("link", { name: /open the tap-in log/i });
  await expect(out.first()).toBeVisible();
  await out.first().click();
  await expect(page.getByRole("heading", { name: /today's work/i })).toBeVisible();
});

test("the scheduled endpoints refuse anybody who cannot prove they are the scheduler", async ({
  page,
}) => {
  // 503 with no secret configured, 401 with one and a missing header. Never 200: these
  // read the whole organisation, delete recordings, or push to every coach.
  //
  // All six go through `checkCronSecret`. The last two carried their own inline copies
  // of the guard until 2026-08-19; they are listed here because a shared helper is only
  // an improvement if the routes that adopted it are still refusing strangers.
  for (const path of [
    "/api/silence",
    "/api/voice-logs/purge",
    "/api/duplication/rebuild",
    "/api/qualifications/evaluate",
    "/api/leaderboards/rebuild",
    "/api/notifications/daily",
  ]) {
    const res = await page.request.post(path);
    expect([401, 503], `${path} must refuse a caller with no cron secret`).toContain(
      res.status()
    );
  }
});

test("the voice-note writes refuse a signed-out client", async ({ page }) => {
  const post = await page.request.post("/api/voice-logs", {
    data: { dayKey: "2026-08-12", audioBase64: "AAAA", durationMs: 1000 },
  });
  expect(post.status()).toBe(401);

  const patch = await page.request.patch("/api/voice-logs", {
    data: { dayKey: "2026-08-12", servings: 5 },
  });
  expect(patch.status()).toBe(401);
});
