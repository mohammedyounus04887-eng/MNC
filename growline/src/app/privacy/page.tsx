import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HEALTH_RETENTION_DAYS, privacyContact, privacyEnv, privacyNoticePublished } from "@/modules/privacy/model";
// Straight from the token's own module. Not routed through the privacy model, which
// stays free of anything that reaches the database — see the note there.
import { REPORT_TTL_DAYS as REPORT_LINK_DAYS } from "@/lib/report";

/**
 * The itemised privacy notice (v2 §5.4, DPDP Act 2023 + Rules 2025).
 *
 * ## Public, and that has to be tested
 *
 * A prospect reaches this from a QR form or a report page having never signed in, so it
 * is added to `PUBLIC_PATHS` in `src/proxy.ts`. Without that the proxy sends it to
 * `/login` — which is D68 exactly: a page that exists, renders, passes every unit test,
 * and is unreachable by the only people it was written for. There is a signed-out e2e
 * test for this.
 *
 * ## 404 until it is complete
 *
 * Four facts are not derivable from code — the legal entity, a named grievance officer,
 * their email, a postal address. Until all four are configured this route does not
 * exist. See `src/modules/privacy/model.ts` for why the alternative, a notice with gaps
 * in it, is worse than no notice.
 *
 * ## Everything else here is derived from the code, not aspirational
 *
 * Each retention figure is imported from the constant the job actually uses rather than
 * typed in. Where the app does something a reader would not expect — a report link being
 * a bearer credential, activity counts flowing up the tree even with sharing off — this
 * says so plainly. A notice that describes a nicer product than the one running is the
 * failure mode worth avoiding.
 *
 * ## Still outstanding: Kannada and Hindi
 *
 * v2 §5.4 requires this in English, Kannada and Hindi. Only English exists. Machine
 * translation of a legal document is not acceptable and D72 already forbids shipping
 * unverified translations, so the other two need a human. Recorded in STATUS.
 */

export const metadata: Metadata = {
  title: "Privacy — Growline",
  description: "What Growline collects, why, how long it is kept, and how to have it removed.",
  // A legal notice should be findable; unlike report links it holds nothing personal.
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  if (!privacyNoticePublished()) notFound();
  const contact = privacyContact(privacyEnv());
  if (!contact) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 text-text">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Privacy</h1>
        <p className="text-text-dim">
          What Growline collects, why, how long it is kept, and how to have it removed.
        </p>
      </header>

      <Section title="Who holds your data">
        <p>
          {contact.entityName} operates Growline and is the data fiduciary for the
          information described here.
        </p>
        <p>
          If you have a complaint about how your information has been handled, contact our
          grievance officer:
        </p>
        <p className="rounded-xl bg-surface px-4 py-3">
          {contact.grievanceOfficer}
          <br />
          <a className="underline" href={`mailto:${contact.grievanceEmail}`}>
            {contact.grievanceEmail}
          </a>
          <br />
          <span className="whitespace-pre-line">{contact.postalAddress}</span>
        </p>
      </Section>

      <Section title="If a coach saved your details">
        <p>
          Growline is used by independent wellness coaches. If you met a coach and they
          saved your details — or you filled in their form yourself — this is what exists
          about you.
        </p>
        <List
          items={[
            [
              "Your name and phone number",
              "so the coach can contact you. These are kept for as long as the coach uses Growline — nothing deletes them automatically, and the health figures below are deleted on their own schedule while these are not.",
            ],
            [
              "Your age, gender, height and weight, if you gave them",
              `used once to produce your wellness estimates. Automatically deleted after ${HEALTH_RETENTION_DAYS} days without contact, along with everything calculated from them. Your name and number are not deleted by that job.`,
            ],
            [
              "Estimates calculated from those numbers",
              "BMI and its general range, an estimated body fat percentage, a basal metabolic rate, a healthy weight range and a daily water target. These are general wellness estimates and are not medical advice, not a diagnosis, and not a health assessment.",
            ],
            ["Notes the coach types about your conversation", "visible to that coach."],
            ["Which stage of their follow-up list you are on", "and when they plan to contact you next."],
          ]}
        />
        <p>
          We do not collect or calculate anything about cholesterol, blood pressure, blood
          sugar, muscle mass or any disease risk. That is not possible from a height and a
          weight, and Growline does not claim to do it.
        </p>
      </Section>

      <Section title="Your wellness report link">
        <p>
          The report a coach sends you on WhatsApp is a private link. Anyone holding that
          link can open the report, so treat it as you would a document sent to you — it
          is not protected by a password.
        </p>
        <List
          items={[
            [`It stops working after ${REPORT_LINK_DAYS} days`, "after which the link is dead."],
            ["It shows your first name only", "never your phone number."],
            ["It is not indexed by search engines", "and carries no referrer."],
            [
              "You can remove it yourself, while the link works",
              `every report page carries a control that deletes the report and everything behind it — including your name and phone number. You do not need an account and you do not need to ask the coach. It works for as long as the link does: once the ${REPORT_LINK_DAYS} days are up the link is dead and so is that control, and you would need to write to the grievance officer above instead.`,
            ],
          ]}
        />
      </Section>

      <Section title="What your coach’s upline can and cannot see">
        <p>
          Coaches work in teams. By default, a coach’s mentor sees <strong>numbers only</strong> —
          how many people were spoken to, invited or joined — and never your name or phone
          number.
        </p>
        <p>
          A coach can choose to share prospect details with their mentor. That setting is
          off unless they turn it on, and it is enforced by the database itself rather than
          only by the app. Activity counts flow upward either way; if you would rather a
          coach not hold your details at all, ask them to delete you or use the removal
          control on your report.
        </p>
      </Section>

      <Section title="If you are a coach using Growline">
        <List
          items={[
            [
              "Your phone number",
              "it is how prospects and your team reach you — it appears on the reports you send and behind the WhatsApp button on your public page, if you publish one. When you sign in by phone it is verified by SMS. When you sign in with an email address it is saved as you typed it, unverified.",
            ],
            [
              "Your email address, if you sign in with one",
              "used to sign you in and to send you a password reset, and for nothing else. It does not appear on reports or on your public page, and your team never sees it.",
            ],
            ["Your name, city and photo, if you add one", "your name and photo appear on reports you send and on your public page, if you publish one."],
            ["Your daily activity, targets and team position", "the business record the app exists to keep."],
            ["Anything you type into notes, messages to your team, or goals", "stored as written."],
            ["Photos you attach as proof of progress", "re-encoded when uploaded, which removes camera metadata such as location."],
            [
              "Voice notes, if you use voice logging",
              "the recording is deleted automatically after a short period. The text it was turned into, and the numbers you confirm from it, are kept — so treat the transcript as something that stays.",
            ],
          ]}
        />
      </Section>

      <Section title="Who else receives information">
        <List
          items={[
            [
              "Google (Firebase)",
              "hosting, the database, and sign-in: the SMS that verifies a phone number, or the email address and password of a coach who signs in that way.",
            ],
            [
              "Google (speech recognition), only if a coach uses voice logging",
              "the browser's speech feature sends what is spoken to Google to be turned into text, the same way a phone keyboard's microphone key does. A coach who would rather nothing left their phone can type their numbers in instead.",
            ],
            [
              "Razorpay, only if a coach subscribes",
              "handles the payment. Growline never sees or stores a card, UPI id or bank detail — there is no field for one in our records.",
            ],
            [
              "WhatsApp, only when a coach chooses to send something",
              "messages are sent from the coach’s own phone and their own WhatsApp account. Growline does not send messages on their behalf and has no access to their chats.",
            ],
          ]}
        />
        <p>
          We do not sell information to anyone, and we do not use it for advertising.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Growline does not produce wellness reports for anyone under 18. If a coach enters
          an age under 18 the app refuses rather than producing a limited report.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under the Digital Personal Data Protection Act 2023 you can ask us to:</p>
        <List
          items={[
            ["Tell you what we hold about you", "and why."],
            ["Correct anything that is wrong", "or incomplete."],
            [
              "Delete it",
              "if you have a working report link, the control on that page does it immediately and without asking anyone. Otherwise — if the link has expired, or a coach saved your details and never sent you one — write to the grievance officer above and we will do it.",
            ],
            ["Complain", "to our grievance officer above, and to the Data Protection Board of India if we do not resolve it."],
          ]}
        />
        <p>
          Write to the grievance officer above to exercise any of these. We will respond
          within the period the law requires.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this notice changes materially we will say so in the app rather than only
          editing this page.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Term/description pairs. A definition list, because that is what this content is. */
function List({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {items.map(([term, detail]) => (
        <div key={term}>
          <dt className="font-medium">{term}</dt>
          <dd className="text-text-dim">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
