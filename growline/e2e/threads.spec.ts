import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * F8 end to end: a broadcast reaches the line, the acknowledgement comes back, and
 * the sender's counter moves.
 *
 * This is the accountability loop the feature exists for, and no unit test can reach
 * it — it spans two signed-in coaches, a Firestore transaction, and a counter one of
 * them is watching. The rules tests prove who MAY read a thread; this proves the
 * thing actually works for the two people involved.
 *
 * Two browser contexts rather than one with a logout in the middle: the Firebase
 * client SDK persists its session outside cookies, so reusing one context to be two
 * different coaches is exactly the sort of shared state that made the suite flaky
 * before (D44).
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const ASHA = { phone: "9000000002", name: "Asha" };
const CHANDAN = { phone: "9000000004", name: "Chandan" };

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

test("a broadcast reaches the line, and the acknowledgement comes back", async ({
  browser,
}) => {
  const message = `Club meet on Sunday ${Date.now()}`;

  const upline: BrowserContext = await browser.newContext();
  const downline: BrowserContext = await browser.newContext();

  try {
    // --- Asha sends to her direct line (Chandan is her only downline) ---------
    const ashaPage = await upline.newPage();
    await login(ashaPage, ASHA);
    await ashaPage.goto("/threads");

    await ashaPage.getByTestId("thread-body").fill(message);
    await ashaPage.getByTestId("thread-scope-direct").click();
    await ashaPage.getByTestId("thread-send").click();

    // Sent, and nobody has responded yet. Asserting the zero matters: it is what
    // makes the "1 acknowledged" at the end evidence of the round trip rather than
    // of a counter that was already non-zero.
    await expect(ashaPage.getByTestId("sent-thread").first()).toContainText(message, {
      timeout: 20_000,
    });
    await expect(ashaPage.getByTestId("sent-ack").first()).toHaveText("0 acknowledged");

    // --- Chandan receives it and acknowledges --------------------------------
    const chandanPage = await downline.newPage();
    await login(chandanPage, CHANDAN);
    await chandanPage.goto("/threads");

    const card = chandanPage.getByTestId("thread-card").first();
    await expect(card).toContainText(message, { timeout: 20_000 });
    // The sender is named on the card — a broadcast a coach cannot attribute is one
    // they will not act on.
    await expect(card).toContainText("Asha");

    await chandanPage.getByTestId("thread-ack").first().click();
    await expect(chandanPage.getByText(/acknowledged/i).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Asha's counter has moved --------------------------------------------
    await ashaPage.reload();
    await expect(ashaPage.getByTestId("sent-ack").first()).toHaveText("1 acknowledged", {
      timeout: 20_000,
    });
    // Seen is recorded too, and independently: a coach who acknowledges has plainly
    // seen it, and ackCount must never be able to exceed seenCount.
    await expect(ashaPage.getByTestId("sent-seen").first()).toHaveText("1 seen");
  } finally {
    await upline.close();
    await downline.close();
  }
});

test("a direct-line message does not reach a grandchild", async ({ browser }) => {
  /**
   * The scope guarantee, from the app's side. `rules.test.ts` proves the database
   * refuses it; this proves the screen never renders it either — the two failure
   * modes are independent, and only one of them is visible to a coach.
   *
   * Root sends "direct line only". Chandan is Root's GRANDCHILD via Asha, so it must
   * not appear in his inbox.
   */
  const message = `Only my direct line ${Date.now()}`;
  const root = await browser.newContext();
  const grandchild = await browser.newContext();

  try {
    const rootPage = await root.newPage();
    await login(rootPage, { phone: "9000000001", name: "Root" });
    await rootPage.goto("/threads");
    await rootPage.getByTestId("thread-body").fill(message);
    await rootPage.getByTestId("thread-scope-direct").click();
    await rootPage.getByTestId("thread-send").click();
    await expect(rootPage.getByTestId("sent-thread").first()).toContainText(message, {
      timeout: 20_000,
    });

    const chandanPage = await grandchild.newPage();
    await login(chandanPage, CHANDAN);
    await chandanPage.goto("/threads");
    // Give the inbox a real chance to render before asserting an absence.
    await expect(chandanPage.getByTestId("realtime-threads")).toHaveCount(1);
    await expect(chandanPage.getByText(message)).toHaveCount(0);
  } finally {
    await root.close();
    await grandchild.close();
  }
});
