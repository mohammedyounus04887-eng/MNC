import Link from "next/link";
import type { Metadata } from "next";
import { getUserByReferralCode } from "@/lib/users";
import { Avatar } from "@/components/Avatar";

/**
 * Not indexed, for the same reason `/c/{code}` and `/r/{token}` are not.
 *
 * This page renders a coach's NAME and PHOTO to anybody holding a referral code, and
 * referral codes are short and shared widely — WhatsApp, posters, club walls. Its two
 * sibling public routes both set this and this one did not, so a shared invite link was
 * enough to put a coach's face and name into a search index.
 *
 * The distinction that makes this a defect rather than a preference: the public portfolio
 * IS deliberately indexed, because a coach chose to publish it and wants to be findable.
 * Nobody chooses this page. Being recruited is not a decision to appear in search results.
 *
 * Found by the data-inventory pass on 2026-08-20, which noticed the asymmetry between the
 * three public routes. Nothing else would have: it is the absence of a line.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const upline = await getUserByReferralCode(code.toUpperCase());

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">
        Grow<span className="text-gold-ink">line</span>
      </h1>
      {upline ? (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl bg-surface px-6 py-10 text-center">
          <Avatar name={upline.name} photoUrl={upline.photoUrl} size={72} />
          <div>
            <h2 className="text-xl font-semibold">{upline.name} invited you</h2>
            <p className="mt-1 text-text-dim">
              Join {upline.name.split(" ")[0]}&apos;s team on Growline
              {upline.city ? ` · ${upline.city}` : ""}
            </p>
          </div>
          <Link
            href={`/login?ref=${upline.referralCode}`}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-gold text-lg font-semibold text-on-gold"
          >
            Continue with mobile number
          </Link>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-surface px-6 py-10 text-center">
          <h2 className="text-xl font-semibold">This invite link isn&apos;t valid</h2>
          <p className="text-text-dim">
            Ask your coach to share their invite again, or sign up without a code.
          </p>
          <Link
            href="/login"
            className="flex h-14 w-full items-center justify-center rounded-xl bg-gold text-lg font-semibold text-on-gold"
          >
            Go to sign up
          </Link>
        </div>
      )}
    </main>
  );
}
