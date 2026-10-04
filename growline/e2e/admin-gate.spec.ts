import { test, expect, type Page } from "@playwright/test";

/**
 * The admin gate (F12).
 *
 * The panel can see every coach's counts, so the only property worth a test is that an
 * ordinary coach cannot open it. That assertion holds in every environment: Asha is not
 * in `ADMIN_UIDS` locally, and in CI the variable is unset so the panel does not exist at
 * all. One test, meaningful everywhere.
 *
 * 404 rather than 403 is the assertion, deliberately: a 403 tells a curious coach the
 * panel is there and worth trying.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

async function loginAsAsha(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill("9000000002");
  await page.getByRole("button", { name: /get otp/i }).click();

  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === "+919000000002");
  await codeField.fill(mine[mine.length - 1].code);
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });
}

test("a signed-out visitor is sent to login, not shown the panel", async ({ request }) => {
  const res = await request.get("/admin", { maxRedirects: 0 });
  // The proxy redirects anything without a session cookie. It cannot verify the JWT in
  // the edge runtime, so this is a redirect rather than the 404 below — the layout is
  // what decides once there is a session to check.
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("/login");
});

test("an ordinary coach gets 404, not a login wall and not a 403", async ({ page }) => {
  await loginAsAsha(page);

  const res = await page.goto("/admin");
  expect(
    res?.status(),
    "a signed-in non-admin reached /admin — the allowlist is not being enforced"
  ).toBe(404);

  // And nothing from the panel leaked into the 404 body.
  await expect(page.getByText("Growline admin")).toHaveCount(0);
  await expect(page.getByText(/Coaches logging their work/i)).toHaveCount(0);
});
