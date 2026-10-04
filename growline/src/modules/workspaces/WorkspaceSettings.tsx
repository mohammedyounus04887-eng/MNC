"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCENTS,
  ACCENT_KEYS,
  MAX_LEVEL_GROUPS,
  MAX_LEVEL_GROUP_NAME,
  MAX_WORKSPACE_NAME,
  type AccentKey,
} from "./model";

/**
 * The organisation's own settings, for its owner.
 *
 * ## The level names are the delicate part
 *
 * There is no starter list, no placeholder text naming a rank, and no suggestion — the
 * rows begin empty and stay empty until somebody types their own words. RULES L1 and L8
 * make this a legal line rather than a preference: no direct-selling or nutrition
 * company's rank names may appear anywhere in this app, and a helpful "e.g. Supervisor"
 * would be the app supplying exactly that. The empty state explains what the field is for
 * without ever showing an example.
 *
 * ## Why the colour is a list and not a picker
 *
 * Five palette colours, not a hex field. A free colour can fail contrast on the dark base,
 * and it can collide with meanings the app has already taught — green is money and gains,
 * heat is an alert. A workspace repainting those has broken the grammar its own coaches
 * read without thinking.
 */

export type WorkspaceView = {
  id: string;
  name: string;
  accent: AccentKey;
  levelGroups: string[];
  memberCount: number;
  isOwner: boolean;
};

export default function WorkspaceSettings({ workspace }: { workspace: WorkspaceView }) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [accent, setAccent] = useState<AccentKey>(workspace.accent);
  const [levels, setLevels] = useState<string[]>(
    workspace.levelGroups.length > 0 ? workspace.levelGroups : [""]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const setLevelAt = (index: number, value: string) =>
    setLevels((rows) => rows.map((r, i) => (i === index ? value : r)));
  const removeLevelAt = (index: number) =>
    setLevels((rows) => (rows.length === 1 ? [""] : rows.filter((_, i) => i !== index)));

  const save = async () => {
    if (busy) return;
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The workspace id is deliberately NOT sent: the server takes it from the
        // caller's own account, so this form cannot be aimed at another organisation.
        body: JSON.stringify({ name, accent, levelGroups: levels }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  };

  if (!workspace.isOwner) {
    return (
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">{workspace.name}</h2>
        <p className="mt-1 text-sm text-text-dim">
          {workspace.memberCount === 1
            ? "1 coach in this group"
            : `${workspace.memberCount} coaches in this group`}
        </p>
        {workspace.levelGroups.length > 0 && (
          <p className="mt-3 text-sm text-text-dim">
            Levels: {workspace.levelGroups.join(" · ")}
          </p>
        )}
        <p className="mt-3 text-sm text-text-dim">
          Only the person who started this group can change its settings.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">Group name</h2>
        <p className="mt-1 text-sm text-text-dim">
          What your coaches see. {workspace.memberCount === 1
            ? "1 coach is in it"
            : `${workspace.memberCount} coaches are in it`}
          .
        </p>
        <input
          data-testid="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_WORKSPACE_NAME))}
          className="mt-3 min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base"
        />
      </div>

      <div className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">Accent colour</h2>
        <p className="mt-1 text-sm text-text-dim">
          Used on buttons and progress. Chosen from the Growline palette so every choice
          stays readable in both themes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACCENT_KEYS.map((key) => {
            const active = accent === key;
            return (
              <button
                key={key}
                data-testid={`workspace-accent-${key}`}
                onClick={() => setAccent(key)}
                aria-pressed={active}
                className={`flex min-h-12 items-center gap-2 rounded-xl border px-4 py-3 ${
                  active ? "border-text bg-elevated" : "border-hairline"
                }`}
              >
                <span
                  aria-hidden
                  className="h-5 w-5 shrink-0 rounded-full"
                  style={{ background: `var(${ACCENTS[key].cssVar})` }}
                />
                <span className="text-sm">{ACCENTS[key].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">Level names</h2>
        <p className="mt-1 text-sm text-text-dim">
          Your group&apos;s own words for the levels your coaches work towards. Type your
          own — Growline never fills these in.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {levels.map((value, index) => (
            <div key={index} className="flex gap-2">
              <input
                data-testid={`workspace-level-${index}`}
                value={value}
                onChange={(e) => setLevelAt(index, e.target.value.slice(0, MAX_LEVEL_GROUP_NAME))}
                /* No example, ever. A placeholder here would be the app suggesting a rank
                   name, which is the thing RULES L1/L8 forbid. */
                placeholder="Level name"
                className="min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base"
              />
              <button
                onClick={() => removeLevelAt(index)}
                aria-label={`Remove level ${index + 1}`}
                className="min-h-12 shrink-0 rounded-xl border border-hairline px-4 text-text-dim"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {levels.length < MAX_LEVEL_GROUPS && (
          <button
            data-testid="workspace-level-add"
            onClick={() => setLevels((rows) => [...rows, ""])}
            className="mt-2 min-h-12 px-1 py-3 text-left font-medium text-text-dim"
          >
            + Add a level
          </button>
        )}
        <p className="mt-1 text-sm text-text-dim">
          Blank rows are dropped when you save.
        </p>
      </div>

      <button
        data-testid="workspace-save"
        onClick={() => void save()}
        disabled={busy}
        className="h-14 neopop metal-gold px-5 text-lg font-semibold text-on-gold disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>

      {saved && <p className="text-sm text-gem-green">Saved.</p>}
      {error && <p className="text-sm text-heat">{error}</p>}
    </section>
  );
}
