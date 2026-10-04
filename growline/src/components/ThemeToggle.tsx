"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./ThemeScript";

type Theme = "dark" | "light";

/**
 * The Settings switch (v2 §4: "switchable in Settings").
 *
 * Reads the attribute ThemeScript already set rather than re-deriving it, so the
 * control can never disagree with what is on screen.
 *
 * That read is an external store, not component state: `data-theme` is owned by the
 * document and set before hydration. Mirroring it into `useState` inside an effect
 * meant a synchronous setState on mount, which cascades a second render for every
 * visitor. `useSyncExternalStore` is the API for exactly this, and it also gives a
 * server snapshot so the markup matches the "dark by default" rule.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

/** Dark is the default, so that is what the server renders. */
const readServerTheme = (): Theme => "dark";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, readServerTheme);

  const choose = (next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable — the theme still applies for this session.
    }
    // The document changed; tell the store's subscribers to re-read it.
    listeners.forEach((notify) => notify());
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Appearance</span>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex gap-2 rounded-xl border border-hairline bg-surface p-1"
      >
        {(["dark", "light"] as const).map((option) => (
          <button
            key={option}
            role="radio"
            aria-checked={theme === option}
            onClick={() => choose(option)}
            data-testid={`theme-${option}`}
            className={
              theme === option
                ? "metal-gold h-11 flex-1 rounded-lg text-sm font-semibold capitalize"
                : "h-11 flex-1 rounded-lg text-sm font-medium capitalize text-text-dim"
            }
          >
            {option}
          </button>
        ))}
      </div>
      <p className="text-sm text-text-dim">
        Dark is the default. Your choice is remembered on this device.
      </p>
    </div>
  );
}
