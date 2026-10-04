import Link from "next/link";
import { LIST_CAP, listCoaches } from "@/lib/admin-coaches";

/**
 * Coaches — the list support actually opens.
 *
 * Search covers name, city and phone digits, because those are the three things somebody
 * has when a coach calls. Filtering happens on the server over one query; see
 * `listCoaches` for why in-memory rather than a Firestore prefix search, and what to do
 * when that stops being the right answer.
 */
export const dynamic = "force-dynamic";

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default async function AdminCoachesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, total, truncated } = await listCoaches(query);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Coaches</h1>
        <p className="mt-1 text-text-dim">
          {rows.length} shown of {total}
          {truncated && ` · list capped at ${LIST_CAP}, oldest not loaded`}
        </p>
      </div>

      {/* A plain GET form: the query lands in the URL, so a support person can paste the
          link to a colleague and land on the same result. */}
      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Name, city or phone number"
          className="h-11 w-full max-w-md rounded-lg border border-hairline bg-elevated px-3"
        />
        <button className="h-11 rounded-lg border border-hairline px-4 font-medium">
          Search
        </button>
        {query && (
          <Link
            href="/admin/coaches"
            className="flex h-11 items-center px-2 text-sm text-text-dim"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-hairline p-5 text-text-dim">
          Nobody matches that.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-hairline text-left text-text-dim">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 text-right font-medium">Direct line</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/coaches/${row.id}`} className="font-medium underline">
                      {row.name || "(no name)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-dim">{row.phone}</td>
                  <td className="px-4 py-3 text-text-dim">{row.city ?? "—"}</td>
                  <td className="px-4 py-3 text-text-dim">{row.plan}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.directDownlineCount}
                  </td>
                  <td className="px-4 py-3 text-text-dim">{daysAgo(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
