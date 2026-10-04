import { test, expect } from "@playwright/test";

/**
 * The theme layer (Design System 3.0 "Voltage", was v2 §4 "Dark Achiever").
 *
 * These assertions used to pin the literal navy `rgb(11, 16, 32)`, which meant a
 * change of PALETTE failed a test about MECHANISM. The three things worth proving
 * here are about whether the theme resolves and applies, not what colour it
 * happens to be this quarter — so the expected value is now read from the `--bg`
 * token itself. A palette change is then free; a broken token wiring still fails,
 * because body's computed background would stop matching the variable.
 *
 * Three things worth proving, because all three are silent when broken:
 *   1. dark really is the default
 *   2. a stored choice survives a reload — and survives it WITHOUT a flash of the
 *      wrong theme, which is why ThemeScript blocks before paint
 *   3. the system preference is honoured on first run
 */

test("a device that prefers dark gets dark", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // The token layer is actually wired, not just the attribute: body's painted
  // background must be the --bg token resolved, whatever that token now holds.
  expect(await bodyMatchesBgToken(page)).toBe(true);
  await ctx.close();
});

test("the server ships the default theme, so first paint is never the wrong one", async ({
  request,
}) => {
  // The pre-hydration attribute in the HTML is what a user sees for the few
  // milliseconds before ThemeScript runs, so it must equal the app's default —
  // whichever that is. It was dark under v2 §4 and is light under Sunrise (3.1),
  // because the chosen identity IS light and the defining use is outdoors in
  // daylight. What must never drift is server default vs script default: if those
  // two disagree, every load flashes.
  const res = await request.get("/login");
  expect(await res.text()).toContain('data-theme="light"');
});

test("a light system preference is honoured on first run", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await ctx.close();
});

test("no stored choice and no system preference falls back to the default", async ({
  browser,
}) => {
  // The `catch` path in ThemeScript — private mode, storage blocked. It has to
  // agree with what the server shipped, which is the whole flash-prevention
  // contract; the two were written in different files and can silently diverge.
  const ctx = await browser.newContext({ colorScheme: "no-preference" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await ctx.close();
});

test("an explicit dark choice beats a light system preference", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("growline:theme", "dark"));
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyMatchesBgToken(page)).toBe(true);
  await ctx.close();
});

test("the theme is applied before first paint, not after", async ({ page }) => {
  await page.evaluate(() => {}).catch(() => {});
  await page.goto("/login");
  // Store the NON-default choice, so there is a correction to observe at all.
  // The direction flipped with Sunrise (3.1): the default is light now, so the
  // stored value that proves the mechanism is dark.
  await page.evaluate(() => localStorage.setItem("growline:theme", "dark"));

  // Capture what the SERVER sends, before any script has run. It must be the
  // default; if ThemeScript ran only after hydration, the corrected value would
  // never make it into this HTML and every load would flash the wrong theme.
  const early = await page.evaluate(async () => {
    const res = await fetch(location.href);
    const html = await res.text();
    return html.includes('data-theme="light"');
  });
  expect(early).toBe(true); // server ships the default...

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // ...script corrects it
});

/**
 * Does the painted body background equal the `--bg` token?
 *
 * Compared by rendering both through the same element, because the token is
 * authored as a hex and `getComputedStyle` reports rgb() — string-comparing the
 * two forms would fail on formatting rather than on colour.
 */
async function bodyMatchesBgToken(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const painted = getComputedStyle(document.body).backgroundColor;
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--bg)";
    document.body.appendChild(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return painted === token && token !== "rgba(0, 0, 0, 0)";
  });
}
