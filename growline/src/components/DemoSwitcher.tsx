"use client";

import { useState } from "react";
import Link from "next/link";
import type { DemoRole, DemoRoleKey } from "@/lib/demo";

/**
 * The always-visible demo chip, and the one-tap role switch.
 *
 * ## Why it is always visible
 *
 * Because a demo session is a real session on real screens, the only thing distinguishing
 * this from the live product is this chip. Hiding it to make the demo look cleaner would
 * remove the single cue that stops somebody screenshotting demo data as if it were
 * theirs, or wondering later which account they were looking at. An investor seeing
 * "Demo" is normal; an investor being shown something they cannot identify is not.
 *
 * ## Why it switches rather than logs out
 *
 * The demo story is a relationship — an upline sets a target, a downline receives it —
 * so the interesting moment is seeing the SAME data from the other side. Tapping a name
 * mints a session for that coach and reloads the page you are already on, so "here is
 * what your downline sees" costs one tap and stays on the same screen.
 *
 * Muted on purpose: `--info`-leaning, no gold, no animation. It is chrome, not a feature
 * being demonstrated, and it must never pull attention off the screen being shown.
 */
export default function DemoSwitcher({
  roles,
  currentKey,
  currentName,
}: {
  roles: DemoRole[];
  /** Null when signed in as a coach who is not one of the demo seats. */
  currentKey: DemoRoleKey | null;
  currentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DemoRoleKey | "">("");

  const switchTo = async (role: DemoRoleKey) => {
    if (busy || role === currentKey) return;
    setBusy(role);
    try {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        setBusy("");
        return;
      }
      // Reload rather than router.refresh(): the session cookie changed, so client
      // state belonging to the previous coach must not survive the switch.
      window.location.reload();
    } catch {
      setBusy("");
    }
  };

  return (
    <div className="fixed bottom-20 right-3 z-30 flex flex-col items-end gap-2 md:bottom-4">
      {open && (
        <div className="w-64 rounded-xl border border-hairline bg-elevated p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-semibold text-text-dim">
            View the app as
          </p>
          {roles.map((role) => {
            const active = role.key === currentKey;
            return (
              <button
                key={role.key}
                data-testid={`demo-switch-${role.key}`}
                onClick={() => void switchTo(role.key)}
                disabled={busy !== "" || active}
                className={`flex min-h-12 w-full flex-col justify-center rounded-lg px-2 py-2 text-left disabled:opacity-60 ${
                  active ? "bg-surface" : "hover:bg-surface"
                }`}
              >
                <span className="text-sm font-medium">
                  {role.name}
                  {active && " ✓"}
                </span>
                <span className="text-xs text-text-dim">{role.headline}</span>
              </button>
            );
          })}
          <Link
            href="/demo"
            className="flex min-h-12 items-center px-2 text-sm text-text-dim"
          >
            Back to the demo menu
          </Link>
        </div>
      )}

      <button
        data-testid="demo-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 items-center gap-2 rounded-full border border-info/40 bg-elevated px-4 py-2 text-sm"
      >
        <span className="font-semibold text-info">Demo</span>
        <span className="text-text-dim">{currentName}</span>
      </button>
    </div>
  );
}
