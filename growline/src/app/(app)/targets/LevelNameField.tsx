"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_LEVEL_NAME } from "@/lib/targets";

/**
 * The coach's own label for the level they are working at (F7).
 *
 * Section 5.1 is the reason this is a free text field with an EMPTY default and no
 * examples, suggestions, autocomplete or picker: any direct-selling or nutrition
 * company's rank names are forbidden anywhere in this app, so the only way a rank
 * name can ever appear is a coach choosing to type their own words. Do not add a
 * list of suggested levels here.
 */
export default function LevelNameField({ levelName }: { levelName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(levelName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levelName: value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-3 text-left"
      >
        <span>
          <span className="block text-sm text-text-dim">My level</span>
          <span className="font-medium">
            {levelName ?? "Not named yet"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium text-gold-ink">
          {levelName ? "Change" : "Add a name"}
        </span>
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
      <label className="text-sm font-medium" htmlFor="level-name">
        What do you call this level?
      </label>
      <p className="text-xs text-text-dim">
        Your own words — whatever you and your team use. Leave it empty if you would
        rather not name it.
      </p>
      <input
        id="level-name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_LEVEL_NAME}
        className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        autoFocus
      />
      {error && <p className="text-sm text-heat">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="h-12 rounded-xl bg-gold px-5 font-semibold text-on-gold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => {
            setValue(levelName ?? "");
            setOpen(false);
          }}
          className="h-12 rounded-xl border border-hairline px-4 font-medium"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
