import { todayKey } from "@/lib/daily-log";
import { listPromoCodes } from "@/modules/promo/queries";
import MintForm from "./MintForm";

/**
 * Promo codes (F12, v2 §8).
 *
 * The admin layout used to carry a comment explaining why this tab did not exist: a code
 * grants an extended Leader trial, that was meaningless before tiers and payments, and a
 * screen minting codes that do nothing would have somebody hand them out at a club launch
 * and find out in front of a room. Tiers and payments now exist, so the screen does.
 *
 * A code is only ever days of free Leader. It cannot change what anybody is charged —
 * see the note at the top of `src/modules/promo/model.ts` for why that boundary is worth
 * having.
 */
export const dynamic = "force-dynamic";

export default async function AdminPromoCodesPage() {
  const [codes, today] = await Promise.all([listPromoCodes(), Promise.resolve(todayKey())]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Promo codes</h1>
        <p className="mt-1 text-text-dim">
          Free Leader days for club launches. A code never sets a price and never touches
          Razorpay — the paid conversion afterwards is the ordinary path.
        </p>
      </div>

      <MintForm />

      <section>
        <h2 className="font-semibold">Codes</h2>
        {codes.length === 0 ? (
          <p className="mt-2 text-sm text-text-dim">None yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-hairline text-left text-text-dim">
                <tr>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 text-right font-medium">Days</th>
                  <th className="px-4 py-3 text-right font-medium">Used</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  // Dead means nobody can redeem it, for either reason. Said once, in
                  // the row, rather than leaving somebody to compare a date by eye
                  // before reading a code out to a room.
                  const spent = c.uses >= c.maxUses;
                  const expired = today > c.expiresKey;
                  return (
                    <tr key={c.code} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-3 font-mono">
                        {c.code}
                        {(spent || expired) && (
                          <span className="ml-2 text-xs text-text-dim">
                            {expired ? "expired" : "fully used"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.leaderDays}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.uses} / {c.maxUses}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{c.expiresKey}</td>
                      <td className="px-4 py-3 text-text-dim">{c.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
