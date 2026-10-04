import { getOverview, pct, type Metric } from "@/lib/admin-metrics";

/**
 * Overview — the six metrics from v1 §13.
 *
 * Two of them cannot be computed yet and say so rather than showing zero. That is the
 * whole reason this page renders an "unmeasurable" state at all: a north-star retention
 * figure reading 0% would be read as a disaster instead of as an unbuilt feature, and
 * somebody would act on it.
 */

function MetricCard({ metric }: { metric: Metric }) {
  if (metric.kind === "unmeasurable") {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-5">
        <p className="text-sm font-medium text-text-dim">{metric.label}</p>
        <p className="mt-2 text-2xl font-semibold text-text-dim">Not measurable yet</p>
        <p className="mt-2 text-sm text-text-dim">{metric.why}</p>
        <p className="mt-1 text-sm text-text-dim">{metric.help}</p>
      </div>
    );
  }

  const { value, of } = metric.data;
  const display =
    metric.unit === "%" && of !== undefined ? `${pct(value, of)}%` : String(value);

  return (
    <div className="rounded-xl border border-hairline p-5">
      <p className="text-sm font-medium text-text-dim">{metric.label}</p>
      <p className="mt-2 text-4xl font-bold tabular-nums">{display}</p>
      {of !== undefined && (
        // The raw pair under the percentage: "60%" out of 5 coaches and out of 5,000
        // are different facts, and a percentage alone hides which one you are looking at.
        <p className="mt-1 text-sm text-text-dim tabular-nums">
          {value} of {of}
        </p>
      )}
      <p className="mt-2 text-sm text-text-dim">{metric.help}</p>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const overview = await getOverview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="mt-1 text-text-dim">
          {overview.coaches} coach{overview.coaches === 1 ? "" : "es"} · rolling{" "}
          {overview.windowDays}-day window
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {overview.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>
    </div>
  );
}
