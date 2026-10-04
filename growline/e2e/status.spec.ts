import { test, expect } from "@playwright/test";

/**
 * /status — the deployment's health readout (D83).
 *
 * Visited signed out, because that is its entire job: it exists for the moments
 * when the app is broken and nobody can log in. D68 is the standing lesson that a
 * public page nobody has visited signed-out is a page that may not be public at
 * all — this one has the extra trap that "status" is a RESERVED_SLUG, so a missing
 * PUBLIC_PATHS entry sends it to /login silently.
 *
 * Against the emulators every probe passes, so this also pins that the nine
 * checks run and report rather than crash: a status page that 500s is the one
 * outcome it is not allowed to have.
 */
test("the health readout is reachable signed out, and every probe reports", async ({ page }) => {
  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /status/i })).toBeVisible({ timeout: 20_000 });

  // Nine verdicts, each PASS against the emulators. Zero FAILs, and zero would
  // also catch the page silently rendering an empty list.
  await expect(page.getByText("PASS", { exact: true })).toHaveCount(9);
  await expect(page.getByText("FAIL", { exact: true })).toHaveCount(0);

  // It never asks anyone to sign in.
  await expect(page).toHaveURL(/\/status$/);
});

/**
 * The build stamp, which is the only thing on the page that can tell a successful
 * rollout from one that silently rolled back.
 *
 * A failed App Hosting rollout does not take the site down — the previous good
 * build keeps serving — so every other check here passes just as happily against a
 * deploy that never landed. This is the line that distinguishes them, and it is
 * resolved at BUILD time through a fallback chain that is deliberately allowed to
 * give up. "unknown" is the giving-up value, and it must never be what production
 * shows, so the test that guards it has to reject exactly that.
 */
test("the page names the build it is serving", async ({ page }) => {
  await page.goto("/status");

  const stamp = page.getByTestId("build-stamp");
  await expect(stamp).toBeVisible();

  const sha = await page.getByTestId("build-sha").innerText();
  expect(sha).not.toBe("unknown");
  // Seven hex characters — a short git SHA, not a placeholder and not a truncated
  // branch name.
  expect(sha).toMatch(/^[0-9a-f]{7}$/);

  // And a timestamp that parses, so "how old is what is serving?" is answerable
  // even on a build where the SHA had to fall through.
  const text = await stamp.innerText();
  const iso = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(text);
  expect(iso, `no ISO timestamp in "${text}"`).not.toBeNull();
  expect(Number.isNaN(Date.parse(iso![1]))).toBe(false);
});
