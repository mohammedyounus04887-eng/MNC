"use client";

import { useState } from "react";
import { CopyIcon, WhatsAppIcon } from "./icons";

/** Share buttons for the coach's referral code — used on Home and the empty team screen. */
export default function InviteButtons({
  code,
  dark = false,
}: {
  code: string;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const inviteLink = () => `${window.location.origin}/join/${code}`;

  const shareOnWhatsApp = () => {
    const msg = `Join my team on Growline! Sign up with my referral code ${code}: ${inviteLink()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${code} — ${inviteLink()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http on LAN, old WebView) — show the link instead.
      window.prompt("Copy your invite:", `${code} — ${inviteLink()}`);
    }
  };

  const solid = "neopop metal-gold font-semibold";
  const outline = dark
    ? "border border-hairline text-text"
    : "border border-hairline text-text";

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={shareOnWhatsApp}
        className={`flex h-12 items-center gap-2 px-4 ${solid}`}
      >
        <WhatsAppIcon className="h-5 w-5" />
        Invite on WhatsApp
      </button>
      <button
        onClick={copy}
        className={`flex h-12 items-center gap-2 rounded-xl px-4 ${outline}`}
      >
        <CopyIcon className="h-5 w-5" />
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
