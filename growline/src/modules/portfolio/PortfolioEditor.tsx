"use client";

import { useState } from "react";
import {
  MAX_HEADLINE,
  MAX_SLUG,
  MAX_STORY,
  checkSlug,
  portfolioUrl,
  readyToPublish,
  suggestSlug,
} from "./model";

/**
 * The coach's side of their public page (F9).
 *
 * ## Four fields, and publishing is a separate decision
 *
 * Link name, headline, story, and a switch. Under the six-field limit (RULES S2) with
 * room left, which matters because this is the one screen a coach fills sitting down
 * rather than standing on a road — but it still should not become a form.
 *
 * `published` is its own control below the fields rather than an automatic consequence of
 * filling them in. A coach must never discover they have been publicly visible since the
 * afternoon they first typed a link name.
 *
 * ## The availability hint is a hint
 *
 * It asks the server whether a name is free as they type, and the answer can be stale by
 * the time they press save. That is fine and it is why the claim itself is transactional
 * on the server (D41) — this exists so the common case is answered before they commit,
 * not so the check can be skipped.
 */

type State = {
  slug: string;
  headline: string;
  story: string;
  published: boolean;
};

export default function PortfolioEditor({
  initial,
  coachName,
  siteUrl,
}: {
  initial: State;
  coachName: string;
  siteUrl: string;
}) {
  const [p, setP] = useState<State>({
    ...initial,
    // A coach opening this for the first time gets their own name in the box, editable.
    // Never auto-claimed — two coaches with the same name would race for it, and the
    // loser would be told their own name is taken by a claim they never made.
    slug: initial.slug || suggestSlug(coachName),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [free, setFree] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const slugCheck = checkSlug(p.slug);

  const set = <K extends keyof State>(key: K, value: State[K]) => {
    setP((s) => ({ ...s, [key]: value }));
    setSaved(false);
    if (key === "slug") setFree(null);
  };

  const checkAvailability = async () => {
    if (!slugCheck.ok) return;
    try {
      const res = await fetch(`/api/portfolio?check=${encodeURIComponent(slugCheck.value)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) setFree((await res.json()).free === true);
    } catch {
      // A failed hint is silent. It is not the check that matters, and an error here
      // would tell the coach something is broken when nothing is.
    }
  };

  const save = async (override?: Partial<State>) => {
    if (busy) return;
    const body = { ...p, ...override };
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      if (data.portfolio) setP(data.portfolio as State);
      setSaved(true);
    } catch {
      setError("No connection. Please try again when you have network.");
    } finally {
      setBusy(false);
    }
  };

  const url = slugCheck.ok ? portfolioUrl(siteUrl, slugCheck.value) : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Your link name</span>
          <div className="flex items-center gap-1 rounded-xl border border-hairline bg-elevated px-3">
            <span className="shrink-0 text-sm text-text-dim">{siteUrl.replace(/^https?:\/\//, "")}/</span>
            <input
              value={p.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase())}
              onBlur={checkAvailability}
              maxLength={MAX_SLUG}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="yourname"
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
            />
          </div>
          {p.slug && !slugCheck.ok && (
            <span className="text-sm text-heat">{slugCheck.error}</span>
          )}
          {slugCheck.ok && free === true && (
            <span className="text-sm text-gem-green">That one is free.</span>
          )}
          {slugCheck.ok && free === false && (
            <span className="text-sm text-heat">
              Somebody already has that. Try another.
            </span>
          )}
          <span className="text-sm text-text-dim">
            This goes on your reports and your QR poster, so pick one you are happy to read
            out loud. Changing it later breaks anything already printed.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-medium">
            One line about you <span className="font-normal text-text-dim">(optional)</span>
          </span>
          <input
            value={p.headline}
            onChange={(e) => set("headline", e.target.value)}
            maxLength={MAX_HEADLINE}
            placeholder="Helping people in Mysuru feel better"
            className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Your story</span>
          <textarea
            value={p.story}
            onChange={(e) => set("story", e.target.value)}
            maxLength={MAX_STORY}
            rows={6}
            placeholder="Why you started, who you help, what a first conversation is like."
            className="w-full rounded-xl border border-hairline bg-elevated px-4 py-3 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          <span className="text-sm text-text-dim">
            {MAX_STORY - p.story.length} left
          </span>
        </label>

        {error && (
          <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
        )}
        {saved && !error && (
          <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gem-green">Saved.</p>
        )}

        <button
          type="button"
          onClick={() => save()}
          disabled={busy || !slugCheck.ok}
          className="h-14 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Publishing is its own decision, with the consequence stated in the sentence next
          to it rather than in a help link. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-hairline p-4">
        <div className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-medium">
              {p.published ? "Your page is live" : "Your page is off"}
            </span>
            <span className="block text-sm text-text-dim">
              {p.published
                ? "Anyone with the link can see it, and search engines can find it."
                : "Nobody can see it yet — not even with the link."}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={p.published}
            aria-label="Show my page publicly"
            disabled={busy || !slugCheck.ok}
            /*
             * Saved immediately rather than left for the Save button — and NOT flipped
             * optimistically first.
             *
             * The obvious version sets local state, then saves. That renders "Your page
             * is live" before the server has agreed, so a coach on a slow connection
             * reads that their page is public while the request is still in flight — and
             * if it fails, the switch stays flipped over a page nobody can see. For this
             * particular control that is the worst available outcome, and it is the one
             * the honest version costs a few hundred milliseconds to avoid.
             *
             * `save()` replaces the whole state from the response, so the label follows
             * what was actually stored.
             */
            onClick={() => save({ published: !p.published })}
            className={`h-12 w-20 shrink-0 rounded-full border border-hairline transition-colors disabled:opacity-40 ${
              p.published ? "bg-gem-green" : "bg-elevated"
            }`}
          >
            <span
              aria-hidden="true"
              className={`block h-9 w-9 rounded-full bg-text transition-transform ${
                p.published ? "translate-x-9" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {!p.published && !readyToPublish(p) && (
          <p className="text-sm text-text-dim">
            Write a line or two about yourself first — a page with only a name does not say
            much.
          </p>
        )}

        {url && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            <code className="min-w-0 flex-1 truncate text-sm text-text/80">{url}</code>
            <button
              type="button"
              onClick={copy}
              className="h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            {p.published && (
              <a
                href={`/${slugCheck.ok ? slugCheck.value : ""}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center rounded-xl border border-hairline px-4 font-medium"
              >
                View
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
