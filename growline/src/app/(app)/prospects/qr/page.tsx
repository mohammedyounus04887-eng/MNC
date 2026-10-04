import Link from "next/link";
import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/site-url";
import QRCode from "qrcode";
import { getSessionUser } from "@/lib/session";
import { DISCLAIMER } from "@/lib/report-copy";
import { BackIcon } from "@/components/icons";
import PrintButton from "./PrintButton";

export default async function QrPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const captureUrl = `${await siteUrl()}/c/${user.referralCode}`;

  // Rendered server-side so the phone downloads an image, not a QR library.
  const qrSvg = await QRCode.toString(captureUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#14213D", light: "#FFFFFF" },
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/prospects"
        className="flex h-12 items-center gap-2 self-start font-medium text-gold-ink print:hidden"
      >
        <BackIcon className="h-5 w-5" />
        Back
      </Link>
      <h1 className="text-2xl font-bold print:hidden">My QR code</h1>
      <p className="text-text-dim print:hidden">
        Show this on your phone or print it for your club wall. They scan, fill their
        own details, and appear in your list.
      </p>

      {/* The poster — this is the only part that prints */}
      <section className="flex flex-col items-center gap-4 rounded-2xl border border-hairline bg-elevated px-6 py-8 text-center">
        <p className="text-lg font-semibold">Scan for your free wellness report</p>
        <div
          className="w-full max-w-[260px] [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div>
          <p className="text-xl font-bold">{user.name}</p>
          {user.city && <p className="text-text-dim">{user.city}</p>}
        </div>
        <p className="text-sm text-text-dim">
          Or open <span className="font-medium">{captureUrl.replace(/^https?:\/\//, "")}</span>
        </p>
        {/* A disclaimer only counts if it can be read: navy/70 keeps it above the
            WCAG AA 4.5:1 contrast floor, where navy/40 did not. */}
        <p className="max-w-xs text-sm text-text-dim">{DISCLAIMER}</p>
      </section>

      <PrintButton />
    </div>
  );
}
