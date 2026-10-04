import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { formatPhoneForDisplay } from "@/lib/phone";
import { TIER_INFO } from "@/modules/tiers/model";
import { getTierState } from "@/modules/tiers/queries";
import { PAY_COPY, PLANS, cancelledExplainer } from "@/modules/payments/model";
import { getPaymentState } from "@/modules/payments/queries";
import ProfileSection from "./ProfileSection";
import ReminderToggle from "./ReminderToggle";
import PrivacyToggle from "./PrivacyToggle";
import LogoutButton from "./LogoutButton";
import PrivacyLink from "@/modules/privacy/PrivacyLink";
import ThemeToggle from "@/components/ThemeToggle";
import { getTranslate } from "@/lib/locale-server";
import LanguageSwitcher from "./LanguageSwitcher";
import ClubLinkEnrollment from "./ClubLinkEnrollment";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [{ locale, t }, tierState, pay] = await Promise.all([
    getTranslate(),
    getTierState(user),
    getPaymentState(user.id),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <ThemeToggle />

      <LanguageSwitcher
        current={locale}
        title={t("settings.language.title")}
        help={t("settings.language.help")}
        savingLabel={t("settings.language.saving")}
        errorLabel={t("settings.language.error")}
        reportNote={t("settings.language.reportNote")}
      />
      <h1 className="text-2xl font-bold">Settings</h1>

      <ProfileSection
        name={user.name}
        city={user.city ?? ""}
        photoUrl={user.photoUrl}
        phoneDisplay={`+91 ${formatPhoneForDisplay(user.phone)}`}
      />

      {/*
       * Trust-first (Section 4.7), v2 §8 edition. The v1 trial countdown that lived
       * here is deleted, not reworded: it counted down 60 days to a day on which
       * nothing happened, and a countdown to nothing is the money-surprise pattern
       * §4.7 exists to prevent, inverted. Starter is free forever and this says so;
       * the trial that DOES exist (30 Leader days at the 2nd downline) is stated only
       * for the coach who has earned it.
       */}
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">My plan</h2>
        <p className="mt-2 text-3xl font-bold">
          {TIER_INFO[tierState.tier].name}
          {pay.hasSubscription && pay.plan ? (
            <span className="text-base font-medium text-text-dim">
              {" "}
              · {PLANS[pay.plan].label}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-sm text-text-dim">
          {/*
           * A coach who is being CHARGED gets the money state, not the tier blurb. The
           * tier line is written for somebody with no payment method — telling a paying
           * Leader "nothing charges by itself" while their mandate is live would be the
           * money surprise §4.7 exists to prevent, and telling a cancelled coach only
           * "Leader tools are yours" would hide the date they stop being theirs.
           *
           * Order matters: cancelled before grace before ordinary. Cancelled is the
           * state with a deadline in it, and a coach in both should read the deadline.
           */}
          {pay.hasSubscription
            ? pay.cancelled
              ? cancelledExplainer(pay.accessEndsKey)
              : pay.inGrace
                ? PAY_COPY.graceExplainer
                : PAY_COPY.mandateExplainer
            : tierState.tier === "starter"
              ? "Free forever. No payment method is connected, and nothing charges by itself."
              : "Leader tools are yours."}
          {!pay.hasSubscription && tierState.qualified && tierState.tier === "starter"
            ? " Your team earned you 30 free days of Leader — they start when payments begin."
            : ""}
        </p>
        <Link
          href="/plans"
          className="mt-3 inline-flex h-12 items-center rounded-xl border border-hairline px-4 font-medium"
        >
          {pay.hasSubscription ? "Manage my plan" : "See all plans"}
        </Link>
      </section>

      <ReminderToggle />

      {/* F11. Above the referral code on purpose — the coach should meet the
          control that decides what their upline sees before the one that invites
          people into their line. */}
      <PrivacyToggle sharing={user.shareProspects} hasUpline={user.uplineId !== null} />

      <ClubLinkEnrollment />

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">My referral code</h2>
        <p className="mt-1 text-2xl font-bold tracking-[0.25em] text-gold-ink">
          {user.referralCode}
        </p>
      </section>

      {/* v2 §5.4 asks for the notice from Settings too — this is where a coach looks
          when they want to know what the app does with their people's details. */}
      <p className="text-sm text-text-dim">
        <PrivacyLink />
      </p>

      <LogoutButton />

      <p className="text-center text-xs text-text-dim">
        Growline · Built by The Real V Developers, Bengaluru
      </p>
    </div>
  );
}
