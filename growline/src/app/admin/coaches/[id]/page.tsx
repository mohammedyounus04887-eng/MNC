import Link from "next/link";
import { notFound } from "next/navigation";
import { getCoachDetail } from "@/lib/admin-coaches";

/**
 * One coach: their position in the tree, and whether they are actually using the app.
 *
 * This is the tree browser — the direct line is a list of links, so walking down a line is
 * clicking. A rendered tree diagram was the alternative and is worse here: support needs
 * to move through a line, not look at its shape, and a diagram of a thousand-person line
 * is unusable either way.
 *
 * Still no prospect identities. "How many people they captured" is a count on the
 * Overview; who those people are is the coach's business.
 */
export const dynamic = "force-dynamic";

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="rounded-lg border border-hairline p-4">
      <p className="text-sm text-text-dim">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {help && <p className="mt-1 text-sm text-text-dim">{help}</p>}
    </div>
  );
}

export default async function AdminCoachPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCoachDetail(id);
  if (!detail) notFound();

  const { coach, upline, directLine, lineSize, lastLoggedDay, streak, logsLast30 } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/coaches" className="text-sm text-text-dim underline">
          ← All coaches
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{coach.name || "(no name)"}</h1>
        <p className="mt-1 text-text-dim tabular-nums">
          {coach.phone}
          {coach.city && ` · ${coach.city}`} · plan {coach.plan}
        </p>
        <p className="mt-1 text-sm text-text-dim">
          Upline:{" "}
          {upline ? (
            <Link href={`/admin/coaches/${upline.id}`} className="underline">
              {upline.name}
            </Link>
          ) : (
            // Worth calling out rather than showing a dash: an unattached coach is
            // exactly the case the "Link my line" work exists for, and today it cannot
            // be fixed after signup.
            <span>none — this coach is a root of their own tree</span>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Direct line" value={String(coach.directDownlineCount)} />
        <Stat label="Whole line" value={String(lineSize)} help="Any depth below them" />
        <Stat
          label="Streak"
          value={String(streak)}
          help={lastLoggedDay ? `Last logged ${lastLoggedDay}` : "Has never logged"}
        />
        <Stat
          label="Days logged"
          value={String(logsLast30)}
          help="Out of the last 30"
        />
      </div>

      <section>
        <h2 className="font-semibold">Direct line</h2>
        {directLine.length === 0 ? (
          <p className="mt-2 text-text-dim">Nobody has joined under this coach yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">
            {directLine.map((member) => (
              <li key={member.id} className="flex items-center justify-between px-4 py-3">
                <Link href={`/admin/coaches/${member.id}`} className="underline">
                  {member.name || "(no name)"}
                </Link>
                <span className="text-sm text-text-dim tabular-nums">
                  {member.directDownlineCount} under them
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
