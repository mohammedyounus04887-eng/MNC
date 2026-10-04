import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProspectForCoach } from "@/lib/prospects";
import { siteUrl } from "@/lib/site-url";
import { getSessionUser } from "@/lib/session";
import { computeWellness, reportEligibility, type Gender } from "@/lib/wellness";
import { eligibilityMessage, ensureCurrentReport, parseSnapshot } from "@/lib/report";
import { DISCLAIMER, NOT_A_DOCTOR } from "@/lib/report-copy";
import { BackIcon } from "@/components/icons";
import SnapshotMetrics from "@/components/SnapshotMetrics";
import ProspectActions from "./ProspectActions";
import ProspectDetailsEditor from "./ProspectDetailsEditor";
import PipelineControls from "./PipelineControls";
import AddToClub from "./AddToClub";
import { toStage } from "@/lib/pipeline";
import { bucketFollowup, describeFollowup } from "@/lib/followup";
import { getOwnPortfolio } from "@/modules/portfolio/queries";
import { portfolioUrl } from "@/modules/portfolio/model";

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const prospect = await getProspectForCoach(id, user.id);
  if (!prospect || prospect.coachId !== user.id) notFound();

  const inputs = {
    age: prospect.age,
    gender: (prospect.gender as Gender | null) ?? null,
    heightCm: prospect.heightCm,
    weightKg: prospect.weightKg,
  };
  const eligibility = reportEligibility(inputs);
  const report = eligibility.ok ? await ensureCurrentReport(prospect) : null;
  const snapshot = report ? parseSnapshot(report.metricsJson) : null;
  const metrics = snapshot?.metrics ?? computeWellness(inputs);

  const blocked = eligibilityMessage(eligibility);

  const base = await siteUrl();
  const reportUrl = report ? `${base}/r/${report.token}` : null;

  /**
   * The coach's own page, if they have published one (F9).
   *
   * Only when PUBLISHED — an unpublished page 404s, and a link to it in a message a
   * prospect receives teaches them something worse about the coach than no link would.
   * Read here rather than in the client component so the URL is built from the server's
   * idea of the origin (`site-url.ts`), which is the correct one behind a proxy.
   */
  const myPage = await getOwnPortfolio(user.id);
  const myPageUrl =
    myPage.published && myPage.slug ? portfolioUrl(base, myPage.slug) : null;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/prospects"
        className="flex h-12 items-center gap-2 self-start font-medium text-gold-ink"
      >
        <BackIcon className="h-5 w-5" />
        Back
      </Link>

      <header>
        <h1 className="font-display text-3xl font-bold">{prospect.name}</h1>
        <p className="mt-1 text-text-dim">
          {prospect.phone.replace(/^\+91/, "")}
          {prospect.source === "qr" && " · filled their own details"}
        </p>
      </header>

      {/* Pipeline first: moving a stage and setting a follow-up are the actions a
          coach comes back to this screen for, so they sit above the snapshot. */}
      <PipelineControls
        prospectId={prospect.id}
        stage={toStage(prospect.stage)}
        followupLabel={describeFollowup(prospect.nextFollowupAt)}
        followupOverdue={bucketFollowup(prospect.nextFollowupAt) === "overdue"}
        notes={prospect.notes}
      />

      {report && reportUrl ? (
        <>
          <SnapshotMetrics metrics={metrics} />
          <ProspectActions
            reportUrl={reportUrl}
            reportToken={report.token}
            prospectName={prospect.name}
            prospectPhone={prospect.phone}
            coachName={user.name}
            portfolioUrl={myPageUrl}
          />
        </>
      ) : blocked ? (
        <section className="rounded-2xl bg-surface p-5">
          <h2 className="font-semibold">{blocked.title}</h2>
          <p className="mt-2 text-sm leading-snug text-text-dim">{blocked.body}</p>
        </section>
      ) : null}

      <ProspectDetailsEditor
        id={prospect.id}
        name={prospect.name}
        phone={prospect.phone.replace(/^\+91/, "")}
        age={prospect.age}
        gender={prospect.gender}
        heightCm={prospect.heightCm}
        weightKg={prospect.weightKg}
      />

      <AddToClub key={prospect.stage} prospectId={prospect.id} />

      <p className="text-xs leading-snug text-text-dim">
        {DISCLAIMER} {NOT_A_DOCTOR}
      </p>
    </div>
  );
}
