"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_LEADER_DAYS } from "@/modules/promo/model";

/**
 * Minting a code (F12). Internal tooling, so plain — no design system, matching every
 * other admin screen.
 *
 * Defaults are deliberately modest: 30 days, 50 uses. The mistake this shape guards
 * against is an admin at 11pm before a launch typing an extra zero into a field that
 * gives away free Leader; a default of 30 makes the common case one tap, and the
 * server bounds the rest.
 */
export default function MintForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minted, setMinted] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMinted("");
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          leaderDays: Number(form.get("leaderDays")),
          maxUses: Number(form.get("maxUses")),
          expiresKey: form.get("expiresKey"),
          note: form.get("note"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: { code: string };
      };
      if (!res.ok || !data.code) {
        setError(data.error ?? "Could not create that code.");
        return;
      }
      setMinted(data.code.code);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-hairline p-5">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Code
          <input
            name="code"
            required
            placeholder="FOUNDING50"
            autoCapitalize="characters"
            className="h-10 rounded border border-hairline bg-transparent px-3 uppercase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Leader days
          <input
            name="leaderDays"
            type="number"
            min={1}
            max={MAX_LEADER_DAYS}
            defaultValue={30}
            required
            className="h-10 w-32 rounded border border-hairline bg-transparent px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Max uses
          <input
            name="maxUses"
            type="number"
            min={1}
            defaultValue={50}
            required
            className="h-10 w-32 rounded border border-hairline bg-transparent px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Expires
          <input
            name="expiresKey"
            type="date"
            required
            className="h-10 rounded border border-hairline bg-transparent px-3"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Note (what this code is for)
        <input
          name="note"
          placeholder="Jayanagar club launch, 14 Sep"
          className="h-10 rounded border border-hairline bg-transparent px-3"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="h-10 self-start rounded border border-hairline px-4 font-medium disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create code"}
      </button>
      {error && <p className="text-sm text-heat">{error}</p>}
      {minted && <p className="text-sm">Created {minted}.</p>}
    </form>
  );
}
