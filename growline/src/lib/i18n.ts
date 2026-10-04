/**
 * Language selection (v1 §8, brought forward).
 *
 * ## Why a cookie and not localStorage
 *
 * The theme is a `localStorage` value applied by a blocking script before paint
 * (ThemeScript), and that works because a theme is only CSS — the server can ship
 * one markup tree and let the browser recolour it.
 *
 * Language is not like that. The strings are IN the markup, and this app
 * server-renders nearly every screen, so the server has to know the language while it
 * renders. `localStorage` does not exist there. A cookie does, so a cookie it is —
 * which also means no flash of English and no layout shift when a longer Kannada word
 * replaces a short English one.
 *
 * ## Why no URL prefix
 *
 * The obvious Next pattern is `/[locale]/...`. It is wrong here: the public portfolio
 * lives at the ROOT — `growline.in/<username>` (F9) — so a locale segment would be
 * indistinguishable from a coach's username, and every prospect-facing link would have
 * to grow a prefix. The cookie keeps the public URLs exactly as F9 specifies.
 *
 * ## Why hand-rolled and not a library
 *
 * Five languages and a flat dictionary. A library would add a dependency, a build step
 * and a plural-rules engine to solve a problem this app does not have — the counts it
 * displays are already rendered as bare numerals next to a label. If genuine plural or
 * gender agreement is ever needed, revisit; a `Intl.PluralRules` call is the next step,
 * not a framework.
 *
 * ## What is deliberately NOT translated
 *
 * The wellness report card and PDF. They are rendered as images by satori, which has no
 * Indic shaper — Devanagari, Kannada, Tamil and Telugu all come out with vowel marks
 * misplaced and conjuncts broken, and committing fonts does not fix that (v2.3 fonts
 * investigation). A translated report would look worse than an English one, and the
 * report is the coach's first impression on a prospect. Revisit when the renderer can
 * shape these scripts.
 */

export const LOCALES = ["en", "kn", "hi", "ta", "te"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** The cookie the server reads while rendering. Not a session value; 1 year. */
export const LOCALE_COOKIE = "gl_lang";
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Each language named IN ITSELF, which is the only labelling that works.
 *
 * A coach who cannot read English cannot find "Kannada" in a list — but they can find
 * ಕನ್ನಡ. The English name is kept alongside for the person setting up a phone for
 * somebody else, which on a shared family device is common.
 */
export const LOCALE_NAMES: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  kn: { native: "ಕನ್ನಡ", english: "Kannada" },
  hi: { native: "हिन्दी", english: "Hindi" },
  ta: { native: "தமிழ்", english: "Tamil" },
  te: { native: "తెలుగు", english: "Telugu" },
};

/** BCP 47 tags, for `lang` on <html> — screen readers and hyphenation depend on it. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-IN",
  kn: "kn-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a locale from an `Accept-Language` header, for a coach's very first request
 * before they have chosen anything.
 *
 * Deliberately simple: match the primary subtag only, in the browser's stated order of
 * preference. `kn-IN`, `kn` and `KN` all mean Kannada, and nothing here needs to
 * distinguish regional variants because there is one dictionary per language.
 *
 * Falls back to English rather than guessing from the country — an Indian IP says
 * nothing about which of twenty-two languages somebody reads.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
