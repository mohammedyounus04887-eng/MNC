import { test, expect } from "@playwright/test";

/**
 * v1 §4.3 / RULES S5: prospect capture must work offline.
 *
 * This is the parity-gate item that assertions genuinely cannot reach. The
 * no-duplicate property is provable against the data layer (the composite
 * document id, D6/D35), but "does a capture survive a dead signal and sync when
 * it comes back" is a browser behaviour — IndexedDB, `navigator.onLine`, the
 * service worker, and OfflineSync draining from the authenticated layout (D9).
 *
 * Walk-and-talk happens where the network is weak, so this path failing silently
 * costs a coach the person they just met.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ASHA_PHONE = "9000000002";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill(ASHA_PHONE);
  await page.getByRole("button", { name: /get otp/i }).click();
  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === `+91${ASHA_PHONE}`);
  await codeField.fill(mine[mine.length - 1].code);
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });
}

test("a capture made offline survives and syncs when the signal returns", async ({
  page,
  context,
}) => {
  await login(page);

  const name = `Offline Person ${Date.now()}`;
  await page.goto("/prospects/new");
  await expect(page.getByPlaceholder("Who did you meet?")).toBeVisible();

  // Signal dies mid-walk.
  await context.setOffline(true);

  await page.getByPlaceholder("Who did you meet?").fill(name);
  await page.getByPlaceholder("98765 43210").fill("9111100001");

  /**
   * Save is blocked until the consent tick (RULES P6) — asserted here rather than in its
   * own test, because this is the offline path and consent has to survive the QUEUE. A
   * capture that lost its tick on the way through IndexedDB would be refused by the API
   * on replay and sit in the queue forever, which is a silent failure: the coach was told
   * "saved on this phone" and the person never arrives.
   */
  const save = page.getByRole("button", { name: /save person/i });
  await expect(save).toBeDisabled();
  await page.getByTestId("capture-consent").check();
  await expect(save).toBeEnabled();

  await save.click();

  // The coach must be told it is safe, on the spot — not left staring at a
  // spinner that cannot resolve.
  await expect(page.getByText(/saved on this phone/i)).toBeVisible({ timeout: 15_000 });

  // Signal returns. OfflineSync drains from the authenticated layout, so any
  // screen will do — the coach does not have to open the prospect list (D9).
  await context.setOffline(false);
  await page.goto("/prospects");

  /**
   * `.first()` here, and the reason is worth writing down.
   *
   * `toBeVisible()` on a locator that matches two elements throws a strict-mode
   * violation instead of retrying it away, and this list momentarily holds two copies
   * of the same row while `router.refresh()` swaps the server-rendered tree in. The
   * duplicate is transient and the database provably holds ONE document — the
   * composite id (D6/D35) makes a second one unreachable — so failing here was the
   * assertion being brittle about a render, not the sync creating a person twice.
   *
   * The no-duplicate guarantee is not dropped; it moves to the line below, where
   * `toHaveCount(1)` retries until the count SETTLES at one. That is a stronger claim
   * than the original pair made: it now catches both a duplicate row that persists
   * and a duplicate document, and it cannot pass by racing.
   */
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

  // And the sync must not have produced two of them (D6).
  await expect(page.getByText(name)).toHaveCount(1, { timeout: 20_000 });
});
