"use client";

import { useEffect, useState } from "react";

/**
 * The score itself, counted up on load.
 *
 * ## Why there is no ring here
 *
 * The obvious move was to reuse the target ring's shape, and it would have been
 * wrong. That ring lights the REMAINING arc on purpose (v2 §4, the Zeigarnik effect)
 * because a target is a thing a coach is chasing to 100. A duplication score is not:
 * it is a reading of a line, and a coach whose one level is fully active is honestly
 * at 100 while a coach at 60 across three levels may have the healthier team. A ring
 * with an unfilled arc says "you are short of something", every month, to everybody
 * — a permanent debt against a number that is a measurement rather than a goal.
 *
 * So the number is the number, and the thing to act on is the breakdown underneath
 * it. That also keeps the screen to one accent (G3): the gold is on the level bars,
 * where the action is.
 *
 * ## Motion (G5)
 *
 * A count-up under 400ms, and an instant number under `prefers-reduced-motion`. No
 * celebration: crossing a band would need a stored previous reading, and no trend is
 * stored (docs.ts) — a celebration fired on every page load would be decoration
 * without behaviour, which G6 bans outright.
 */
export default function ScoreNumber({ score }: { score: number }) {
  const target = Math.min(100, Math.max(0, Math.round(score)));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // Deferred one frame rather than set in the effect body — the same reason
      // TargetRing gives: a synchronous setState here cascades a second render on
      // mount for every visitor, and one frame is imperceptible.
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const steps = 20;
    const id = setInterval(() => {
      frame += 1;
      setShown(Math.round((target * frame) / steps));
      if (frame >= steps) clearInterval(id);
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [target]);

  return (
    <p className="flex items-baseline gap-2" data-testid="duplication-score" data-score={target}>
      <span className="numeral text-6xl text-text">{shown}</span>
      <span className="text-text-dim">out of 100</span>
    </p>
  );
}
