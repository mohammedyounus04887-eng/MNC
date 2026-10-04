import Link from "next/link";
import NewProspectForm from "./NewProspectForm";
import { BackIcon } from "@/components/icons";
import PrivacyLink from "@/modules/privacy/PrivacyLink";

export default function NewProspectPage() {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/prospects"
        className="flex h-12 items-center gap-2 self-start font-medium text-gold-ink"
      >
        <BackIcon className="h-5 w-5" />
        Back
      </Link>
      <h1 className="font-display text-3xl font-bold">New Person</h1>
      <NewProspectForm />

      {/*
       * The fourth surface v2 §5.4 asks for — QR form, report pages and Settings already
       * had it and this one was missed. It belongs here rather than inside the form
       * because the form is a client component and the publication gate reads server
       * configuration.
       *
       * Below the consent tick on purpose. A coach reading this is being asked to
       * confirm that somebody else agreed, and this is where they can check what they
       * are agreeing on that person's behalf to.
       */}
      <p className="text-sm text-text-dim">
        <PrivacyLink />
      </p>
    </div>
  );
}
