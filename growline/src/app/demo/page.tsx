import { notFound } from "next/navigation";
import { DEMO_ROLES, isDemoMode } from "@/lib/demo";
import DemoPicker from "./DemoPicker";

/**
 * The demo entry point: `/demo`.
 *
 * `notFound()` when demo mode is off, so on the production deployment this route is
 * indistinguishable from a typo. That is the whole gate — there is no second way in.
 */
export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isDemoMode()) notFound();

  const { next } = await searchParams;
  /**
   * Only a same-site path is honoured. `next` arrives in a URL, so an absolute one would
   * make this an open redirect — and a redirect that runs immediately after a session
   * cookie is set is the worst possible place to have one. `//evil.com` is rejected too:
   * it is protocol-relative, so the leading-slash test alone is not enough.
   */
  const target =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-5 px-4 py-10">
      <div>
        <h1 className="font-display text-3xl font-bold">Demo</h1>
        <p className="mt-2 text-text-dim">
          Pick a seat and the app opens as that coach — no OTP, no waiting. Switch at
          any time from the chip in the corner.
        </p>
      </div>

      <DemoPicker roles={DEMO_ROLES} next={target} />

      <p className="text-sm text-text-dim">
        This is the real app on demo data, not a mock-up — the same screens, rules and
        privacy settings a paying coach gets.
      </p>
    </main>
  );
}
