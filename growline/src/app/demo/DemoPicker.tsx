"use client";

import { useState } from "react";
import type { DemoRole, DemoRoleKey } from "@/lib/demo";

/**
 * The three seats, as cards. One tap signs in and lands on the home screen.
 *
 * Deliberately plain and fast. This screen is looked at for about four seconds before a
 * demo starts, so it explains what each seat SHOWS rather than who the person is — the
 * question in the room is "what am I about to look at", not "who is Asha".
 */
export default function DemoPicker({
  roles,
  next,
}: {
  roles: DemoRole[];
  /** Where to land after signing in. Home, unless the switcher sent us somewhere. */
  next: string;
}) {
  const [busy, setBusy] = useState<DemoRoleKey | "">("");
  const [error, setError] = useState("");

  const start = async (role: DemoRoleKey) => {
    if (busy) return;
    setError("");
    setBusy(role);
    try {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start the demo.");
        return;
      }
      /**
       * A full navigation, not `router.push`: the session cookie changed, and every
       * server-rendered screen behind it has to be re-fetched for the new coach.
       *
       * `assign()` rather than setting `location.href`, because the React Compiler's
       * immutability rule treats assigning to a global as a modification it cannot
       * reason about — and it is right to, so the method call is the honest form.
       */
      window.location.assign(next);
    } catch {
      setError("Could not start the demo. Is the server still running?");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {roles.map((role) => (
        <button
          key={role.key}
          data-testid={`demo-role-${role.key}`}
          onClick={() => void start(role.key)}
          disabled={busy !== ""}
          className="rounded-2xl border border-hairline bg-surface p-5 text-left disabled:opacity-50"
        >
          <span className="block font-semibold">{role.headline}</span>
          <span className="mt-1 block text-sm text-text-dim">{role.shows}</span>
          <span className="mt-3 block text-sm font-medium text-gold-ink">
            {busy === role.key ? "Opening…" : `Open as ${role.name} →`}
          </span>
        </button>
      ))}
      {error && <p className="text-sm text-heat">{error}</p>}
    </div>
  );
}
