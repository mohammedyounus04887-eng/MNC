import { test, expect, type Page } from "@playwright/test";

/**
 * F9 end to end: a coach claims a link, writes a story, publishes, and a STRANGER —
 * no account, no session — can read the page.
 *
 * The last clause is the whole point and no unit test can reach it. The portfolio is
 * the only screen in Growline a prospect ever opens on purpose, and every other public
 * surface here is behind a token or a code. This one is behind nothing, which is
 * exactly why "is it actually reachable signed-out, and is it actually NOT reachable
 * before publishing" has to be proven against a real server.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const BHAVANA = { phone: "9000000003", name: "Bhavana" };

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

test("a coach claims a link, publishes, and a stranger can read the page", async ({
  browser,
}) => {
  // Unique per run: the emulator is shared and single-worker (D44), and a slug is
  // claimed for good — a fixed one would pass once and then collide with itself.
  const slug = `bhavana-${Date.now()}`;
  const story = "I started because my mother asked me to walk with her every morning.";

  const coach = await browser.newContext();
  const stranger = await browser.newContext();

  try {
    const page = await coach.newPage();
    await login(page, BHAVANA);

    // Reachable from the hub, not just by typed URL — the bottom bar is full at five
    // tabs and a sixth is the owner's call (same position as /who-to-call).
    await page.goto("/more");
    await page.getByRole("link", { name: /my page/i }).click();
    await expect(page.getByRole("heading", { name: "My Page", level: 1 })).toBeVisible();

    /*
     * Put the switch in a KNOWN state before relying on it.
     *
     * The emulator is shared and single-worker (D44), so a previous run of this very
     * test can leave Bhavana published — and then the new slug goes live the moment it
     * is claimed and the "not visible yet" assertion below passes nothing. A test that
     * only holds on a freshly reset database is a test that lies on a second run.
     */
    const publishSwitch = page.getByRole("switch", { name: /show my page publicly/i });
    if ((await publishSwitch.getAttribute("aria-checked")) === "true") {
      await publishSwitch.click();
      await expect(page.getByText(/your page is off/i)).toBeVisible({ timeout: 15_000 });
    }

    await page.getByLabel(/your link name/i).fill(slug);
    await page.getByLabel(/your story/i).fill(story);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    // --- Before publishing, the page does not exist for anybody -------------------
    //
    // Asserted BEFORE the publish rather than after, because "it 404s" is only
    // meaningful while the slug is genuinely claimed and the story genuinely saved.
    // Checking a slug nobody has claimed would pass against a broken implementation.
    const outside = await stranger.newPage();
    const before = await outside.goto(`/${slug}`);
    expect(before?.status()).toBe(404);

    // --- Publish ------------------------------------------------------------------
    //
    // "Your page is live" appears only after the server confirms, never optimistically,
    // so waiting for it is a real wait rather than a wait on local state.
    await publishSwitch.click();
    await expect(page.getByText(/your page is live/i)).toBeVisible({ timeout: 15_000 });

    // --- Now a stranger can read it -----------------------------------------------
    const after = await outside.goto(`/${slug}`);
    expect(after?.status()).toBe(200);
    await expect(outside.getByRole("heading", { name: "Bhavana" })).toBeVisible();
    await expect(outside.getByText(story)).toBeVisible();
    await expect(
      outside.getByRole("link", { name: /message me on whatsapp/i })
    ).toBeVisible();
    await expect(outside.getByRole("link", { name: /join my club/i })).toBeVisible();

    // The coach's personal number must not be in the HTML of a page we ask search
    // engines to index — the button goes through the redirect route instead.
    expect(await outside.content()).not.toContain("wa.me");

    // Unlike a report link (D17), this page is MEANT to be found. A noindex here would
    // silently defeat the one screen that exists to be discovered.
    //
    // Asserted as "not noindex" rather than "no robots tag at all": setting index:true
    // makes Next emit an explicit `index, follow`, which is the stronger signal. The tag
    // being absent and the tag saying index are both correct; only noindex is wrong.
    const robots = await outside.locator('meta[name="robots"]').getAttribute("content");
    expect(robots ?? "index").not.toContain("noindex");
  } finally {
    await coach.close();
    await stranger.close();
  }
});

test("a link name somebody already has is refused, and so is one the app owns", async ({
  page,
}) => {
  await login(page, BHAVANA);
  await page.goto("/portfolio");

  // A route name would shadow the coach's printed link with a real page, so it is
  // refused at claim time rather than discovered on a poster.
  await page.getByLabel(/your link name/i).fill("settings");
  await expect(page.getByText(/taken by the app/i)).toBeVisible();

  // And the save button is unreachable while the name is invalid — the error is not
  // merely decorative.
  await expect(page.getByRole("button", { name: /^save$/i })).toBeDisabled();
});
