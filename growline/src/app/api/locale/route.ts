import { NextResponse } from "next/server";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "@/lib/i18n";

/**
 * Sets the language cookie.
 *
 * No session check, deliberately. A language preference is not private, it belongs to
 * the browser rather than the account, and requiring a login would mean the /login and
 * public capture screens — the first thing a new coach and every prospect ever sees —
 * could not be read in the reader's own language.
 *
 * The value is validated against the known locales rather than trusted, because it is
 * written to a cookie the server reads on every subsequent render. `httpOnly` is false
 * on purpose: nothing here is a credential, and a future client-side switcher may want
 * to read it without a round trip.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const locale = (body ?? {})?.locale;

  if (!isLocale(locale)) {
    return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set({
    name: LOCALE_COOKIE,
    value: locale,
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}
