import type { Metadata } from "next";
import { getSessionUserId } from "@/lib/session";
import { loadReportForRender } from "@/lib/report-render";
import {
  COACH_ROLE,
  DISCLAIMER,
  NOT_A_DOCTOR,
  REPORT_TITLE,
  nextStepLine,
} from "@/lib/report-copy";
import { whatsappNumber } from "@/lib/prospect";
import { Avatar } from "@/components/Avatar";
import SnapshotMetrics from "@/components/SnapshotMetrics";
import RemoveMyDetails from "./RemoveMyDetails";
import PrivacyLink from "@/modules/privacy/PrivacyLink";
import { getOwnPortfolio } from "@/modules/portfolio/queries";
import { touchProspect } from "@/modules/retention/activity";

type Params = { params: Promise<{ token: string }> };

// loadReportForRender is request-cached, so generateMetadata and the page below
// share one query — and both stay on the same token/expiry rules as the PNG,
// preview and PDF routes, which is the whole point of the shared loader.

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const report = await loadReportForRender(token);
  return {
    title: report ? REPORT_TITLE : "Link not available",
    // The description is the first thing read in a WhatsApp preview, so the
    // disclaimer rides along with it — and no metric ever appears here.
    description: report
      ? `A wellness snapshot from ${report.coach.name}. ${DISCLAIMER}`
      : DISCLAIMER,
    robots: { index: false, follow: false },
    openGraph: report
      ? {
          title: REPORT_TITLE,
          description: `From ${report.coach.name}. ${DISCLAIMER}`,
          // Neutral branding, NOT the metrics card: a forwarded link renders its
          // preview inside whatever group chat it lands in.
          images: [{ url: `/r/${report.token}/preview.png`, width: 1200, height: 630 }],
        }
      : undefined,
  };
}

export default async function PublicReportPage({ params }: Params) {
  const { token } = await params;
  const report = await loadReportForRender(token);

  if (!report) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 text-center">
        <h1 className="text-2xl font-bold">This link is not available</h1>
        <p className="mt-2 text-text-dim">
          Wellness snapshot links stop working after a while. Ask your coach to send a
          fresh one.
        </p>
        <p className="mt-6 text-sm text-text-dim">{DISCLAIMER}</p>
      </main>
    );
  }

  const { coach, firstName } = report;
  const waLink = `https://wa.me/${whatsappNumber(coach.phone)}`;
  /**
   * Hidden only from the coach who OWNS this prospect — previewing their own send
   * shouldn't offer to delete it. Any other viewer keeps the control, because
   * prospects are often coaches themselves on this network, and a signed-in
   * Growline session is no reason to deny someone their own erasure link.
   */
  const viewerOwnsProspect = (await getSessionUserId()) === report.coachId;

  /**
   * The prospect opening their own snapshot is the second thing RULES P5 counts as
   * activity, so it pushes the 180-day purge back.
   *
   * Not when the COACH is previewing their own send — that is the coach checking their
   * work, not the person staying engaged, and letting it count would mean any coach could
   * keep a prospect's health data alive forever by opening a page.
   *
   * Not awaited: this is a public page and its render must not wait on a write. The touch
   * throttles itself to at most one write a day, which is what keeps an unauthenticated
   * route from being an unbounded write.
   */
  if (!viewerOwnsProspect) void touchProspect(report.prospectId, "report-view");

  // The coach's public page (F9), only if published. Relative, so it needs no origin.
  const myPage = await getOwnPortfolio(report.coachId);
  const myPageUrl = myPage.published && myPage.slug ? `/${myPage.slug}` : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-gold-ink">Growline</p>
        <h1 className="text-3xl font-bold leading-tight">{REPORT_TITLE}</h1>
        <p className="text-text-dim">For {firstName}</p>
      </header>

      {/* Disclaimer above the fold, never behind a "read more" */}
      <p className="mt-5 rounded-2xl bg-hairline px-4 py-3 text-sm leading-snug text-text">
        {DISCLAIMER} {NOT_A_DOCTOR}
      </p>

      <div className="mt-5">
        <SnapshotMetrics metrics={report.snapshot.metrics} />
      </div>

      <p className="mt-5 rounded-2xl bg-elevated px-5 py-4 text-base leading-snug text-text">
        {nextStepLine(report.id)}
      </p>

      {/* Kept visually separate from the numbers, so the page never reads as
          "here is your problem, here is who to buy from". */}
      <section className="mt-8 border-t border-hairline pt-6">
        <div className="flex items-center gap-4">
          <Avatar name={coach.name} photoUrl={coach.photoUrl} size={56} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{coach.name}</p>
            <p className="truncate text-sm text-text-dim">
              {COACH_ROLE}
              {coach.city ? ` · ${coach.city}` : ""}
            </p>
          </div>
        </div>
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 flex h-14 items-center justify-center rounded-xl bg-gold text-lg font-semibold text-on-gold"
        >
          Message {coach.name.split(" ")[0]} on WhatsApp
        </a>
        {/*
         * The coach's own page (F9), and only when they have published one — an
         * unpublished page 404s, and a dead link on the one document a prospect keeps
         * is worse than no link.
         *
         * Secondary to the WhatsApp button on purpose. The report exists to start a
         * conversation; reading more about the coach is the softer option for somebody
         * not ready to message a stranger yet, which is most people.
         */}
        {myPageUrl && (
          <a
            href={myPageUrl}
            className="mt-2 flex h-12 items-center justify-center rounded-xl border border-hairline font-medium text-text"
          >
            More about {coach.name.split(" ")[0]}
          </a>
        )}
      </section>

      <footer className="mt-8 flex flex-col gap-3 border-t border-hairline pt-6 text-sm text-text-dim">
        <p>{DISCLAIMER}</p>
        <p>{NOT_A_DOCTOR}</p>
        {/* Next to the erasure control on purpose: "what is held about me" and "remove
            it" are the same question, and a person who has just read one wants the
            other within reach (v2 §5.4). */}
        <PrivacyLink />
        {!viewerOwnsProspect && <RemoveMyDetails token={report.token} />}
      </footer>
    </main>
  );
}
