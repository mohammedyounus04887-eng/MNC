import { progressPercent } from "@/lib/targets";

/**
 * A target's progress bar. Gold while working, green once reached — green is reserved
 * for positive stats (Section 9) and a bar that never turns red, because a target
 * not yet met is not an error.
 */
export default function ProgressBar({
  progress,
  target,
  achieved,
}: {
  progress: number;
  target: number;
  achieved: boolean;
}) {
  const { pct, clamped } = progressPercent(progress, target);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {progress.toLocaleString("en-IN")}
        </span>
        <span className="text-sm text-text-dim">
          of {target.toLocaleString("en-IN")} points
        </span>
      </div>
      <div
        className="mt-2 h-3 overflow-hidden rounded-full bg-hairline"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full ${achieved ? "bg-gem-green" : "bg-gold"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-text-dim">
        {/* Overshoot is shown honestly rather than capped at 100. */}
        {pct}% {achieved && pct > 100 ? "— past the target" : ""}
      </p>
    </div>
  );
}
