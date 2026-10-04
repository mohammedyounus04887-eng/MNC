import { test, expect, type Page } from "@playwright/test";

/**
 * Tiers (v2 §8), under the standing instruction "don't gate anything yet".
 *
 * These are NOT tests of a feature working. They are tests that a feature which is
 * built and standing has taken nothing away — which is a different and, this week, more
 * important property. A gate that accidentally closed would look, in the unit suite,
 * exactly like a gate that is correctly open; only a real request from a real Starter
 * through the real route can tell the two apart.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

// Asha has ONE direct downline (Chandan) — a Starter who is not qualified. If any gate
// were enforced she is exactly the coach who would be refused.
const ASHA = { phone: "9000000002", name: "Asha" };

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

/**
 * Calls an API route FROM THE PAGE, so the real session cookie travels with it.
 *
 * `page.request` shares the context's cookie jar but does not send a `Secure` cookie
 * over plain http://127.0.0.1 — and `next start` is production, so `gl_session` IS
 * Secure. Browsers carve out a special case for localhost; the request client does not.
 * Every existing spec that used `page.request` did so signed-out, which is why nothing
 * had tripped over this before. `fetch` inside the page is the honest instrument here:
 * it is exactly what the app's own components do.
 */
async function callApi(
  page: Page,
  method: "GET" | "POST" | "PUT",
  path: string,
  data?: unknown
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, path, data }) => {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, data }
  );
}

test("a Starter can still set a target and send a thread — no gate has closed", async ({
  page,
}) => {
  await login(page, ASHA);

  // The gate answers before it does any work, so a 402 here would be the flip having
  // happened by accident. Anything else — 200, or a 400 for a bad body — means open.
  const target = await callApi(page, "PUT", "/api/targets", {
    coachId: "usr_chan0000000000000000",
    targetPoints: 300,
  });
  expect(target.status, "set-targets gate must be open").not.toBe(402);
  expect(target.status).toBe(200);

  const thread = await callApi(page, "POST", "/api/threads", {
    scope: "direct",
    body: `Gate check ${Date.now()}`,
  });
  expect(thread.status, "send-threads gate must be open").not.toBe(402);
  expect(thread.status).toBe(200);
});

test("the v1 trial countdown is gone from Home and Settings", async ({ page }) => {
  await login(page, ASHA);
  await expect(page.getByText(/free trial ·/i)).toHaveCount(0);
  await expect(page.getByText(/days left/i)).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "My plan" })).toBeVisible();
  await expect(page.getByText(/free forever/i)).toBeVisible();
  await expect(page.getByText(/days left/i)).toHaveCount(0);
});

test("the plans screen is honest that nothing is locked, and favours annual", async ({
  page,
}) => {
  await login(page, ASHA);
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "Plans", level: 1 })).toBeVisible();
  await expect(page.getByText(/nothing is locked today/i)).toBeVisible();
  await expect(page.getByText(/9,999\/year/)).toBeVisible();
  await expect(page.getByText(/coming soon/i)).toBeVisible();
  // Trust Zone (G1): no celebration on a money screen.
  await expect(page.getByText(/🎉/)).toHaveCount(0);
});

test("starting a trial is refused while enforcement is off, and says why", async ({
  page,
}) => {
  await login(page, ASHA);
  const res = await callApi(page, "POST", "/api/tiers", { action: "start-trial" });
  expect(res.status).toBe(409);
  expect((res.body as { error: string }).error).toMatch(/lose nothing/i);
});
