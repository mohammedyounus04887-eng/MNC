"use client";

import { useState } from "react";
import { redeemedMessage } from "./model";

/**
 * "Have a code?" on /plans — a TRUST ZONE control (RULES G1).
 *
 * Flat, calm, no glow, no animation, and NO celebration even though the outcome is good
 * news. G1 does not carve out an exception for pleasant money events: this sits on the
 * pricing screen, beside the buttons that charge people, and a confetti burst here would
 * teach a coach that this screen celebrates — which is exactly the association the
 * Trust Zone exists to prevent one scroll above a mandate button.
 *
 * The success line says what happened AND what did not: Leader is on until a date,
 * nothing was charged, no payment method is connected. A grant that left somebody
 * wondering whether they had just started paying would be the money surprise v1 §4.7
 * is about, arriving through the door marked "free".
 *
 * Collapsed by default. A coach without a code should not have to read past an empty
 * field to reach the plans, and the 6-field ceiling (RULES S2) is about what a screen
 * asks of somebody, not what it hides behind one tap.
 */
export default function RedeemField() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; endKey?: string };
      if (!res.ok || !data.endKey) {
        setError(data.error ?? "Could not use that code.");
        return;
      }
      setDone(data.endKey);
    } catch {
      setError("Could not reach Growline. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section className="rounded-2xl border border-hairline p-5">
        <p className="font-medium">Code applied.</p>
        <p className="mt-1 text-sm text-text-dim">{redeemedMessage(done)}</p>
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 self-start px-1 text-sm text-text-dim underline"
      >
        Have a code?
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-hairline p-5">
      <label htmlFor="promo-code" className="font-medium">
        Enter your code
      </label>
      <p className="text-sm text-text-dim">
        A code adds free Leader days. It never sets up a payment and never charges you.
      </p>
      <input
        id="promo-code"
        name="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        // Codes are read off a poster and typed one-handed. The field does the
        // capitalising so the coach does not have to, and the server normalises anyway.
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="FOUNDING50"
        className="h-12 rounded-xl border border-hairline bg-transparent px-4 uppercase tracking-widest"
      />
      <button
        type="submit"
        disabled={busy || code.trim().length === 0}
        className="h-12 rounded-xl border border-hairline px-4 font-medium disabled:opacity-50"
      >
        {busy ? "Checking…" : "Apply code"}
      </button>
      {error && <p className="text-sm text-heat">{error}</p>}
    </form>
  );
}
