import { test, expect, type Page } from "@playwright/test";

/**
 * The happy path v2 §5.7 asks for, and the half of v2.1a's parity gate that no
 * amount of data-layer assertions can cover: can a coach actually sign in.
 *
 * Everything here goes through the real UI in a real browser — Firebase phone
 * auth, the ID-token exchange, session-cookie creation, `createUser`, referral
 * placement, and the authenticated layout's redirect.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/** Asha's referral code, from the seed. */
const SEEDED_REFERRAL = "ASHA01";

/**
 * The Auth emulator records every code it "sends". This is the piece that makes
 * phone auth testable at all — on a real project the code only exists in an SMS.
 */
async function latestCodeFor(phone: string): Promise<string> {
  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === phone);
  if (mine.length === 0) throw new Error(`No verification code issued for ${phone}`);
  return mine[mine.length - 1].code;
}

/** A number nobody else in the run is using, so tests never collide. */
function uniquePhone(): string {
  const n = Math.floor(Math.random() * 90_000_000) + 10_000_000;
  return `9${String(n).padStart(9, "0")}`.slice(0, 10);
}

async function enterPhoneAndCode(page: Page, tenDigits: string) {
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill(tenDigits);
  await page.getByRole("button", { name: /get otp/i }).click();

  // The OTP step is up once the code field is visible.
  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  const code = await latestCodeFor(`+91${tenDigits}`);
  // The form submits itself on the 6th digit (the 30-second rule) — no button.
  await codeField.fill(code);
  return code;
}

test("a new coach signs up with a referral code and lands on the home screen", async ({
  page,
}) => {
  const phone = uniquePhone();
  await page.goto(`/login?ref=${SEEDED_REFERRAL}`);

  // The invite is acknowledged before the number is even entered.
  await expect(page.getByText(`Joining with code ${SEEDED_REFERRAL}`)).toBeVisible();

  await enterPhoneAndCode(page, phone);

  // No user document exists yet, so no session cookie is issued — the ID token
  // carries the verified number into profile setup instead.
  await expect(page.getByRole("heading", { name: /tell us about you/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByPlaceholder("e.g. Priya Kumar").fill("E2E Coach");
  await page.getByPlaceholder("e.g. Mysuru").fill("Bengaluru");
  // The referral code arrived on the URL and is pre-filled — this asserts the
  // invite actually carried through, rather than typing it back in ourselves.
  await expect(page.getByPlaceholder("ABC123")).toHaveValue(SEEDED_REFERRAL);
  await page.getByRole("button", { name: /start my growline/i }).click();

  // Landing here proves the session cookie was issued AND that the authenticated
  // layout found a user document — the half-signed-up trap would redirect to
  // logout instead.
  await expect(page.getByRole("heading", { name: /hello, e2e/i })).toBeVisible({
    timeout: 20_000,
  });
});

test("an existing coach logs straight in, with no profile step", async ({ page }) => {
  // Asha is in the seed and was migrated, so her document already exists.
  await page.goto("/login");
  await enterPhoneAndCode(page, "9000000002");

  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });
  // The profile step must never appear for someone who already has an account.
  await expect(page.getByRole("heading", { name: /tell us about you/i })).toHaveCount(0);
});

test("logging out ends the session on the server, not just in this browser", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await enterPhoneAndCode(page, "9000000002");
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });

  // Stands in for a second device, or for anyone who copied the cookie off a
  // shared phone: the exact cookie, kept from before the logout.
  const copied = (await context.cookies()).find((c) => c.name === "gl_session");
  if (!copied) throw new Error("No gl_session cookie after login — nothing to replay.");

  /**
   * Firebase revocation has one-second granularity, and this matters here.
   * `revokeRefreshTokens` stamps `validSince` in whole seconds, and the check is
   * `auth_time < validSince` — strictly less. Log in and log out inside the same
   * wall-clock second and the two are EQUAL, so the cookie survives its own
   * revocation. A real coach cannot hit that; a Playwright script does it easily,
   * and the test then fails for a reason that has nothing to do with the code.
   *
   * So: cross the second boundary on purpose. This is one of the few places a
   * fixed wait is the correct tool rather than a smell — there is no event to
   * await, the thing being waited on is a clock.
   */
  await page.waitForTimeout(1100);

  await page.goto("/settings");
  await page.getByRole("button", { name: /^log out$/i }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  /**
   * The assertion that matters — stated as CAPABILITY, not as a URL.
   *
   * Clearing the cookie alone would leave this test green while the session lived
   * out its 14 days on the Auth backend; only revocation makes the replayed cookie
   * fail verification. But asserting a final URL was the wrong way to check it: a
   * rejected cookie takes the coach through the layout's redirect to
   * /api/auth/logout and on to /login, and where that chain settles depends on the
   * host it started from. What must be true is simpler and does not care about the
   * route — the replayed cookie buys no access to the coach's business.
   */
  await context.addCookies([copied]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("the public capture page is reachable without an account and is noindex", async ({
  page,
}) => {
  const res = await page.goto(`/c/${SEEDED_REFERRAL}`);
  expect(res?.status()).toBe(200);

  // A prospect's details must never be crawlable (D7).
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");

  // No redirect to /login — the whole point of Mode B is that the prospect has
  // no account.
  expect(page.url()).toContain(`/c/${SEEDED_REFERRAL}`);
});
