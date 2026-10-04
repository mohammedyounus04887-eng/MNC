import { test, expect, type Page } from "@playwright/test";

/**
 * Switching language, and the thing no unit test can check: whether the result FITS.
 *
 * The dictionaries are verified for completeness, placeholders and script by
 * `tests/i18n.test.ts`. What that cannot see is layout — a Kannada or Tamil nav label
 * runs longer than its English original, and five of them share a 360px row on the
 * phones this app targets. So the load-bearing assertion here is that the document
 * never scrolls sideways, in every language, which is the automated form of "does the
 * bottom nav break".
 *
 * Assertions are on SCRIPT, not on specific words. Every translator flagged wording they
 * were unsure about and those strings will change after a native-speaker review; a test
 * pinned to "ಮುಖಪುಟ" would fail on a legitimate copy fix and teach everybody to
 * distrust it.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/** Unicode blocks, so a translation can be recognised without pinning its words. */
const SCRIPTS = {
  kn: /[ಀ-೿]/,
  hi: /[ऀ-ॿ]/,
  ta: /[஀-௿]/,
  te: /[ఀ-౿]/,
} as const;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use phone OTP instead" }).click();
  await page.getByPlaceholder("98765 43210").fill("9000000002");
  await page.getByRole("button", { name: /get otp/i }).click();

  const codeField = page.getByPlaceholder("••••••");
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  const res = await fetch(
    `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`
  );
  const body = (await res.json()) as {
    verificationCodes: { phoneNumber: string; code: string }[];
  };
  const mine = body.verificationCodes.filter((c) => c.phoneNumber === "+919000000002");
  await codeField.fill(mine[mine.length - 1].code);
  await expect(page.getByRole("heading", { name: /hello, asha/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** True when the page scrolls sideways — always a layout bug on a phone. */
async function overflowsHorizontally(page: Page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    // 1px of slack for subpixel rounding, which is not a broken layout.
    return el.scrollWidth > el.clientWidth + 1;
  });
}

/**
 * Nav labels that are cut off inside the bar.
 *
 * "The page does not scroll sideways" and "the label is readable" are different claims.
 * The bottom nav is a fixed-height row, so a label too tall or too wide for its cell is
 * clipped SILENTLY — the page stays exactly 375px and the word is simply unreadable.
 * That is the failure mode a longer script actually produces here, so it gets its own
 * assertion rather than being assumed away by the overflow check.
 */
async function clippedNavLabels(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector("nav");
    if (!bar) return ["no nav element found"];
    const bad: string[] = [];
    for (const span of bar.querySelectorAll("span")) {
      const clippedDown = span.scrollHeight > span.clientHeight + 1;
      const clippedAcross = span.scrollWidth > span.clientWidth + 1;
      if (clippedDown || clippedAcross) {
        bad.push(
          `"${span.textContent}" (${span.scrollWidth}x${span.scrollHeight} in ` +
            `${span.clientWidth}x${span.clientHeight})`
        );
      }
    }
    return bad;
  });
}

test("a coach can switch language, and every language fits the phone", async ({ page }) => {
  await login(page);

  // Baseline: English, and already not overflowing.
  await page.goto("/settings");
  const nav = page.getByRole("navigation");
  await expect(nav).toContainText("Home");
  expect(await overflowsHorizontally(page)).toBe(false);

  for (const [locale, script] of Object.entries(SCRIPTS)) {
    await page.goto("/settings");
    await page.getByTestId(`language-${locale}`).click();

    // The nav is server-rendered, so the labels change only once the refresh lands.
    await expect
      .poll(async () => script.test((await nav.textContent()) ?? ""), {
        timeout: 20_000,
        message: `nav never rendered in ${locale}`,
      })
      .toBe(true);

    // `lang` drives the browser's font fallback and line breaking for these scripts,
    // and a screen reader picks its voice from it.
    await expect(page.locator("html")).toHaveAttribute("lang", `${locale}-IN`);

    // THE assertions: a longer label must wrap, not push the page sideways...
    expect(
      await overflowsHorizontally(page),
      `${locale} makes the page scroll sideways at ${page.viewportSize()?.width}px`
    ).toBe(false);
    // ...and must not be quietly cut off inside the fixed-height bar either.
    expect(
      await clippedNavLabels(page),
      `${locale} nav labels are clipped and unreadable`
    ).toEqual([]);

    // And the switcher itself stays readable in its own script, so a coach who lands
    // in a language they cannot read can still find their way out.
    await expect(page.getByTestId("language-en")).toContainText("English");
  }

  // Back to English, so the choice is proven reversible rather than one-way.
  await page.goto("/settings");
  await page.getByTestId("language-en").click();
  await expect(nav).toContainText("Home", { timeout: 20_000 });
});
