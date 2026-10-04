import { users } from "@/lib/collections";
import { TIERS_ENFORCED } from "@/modules/tiers/model";
import { tierFunnel } from "@/modules/tiers/queries";
import { isConfigured } from "@/modules/payments/razorpay";

/**
 * Subscriptions (F12) — the tier funnel v2 §8 asks for:
 * Starter → 2-downline-qualified → trial → paid.
 *
 * Honest about which stages can move. Tiers exist and enforcement is off (owner, 2026-08-14:
 * "don't gate anything yet"), so today the funnel measures qualification — how many
 * coaches have EARNED Leader — while trial and paid stay at zero for a stated reason
 * rather than reading as a business failing. When payments land, this page needs no
 * change: the same query fills the same columns.
 *
 * `qualified` is one aggregation over `users` (a `>=` on a materialised counter, no
 * document reads); trial and paid come from a scan of `tiers`, which is empty until the
 * flip and small for a long time after it.
 *
 * ## "Razorpay is not connected" is a fact, so it is read from Razorpay
 *
 * The note under the paid row used to be a hardcoded sentence. It is now `isConfigured()`
 * — the same switch every money route checks — so it disappears the moment keys are in
 * the environment and cannot be left behind saying "nobody can pay yet" on a screen
 * showing paying coaches.
 *
 * The promo row appears only once somebody is on one. A permanently-zero row for a
 * feature that does not exist yet reads as a broken funnel rather than an empty one.
 */
export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const [total, funnel] = await Promise.all([users().count().get(), tierFunnel()]);
  const coaches = total.data().count;
  const pct = (n: number) => (coaches === 0 ? "—" : `${Math.round((n / coaches) * 100)}%`);

  const payments = isConfigured();

  const stages: { label: string; count: number; note: string | null }[] = [
    { label: "Starter (everyone)", count: coaches, note: null },
    {
      label: "Qualified for Leader (2+ direct downlines)",
      count: funnel.qualified,
      note: null,
    },
    {
      label: "On Leader trial",
      count: funnel.onTrial,
      note: TIERS_ENFORCED
        ? null
        : "Trials do not start while every tool is open — starting a 30-day clock on nothing would burn it.",
    },
    // Only once it is real. See the note above the component.
    ...(funnel.granted > 0
      ? [
          {
            label: "Leader on a promo code",
            count: funnel.granted,
            note: "A longer free run, not a sale. Counted apart from revenue on purpose.",
          },
        ]
      : []),
    {
      label: "Paying Leader",
      count: funnel.paid,
      note: payments
        ? null
        : "Razorpay is not connected. Nobody can pay yet.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="mt-1 text-text-dim">{coaches} coaches</p>
      </div>

      {!TIERS_ENFORCED && (
        <div className="rounded-lg border border-dashed border-hairline p-5">
          <p className="font-semibold text-text-dim">Tiers exist. Nothing is gated.</p>
          <p className="mt-2 text-sm text-text-dim">
            Starter / Leader / Elite, the 2nd-downline qualification, the trial clock and the
            pricing screen are built and the gates are standing in the targets, threads and
            proof-review routes — but <code>TIERS_ENFORCED</code> is off by owner decision, so
            every gate answers &ldquo;allowed&rdquo;. Flip it when Razorpay is connected; the
            unit suite pins both positions and the launch-open banner on /plans must come out
            the same day.
          </p>
        </div>
      )}

      <section>
        <h2 className="font-semibold">Funnel</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="border-b border-hairline text-left text-text-dim">
              <tr>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 text-right font-medium">Coaches</th>
                <th className="px-4 py-3 text-right font-medium">Of all</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.label} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    {s.label}
                    {s.note && <p className="mt-1 text-xs text-text-dim">{s.note}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-dim">
                    {pct(s.count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
