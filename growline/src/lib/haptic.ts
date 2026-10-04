/**
 * A short buzz at the moments that matter (v2 §4 dopamine map: "+ haptic").
 *
 * ## Why this exists at all
 *
 * This app is used standing on a road, one-handed, often without looking — the
 * 30-second rule assumes it. A vibration is the only confirmation channel that
 * survives that posture, and on the mid-range Androids this audience carries it
 * is free and instant. `navigator.vibrate` appeared nowhere in the codebase
 * before this, which the field test felt as "I can't tell that I tapped".
 *
 * ## The rules, held here so no call site has to argue them
 *
 * **Never on a Trust Zone.** Payment, mandate, cancel, consent and privacy screens
 * stay silent and still (G1) — a buzz is a celebration cue, and celebrating a
 * charge is exactly the register those screens exist to avoid.
 *
 * **Respects `prefers-reduced-motion`.** Vestibular sensitivity is not only about
 * pixels moving; a device that jumps in the hand is motion too. The media query is
 * the closest honest signal a browser gives us.
 *
 * **Fails silently and always.** iOS Safari has no vibration API, a desktop has no
 * motor, and a browser may refuse without a user gesture. Every one of those is a
 * normal Tuesday, not an error — a confirmation buzz must never be able to break
 * the save it is confirming.
 */

/** Patterns, named for the moment rather than the milliseconds. */
export const HAPTIC = {
  /** A save landed: capture, log, stage move. One clean tick. */
  confirm: 18,
  /** A small positive act that is not a save — a clap, an acknowledgement. */
  tap: 10,
  /** A landmark: streak milestone, target crossing, first Member. Da-dum-da. */
  milestone: [28, 40, 28],
} as const;

export function haptic(pattern: number | readonly number[] = HAPTIC.confirm): void {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (typeof navigator.vibrate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(pattern as number | number[]);
  } catch {
    // A browser that throws on vibrate (a permissions policy, a locked-down
    // WebView) must not take the save down with it.
  }
}
