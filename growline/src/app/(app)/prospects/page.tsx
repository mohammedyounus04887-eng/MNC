import Link from "next/link";
import { redirect } from "next/navigation";
import { listProspectsByCoach } from "@/lib/prospects";
import { getSessionUser } from "@/lib/session";
import { bucketFollowup, describeFollowup } from "@/lib/followup";
import ProspectList, { type ProspectRow } from "./ProspectList";
import RealtimeProspects from "@/components/RealtimeProspects";

export default async function ProspectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rows = await listProspectsByCoach(user.id);

  const prospects: ProspectRow[] = rows.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    nextFollowupAt: p.nextFollowupAt ? p.nextFollowupAt.toISOString() : null,
    // Bucketed and labelled on the server so every row agrees on what "today" is
    // rather than each browser deciding from its own clock.
    followupBucket: bucketFollowup(p.nextFollowupAt),
    followupLabel: describeFollowup(p.nextFollowupAt),
  }));

  return (
    <div className="flex flex-col gap-4">
      <RealtimeProspects />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Prospects</h1>
        <Link
          href="/prospects/qr"
          className="flex h-12 items-center rounded-xl border border-hairline px-4 font-medium"
        >
          My QR code
        </Link>
      </div>
      <ProspectList prospects={prospects} referralCode={user.referralCode} />
    </div>
  );
}
