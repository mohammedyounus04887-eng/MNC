import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";

import {
  cardFonts,
  scriptsIn,
  CARD_FONT_FAMILY,
  type ScriptKey,
} from "@/lib/report-fonts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  ReportCard,
  ReportPreview,
} from "@/lib/report-card";
import { computeWellness } from "@/lib/wellness";

/**
 * The report fonts (v2 §5.5, D66).
 *
 * ## What is actually being defended here
 *
 * Before this, `next/og` shipped one face — Geist Regular — and reached for
 * `fonts.googleapis.com/css2?family=…&text=<the string>` whenever it met a glyph
 * that face did not have. On a Devanagari or Kannada name that request **carried the
 * prospect's name to Google**, on the render path, every time the card was drawn.
 *
 * So the load-bearing test in this file is not "the fonts parse". It is
 * `renders … with no network at all`, below, paired with its control. The control is
 * what makes the pair mean anything: it proves the same render, minus our fonts,
 * really does try to reach the network — so a green run of the first test is
 * evidence and not a tautology.
 *
 * ## Why the assertions are about coverage rather than about pixels
 *
 * A PNG comparison would pin the test to a satori version and to a hinting
 * decision, and it would fail on a legitimate font update. What matters is: can this
 * face draw this code point, and did satori get handed anything it could not draw.
 * Both are answerable exactly, from the font's own `cmap`.
 */

const FONT_DIR = join(process.cwd(), "assets", "fonts");

/** Mirrors `SCRIPTS` in the module. Deliberately restated, so a file dropped from
 *  `assets/fonts/` fails here rather than only at render time in production. */
const SHIPPED: { key: ScriptKey; file: string; sample: string }[] = [
  { key: "latin", file: "NotoSans", sample: "Ramesh Kumar" },
  { key: "devanagari", file: "NotoSansDevanagari", sample: "श्रीनिवास" },
  { key: "kannada", file: "NotoSansKannada", sample: "ಶ್ರೀನಿವಾಸ" },
  { key: "tamil", file: "NotoSansTamil", sample: "முருகன்" },
  { key: "telugu", file: "NotoSansTelugu", sample: "శ్రీనివాస్" },
];

/* ------------------------------------------------------------------ *
 * The files themselves
 * ------------------------------------------------------------------ */

test("every shipped script has a regular and a bold TTF on disk", () => {
  for (const { file } of SHIPPED) {
    for (const weight of ["Regular", "Bold"]) {
      const path = join(FONT_DIR, `${file}-${weight}.ttf`);
      assert.ok(existsSync(path), `missing font file: ${file}-${weight}.ttf`);

      const bytes = readFileSync(path);
      // sfnt version 0x00010000 is a TrueType outline font. satori cannot parse
      // woff2, so a well-meaning "optimisation" that swaps these for woff2 has to
      // fail loudly here rather than silently at render time.
      assert.equal(
        bytes.readUInt32BE(0),
        0x00010000,
        `${file}-${weight}.ttf is not a TrueType font`
      );
      assert.ok(bytes.length > 20_000, `${file}-${weight}.ttf looks truncated`);
    }
  }
});

test("the font licence ships with the fonts", () => {
  // SIL Open Font License 1.1. Redistributing the binaries without it is the one
  // way this directory could become a licensing problem.
  const ofl = join(FONT_DIR, "OFL.txt");
  assert.ok(existsSync(ofl), "assets/fonts/OFL.txt is missing");
  assert.match(readFileSync(ofl, "utf8"), /SIL OPEN FONT LICENSE/i);
});

/* ------------------------------------------------------------------ *
 * Which faces get loaded
 * ------------------------------------------------------------------ */

test("scriptsIn always includes latin, and adds only the scripts present", () => {
  assert.deepEqual(scriptsIn(["Ramesh", "Bengaluru"]), ["latin"]);
  assert.deepEqual(scriptsIn(["ಶ್ರೀನಿವಾಸ"]), ["latin", "kannada"]);
  assert.deepEqual(scriptsIn(["श्रीनिवास"]), ["latin", "devanagari"]);
  assert.deepEqual(scriptsIn(["முருகன்"]), ["latin", "tamil"]);
  assert.deepEqual(scriptsIn(["శ్రీనివాస్"]), ["latin", "telugu"]);

  // Latin is not optional even when no Latin appears in the variable text: the
  // labels, the disclaimer and every digit on the card are Latin.
  assert.ok(scriptsIn(["ಶ್ರೀ"]).includes("latin"));
});

test("scriptsIn handles a mixed card and ignores absent fields", () => {
  // A Kannada coach with a Hindi-speaking prospect is an ordinary case, not an
  // edge one — and `city` is nullable on every card.
  assert.deepEqual(scriptsIn(["ಶ್ರೀ", "श्री", null, undefined, ""]), [
    "latin",
    "devanagari",
    "kannada",
  ]);
});

test("cardFonts returns a real 400 and a real 700 for each loaded script", async () => {
  const latin = await cardFonts(["Ramesh"]);
  assert.equal(latin.fonts.length, 2);
  assert.deepEqual(
    latin.fonts.map((f) => f.weight).sort(),
    [400, 700]
  );

  const kannada = await cardFonts(["ಶ್ರೀನಿವಾಸ"]);
  assert.equal(kannada.fonts.length, 4, "latin pair + kannada pair");
  assert.equal(kannada.fonts.filter((f) => f.weight === 700).length, 2);
});

test("each script is registered under its OWN family name", async () => {
  // This is the whole trick, and the obvious alternative is silently broken.
  //
  // Registering every face as "Noto Sans" reads like the right answer — one family,
  // let satori pick per glyph. satori instead keeps ONE face per
  // (family, weight, style), so the Indic faces are dropped on load and the render
  // goes to Google anyway. Measured: with a shared name, all four Indic scripts
  // still fetched; with distinct names, none did.
  //
  // If this assertion is ever "simplified" back to a single name, the network leak
  // returns and only `renders with no network` will catch it.
  const { fonts } = await cardFonts(["ಶ್ರೀನಿವಾಸ", "श्रीनिवास"]);
  assert.equal(fonts.length, 6);
  const names = [...new Set(fonts.map((f) => f.name))].sort();
  assert.deepEqual(names, ["Noto Sans", "Noto Sans Devanagari", "Noto Sans Kannada"]);
  // The card names exactly one of them; the rest are reached by fallback.
  assert.equal(CARD_FONT_FAMILY, "Noto Sans");
});

test("the handed-over buffer is the whole font and nothing else", async () => {
  // Buffers are views into a shared pool. Passing `.buffer` without slicing at the
  // byteOffset hands satori the pool — megabytes of unrelated memory, and a font it
  // cannot parse.
  const { fonts } = await cardFonts(["Ramesh"]);
  const onDisk = readFileSync(join(FONT_DIR, "NotoSans-Regular.ttf"));
  const regular = fonts.find((f) => f.weight === 400)!;
  assert.equal(regular.data.byteLength, onDisk.length);
  assert.equal(Buffer.from(regular.data).readUInt32BE(0), 0x00010000);
});

/* ------------------------------------------------------------------ *
 * Coverage — the guarantee that satori is never sent looking
 * ------------------------------------------------------------------ */

test("Latin coverage includes the characters the card actually prints", async () => {
  const { safe } = await cardFonts(["Ramesh"]);
  // Every one of these is on a real card: the rupee sign, the middle dot in
  // "Coach · Bengaluru", the en dash in "22.4–24.9", the ellipsis, and the accented
  // letters that appear in transliterated Indian names.
  for (const s of [
    "Ramesh Kumar",
    "₹ 1,299",
    "Coach · Bengaluru",
    "22.4–24.9",
    "naïve Kōkila",
    "—–…•",
    "+91 98765 43210",
  ]) {
    assert.equal(safe(s), s, `Latin face should cover: ${s}`);
  }
});

test("an Indic name survives untouched once its face is loaded", async () => {
  for (const { key, sample } of SHIPPED) {
    if (key === "latin") continue;
    const { safe } = await cardFonts([sample]);
    assert.equal(safe(sample), sample, `${key} should round-trip unchanged`);
  }
});

test("a script we do NOT ship is replaced rather than fetched", async () => {
  // Bengali. This is the case that used to leave the server for Google. Replacement
  // marks are the deliberate trade (D66): a name we cannot draw is a cosmetic
  // failure, a name we send to a third party is not.
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (msg: unknown) => void warnings.push(String(msg));
  try {
    const { safe } = await cardFonts(["আবীর"]);
    const out = safe("আবীর");
    assert.notEqual(out, "আবীর");
    assert.equal(out, "����");
  } finally {
    console.warn = realWarn;
  }
  // The operator signal matters as much as the substitution: this line is how
  // anyone finds out a script needs adding.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /outside the shipped fonts/);
});

test("zero-width characters never become visible boxes", async () => {
  // ZWJ and ZWNJ are ordinary parts of correctly typed Indic text, and a BOM can
  // ride in on a pasted name. Whether a given face happens to carry a cmap entry
  // for one is not the point — the contract is that nothing invisible is ever
  // turned into something visible.
  const { safe } = await cardFonts(["ಶ್ರೀನಿವಾಸ"]);
  for (const zw of ["​", "‌", "‍", "⁠", "﻿"]) {
    const out = safe(`Ram${zw}esh`);
    assert.ok(!out.includes("�"), `${escape(zw)} became a replacement mark`);
    assert.equal(out.replace(/[​-‏⁠﻿]/g, ""), "Ramesh");
  }
  // And a genuinely undrawable character still is replaced — the rule above is a
  // carve-out for invisibles, not a hole.
  assert.ok(safe("আ").includes("�"));
});

test("safeOrNull passes a null city straight through", async () => {
  const { safeOrNull } = await cardFonts(["Ramesh"]);
  assert.equal(safeOrNull(null), null);
  assert.equal(safeOrNull("Bengaluru"), "Bengaluru");
});

/* ------------------------------------------------------------------ *
 * The render, with the network taken away
 * ------------------------------------------------------------------ */

/** Renders two lines — one at 400, one at 700 — and reports any fetch attempted. */
async function renderWithNoNetwork(
  text: string,
  fonts: Awaited<ReturnType<typeof cardFonts>>["fonts"] | null
): Promise<{ png: Buffer | null; attempted: string[]; error: string | null }> {
  const attempted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : ((input as { url?: string })?.url ?? String(input));
    // resvg and yoga arrive as `data:` URIs through this same function. Blocking
    // those would fail the render for a reason that has nothing to do with fonts —
    // and, worse, would make the assertion order-dependent, since the WASM is
    // cached after the first render in the process.
    if (!/^https?:/i.test(url)) {
      return (realFetch as (a: unknown, b: unknown) => Promise<Response>)(input, init);
    }
    attempted.push(url);
    throw new Error(`network blocked in test: ${url}`);
  }) as typeof fetch;

  try {
    const el = createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          width: 900,
          height: 300,
          backgroundColor: "#FFFFFF",
          padding: 30,
          ...(fonts ? { fontFamily: CARD_FONT_FAMILY } : {}),
        },
      },
      createElement("div", { style: { display: "flex", fontSize: 48, fontWeight: 400 } }, text),
      createElement("div", { style: { display: "flex", fontSize: 48, fontWeight: 700 } }, text)
    );
    const buf = Buffer.from(
      await new ImageResponse(el, {
        width: 900,
        height: 300,
        ...(fonts ? { fonts } : {}),
      }).arrayBuffer()
    );
    return { png: buf, attempted, error: null };
  } catch (err) {
    return { png: null, attempted, error: String(err) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("CONTROL: without our fonts, an Indic name really does reach for Google", async () => {
  // Without this control the test below proves nothing — a render that never needed
  // the network would pass it trivially. This asserts the leak is real and that the
  // stub is on the path that leaks.
  const { attempted } = await renderWithNoNetwork("ಶ್ರೀನಿವಾಸ", null);
  assert.ok(
    attempted.some((u) => u.includes("fonts.googleapis.com")),
    `expected a Google Fonts request, saw: ${JSON.stringify(attempted)}`
  );
});

test("every shipped script renders with no network at all", async () => {
  for (const { key, sample } of SHIPPED) {
    const { fonts } = await cardFonts([sample]);
    const { png, attempted, error } = await renderWithNoNetwork(sample, fonts);
    assert.equal(error, null, `${key} render failed: ${error}`);
    assert.deepEqual(
      attempted,
      [],
      `${key} rendered but attempted ${JSON.stringify(attempted)}`
    );
    assert.ok(png && png.length > 1000, `${key} produced no real PNG`);
    // PNG magic — a truncated or error body would not carry it.
    assert.equal(png!.subarray(1, 4).toString("latin1"), "PNG");
  }
});

test("bold survives the fallback into an Indic face", async () => {
  // The fallback has to carry the requested weight with it. If it did not, a
  // Kannada name would quietly render regular on a card whose Latin names render
  // bold — which is exactly the "non-Latin names must render bold" clause in
  // v2 §5.5, and is invisible unless someone reads Kannada.
  const { fonts } = await cardFonts(["ಶ್ರೀನಿವಾಸ"]);
  const both = await renderWithNoNetwork("ಶ್ರೀನಿವಾಸ", fonts);
  const regularOnly = await renderWithNoNetwork(
    "ಶ್ರೀನಿವಾಸ",
    fonts.filter((f) => f.weight === 400)
  );
  assert.equal(both.error, null);
  assert.deepEqual(both.attempted, []);
  assert.ok(
    !both.png!.equals(regularOnly.png!),
    "the Kannada bold face is not reaching satori through the fallback"
  );
});

/* ------------------------------------------------------------------ *
 * The real card, end to end
 * ------------------------------------------------------------------ */

/** Blocks remote traffic around one render and reports what it tried to reach. */
async function withoutNetwork<T>(
  fn: () => Promise<T>
): Promise<{ value: T | null; attempted: string[]; error: string | null }> {
  const attempted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : ((input as { url?: string })?.url ?? String(input));
    if (!/^https?:/i.test(url)) {
      return (realFetch as (a: unknown, b: unknown) => Promise<Response>)(input, init);
    }
    attempted.push(url);
    throw new Error(`network blocked in test: ${url}`);
  }) as typeof fetch;
  try {
    return { value: await fn(), attempted, error: null };
  } catch (err) {
    return { value: null, attempted, error: String(err) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the real card draws an Indic prospect and an Indic coach, offline", async () => {
  // Not a synthetic div: the actual component, with the actual metrics, at the
  // actual 1080×1620. This is the one that would catch the header's name split
  // overflowing, or a face that parses but cannot lay out.
  const metrics = computeWellness({
    age: 34,
    gender: "female",
    heightCm: 162,
    weightKg: 64,
  });

  for (const [prospect, coach, city] of [
    ["ಶ್ರೀನಿವಾಸ", "ಪ್ರಿಯಾ ಶರ್ಮಾ", "ಬೆಂಗಳೂರು"],
    ["श्रीनिवास", "प्रिया शर्मा", "मुंबई"],
    ["முருகன்", "பிரியா சர்மா", "சென்னை"],
    ["శ్రీనివాస్", "ప్రియా శర్మ", "హైదరాబాద్"],
    // The realistic everyday case: a romanised name and an English city.
    ["Ramesh", "Priya Sharma", "Bengaluru"],
  ]) {
    const { fonts, safe, safeOrNull } = await cardFonts([prospect, coach, city]);
    const { value, attempted, error } = await withoutNetwork(() =>
      new ImageResponse(
        createElement(ReportCard, {
          firstName: safe(prospect),
          metrics,
          coach: {
            name: safe(coach),
            photoUrl: null,
            city: safeOrNull(city),
            phone: "+919876543210",
          },
          nextStep: "One small step this week.",
        }),
        { width: CARD_WIDTH, height: CARD_HEIGHT, fonts }
      ).arrayBuffer()
    );

    assert.equal(error, null, `card for ${prospect} failed: ${error}`);
    assert.deepEqual(attempted, [], `card for ${prospect} went to the network`);
    const png = Buffer.from(value!);
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    // A blank or near-blank canvas compresses to almost nothing. A drawn card at
    // this size does not.
    assert.ok(png.length > 20_000, `card for ${prospect} looks empty (${png.length}B)`);
  }
});

test("the link preview draws an Indic coach name, offline", async () => {
  const coach = "ಪ್ರಿಯಾ ಶರ್ಮಾ";
  const { fonts, safe } = await cardFonts([coach]);
  const { value, attempted, error } = await withoutNetwork(() =>
    new ImageResponse(createElement(ReportPreview, { coachName: safe(coach) }), {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      fonts,
    }).arrayBuffer()
  );
  assert.equal(error, null, String(error));
  assert.deepEqual(attempted, []);
  assert.ok(Buffer.from(value!).length > 5_000);
});

test("fontWeight 700 now changes the pixels", async () => {
  // D18's finding was that `fontWeight: 700` against a single 400-weight face was a
  // silent no-op producing a byte-identical PNG. With a real bold face loaded, the
  // same element must not render identically to one drawn with regular only.
  const { fonts } = await cardFonts(["Ramesh"]);
  const both = await renderWithNoNetwork("Ramesh 24.9", fonts);
  const regularOnly = await renderWithNoNetwork(
    "Ramesh 24.9",
    fonts.filter((f) => f.weight === 400)
  );
  assert.equal(both.error, null);
  assert.equal(regularOnly.error, null);
  assert.ok(
    !both.png!.equals(regularOnly.png!),
    "bold is still a no-op — the 700 face is not reaching satori"
  );
});
