"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n";

/**
 * The language chooser.
 *
 * ## Every option is written in its own script, always
 *
 * A coach who cannot read English cannot find "Kannada" in a list — but they can find
 * ಕನ್ನಡ. So the options are never translated: they show the same five native names
 * whatever the current language is, which means this control is usable even by somebody
 * who has landed in a language they cannot read and needs to get out of it. That is the
 * failure case a language switcher exists for, and translating the option labels would
 * break exactly it.
 *
 * The English name sits underneath in small text, for the common case of one person
 * setting up a phone for somebody else.
 *
 * ## Why the whole page reloads
 *
 * `router.refresh()` re-renders on the server with the new cookie, because the strings
 * live in server-rendered markup (see lib/i18n.ts). That is also why there is no
 * optimistic state here: the label a coach sees has to be the one the server actually
 * produced, not a guess that could disagree with it.
 *
 * Calm register, no accent, nothing animated — this is a settings row, not a reward.
 */
export default function LanguageSwitcher({
  current,
  title,
  help,
  savingLabel,
  errorLabel,
  reportNote,
}: {
  current: Locale;
  title: string;
  help: string;
  savingLabel: string;
  errorLabel: string;
  reportNote: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Locale | "">("");
  const [error, setError] = useState("");

  const choose = async (locale: Locale) => {
    if (busy || locale === current) return;
    setError("");
    setBusy(locale);
    try {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        setError(errorLabel);
        return;
      }
      router.refresh();
    } catch {
      setError(errorLabel);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-text-dim">{help}</p>

      <div className="mt-4 flex flex-col gap-2">
        {LOCALES.map((locale) => {
          const active = locale === current;
          const names = LOCALE_NAMES[locale];
          return (
            <button
              key={locale}
              data-testid={`language-${locale}`}
              onClick={() => void choose(locale)}
              disabled={busy !== ""}
              aria-pressed={active}
              // `lang` on the button so the browser picks the right font and shaping for
              // this option even while the page is in another language.
              lang={locale}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left disabled:opacity-50 ${
                active ? "border-text bg-elevated" : "border-hairline"
              }`}
            >
              <span>
                <span className="block font-medium">{names.native}</span>
                {names.native !== names.english && (
                  <span className="block text-sm text-text-dim">{names.english}</span>
                )}
              </span>
              {busy === locale ? (
                <span className="shrink-0 text-sm text-text-dim">{savingLabel}</span>
              ) : (
                active && <span className="shrink-0 text-sm">✓</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Honest about the one place the language does not apply yet — a coach who picks
          Kannada and then sends an English report card should know why. */}
      <p className="mt-3 text-sm text-text-dim">{reportNote}</p>
      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
