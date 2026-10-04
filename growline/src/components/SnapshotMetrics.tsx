import type { WellnessMetrics } from "@/lib/wellness";
import { HEALTHY_BMI_MAX, HEALTHY_BMI_MIN } from "@/lib/wellness";
import {
  BMI_NOT_DIAGNOSIS,
  BMI_STANDARD_NOTE,
  BMR_NOTE,
  BODY_FAT_NOTE,
  WATER_NOTE,
  WEIGHT_RANGE_NOTE,
} from "@/lib/report-copy";

/**
 * The metrics block, shared by the coach's in-app view and the prospect's public
 * page so the two can never disagree.
 *
 * Deliberately uniform styling across every band: no red/green, no arrows, no
 * severity icons, and a below-range result is presented exactly as calmly as an
 * above-range one. Colour-coded alarm on a health estimate is a closing tool, not
 * information.
 */

const BMI_SCALE_MIN = 15;
const BMI_SCALE_MAX = 35;

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl bg-surface p-4">
      <span className="text-sm font-medium text-text-dim">{label}</span>
      <span className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        {unit && <span className="text-base font-medium text-text-dim">{unit}</span>}
      </span>
      <span className="mt-2 text-xs leading-snug text-text-dim">{note}</span>
    </div>
  );
}

function BmiStrip({ bmi }: { bmi: number }) {
  const pct = Math.min(
    100,
    Math.max(
      0,
      ((bmi - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100
    )
  );
  const tickPct = (v: number) =>
    ((v - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN)) * 100;

  return (
    <div className="mt-4">
      <div className="relative h-3 rounded-full bg-hairline">
        {/* The general range, marked without judging anything outside it */}
        <div
          className="absolute inset-y-0 rounded-full bg-hairline"
          style={{
            left: `${tickPct(HEALTHY_BMI_MIN)}%`,
            width: `${tickPct(HEALTHY_BMI_MAX) - tickPct(HEALTHY_BMI_MIN)}%`,
          }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-gold"
          style={{ left: `${pct}%` }}
        />
      </div>
      {/* Each label is positioned at its own value, not spaced evenly. Even
          spacing would put "18.5" at a third of the way across while the band
          it marks starts at 17.5% — a scale contradicting itself. */}
      <div className="relative mt-1.5 h-4 text-xs text-text-dim">
        {[BMI_SCALE_MIN, HEALTHY_BMI_MIN, HEALTHY_BMI_MAX, BMI_SCALE_MAX].map((v) => (
          <span
            key={v}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: `${tickPct(v)}%` }}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SnapshotMetrics({ metrics }: { metrics: WellnessMetrics }) {
  return (
    <div className="flex flex-col gap-3">
      {metrics.bmi && (
        <section className="rounded-2xl bg-surface p-5">
          <span className="text-sm font-medium text-text-dim">BMI</span>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-5xl font-bold tabular-nums">
              {metrics.bmi.value.toFixed(1)}
            </span>
            <span className="text-base font-medium">{metrics.bmi.band.label}</span>
          </div>
          <BmiStrip bmi={metrics.bmi.value} />
          <p className="mt-3 text-xs leading-snug text-text-dim">
            {BMI_NOT_DIAGNOSIS} {BMI_STANDARD_NOTE}
          </p>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.bodyFatPct && (
          <Tile
            label="Estimated body fat"
            value={`${metrics.bodyFatPct.low}–${metrics.bodyFatPct.high}`}
            unit="%"
            note={BODY_FAT_NOTE}
          />
        )}
        {metrics.bmrKcal && (
          <Tile
            label="Energy used at complete rest"
            value={metrics.bmrKcal.toLocaleString("en-IN")}
            unit="a day"
            note={BMR_NOTE}
          />
        )}
        {metrics.healthyWeightKg && (
          <Tile
            label="General weight range for this height"
            value={`${metrics.healthyWeightKg.min}–${metrics.healthyWeightKg.max}`}
            unit="kg"
            note={WEIGHT_RANGE_NOTE}
          />
        )}
        {metrics.waterLitres && (
          <Tile
            label="Daily fluid guideline"
            value={
              metrics.waterLitres.low === metrics.waterLitres.high
                ? metrics.waterLitres.low.toFixed(1)
                : `${metrics.waterLitres.low}–${metrics.waterLitres.high}`
            }
            unit="litres a day"
            note={WATER_NOTE}
          />
        )}
      </div>
    </div>
  );
}
