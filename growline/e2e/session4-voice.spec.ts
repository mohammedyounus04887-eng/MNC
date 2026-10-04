import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * The voice note, driven with a microphone (session 4, feature 1).
 *
 * ## Why this is a separate file
 *
 * Playwright refuses `test.use({ launchOptions })` inside a describe block — it forces a
 * new worker — so the flags that give Chromium a fake audio device have to be top-level.
 * The rest of session 4 lives in `session4.spec.ts` and deliberately runs WITHOUT a
 * device, because the refused-microphone path is its own test and needs a browser that
 * genuinely has no mic.
 *
 * `executablePath` is resolved here the same way `playwright.config.ts` resolves it,
 * because a top-level `test.use({ launchOptions })` REPLACES the object rather than
 * merging into it — dropping the container's Chromium path and leaving Playwright with
 * nothing to launch. Duplicated deliberately and narrowly; the config is not this
 * branch's to edit.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ASHA = { phone: "9000000002", name: "Asha" };
const ASHA_UID = "usr_asha0000000000000000";

const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";
const override = process.env.PW_CHROMIUM_PATH;
const resolvedPath =
  override && existsSync(override)
    ? override
    : existsSync(CONTAINER_CHROMIUM)
      ? CONTAINER_CHROMIUM
      : undefined;

test.use({
  launchOptions: {
    ...(resolvedPath ? { executablePath: resolvedPath } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

/** Admin SDK against the emulator, used only to undo what this test wrote (D44). */
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

test("a recording nothing could transcribe still ends in a log a team can count", async ({
  page,
}) => {
  /**
   * There is no speech service behind a headless browser, so the recogniser hears
   * nothing at all. That is precisely the case worth driving: the parser returns zeros,
   * and the screen must still hand the coach a way to finish — otherwise a coach whose
   * accent, language or background noise defeats the recogniser has been given a feature
   * that quietly does nothing, while believing they logged their day.
   */
  await login(page, ASHA);
  await page.goto("/voice-log");

  await page.getByTestId("voice-record").click();
  await expect(page.getByTestId("voice-record")).toContainText(/stop/i, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId("voice-record").click();

  const confirm = page.getByTestId("voice-confirm");
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  // Named as the app's shortcoming, never the coach's.
  await expect(confirm).toContainText(/couldn't make out the numbers/i);
  await expect(confirm).toContainText(/it happens/i);

  // The five counts, at zero, because nothing was understood and nothing may be
  // invented — a guess here becomes a number on somebody's team screen.
  await expect(page.getByTestId("voice-value-servings")).toHaveText("0");

  await page.getByRole("button", { name: /one more shakes/i }).click();
  await page.getByRole("button", { name: /one more shakes/i }).click();
  await expect(page.getByTestId("voice-value-servings")).toHaveText("2");

  await page.getByTestId("voice-save").click();
  await expect(page.getByTestId("voice-saved")).toBeVisible({ timeout: 20_000 });
  // The recording is dropped the moment the numbers land — it had done its job.
  await expect(page.getByTestId("voice-saved")).toContainText(/recording has been deleted/i);

  /**
   * The claim the whole feature rests on: the numbers went through the EXISTING writer,
   * so the streak moved and the upline's roll-up will see it. If this screen had its own
   * writer, everything above could pass while the team saw nothing.
   */
  await expect(page.getByTestId("voice-streak")).toBeVisible();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const db = adminDb();
  const log = await db.collection("dailyLogs").doc(`${ASHA_UID}__${today}`).get();
  expect(log.exists, "the voice screen must produce a real daily log").toBe(true);
  expect(log.data()?.servings).toBe(2);

  // The note document is marked counted and its audio is gone, not merely expired.
  const noteDoc = await db.collection("voiceLogs").doc(`${ASHA_UID}__${today}`).get();
  expect(noteDoc.data()?.status).toBe("counted");
  expect(noteDoc.data()?.audioBase64).toBeNull();

  // And the tap-in log — a different screen, the same document — now shows the streak.
  await page.goto("/log");
  await expect(page.getByTestId("streak")).toBeVisible();

  /**
   * Put the shared emulator back as it was found (D44). Both documents go: the log this
   * test created and the note that produced it. A daily log left behind would change
   * what the duplication and leaderboard specs are looking at, and this suite runs
   * single-worker against one Firestore.
   */
  await db.collection("dailyLogs").doc(`${ASHA_UID}__${today}`).delete();
  await db.collection("voiceLogs").doc(`${ASHA_UID}__${today}`).delete();
});
