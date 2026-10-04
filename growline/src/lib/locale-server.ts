import { cookies, headers } from "next/headers";
import en, { type Dict, type MessageKey } from "./dictionaries/en";
import kn from "./dictionaries/kn";
import hi from "./dictionaries/hi";
import ta from "./dictionaries/ta";
import te from "./dictionaries/te";
import {
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./i18n";

/**
 * SERVER ONLY — this imports `next/headers`.
 *
 * Named `-server` for the same reason D25/RULES E2 splits the query modules: the
 * failure mode of importing this from a `"use client"` file is a confusing build
 * error, and a filename is the cheapest possible warning. Client components receive
 * translated strings as PROPS from a server component; they never look a locale up
 * themselves, which also keeps five dictionaries out of the browser bundle.
 */

const DICTIONARIES: Record<Locale, Dict> = { en, kn, hi, ta, te };

/**
 * The coach's language: their explicit choice, else what their browser asks for, else
 * English.
 *
 * The `Accept-Language` fallback only matters on the very first request. It is worth
 * having anyway — a coach whose phone is already set to Kannada should not have to find
 * a settings screen written in English in order to read the app in Kannada.
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

/** Substitutes `{name}` placeholders. Anything unmatched is left alone rather than blanked. */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole
  );
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * The translator for this request.
 *
 * Falls back to English per KEY, not per dictionary. A missing or accidentally-empty
 * string then shows the English word rather than a raw key like `nav.prospects` —
 * because a coach seeing a dotted identifier in their navigation bar is a worse outcome
 * than a coach seeing one English word among their own language. The `Dict` type makes
 * a missing key a build error, so this only fires for an empty string.
 */
export async function getTranslate(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  const dict = DICTIONARIES[locale] ?? en;
  const t: Translate = (key, vars) => format(dict[key] || en[key], vars);
  return { locale, t };
}
