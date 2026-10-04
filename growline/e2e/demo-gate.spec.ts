import { test, expect } from "@playwright/test";

/**
 * The demo gate, asserted in whichever mode the server under test is running.
 *
 * Demo mode signs somebody in with no SMS. The one thing that must never be true is that
 * it is reachable on a deployment where nobody enabled it — so this test's real job is to
 * fail loudly if `/demo` ever answers on a server with `DEMO_MODE` unset.
 *
 * It does NOT skip when the flag is on. A test that quietly skips half the time teaches
 * everybody to ignore it; instead it asserts the correct behaviour for the mode it finds,
 * so it is meaningful both on a developer's machine with the demo enabled and in CI,
 * where the flag is unset and the closed-gate case is the one being proven.
 */

const demoOn = process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";

test("the demo entry point matches the DEMO_MODE flag exactly", async ({ request }) => {
  const page = await request.get("/demo");
  const api = await request.post("/api/demo/session", { data: { role: "middle" } });

  if (demoOn) {
    expect(page.status()).toBe(200);
    expect(api.status()).toBe(200);
  } else {
    // 404 and not 403: on the production deployment this route must be
    // indistinguishable from a typo, because a 403 confirms it exists.
    expect(
      page.status(),
      "/demo answered on a server with DEMO_MODE unset — the gate is open"
    ).toBe(404);
    expect(
      api.status(),
      "/api/demo/session answered with DEMO_MODE unset — anyone could mint a session"
    ).toBe(404);
  }
});

test("the login screen only offers the demo when it is enabled", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("demo-entry")).toHaveCount(demoOn ? 1 : 0);
});

test("even with the demo enabled, only the fixed roles are accepted", async ({
  request,
}) => {
  test.skip(!demoOn, "nothing to probe when every demo route is 404");

  // The uid must come from the server's own table, never from the caller — otherwise
  // "demo mode on" would mean "mint a session for any account you can name".
  for (const role of [
    "admin",
    "usr_root0000000000000000",
    "",
    "MIDDLE",
    "../middle",
  ]) {
    const res = await request.post("/api/demo/session", { data: { role } });
    expect(res.status(), `role=${JSON.stringify(role)} must be refused`).toBe(400);
  }
});
