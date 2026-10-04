import { test, expect } from "@playwright/test";

/**
 * v2 §3: "QR form submissions ... switch to Firestore listeners — new prospects
 * appear instantly, no refresh (closes a v1 debt item for free)."
 *
 * That debt is D10, which shipped Phase 2 with the row written but no live update,
 * having rejected polling on data cost. This proves the listener replaces it: the
 * coach sits on the prospects screen, a stranger submits the public QR form, and
 * the row appears without anyone touching the page.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ASHA_PHONE = "9000000002";
const ASHA_CODE = "ASHA01";

test("a QR self-fill appears in the pipeline with no refresh", async ({ page, request }) => {
  // Sign in as Asha and sit on the prospects screen.
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

  await page.goto("/prospects");

  // The listener attaches only once client Firebase Auth is resolved.
  await expect(page.locator('[data-testid="realtime"]')).toHaveAttribute("data-live", "1", {
    timeout: 15_000,
  });

  const name = `QR Walker ${Date.now()}`;

  // A prospect submits the public form from somewhere else entirely — no session,
  // no browser tab of ours. This is the real Mode B path.
  const submitted = await request.post(`/api/public/capture/${ASHA_CODE}`, {
    data: { name, phone: "9111100077" },
  });
  expect(submitted.ok()).toBeTruthy();

  // No reload, no navigation, no polling — the row arrives on its own.
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
});
