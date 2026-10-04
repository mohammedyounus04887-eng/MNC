import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getCallList } from "@/modules/call-list/queries";
import { MAX_LIST, telLink, whatsappLink, type RankedCall } from "@/modules/call-list/rank";
import * as copy from "@/modules/call-list/copy";

/**
 * Who to call today (session 4, feature 2).
 *
 * ## A glance and a tap, and no JavaScript
 *
 * Server-rendered end to end. There is no filter, no sort control and no switcher: the
 * order IS the answer, and offering a coach standing on a road the chance to re-sort it
 * would be handing back the decision the screen exists to make. That also means the
 * page ships no client bundle, loads in one render, and passes the 30-second rule by
 * having almost nothing to operate — the same argument the duplication screen makes.
 *
 * Every row has three targets: the name opens the person, and two 48px buttons dial or
 * open WhatsApp. `wa.me` only (S4), from the coach's own number.
 *
 * ## Colour (G3)
 *
 * One accent — gold, on the actions. The list is otherwise monochrome, because the
 * ORDER is what carries urgency and colouring five rows five ways would make the
 * ranking harder to read rather than easier. The single exception is a hairline on the
 * left of a row where a promised call was missed: that is colour as an event, on the
 * rows that earned it, which is exactly what the 90% rule permits.
 *
 * ## Three different empty states
 *
 * Nothing captured, everything scheduled for later, everyone already a member. They are
 * genuinely different situations and a shared "no results" box would teach none of them.
 * None renders an empty list.
 */

function Teach({ headline, body }: { headline: string; body: string }) {
  return (
    <section className="rounded-2xl bg-surface p-5" data-testid="call-list-empty">
      <h2 className="font-display text-xl font-bold">{headline}</h2>
      <p className="mt-2 text-text-dim">{body}</p>
    </section>
  );
}

function CallRow({ call, position }: { call: RankedCall; position: number }) {
  return (
    <li
      data-testid="call-row"
      data-urgency={call.urgency}
      data-position={position}
      className={`rounded-2xl bg-surface p-4 ${
        call.urgency === "late" ? "border-l-2 border-heat" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/prospects/${call.id}`}
            className="font-display text-xl font-bold text-text"
          >
            {call.name}
          </Link>
          {/* The explanation sits on the row, never behind a tap: a ranked list a
              coach cannot audit is a list they override or ignore. */}
          <p className="mt-1 text-sm text-text" data-testid="call-reason">
            {call.reason}
          </p>
          <p className="mt-0.5 text-sm text-text-dim">{call.detail}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={telLink(call.phone)}
            aria-label={`${copy.CALL_LABEL} ${call.name}`}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-xl"
          >
            <span aria-hidden>📞</span>
          </a>
          <a
            href={whatsappLink(call.phone)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${copy.WHATSAPP_LABEL} ${call.name}`}
            className="metal-gold neopop flex h-12 min-w-12 items-center justify-center px-3 text-sm font-bold"
          >
            {copy.WHATSAPP_LABEL}
          </a>
        </div>
      </div>
    </li>
  );
}

export default async function WhoToCallPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const list = await getCallList(user.id);

  const header = (
    <div>
      <h1 className="font-display text-3xl font-bold text-text">{copy.TITLE}</h1>
      <p className="mt-1 text-text-dim">{copy.SUBTITLE}</p>
    </div>
  );

  if (list.calls.length === 0) {
    const nothingCapturedAtAll =
      list.total === 0 && list.scheduledLater === 0 && list.members === 0;

    return (
      <div className="flex flex-col gap-5">
        {header}
        {nothingCapturedAtAll ? (
          <Teach
            headline={copy.NO_PROSPECTS_HEADING}
            body={copy.NO_PROSPECTS_BODY}
          />
        ) : list.scheduledLater > 0 ? (
          <Teach
            headline={copy.ALL_SCHEDULED_HEADING}
            body={copy.allScheduledBody(list.nextInDays)}
          />
        ) : (
          <Teach headline={copy.ALL_MEMBERS_HEADING} body={copy.ALL_MEMBERS_BODY} />
        )}
        <p className="text-sm text-text-dim">{copy.YOURS_ONLY}</p>
        <Link
          href="/prospects/new"
          className="metal-gold neopop inline-flex min-h-14 items-center justify-center px-6 font-bold"
        >
          Save a new person
        </Link>
      </div>
    );
  }

  const capped = copy.cappedNote(Math.min(MAX_LIST, list.calls.length), list.total);

  return (
    <div className="flex flex-col gap-5">
      {header}

      <ul className="flex flex-col gap-3" data-testid="call-list">
        {list.calls.map((call, i) => (
          <CallRow key={call.id} call={call} position={i + 1} />
        ))}
      </ul>

      {capped && <p className="text-sm text-text-dim">{capped}</p>}

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-display text-lg font-bold">How this is ordered</h2>
        <p className="mt-2 text-sm text-text-dim">{copy.HOW_IT_IS_ORDERED}</p>
      </section>

      {list.scheduledLater > 0 && (
        <p className="text-sm text-text-dim">
          {list.scheduledLater === 1
            ? "1 other person has a follow-up set for a later day."
            : `${list.scheduledLater} other people have follow-ups set for later days.`}
        </p>
      )}

      <p className="text-sm text-text-dim">{copy.YOURS_ONLY}</p>
    </div>
  );
}
