import { test, expect, type Page } from "@playwright/test";

/**
 * The boards screen (F13), in a browser, on a phone-sized viewport.
 *
 * ## What this covers that no other test can
 *
 * The seeded organisation has four coaches, which is BELOW the floor at which a
 * board is published (`MIN_PARTICIPANTS` in ranking.ts — derived from the podium and
 * window sizes, and privacy rather than performance). So this is the zero-data case,
 * and every list, board and alert has to
 * teach rather than render an empty box. That state is the one a real pilot club sees
 * on day one, and it is the easiest one to ship broken because it looks fine in a
 * fixture full of data.
 *
 * It also covers the two navigations that carry no JavaScript — week/month and the
 * scope filter are plain links — and the opt-out round trip through its API route.
 *
 * The opt-out is turned back on before the test ends. The emulator is shared state
 * (D44) and a coach left off the boards would silently change what a later run of
 * this file, or anybody else's, is looking at.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

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

test("the boards teach when there is nothing on them, and the filters need no JavaScript", async ({
  page,
}) => {
  await login(page, ASHA);

  // Reachable from the hub, since the bottom bar is full and adding a sixth tab is
  // the owner's decision, not this branch's.
  await page.goto("/more");
  await page.getByRole("link", { name: /boards/i }).click();
  await expect(page.getByRole("heading", { name: "Boards", level: 1 })).toBeVisible();

  // Four boards, always. Not one board with a metric switcher — see metrics.ts.
  for (const id of ["volume", "peopleMet", "followUps", "streak"]) {
    await expect(page.getByTestId(`board-${id}`)).toBeVisible();
  }

  // Zero data teaches. Four coaches is below the floor at which a board publishes,
  // so every card says what will fill it instead of showing an empty frame.
  await expect(
    page.getByTestId("board-peopleMet").getByText(/nothing here yet/i)
  ).toBeVisible();
  await expect(
    page.getByTestId("board-peopleMet").getByText(/save the next person you meet/i)
  ).toBeVisible();

  // A group this coach does not have is explained, never offered as a dead option —
  // and no level name is suggested to them (RULES L8, D29).
  await expect(page.getByTestId("scope-level")).toHaveCount(0);
  await expect(page.getByTestId("scope-missing-level")).toContainText(
    /named by your own organisation/i
  );

  // Scope and window are links: navigating changes the URL and re-renders on the
  // server, with no client bundle involved.
  await page.getByTestId("scope-club").click();
  await expect(page).toHaveURL(/scope=club/);
  await expect(page.getByTestId("board-streak")).toBeVisible();

  await page.getByRole("link", { name: "This week" }).click();
  await expect(page).toHaveURL(/window=weekly/);
  // Volume is a monthly figure by construction, and the weekly view says so rather
  // than inventing a weekly number for it.
  await expect(page.getByTestId("board-volume")).toContainText(/only runs monthly/i);
});

test("a coach can take their name off the boards, and still see them", async ({ page }) => {
  await login(page, ASHA);
  await page.goto("/leaderboards");

  const toggle = page.getByTestId("leaderboard-optout-toggle");
  await expect(toggle).toHaveText(/take my name off the boards/i);

  await toggle.click();
  await expect(toggle).toHaveText(/show my name on the boards/i);
  // Opting out is about being listed, not about being locked out.
  await expect(page.getByTestId("board-volume")).toBeVisible();
  await expect(page.getByText(/your name is not listed on any board/i)).toBeVisible();

  // Put the shared emulator back as it was found (D44).
  await toggle.click();
  await expect(toggle).toHaveText(/take my name off the boards/i);
});
