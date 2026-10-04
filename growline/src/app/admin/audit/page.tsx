import { listAuditEntries } from "@/lib/admin-audit";

/**
 * Audit log (F12). Every admin action that changed something.
 *
 * Rendered server-side because the collection is denied to browsers — including admins'
 * browsers. See lib/admin-audit.ts.
 */
export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const entries = await listAuditEntries();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="mt-1 text-text-dim">
          {entries.length === 0
            ? "Nothing yet — no admin action has changed anything."
            : `Last ${entries.length} admin actions, newest first.`}
        </p>
      </div>

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-hairline text-left text-text-dim">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-hairline last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-text-dim tabular-nums">
                    {entry.createdAt.toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">{entry.actorName}</td>
                  <td className="px-4 py-3 text-text-dim">{entry.action}</td>
                  <td className="px-4 py-3 text-text-dim">{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
