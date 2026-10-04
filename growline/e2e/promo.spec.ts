import { test, expect, type Page } from "@playwright/test";

/**
 * Promo codes (v2 §8, Phase 9b) — driven end to end, because the parts that can break
 * are the parts a unit test cannot reach.
 *
 * The arithmetic is unit-tested in `tests/promo.test.ts`. What is tested HERE is the
 * transaction: that a second redemption of the same code by the same coach is refused
 * structurally rather than granting the days twice, that the use count moves exactly
 * once, and that a coach's tier actually changes. Those are Firestore behaviours, and
 * the only honest way to test them is against Firestore.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

// Chandan is a Starter with no downlines — the coach least entitled to Leader by any
// other route, so a Leader tier after redeeming can only have come from the code.
const CHANDAN = { phone: "9000000004", name: "Chandan" };
const CHANDAN_ID = "usr_chan0000000000000000";

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
 * Writes a promo code straight into the emulator over its REST API.
 *
 * Minting through the admin route would need an ADMIN_UIDS allowlist baked into the
 * server build, which would make this spec depend on the deployment's admin config. The
 * mint path has its own unit coverage; what this spec is about is redemption.
 */
async function seedCode(code: string, fields: { leaderDays: number; maxUses: number; expiresKey: string }) {
  const url = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/promoCodes?documentId=${code}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({
      fields: {
        leaderDays: { integerValue: String(fields.leaderDays) },
        maxUses: { integerValue: String(fields.maxUses) },
        uses: { integerValue: "0" },
        expiresKey: { stringValue: fields.expiresKey },
        lockedPlan: { nullValue: null },
        note: { stringValue: "e2e" },
        createdBy: { stringValue: "e2e" },
        createdAt: { timestampValue: "2026-01-01T00:00:00Z" },
      },
    }),
  });
  if (!res.ok) throw new Error(`could not seed ${code}: ${res.status} ${await res.text()}`);
  seeded.push(code);
}

/** Every code this file mints, so afterAll can take them away again. */
const seeded: string[] = [];

const docUrl = (path: string) =>
  `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;

/**
 * The Firestore emulator's owner bypass.
 *
 * The REST API under `/v1/projects/...` is the CLIENT surface, so it is evaluated
 * against `firestore.rules` — where `promoCodes` has no match block and the default deny
 * applies (deliberately: a client-readable promoCodes would let anyone enumerate live
 * codes, and a writable one would let a coach mint their own free year). Fixture setup
 * therefore has to speak as the owner, which is exactly what the app does via the admin
 * SDK. Without this header the seed fails 403 "false for 'create'", which is the rule
 * working.
 */
const ADMIN = { Authorization: "Bearer owner" };

/**
 * Put the shared emulator back exactly as it was found.
 *
 * `threads.spec.ts` and `qualifications.spec.ts` both log in as Chandan AFTER this file
 * runs, and every suite shares one Firestore instance (playwright.config: workers: 1,
 * "one Firestore, shared state"). Leaving him a Leader would be this spec quietly
 * changing the world other specs are asserting about — the kind of cross-suite coupling
 * that surfaces later as a test that only fails in the full run.
 *
 * Deleting the tier document restores his real state precisely: `tiers` holds only the
 * coaches who moved, so absent IS Starter.
 */
test.afterAll(async () => {
  const gone = [
    docUrl(`tiers/${CHANDAN_ID}`),
    ...seeded.map((c) => docUrl(`promoCodes/${c}`)),
    ...seeded.map((c) => docUrl(`promoRedemptions/${c}__${CHANDAN_ID}`)),
  ];
  await Promise.all(
    gone.map((u) => fetch(u, { method: "DELETE", headers: ADMIN }).catch(() => undefined))
  );
});

async function readUses(code: string): Promise<number> {
  const res = await fetch(docUrl(`promoCodes/${code}`), { headers: ADMIN });
  const doc = (await res.json()) as { fields?: { uses?: { integerValue?: string } } };
  return Number(doc.fields?.uses?.integerValue ?? -1);
}

const redeem = (page: Page, code: string) =>
  page.evaluate(async (c) => {
    const r = await fetch("/api/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: c }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, code);

test("a stranger cannot redeem — the route refuses a session-less caller", async ({
  request,
}) => {
  const res = await request.post("/api/promo", { data: { code: "ANYTHING" } });
  expect(res.status()).toBe(401);
});

test("a code grants Leader once, and the second attempt changes nothing", async ({ page }) => {
  const code = `E2EONCE${Date.now().toString().slice(-6)}`;
  await seedCode(code, { leaderDays: 30, maxUses: 5, expiresKey: "2099-12-31" });
  await login(page, CHANDAN);

  const first = await redeem(page, code);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const granted = first.body as { endKey: string; leaderDays: number };
  expect(granted.leaderDays).toBe(30);
  expect(granted.endKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await readUses(code)).toBe(1);

  // The same tap again, which on a weak signal is how this feature is actually used.
  const second = await redeem(page, code);
  expect(second.status).toBe(400);
  expect((second.body as { error: string }).error).toMatch(/already used/i);
  // The count did NOT move. A burnt use with no grant would quietly shrink a launch.
  expect(await readUses(code)).toBe(1);

  // Lower case and spacing are the same code — it is read off a poster.
  const messy = await redeem(page, code.toLowerCase());
  expect(messy.status).toBe(400);
  expect((messy.body as { error: string }).error).toMatch(/already used/i);
});

test("the tier actually moves, and Settings says so without claiming a payment", async ({
  page,
}) => {
  const code = `E2ETIER${Date.now().toString().slice(-6)}`;
  await seedCode(code, { leaderDays: 45, maxUses: 5, expiresKey: "2099-12-31" });
  await login(page, CHANDAN);

  const res = await redeem(page, code);
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "My plan" })).toBeVisible();
  await expect(page.getByText("Leader", { exact: false }).first()).toBeVisible();
  // No subscription exists, so the card must NOT show mandate copy. A granted coach
  // being told about charges would be the money surprise arriving through the free door.
  await expect(page.getByText(/upi autopay mandate/i)).toHaveCount(0);
});

test("an expired code and an unknown code are refused identically", async ({ page }) => {
  const expired = `E2EOLD${Date.now().toString().slice(-6)}`;
  await seedCode(expired, { leaderDays: 30, maxUses: 5, expiresKey: "2020-01-01" });
  await login(page, CHANDAN);

  const a = await redeem(page, expired);
  const b = await redeem(page, "NOSUCHCODE");
  expect(a.status).toBe(400);
  expect(b.status).toBe(400);
  // A code is a bearer token; differing answers would let somebody probe which exist.
  expect((a.body as { error: string }).error).toBe((b.body as { error: string }).error);
  expect(await readUses(expired)).toBe(0);
});

test("a fully-used code says so, and stays at its cap", async ({ page }) => {
  const code = `E2ECAP${Date.now().toString().slice(-6)}`;
  await seedCode(code, { leaderDays: 30, maxUses: 1, expiresKey: "2099-12-31" });
  await login(page, CHANDAN);

  expect((await redeem(page, code)).status).toBe(200);
  expect(await readUses(code)).toBe(1);

  // Chandan cannot spend it twice anyway, but the cap must hold for anyone: the count
  // is what the next coach's redemption checks.
  const again = await redeem(page, code);
  expect(again.status).toBe(400);
  expect(await readUses(code)).toBe(1);
});

test("/plans offers the code field, calmly, with no celebration", async ({ page }) => {
  await login(page, CHANDAN);
  await page.goto("/plans");

  const opener = page.getByRole("button", { name: /have a code/i });
  await expect(opener).toBeVisible();
  await opener.click();

  await expect(page.getByLabel(/enter your code/i)).toBeVisible();
  // It must say what it is NOT, on a Trust Zone screen beside the buttons that charge.
  await expect(page.getByText(/never sets up a payment/i)).toBeVisible();
  await expect(page.getByText(/🎉/)).toHaveCount(0);
});
