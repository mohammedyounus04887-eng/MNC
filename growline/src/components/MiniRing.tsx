/**
 * The target ring, small enough to sit inside a list row (delight plan, move 9).
 *
 * ## Why the home screen needs a ring at all
 *
 * The full `TargetRing` lives on /targets — a screen a coach visits deliberately.
 * Home is the screen they open without deciding to, and v2 §4's mechanic #2 is
 * about the tension an unfinished arc creates (the Zeigarnik effect): a shape with
 * a gap in it asks to be closed, where a number simply reports. Putting a small
 * one on the first screen of the day is the whole point of the mechanic; leaving
 * it only on the screen you go to when you already care is not.
 *
 * ## Deliberately a separate component, not a `size` prop on TargetRing
 *
 * TargetRing carries the celebration: a localStorage read, milestone detection,
 * the confetti call, the glow, a dismiss handler. None of that belongs on a card
 * a coach scrolls past — a celebration that fires in a list row while they are
 * reaching for something else is noise, and worse, it would consume the crossing
 * so the real ring never celebrates it. This renders the same geometry and
 * nothing else. It is a server component for the same reason: no state, no
 * effects, nothing to hydrate.
 *
 * The REMAINING arc is drawn, matching TargetRing exactly. If that ever changes
 * there, it must change here — two rings on two screens disagreeing about which
 * part of the circle is the story would be worse than having no ring on home.
 */

/**
 * ## Size is a prop here, and was not on TargetRing
 *
 * Because this component is only geometry, resizing it cannot change what it
 * means. TargetRing carries behaviour, so a `size` prop there would have been a
 * quiet invitation to reuse the celebration in places it does not belong — which
 * is the exact mistake this file exists to avoid.
 */
const DEFAULT_SIZE = 44;
const DEFAULT_STROKE = 5;

export default function MiniRing({
  progress,
  target,
  size = DEFAULT_SIZE,
  stroke = DEFAULT_STROKE,
  testId = "mini-ring",
}: {
  progress: number;
  target: number;
  size?: number;
  stroke?: number;
  /** Named per placement: home shows two of these, and a test must be able to
   *  say which one it means. */
  testId?: string;
}) {
  const SIZE = size;
  const STROKE = stroke;
  const R = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  const pct = target > 0 ? Math.round((progress / target) * 100) : 0;
  const clamped = Math.min(100, Math.max(0, pct));
  const dashRemaining = (CIRCUMFERENCE * (100 - clamped)) / 100;

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden
      className="shrink-0"
      data-testid={testId}
      data-percent={pct}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--hairline)"
        strokeWidth={STROKE}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--gold)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${dashRemaining} ${CIRCUMFERENCE}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}
