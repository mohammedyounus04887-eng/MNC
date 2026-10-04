import { test, expect, type Page } from "@playwright/test";

/**
 * Design System 2.0 behaviours that are silent when broken (v2 §4, RULES G1–G6).
 *
 * These are not screenshot tests. Each one asserts a rule that has a *reason* —
 * the remaining arc, the banned blur, the income-free copy — so a future reskin
 * cannot quietly undo the reasoning along with the styling.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ASHA_PHONE = "9000000002";

async function loginAsAsha(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill(ASHA_PHONE);
  await page.getByRole("button", { name: /get otp/i }).click();
  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === `+91${ASHA_PHONE}`);
  await codeField.fill(mine[mine.length - 1].code);
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });
}

test("the target ring lights the REMAINING arc, not the completed one", async ({
  page,
}) => {
  await loginAsAsha(page);
  await page.goto("/targets");

  const ring = page.locator('[data-testid="target-ring"]');
  await expect(ring).toBeVisible();

  // Asha is at 420/400 = 105%, so nothing remains and the gold arc is empty.
  // If someone "fixes" this to fill clockwise, the dash length inverts and this
  // fails — which is the point (v2 §4, Zeigarnik).
  await expect(ring).toHaveAttribute("data-percent", "105");

  const dash = await ring.locator("circle").nth(1).getAttribute("stroke-dasharray");
  const remaining = Number(dash?.split(" ")[0]);
  expect(remaining).toBe(0);
});

test("no screen puts money next to a target (RULES L4)", async ({ page }) => {
  await loginAsAsha(page);
  // Home is included because v2 §4's own example copy for Today's Mission carries
  // a "₹-equivalent" that D40 deliberately did not build. This is what stops it
  // being reintroduced later by someone reading the spec literally.
  for (const path of ["/targets", "/"]) {
    await page.goto(path);
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text, `currency on ${path}`).not.toContain("₹");
    expect(text, `income wording on ${path}`).not.toMatch(
      /\bincome\b|\bearn(ing|ings)?\b|\bcommission\b|\bpayout\b/
    );
  }
});

test("Today's Mission renders actionable items from real data", async ({ page }) => {
  await loginAsAsha(page);
  await page.goto("/");

  const card = page.getByTestId("todays-mission");
  await expect(card).toBeVisible();

  // Never more than three — one item is not a list, four is a to-do app.
  const items = card.locator("li");
  expect(await items.count()).toBeLessThanOrEqual(3);

  // Every item must go somewhere: the card's whole job is one tap to the action.
  for (let i = 0; i < (await items.count()); i++) {
    await expect(items.nth(i).locator("a")).toHaveAttribute("href", /.+/);
  }
});

test("no screen uses backdrop-filter blur (RULES G4)", async ({ page }) => {
  await loginAsAsha(page);
  for (const path of ["/", "/log", "/targets", "/prospects", "/threads", "/settings"]) {
    await page.goto(path);
    const blurred = await page.evaluate(() =>
      [...document.querySelectorAll("*")].some((el) => {
        const s = getComputedStyle(el);
        const bf = s.backdropFilter || (s as unknown as Record<string, string>).webkitBackdropFilter;
        return !!bf && bf !== "none";
      })
    );
    expect(blurred, `backdrop-filter found on ${path}`).toBe(false);
  }
});

test("the settings theme switch actually flips the surface", async ({ page }) => {
  await loginAsAsha(page);
  await page.goto("/settings");

  /*
   * Asserted as a RELATIONSHIP, not as two hex values.
   *
   * This test twice pinned the palette of the day — first the v2 navy/white, and
   * a reskin failed it while the switch it tests worked perfectly. What must hold
   * is that the two themes paint DIFFERENT grounds and that light is the lighter
   * of the two; which exact colours those are is a design decision, and a design
   * decision changing should not read as a broken feature.
   */
  const bodyBg = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const luminance = (rgb: string) => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await bodyBg();

  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await bodyBg();

  expect(light).not.toBe(dark);
  expect(luminance(light)).toBeGreaterThan(luminance(dark));

  // The choice must survive a reload, or it is not a setting.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

/**
 * Contrast smoke test — the check that would have caught the alias bug.
 *
 * v2 §4 requires WCAG AA on the actual background. This is not a full audit; it
 * catches the failure mode that actually happened: a colour correct in one theme
 * rendering near-invisible in the other because a v1 name was aliased to a v2
 * token that flips meaning between themes. `bg-navy` was the real case — it
 * resolved to near-white and painted the app's mobile header white in dark mode.
 *
 * Colours are resolved through a canvas rather than parsed from the computed
 * string. Tailwind emits `oklab(… / 0.45)` for alpha utilities, and a regex over
 * that yields nonsense — the first version of this test failed on its own parsing
 * rather than on any real contrast problem. The canvas also composites alpha over
 * the background, which is what the eye actually sees.
 */
function luminance([r, g, b]: number[]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

for (const theme of ["dark", "light"] as const) {
  test(`visible text everywhere in ${theme} theme`, async ({ page }) => {
    await loginAsAsha(page);
    for (const path of ["/", "/log", "/targets", "/prospects", "/team", "/threads", "/settings"]) {
      await page.goto(path);
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);

      const pairs = await page.evaluate(() => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        const resolve = (css: string): number[] => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = "#000";
          ctx.fillStyle = css; // accepts oklab/oklch/rgba and normalises
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const over = (fg: number[], bg: number[]) =>
          [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));

        // A gradient paints the element but leaves backgroundColor transparent.
        // Without this the walk-up sails past a gold button and compares its dark
        // on-gold text against the dark surface behind it — which is exactly what
        // metal-gold does, and it reported as a contrast failure that was not one.
        const gradientColor = (css: string): number[] | null => {
          if (!css || !css.includes("gradient")) return null;
          const stops = css.match(/(?:rgba?|oklab|oklch|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}/g);
          if (!stops || stops.length === 0) return null;
          // The middle stop is what most of the surface actually shows.
          return resolve(stops[Math.floor(stops.length / 2)]);
        };

        const bgOf = (el: Element): number[] => {
          let node: Element | null = el;
          while (node) {
            const s = getComputedStyle(node);
            const grad = gradientColor(s.backgroundImage);
            if (grad && grad[3] > 0.5) return grad;
            const c = resolve(s.backgroundColor);
            if (c[3] > 0.5) return c;
            node = node.parentElement;
          }
          return [11, 16, 32, 1];
        };

        const out: { text: string; fg: number[]; bg: number[] }[] = [];
        for (const el of document.querySelectorAll("body *")) {
          const t = (el.textContent ?? "").trim();
          if (!t || el.children.length > 0) continue;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") continue;
          const bg = bgOf(el);
          out.push({ text: t.slice(0, 40), fg: over(resolve(s.color), bg), bg });
        }
        return out;
      });

      for (const { text, fg, bg } of pairs) {
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        // 2.0 is far below AA on purpose: this is an invisibility tripwire, not a
        // full audit. At or under it, text is the colour of its background.
        expect(ratio, `"${text}" on ${path} (${theme})`).toBeGreaterThan(2.0);
      }
    }
  });
}

test("the Weekly Recap shows counts and shares without money or rank", async ({
  page,
}) => {
  await loginAsAsha(page);
  await page.goto("/");

  const recap = page.getByTestId("weekly-recap");
  await expect(recap).toBeVisible();

  // Counts and a streak, nothing that reads as earnings (RULES L1, L4). This is
  // the most forwarded string the app produces, so it is the most likely to be
  // read by someone who never installed it.
  const text = (await recap.innerText()).toLowerCase();
  expect(text).not.toContain("₹");
  expect(text).not.toMatch(/\bincome\b|\bearn(ing|ings)?\b|\bcommission\b|\bpayout\b/);

  // Sharing falls back to wa.me when the Web Share API is absent — RULES S4, no
  // paid Business API ever.
  //
  // window.open is stubbed rather than the popup being followed: wa.me is not
  // reachable from a sandbox, so following it would assert the network rather
  // than the app. What matters is the URL the app asks for.
  await page.evaluate(() => {
    (window as unknown as { __opened?: string }).__opened = undefined;
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened?: string }).__opened = String(url);
      return null;
    }) as typeof window.open;
    // Force the fallback path even where the runner exposes Web Share.
    //
    // `delete navigator.share` does NOT work: `share` lives on Navigator.prototype,
    // so deleting an own property is a silent no-op. In headless Chromium there is
    // no `share` at all and the fallback ran anyway, which hid the bug; in a real
    // Chrome the app correctly called navigator.share and window.open never fired.
    // Redefining the property is what actually makes Web Share absent.
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  await page.getByTestId("recap-share").click();
  const opened = await page.evaluate(
    () => (window as unknown as { __opened?: string }).__opened
  );
  expect(opened).toContain("wa.me/?text=");
  expect(decodeURIComponent(opened ?? "")).not.toContain("₹");
});
