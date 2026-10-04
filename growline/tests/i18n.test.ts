import { test, describe } from "node:test";
import assert from "node:assert/strict";

import en from "@/lib/dictionaries/en";
import kn from "@/lib/dictionaries/kn";
import hi from "@/lib/dictionaries/hi";
import ta from "@/lib/dictionaries/ta";
import te from "@/lib/dictionaries/te";
import {
  LOCALES,
  LOCALE_NAMES,
  LOCALE_TAGS,
  DEFAULT_LOCALE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/i18n";

/**
 * The `Dict` type already guarantees every key EXISTS in every language — a missing or
 * misspelled key is a build error. So this file tests only what the type system cannot
 * see, which turns out to be most of what actually goes wrong with translations:
 *
 *   - a key left in English because somebody copied en.ts and did not finish
 *   - an empty string, which the type accepts and which renders as nothing at all
 *   - a `{days}` placeholder dropped or renamed, so the number never appears
 *   - a string in the wrong script entirely
 *
 * Each of those ships silently. None of them is caught by `tsc`, and none of them is
 * caught by a screenshot unless somebody who reads that language looks at it.
 *
 * `next/headers` is deliberately not imported here: the dictionaries are read directly,
 * so this runs as a plain unit test with no request context.
 */

const DICTS: Record<Locale, Record<string, string>> = { en, kn, hi, ta, te };
const KEYS = Object.keys(en) as (keyof typeof en)[];

/**
 * The Unicode block each language must actually be written in. Assertion is "contains at
 * least one character from this block", NOT "contains only" — deliberately, because
 * "QR" stays in Latin in several of these translations, and a real product decision
 * should not be broken by an over-strict test.
 */
const SCRIPT_RANGES: Record<Exclude<Locale, "en">, [number, number]> = {
  kn: [0x0c80, 0x0cff], // Kannada
  hi: [0x0900, 0x097f], // Devanagari
  ta: [0x0b80, 0x0bff], // Tamil
  te: [0x0c00, 0x0c7f], // Telugu
};

const inScript = (text: string, [lo, hi_]: [number, number]) =>
  [...text].some((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= lo && cp <= hi_;
  });

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("every dictionary is complete and usable", () => {
  for (const locale of LOCALES) {
    test(`${locale}: no key is empty or whitespace`, () => {
      for (const key of KEYS) {
        const value = DICTS[locale][key];
        assert.equal(typeof value, "string", `${locale}.${key} is not a string`);
        assert.ok(
          value.trim().length > 0,
          `${locale}.${key} is empty — it would render as nothing`
        );
      }
    });

    test(`${locale}: placeholders survive translation exactly`, () => {
      for (const key of KEYS) {
        assert.deepEqual(
          placeholders(DICTS[locale][key]),
          placeholders(en[key]),
          `${locale}.${key} changed its placeholders. English: "${en[key]}" — ` +
            `${locale}: "${DICTS[locale][key]}". A renamed or dropped {name} means the ` +
            `value never appears on screen.`
        );
      }
    });
  }

  for (const locale of LOCALES.filter((l) => l !== "en") as Exclude<Locale, "en">[]) {
    test(`${locale}: nothing was left in English`, () => {
      const untranslated = KEYS.filter((key) => DICTS[locale][key] === en[key]);
      assert.deepEqual(
        untranslated,
        [],
        `${locale} still has the English string for: ${untranslated.join(", ")}`
      );
    });

    test(`${locale}: every string is written in its own script`, () => {
      for (const key of KEYS) {
        assert.ok(
          inScript(DICTS[locale][key], SCRIPT_RANGES[locale]),
          `${locale}.${key} = "${DICTS[locale][key]}" contains no ${locale} characters`
        );
      }
    });
  }
});

describe("locale metadata", () => {
  test("every locale has a native name, an English name and a BCP 47 tag", () => {
    for (const locale of LOCALES) {
      assert.ok(LOCALE_NAMES[locale]?.native.trim(), `${locale} has no native name`);
      assert.ok(LOCALE_NAMES[locale]?.english.trim(), `${locale} has no English name`);
      assert.match(LOCALE_TAGS[locale], /^[a-z]{2}-IN$/, `${locale} tag looks wrong`);
    }
  });

  test("each native name is written in its own script", () => {
    // This is the one that makes the switcher usable by somebody who has landed in a
    // language they cannot read: they find their own language by recognising the script.
    for (const [locale, range] of Object.entries(SCRIPT_RANGES)) {
      const native = LOCALE_NAMES[locale as Locale].native;
      assert.ok(
        inScript(native, range as [number, number]),
        `"${native}" is not written in ${locale}`
      );
    }
  });
});

describe("isLocale", () => {
  test("accepts the known locales and nothing else", () => {
    for (const locale of LOCALES) assert.equal(isLocale(locale), true);
    for (const bad of ["", "EN", "en-IN", "mr", "xx", null, undefined, 5, {}, ["en"]]) {
      assert.equal(isLocale(bad), false, `${JSON.stringify(bad)} must not be a locale`);
    }
  });
});

describe("localeFromAcceptLanguage", () => {
  test("takes the first supported language in the browser's stated order", () => {
    assert.equal(localeFromAcceptLanguage("kn-IN,kn;q=0.9,en;q=0.8"), "kn");
    assert.equal(localeFromAcceptLanguage("en-GB,en;q=0.9"), "en");
    // Unsupported first, supported second: the second must win rather than the default.
    assert.equal(localeFromAcceptLanguage("mr-IN,hi;q=0.9,en;q=0.8"), "hi");
  });

  test("matches the primary subtag, whatever the region or case", () => {
    assert.equal(localeFromAcceptLanguage("TA-IN"), "ta");
    assert.equal(localeFromAcceptLanguage("te-IN,te;q=0.9"), "te");
    assert.equal(localeFromAcceptLanguage("hi"), "hi");
  });

  test("falls back to English rather than guessing", () => {
    // A header full of Indian languages we do not support must NOT be answered with a
    // random Indian language. An Indian locale says nothing about which of twenty-two
    // languages somebody reads.
    assert.equal(localeFromAcceptLanguage("mr-IN,bn;q=0.9,gu;q=0.8"), DEFAULT_LOCALE);
    assert.equal(localeFromAcceptLanguage(null), DEFAULT_LOCALE);
    assert.equal(localeFromAcceptLanguage(""), DEFAULT_LOCALE);
    assert.equal(localeFromAcceptLanguage("   "), DEFAULT_LOCALE);
    assert.equal(localeFromAcceptLanguage("*"), DEFAULT_LOCALE);
  });
});
