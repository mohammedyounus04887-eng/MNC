"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Connecting two coaches who are already a team in real life.
 *
 * This is the screen that unblocks bottom-up adoption. Before it, a coach who installed
 * the app before their upline did signed up with no referral code and became a permanent
 * root — there was no way to attach them afterwards, ever.
 *
 * ## Why both directions are offered
 *
 * You never know who installs first. The keen downline usually does, so "this coach is my
 * upline" is the common case — but a senior coach who finally joins needs to pull in people
 * who are already using the app, which is the other direction. One form, two directions,
 * because making a coach guess which screen they need is how a feature goes unused.
 *
 * ## Why it always waits for the other person
 *
 * Every request needs the other coach's yes, and the copy says so before anything is sent.
 * Attaching yourself under somebody would let you see their line; claiming somebody as your
 * downline would make their work visible to you. Either one on a single tap would let a
 * stranger with a guessed code help themselves.
 *
 * Calm register — no gold, nothing animated. This is a permissions screen.
 */

export type PendingRequest = {
  id: string;
  childName: string;
  parentName: string;
  /** True when this coach is the one who has to answer. */
  mineToAnswer: boolean;
  /** True when this coach would end up as the downline. */
  iAmTheChild: boolean;
};

export default function LinkLine({
  hasUpline,
  pending,
}: {
  hasUpline: boolean;
  pending: PendingRequest[];
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [direction, setDirection] = useState<"under" | "over">(
    // A coach who already has an upline can only be adding people below them.
    hasUpline ? "over" : "under"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const send = async () => {
    if (busy || code.trim().length === 0) return;
    setError("");
    setNote("");
    setBusy(true);
    try {
      const res = await fetch("/api/line-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), direction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send that request.");
        return;
      }
      setCode("");
      setNote(`Asked ${data.otherName}. It appears in their app for them to accept.`);
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  };

  const respond = async (id: string, action: "accept" | "decline" | "cancel") => {
    if (busy) return;
    setError("");
    setNote("");
    setBusy(true);
    try {
      const res = await fetch(`/api/line-requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not do that.");
        return;
      }
      if (action === "accept" && data.moved) {
        const { users, prospects } = data.moved as { users: number; prospects: number };
        setNote(
          users > 0
            ? `Linked. ${users} coach${users === 1 ? "" : "es"} below them moved across too.`
            : "Linked."
        );
        void prospects;
      }
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">Link my line</h2>
      <p className="mt-1 text-sm text-text-dim">
        Already a team outside the app? Connect using each other&apos;s invite codes. The
        other coach has to accept — nothing changes until they do.
      </p>

      {pending.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {pending.map((req) => (
            <li
              key={req.id}
              className="rounded-xl border border-hairline p-4"
              data-testid="line-request"
            >
              <p className="text-sm">
                <b>{req.childName}</b> would be in <b>{req.parentName}</b>&apos;s line.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {req.mineToAnswer ? (
                  <>
                    <button
                      data-testid="line-request-accept"
                      onClick={() => void respond(req.id, "accept")}
                      disabled={busy}
                      className="min-h-12 rounded-xl border border-hairline bg-elevated px-4 py-3 font-semibold disabled:opacity-50"
                    >
                      Yes, that&apos;s right
                    </button>
                    <button
                      onClick={() => void respond(req.id, "decline")}
                      disabled={busy}
                      className="min-h-12 rounded-xl px-4 py-3 font-medium text-text-dim disabled:opacity-50"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex min-h-12 items-center text-sm text-text-dim">
                      Waiting for them to accept
                    </span>
                    <button
                      onClick={() => void respond(req.id, "cancel")}
                      disabled={busy}
                      className="min-h-12 rounded-xl px-4 py-3 font-medium text-text-dim disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {!hasUpline && (
          <button
            onClick={() => setDirection("under")}
            aria-pressed={direction === "under"}
            className={`min-h-12 rounded-xl border px-4 py-3 text-left ${
              direction === "under" ? "border-text bg-elevated" : "border-hairline"
            }`}
          >
            <span className="font-medium">This coach is my upline</span>
            <span className="block text-sm text-text-dim">
              I joined without their code. Put me in their line.
            </span>
          </button>
        )}
        <button
          onClick={() => setDirection("over")}
          aria-pressed={direction === "over"}
          className={`min-h-12 rounded-xl border px-4 py-3 text-left ${
            direction === "over" ? "border-text bg-elevated" : "border-hairline"
          }`}
        >
          <span className="font-medium">This coach is in my line</span>
          <span className="block text-sm text-text-dim">
            They already use the app and joined without my code.
          </span>
        </button>
      </div>

      <input
        data-testid="line-request-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Their invite code"
        autoCapitalize="characters"
        autoComplete="off"
        className="mt-3 min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base tracking-widest"
      />

      <button
        data-testid="line-request-send"
        onClick={() => void send()}
        disabled={busy || code.trim().length === 0}
        className="mt-3 min-h-12 w-full rounded-xl border border-hairline px-5 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? "Sending…" : "Ask them to confirm"}
      </button>

      {hasUpline && (
        <p className="mt-3 text-sm text-text-dim">
          You are already in someone&apos;s line, so you can only add coaches below you.
        </p>
      )}
      {note && <p className="mt-3 text-sm">{note}</p>}
      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
