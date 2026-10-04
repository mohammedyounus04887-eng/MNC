"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that arrives instead of appearing (v2 §4 Typography: "Numbers are the
 * heroes... with count-up animation on load").
 *
 * ## Why this is a component and not a flourish
 *
 * Counts ARE the content of this app — people met, follow-ups due, days in a row.
 * A number that is simply present is a table cell; a number that counts up is an
 * event, and the field test's "1990s banking application" verdict was largely this
 * one difference repeated on every screen. The mechanic maps to a behaviour (G6):
 * the coach looks at the number, which is the point of opening the app.
 *
 * Generalised from `src/modules/duplication/ScoreNumber.tsx`, which had the only
 * count-up in the codebase and applied it to exactly one number. That file keeps
 * its own copy: it pairs the number with "out of 100" and a testid the duplication
 * e2e asserts on, so folding it in here would be a refactor of finished work for
 * no gain (E5).
 *
 * ## The rules it holds so callers don't have to
 *
 * **Under 400ms** — inside G5's micro-interaction budget. A number that takes a
 * second to settle is a number the coach has already looked away from.
 *
 * **Instant under `prefers-reduced-motion`** — not slower, instant. The value is
 * the information; the motion is optional decoration on top of it.
 *
 * **Counts once per value, not on every render.** A parent re-render (a router
 * refresh, a sibling's state change) must not re-run the animation, or a screen
 * that polls would jitter permanently. The ref remembers what was last animated
 * TO — so a genuine change (a saved log raising the streak) animates from the old
 * value to the new one, which is the moment worth showing.
 */
export default function CountUp({
  value,
  className = "",
  suffix,
  durationMs = 380,
  testId,
}: {
  value: number;
  className?: string;
  /** Rendered after the number in the caller's own type scale, e.g. "days". */
  suffix?: React.ReactNode;
  durationMs?: number;
  testId?: string;
}) {
  const target = Math.round(value);
  // Rendered AT the value, so the server's HTML and the first client render agree
  // (a mismatch makes React warn and repaint) — and so a coach whose JavaScript is
  // still parsing on a slow phone already sees the true number rather than a zero.
  const [shown, setShown] = useState(target);
  // null = never animated yet. The first run counts up from zero (the "on load"
  // the spec asks for); later runs count from the previous value to the new one,
  // which is the moment a saved log raises a streak.
  const animatedTo = useRef<number | null>(null);

  useEffect(() => {
    if (animatedTo.current === target) return;
    const from = animatedTo.current ?? 0;
    animatedTo.current = target;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Deferred one frame rather than set here: a synchronous setState inside an
      // effect cascades a second render on mount for every visitor (the same
      // reasoning ScoreNumber and TargetRing already carry). One frame is
      // imperceptible; the cascade is not free on a ₹10K phone.
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out: fast at the start, settling at the end — the shape that reads
      // as a number landing rather than a progress bar filling.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return (
    <span className={className} data-testid={testId} data-value={target}>
      {shown}
      {suffix}
    </span>
  );
}
