"use client";

import { useState } from "react";
import { COACH_SHARING_NOTICE, whatsappMessage } from "@/lib/report-copy";
import { whatsappNumber } from "@/lib/prospect";
import { CopyIcon, WhatsAppIcon } from "@/components/icons";

/**
 * F4 — two taps total: tap here, then press send inside WhatsApp.
 *
 * The WhatsApp link is a real anchor rather than a scripted window.open, so the
 * navigation is never eaten by a popup blocker and never waits on a network call.
 * Marking the report as sent is fire-and-forget for the same reason.
 */
export default function ProspectActions({
  reportUrl,
  reportToken,
  prospectName,
  prospectPhone,
  coachName,
  portfolioUrl,
}: {
  reportUrl: string;
  reportToken: string;
  prospectName: string;
  prospectPhone: string;
  coachName: string;
  /** The coach's published page (F9), or null when they have not published one. */
  portfolioUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const firstName = prospectName.trim().split(/\s+/)[0];
  const message = whatsappMessage({ firstName, url: reportUrl, coachName, portfolioUrl });
  const waHref = `https://wa.me/${whatsappNumber(
    prospectPhone
  )}?text=${encodeURIComponent(message)}`;

  const markSent = () => {
    const url = `/api/reports/${reportToken}/sent`;
    // sendBeacon and keepalive are both built to outlive the page — a plain fetch
    // gets dropped when WhatsApp takes the foreground and the WebView is reclaimed,
    // which would undercount the send rate worst on the cheap devices this app
    // targets. Never awaited either way: the tap must open WhatsApp immediately.
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      if (navigator.sendBeacon(url)) return;
    }
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the snapshot link:", reportUrl);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <a
        href={waHref}
        target="_blank"
        rel="noreferrer noopener"
        onClick={markSent}
        className="flex h-14 items-center justify-center gap-2 neopop metal-gold text-lg font-semibold text-on-gold"
      >
        <WhatsAppIcon className="h-6 w-6" />
        Send on WhatsApp
      </a>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={copyLink}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-hairline px-4 font-medium"
        >
          <CopyIcon className="h-5 w-5" />
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <a
          href={`/r/${reportToken}/card.png`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-12 items-center justify-center rounded-xl border border-hairline px-4 font-medium"
        >
          Image
        </a>
        <a
          href={`/r/${reportToken}/snapshot.pdf`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-12 items-center justify-center rounded-xl border border-hairline px-4 font-medium"
        >
          PDF
        </a>
      </div>

      <p className="text-xs leading-snug text-text-dim">{COACH_SHARING_NOTICE}</p>
    </section>
  );
}
