import Link from "next/link";
import { privacyNoticePublished } from "./model";

/**
 * A link to the privacy notice, or nothing.
 *
 * Renders only when the notice is actually published (v2 §5.4 requires it linked from
 * the QR form, the manual capture flow, report pages and Settings). Before the grievance
 * details are configured, `/privacy` 404s — so an unconditional link would offer a
 * prospect a dead end at precisely the moment they are being asked to hand over their
 * height and weight, which is worse than no link at all.
 *
 * A server component: the gate reads server-only configuration, and none of these four
 * placements is interactive.
 */
export default function PrivacyLink({ className = "" }: { className?: string }) {
  if (!privacyNoticePublished()) return null;
  return (
    <Link href="/privacy" className={`underline ${className}`.trim()}>
      How your details are used
    </Link>
  );
}
