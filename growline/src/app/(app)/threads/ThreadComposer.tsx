"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_BODY,
  SCOPE_HELP,
  SCOPE_LABELS,
  THREAD_SCOPES,
  audienceLabel,
  type ThreadScope,
} from "@/lib/threads";

/**
 * Writing a broadcast (F8).
 *
 * Three inputs — message, who it goes to, an optional link — which keeps this well
 * inside the six-field cap (S2) and inside the 30-second rule (S1): a coach standing
 * at a club types a line, taps a scope, taps send.
 *
 * ## Why the scope buttons say the count out loud
 *
 * "My direct line" and "My whole line" are the words a coach uses, but only they
 * know which one they meant — and the difference is 4 people or 400. Naming the
 * number under each button turns an abstract choice into a concrete one BEFORE it is
 * irreversible. There is no unsend: a broadcast is delivered the instant it is
 * written, and this is where a mistake gets caught.
 *
 * Nothing here is optimistic. The list refreshes from the server after a send, so
 * what a coach sees in "Sent" is what their line actually received.
 */
export default function ThreadComposer({
  directCount,
  lineCount,
}: {
  directCount: number;
  lineCount: number;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<ThreadScope>("direct");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const countFor = (s: ThreadScope) => (s === "direct" ? directCount : lineCount);
  const audience = countFor(scope);
  const canSend = body.trim().length > 0 && audience > 0 && !busy;

  const send = async () => {
    if (!canSend) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, body, linkUrl: linkUrl.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send. Please try again.");
        return;
      }
      setBody("");
      setLinkUrl("");
      setShowLink(false);
      router.refresh();
    } catch {
      setError("No connection. Your message has not been sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">Send a message to your line</h2>
      <p className="mt-1 text-sm text-text-dim">
        They can tap to acknowledge. Replies happen on WhatsApp or in person.
      </p>

      <textarea
        data-testid="thread-body"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        rows={4}
        placeholder="What do you want your line to know?"
        className="mt-4 w-full rounded-xl border border-hairline bg-elevated p-3 text-base"
      />
      <p className="mt-1 text-right text-xs text-text-dim">
        {body.length}/{MAX_BODY}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {THREAD_SCOPES.map((s) => {
          const active = scope === s;
          return (
            <button
              key={s}
              data-testid={`thread-scope-${s}`}
              onClick={() => setScope(s)}
              aria-pressed={active}
              className={`min-h-12 rounded-xl border px-4 py-3 text-left ${
                active ? "border-gold bg-elevated" : "border-hairline"
              }`}
            >
              <span className="font-medium">{SCOPE_LABELS[s]}</span>
              <span className="block text-sm text-text-dim">
                {SCOPE_HELP[s]} {audienceLabel(countFor(s), s)}.
              </span>
            </button>
          );
        })}
      </div>

      {showLink ? (
        <input
          data-testid="thread-link"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          inputMode="url"
          placeholder="https://…"
          className="mt-3 min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base"
        />
      ) : (
        <button
          onClick={() => setShowLink(true)}
          className="mt-3 min-h-12 px-1 py-3 text-left font-medium text-text-dim"
        >
          + Add a link (video, voice note, poster)
        </button>
      )}

      <button
        data-testid="thread-send"
        onClick={() => void send()}
        disabled={!canSend}
        className="mt-4 h-14 w-full rounded-xl bg-gold px-5 text-lg font-semibold text-on-gold disabled:opacity-50"
      >
        {busy ? "Sending…" : `Send to ${audienceLabel(audience, scope)}`}
      </button>

      {audience === 0 && (
        <p className="mt-3 text-sm text-text-dim">
          Invite a coach with your referral code and they will appear here.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
