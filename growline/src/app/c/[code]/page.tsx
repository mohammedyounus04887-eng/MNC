import type { Metadata } from "next";
import { getUserByReferralCode } from "@/lib/users";
import { Avatar } from "@/components/Avatar";
import SelfCaptureForm from "./SelfCaptureForm";
import PrivacyLink from "@/modules/privacy/PrivacyLink";

export const metadata: Metadata = {
  title: "Get your free wellness report",
  // A prospect's details must never be indexed or crawled.
  robots: { index: false, follow: false },
};

export default async function PublicCapturePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const coach = await getUserByReferralCode(code.toUpperCase());

  if (!coach) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 text-center">
        <h1 className="text-2xl font-bold">This link isn&apos;t valid</h1>
        <p className="mt-2 text-text-dim">
          Please ask your coach to show you their QR code again.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 py-8">
      <div className="flex items-center gap-3">
        <Avatar name={coach.name} photoUrl={coach.photoUrl} size={52} />
        <div className="min-w-0">
          <p className="text-sm text-text-dim">Your wellness coach</p>
          <p className="truncate text-lg font-semibold">{coach.name}</p>
        </div>
      </div>

      <h1 className="mt-6 text-3xl font-bold leading-tight">
        Get your free wellness report
      </h1>
      <p className="mt-2 text-text-dim">
        Fill this in once — takes half a minute. {coach.name.split(" ")[0]} will send your
        report on WhatsApp.
      </p>

      <div className="mt-6">
        <SelfCaptureForm code={coach.referralCode} coachName={coach.name} />
      </div>

      {/* v2 §5.4. Below the form rather than above it: this is the screen where somebody
          types their height and weight, so the notice has to be reachable — but leading
          with a legal link on a 30-second form would cost more completions than it buys
          in informedness. It renders only once the notice exists. */}
      <p className="mt-6 text-sm text-text-dim">
        <PrivacyLink />
      </p>
    </main>
  );
}
