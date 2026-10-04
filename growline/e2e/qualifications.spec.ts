import { test, expect, type Page } from "@playwright/test";

/**
 * Qualifications (F14) in a browser, on a phone-sized viewport.
 *
 * ## What this covers that no other test can
 *
 * The round trip. A unit test can prove the scoring is honest and a rules test can
 * prove the rows are unreadable, but neither can show that an upline announcing a
 * qualification produces a working tracker on a downline's phone — which is the whole
 * feature, and which depends on the create route evaluating synchronously rather than
 * leaving an empty frame until a scheduler that is not deployed happens to run.
 *
 * It also covers the zero-data state on every surface, because that is what a pilot
 * club sees on day one and it is the easiest state to ship broken: it looks fine in a
 * fixture full of data. The seeded organisation has four coaches, nobody has met a
 * condition, and every card here has to teach instead of rendering an empty box.
 *
 * ## Shared emulator (D44)
 *
 * The title carries a per-run suffix, because the document id is deterministic on
 * (creator, title, deadline) — deliberately, so a double-tapped button cannot create
 * twins — and a fixed title would make the second run of this file fail on its own
 * first run's data. There is no delete route to clean up with; `npm run e2e:reset`
 * is the reset.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const ROOT = { phone: "9000000001", name: "Root Coach" };
const ASHA = { phone: "9000000002", name: "Asha" };

/** A date well inside the one-year cap, and far enough out that no band is due. */
const DEADLINE = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
const TITLE = `Team push ${Date.now().toString(36).slice(-5)}`;

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

  // The home page greets by FIRST name, so "Root Coach" is welcomed as "Root".
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`hello, ${who.name.split(" ")[0]}`, "i"),
    })
  ).toBeVisible({ timeout: 20_000 });
}

test("an upline announces a qualification and their line gets a live tracker", async ({
  page,
}) => {
  await login(page, ROOT);

  // Reachable from the hub, since the bottom bar is full and adding a sixth tab is
  // the owner's decision, not this branch's.
  await page.goto("/more");
  // The hub card's accessible name is its title AND its one-line description, so the
  // pattern anchors at the start rather than matching the whole thing.
  await page.getByRole("link", { name: /^Qualifications/ }).click();
  await expect(
    page.getByRole("heading", { name: "Qualifications", level: 1 })
  ).toBeVisible();

  await page.getByTestId("qualification-new").click();

  // Step one: three fields, which is what keeps this inside the six-field cap (S2).
  await page.getByTestId("qual-title").fill(TITLE);
  // The audience count is stated under each choice, before the choice is irreversible.
  await expect(page.getByTestId("qual-audience-direct")).toContainText(/2 coaches/);
  await page.getByTestId("qual-audience-direct").click();
  await page.getByTestId("qual-deadline").fill(DEADLINE);
  await page.getByTestId("qual-next").click();

  // Step two: any combination of conditions, each with its own number.
  await page.getByTestId("qual-criterion-newMembers").click();
  await page.getByTestId("qual-target-newMembers").fill("2");
  await page.getByTestId("qual-criterion-daysActive").click();
  await page.getByTestId("qual-target-daysActive").fill("5");
  await page.getByTestId("qual-create").click();

  // The creator lands on their own dashboard, populated — the create path evaluates
  // in the same request rather than promising that a job will run later.
  await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("creator-qualified")).toHaveText("0");
  await expect(page.getByTestId("creator-onestep")).toHaveText("0");

  /**
   * The point of the dashboard: which condition is blocking people, not a total. Both
   * conditions block both coaches, and neither is anybody's SOLE blocker yet — the
   * distinction the whole screen turns on.
   */
  await expect(page.getByTestId("dropoff")).toBeVisible();
  await expect(page.getByTestId("dropoff-newMembers")).toContainText(/2 coaches are short/);
  await expect(page.getByTestId("dropoff-daysActive")).toContainText(/2 coaches are short/);
  await expect(page.getByTestId("dropoff-newMembers-sole")).toHaveCount(0);

  // Zero data teaches on every list rather than rendering an empty frame.
  await expect(page.getByText(/nobody is one condition away yet/i)).toBeVisible();
  await expect(page.getByText(/names appear the moment somebody meets/i)).toBeVisible();
});

test("a downline sees the tracker, the gap, and nobody else's shortfall", async ({
  page,
}) => {
  await login(page, ASHA);
  await page.goto("/qualifications");

  await page.getByRole("link", { name: new RegExp(TITLE, "i") }).click();
  await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();

  // The nudge names the gap. "One step away" is never said without the number that
  // says how far — see progress.ts.
  await expect(page.getByTestId("nudge")).toContainText(/2 conditions left/);
  await expect(page.getByTestId("nudge")).toContainText(/away|to log/);

  // Each condition, its own bar, and what is left in its own words.
  await expect(page.getByTestId("criterion-newMembers-remaining")).toHaveText(
    "2 members away"
  );
  await expect(page.getByTestId("criterion-daysActive-remaining")).toHaveText(
    "5 more days to log"
  );

  // The qualifier list with nobody in it teaches instead of showing an empty box.
  await expect(page.getByTestId("qualifier-list")).toContainText(/nobody yet/i);
  // And no count of who is nearly-in, because nobody is — the one-step group is a
  // COUNT even when it is not zero, and never a list of names (see the page).
  await expect(page.getByTestId("one-step-count")).toHaveCount(0);

  // A downline is not shown the creator's dashboard, whatever the URL says.
  await expect(page.getByTestId("dropoff")).toHaveCount(0);
  await expect(page.getByTestId("close-list")).toHaveCount(0);

  // No money anywhere on the screen a coach reads every day (RULES L4).
  const text = (await page.locator("main").innerText()).toLowerCase();
  expect(text).not.toMatch(/₹|rupee|earn|income|payout|at this rate/);
});

test("a qualification is invisible to a coach it does not apply to", async ({ page }) => {
  // Chandan is in Root's line but was not brought in by Root, and this one is scoped
  // to the direct line. "My direct line only" means exactly that, and the answer is
  // the same one a qualification that does not exist would give.
  await login(page, { phone: "9000000004", name: "Chandan" });
  await page.goto("/qualifications");
  await expect(page.getByRole("link", { name: new RegExp(TITLE, "i") })).toHaveCount(0);
  await expect(page.getByText(/nothing to qualify for yet/i)).toBeVisible();
});
