import { test, expect, type Page } from "@playwright/test";

/**
 * The email + password door (D82), driven through the real UI the way
 * `signup.spec.ts` drives the phone one.
 *
 * Email is the step a visitor lands on because production SMS is not switched on
 * yet — which makes this, for now, the way a real coach actually gets in. The parts
 * only a browser can prove: Firebase email auth, the ID-token exchange deciding
 * new-vs-existing, the profile step collecting the number the credential no longer
 * carries, and that number becoming the coach's contact identity.
 */

/**
 * A fixed identity, on purpose. The Auth emulator accepts
 * `createUserWithEmailAndPassword` with no console setup, and `npm run e2e:reset`
 * wipes both emulators between runs, so a constant address never collides with a
 * previous run's account. The phone number stays clear of the seeded fixtures
 * (9000000001–4) — complete-signup refuses a number that already has an account,
 * and colliding with Asha would turn that guard into a false failure here.
 *
 * The suite runs one worker in file order: the first test creates the account the
 * later ones sign into.
 */
const EMAIL = "e2e-email-coach@example.com";
const PASSWORD = "growline-e2e";
const PHONE = "9123456780";

async function signIn(page: Page, email: string, password: string) {
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Your password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a new coach creates an account with email, adds their number, and lands on the home screen", async ({
  page,
}) => {
  await page.goto("/login");

  // Sign-in and create-account are separate submit paths, chosen explicitly —
  // email-enumeration protection means the server cannot guess the visitor's
  // intent from an error, so the coach declares it up front.
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("At least 6 characters").fill(PASSWORD);
  await page.getByPlaceholder("The same password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // No user document exists yet, so no session cookie is issued — the ID token
  // carries the verified identity into profile setup instead.
  await expect(page.getByRole("heading", { name: /tell us about you/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByPlaceholder("e.g. Priya Kumar").fill("E2E Email Coach");
  // An email credential carries no phone number, so the profile step asks for one:
  // every report and WhatsApp link prints it, however the coach signed in.
  await page.getByPlaceholder("98765 43210").fill(PHONE);
  await page.getByPlaceholder("e.g. Mysuru").fill("Bengaluru");
  // No invite arrived on the URL, so nothing should be pre-filled — a root coach.
  await expect(page.getByPlaceholder("ABC123")).toHaveValue("");
  await page.getByRole("button", { name: /start my growline/i }).click();

  // Landing here proves the session cookie was issued AND that the authenticated
  // layout found a user document — the same bar signup.spec.ts holds phone signup to.
  await expect(page.getByRole("heading", { name: /hello, e2e/i })).toBeVisible({
    timeout: 20_000,
  });

  // The number typed at the profile step is unverified (D82's stated trade), but it
  // must still become the coach's contact identity exactly as an OTP-verified one
  // would — Settings is where the app says who it thinks you are.
  await page.goto("/settings");
  await expect(page.getByText("+91 91234 56780")).toBeVisible({ timeout: 20_000 });
});

test("the same email signs straight back in, with no profile step", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, EMAIL, PASSWORD);

  await expect(page.getByRole("heading", { name: /hello, e2e/i })).toBeVisible({
    timeout: 20_000,
  });
  // The profile step must never appear for someone who already has an account.
  await expect(page.getByRole("heading", { name: /tell us about you/i })).toHaveCount(0);

  // End the session the way the logout test does — the Settings button — and come
  // back in once more. "Back in" should mean after a real sign-out on this device,
  // not merely a fresh browser context that never held the session.
  await page.goto("/settings");
  await page.getByRole("button", { name: /^log out$/i }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  await signIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole("heading", { name: /hello, e2e/i })).toBeVisible({
    timeout: 20_000,
  });
});

test("a wrong password is refused, and the coach stays on the login screen", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page, EMAIL, "not-the-password");

  // The message deliberately cannot separate "wrong password" from "no such
  // account" — that distinction is exactly what enumeration protection hides.
  await expect(page.getByText(/email or password is wrong/i)).toBeVisible({
    timeout: 20_000,
  });
  // A refusal leaves the coach where they can retry — no redirect, no home screen.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the phone OTP path is still one tap away", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();

  // The reveal is the whole assertion: D82 demoted phone to second place, it did
  // not remove it. The OTP flow itself is signup.spec.ts's job — running it twice
  // proves nothing new.
  await expect(page.getByPlaceholder("98765 43210")).toBeVisible();
  await expect(page.getByRole("button", { name: /get otp/i })).toBeVisible();
});
