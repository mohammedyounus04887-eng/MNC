"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCOPE_LABELS, THREAD_SCOPES, attribution, relativeTime, type ThreadScope } from "@/lib/threads";

/**
 * The inbox (F8): what this coach's line has sent them, newest first.
 *
 * Two actions per message and no more — acknowledge, and pass it on. There is no
 * reply, no reaction and no comment box, because v1 §5.5 / RULES S3 rule out group
 * chat and this is the screen where that would creep in one control at a time.
 *
 * ## Why acknowledge is the gold action
 *
 * G6 says a mechanic has to map to a behaviour we need repeated. The behaviour here
 * is a coach confirming they got the message, because that number is what tells an
 * upline whether their line is awake — and it is the only signal the app gives them,
 * since replies deliberately live elsewhere. So it gets the accent, and it is the
 * only accent on the row.
 *
 * Acknowledged is a terminal state on purpose: there is no un-acknowledge. Letting a
 * coach take it back would make the sender's count something that can go down, and a
 * number that moves both ways is one an upline stops trusting.
 */

export type FeedThread = {
  id: string;
  senderName: string;
  scope: string;
  body: string;
  linkUrl: string | null;
  originalSenderName: string | null;
  createdAt: string;
  acked: boolean;
};

function Attribution({ name }: { name: string | null }) {
  const via = attribution(name);
  if (!via) return null;
  return <span className="text-sm text-text-dim"> · {via}</span>;
}

export default function ThreadFeed({
  threads,
  canForward,
}: {
  threads: FeedThread[];
  /** False for a coach with nobody under them — there is nowhere to forward to. */
  canForward: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [forwarding, setForwarding] = useState("");
  const [error, setError] = useState("");

  const ack = async (id: string) => {
    if (busyId) return;
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/threads/${id}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ack: true }),
      });
      if (!res.ok) {
        setError("Could not save that. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusyId("");
    }
  };

  const forward = async (id: string, scope: ThreadScope) => {
    if (busyId) return;
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/threads/${id}/rebroadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) {
        setError("Could not pass that on. Please try again.");
        return;
      }
      setForwarding("");
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <ul className="flex flex-col gap-3">
      {threads.map((t) => (
        <li
          key={t.id}
          data-testid="thread-card"
          className={`rounded-2xl p-4 ${
            t.acked ? "bg-surface" : "border border-gold bg-elevated"
          }`}
        >
          <p className="text-sm">
            <span className="font-semibold">{t.senderName}</span>
            <Attribution name={t.originalSenderName} />
            <span className="text-text-dim"> · {relativeTime(new Date(t.createdAt))}</span>
          </p>

          {/* whitespace-pre-line so a coach's line breaks survive. The body is plain
              text and is never rendered as markup — it is written by one user and
              shown to their whole line. */}
          <p className="mt-2 whitespace-pre-line">{t.body}</p>

          {t.linkUrl && (
            <a
              href={t.linkUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-block min-h-12 py-3 font-medium text-gold-ink underline"
            >
              Open the link
            </a>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {t.acked ? (
              <span className="text-sm font-semibold text-gold-ink">✅ Acknowledged</span>
            ) : (
              <button
                data-testid="thread-ack"
                onClick={() => void ack(t.id)}
                disabled={busyId === t.id}
                className="h-12 rounded-xl bg-gold px-5 font-semibold text-on-gold disabled:opacity-50"
              >
                {busyId === t.id ? "Saving…" : "✅ Acknowledge"}
              </button>
            )}

            {canForward && (
              <button
                onClick={() => setForwarding(forwarding === t.id ? "" : t.id)}
                className="h-12 rounded-xl border border-hairline px-4 font-medium"
              >
                Pass it on
              </button>
            )}
          </div>

          {forwarding === t.id && (
            <div className="mt-3 rounded-xl border border-hairline p-3">
              <p className="text-sm text-text-dim">
                Send this to your own line. They will see it came from{" "}
                {t.originalSenderName ?? t.senderName}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {THREAD_SCOPES.map((s) => (
                  <button
                    key={s}
                    data-testid={`thread-forward-${s}`}
                    onClick={() => void forward(t.id, s)}
                    disabled={busyId === t.id}
                    className="min-h-12 rounded-xl border border-hairline bg-elevated px-4 py-3 font-medium disabled:opacity-50"
                  >
                    {SCOPE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </li>
      ))}

      {error && <p className="text-sm text-heat">{error}</p>}
    </ul>
  );
}
