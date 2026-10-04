"use client";

/**
 * A checkmark drawn in one stroke, over the whole screen, when a save lands.
 *
 * ## Why the founding gesture gets its own component
 *
 * Capturing a person is the action this product exists for — v1 §F2 calls it "the
 * front door" — and it happens in the worst conditions the app ever sees: standing
 * on a road, one hand, sun on the screen, signal that may or may not be there. Its
 * confirmation was a line of text in a coloured box, which is what every form in
 * the world does and which a coach mid-conversation will not read.
 *
 * A stroke that draws itself is legible peripherally. You do not have to look at
 * it to know it happened, which is the entire requirement.
 *
 * ## Why it matters most with no signal
 *
 * Offline, there is no server round-trip to confirm anything and no list to
 * navigate to — the form just empties. That empty form is indistinguishable from
 * one that failed. This is the strongest single answer to "did that work?", and
 * it is why the component takes no network state at all: it means "your phone has
 * this", which is true in both cases and is the only promise capture can make on
 * a weak signal.
 *
 * ## Budget (G5)
 *
 * 520ms, under the 1.5s celebration cap and above the 250ms micro band — this is
 * a moment, not a micro-interaction. `pointer-events: none` so it never blocks
 * the next capture.
 *
 * Reduced motion needs no code here, which is the better answer than the
 * `matchMedia` state this first had: the global override in globals.css forces
 * every animation to a near-zero duration, and because this one is `forwards` it
 * simply lands on its end state — a complete, still tick. Reading the media query
 * in an effect would additionally have drawn one frame of motion before the state
 * arrived, shown to exactly the people who asked not to see it.
 */

const DRAW_MS = 520;

export default function SuccessTick({
  show,
  label = "Saved",
}: {
  show: boolean;
  /** Read aloud by screen readers, and shown under the tick. */
  label?: string;
}) {
  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9998] flex flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
      data-testid="success-tick"
    >
      {/* A scrim, not a solid cover: the coach can still see the form they were
          on, so this reads as confirmation laid over their work rather than a
          screen change they have to get back from. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}
      />
      <svg
        aria-hidden
        viewBox="0 0 64 64"
        className="relative h-24 w-24"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle
          cx="32"
          cy="32"
          r="27"
          stroke="var(--accent)"
          strokeOpacity="0.28"
        />
        <path
          d="M19 33.5 L28.5 43 L45 24"
          // 46 is the path's own length, near enough that the dash starts fully
          // hidden and ends fully drawn. Animating stroke-dashoffset is the one
          // way to draw a line progressively without JS per frame.
          strokeDasharray="46"
          style={{
            strokeDashoffset: 46,
            animation: `gl-draw ${DRAW_MS}ms ease-out forwards`,
          }}
        />
      </svg>
      <p className="relative text-lg font-semibold text-text">{label}</p>
    </div>
  );
}

export { DRAW_MS };
