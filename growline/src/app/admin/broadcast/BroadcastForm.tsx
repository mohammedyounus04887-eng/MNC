"use client";

import { useState } from "react";
import { MAX_BODY } from "@/lib/threads";

const CONFIRM_PHRASE = "SEND TO EVERYONE";

/**
 * Sending an announcement to every coach on the platform.
 *
 * The typed confirmation is the point of this component. This is the widest-reach,
 * least-undoable action in the whole product — it lands in every inbox immediately and
 * there is no unsend — so it deliberately cannot be done by tapping a button twice. A
 * checkbox would be dismissed without reading; typing the phrase requires having noticed
 * what it says.
 */
export default function BroadcastForm({ reach }: { reach: number }) {
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<number | null>(null);

  const ready = body.trim().length > 0 && confirm === CONFIRM_PHRASE && !busy;

  const send = async () => {
    if (!ready) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, linkUrl: linkUrl.trim() || null, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send.");
        return;
      }
      setSent(data.reach ?? reach);
      setBody("");
      setLinkUrl("");
      setConfirm("");
    } catch {
      setError("Could not send. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent !== null) {
    return (
      <div className="rounded-lg border border-hairline p-5">
        <p className="font-semibold">Sent to {sent} coaches.</p>
        <p className="mt-1 text-sm text-text-dim">
          It is in their Threads tab now, and the acknowledgement count will rise there.
          This action is in the audit log.
        </p>
        <button
          onClick={() => setSent(null)}
          className="mt-4 h-11 rounded-lg border border-hairline px-4 font-medium"
        >
          Write another
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <label htmlFor="broadcast-body" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="broadcast-body"
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
          rows={5}
          className="mt-1 w-full rounded-lg border border-hairline bg-elevated p-3"
        />
        <p className="mt-1 text-right text-xs text-text-dim">
          {body.length}/{MAX_BODY}
        </p>
      </div>

      <div>
        <label htmlFor="broadcast-link" className="text-sm font-medium">
          Link (optional)
        </label>
        <input
          id="broadcast-link"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://…"
          className="mt-1 h-11 w-full rounded-lg border border-hairline bg-elevated px-3"
        />
      </div>

      <div className="rounded-lg border border-heat/40 p-4">
        <p className="text-sm">
          This goes to <b>all {reach} coaches</b> immediately. There is no unsend.
        </p>
        <label htmlFor="broadcast-confirm" className="mt-3 block text-sm text-text-dim">
          Type <b className="text-text">{CONFIRM_PHRASE}</b> to enable sending.
        </label>
        <input
          id="broadcast-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 h-11 w-full max-w-xs rounded-lg border border-hairline bg-elevated px-3"
        />
      </div>

      <button
        onClick={() => void send()}
        disabled={!ready}
        className="h-12 max-w-xs rounded-lg border border-hairline px-5 font-semibold disabled:opacity-40"
      >
        {busy ? "Sending…" : `Send to ${reach} coaches`}
      </button>

      {error && <p className="text-sm text-heat">{error}</p>}
    </div>
  );
}
