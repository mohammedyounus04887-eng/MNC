import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { HUB_BLURB as CALL_LIST_BLURB } from "@/modules/call-list/copy";
import { HUB_BLURB as VOICE_BLURB } from "@/modules/voice-log/copy";

/**
 * "More" — the hub for screens that are not one of the five bottom-nav tabs.
 *
 * ## Why this page exists
 *
 * `AppNav` hardcodes a five-column grid. Adding a sixth tab is a layout change, not
 * a route registration, and that decision belongs to the owner — so the nav is left
 * exactly as it is and the new screens are reachable here and by URL. If a sixth tab
 * is ever approved, it points at this page and nothing else has to move.
 *
 * Entries are added as each module lands. One line each, in plain words (S6) — a hub
 * whose descriptions need reading twice is a hub nobody uses.
 *
 * ## Order
 *
 * Daily work first, then the things a coach looks at rather than does. "Who to call
 * today" and "Say today's work" are both part of an evening; boards, qualifications and
 * duplication are all read-only screens somebody opens when they have a minute. A hub
 * sorted by what it cost to build would put them the other way round.
 */

const LINKS = [
  {
    href: "/portfolio",
    title: "My Page",
    body: "Your own link — growline.in/yourname. Photo, your story, and two buttons a new person can press. Goes on every report you send.",
  },
  {
    href: "/who-to-call",
    title: "Who to call today",
    body: CALL_LIST_BLURB,
  },
  {
    href: "/wall",
    title: "The Wall",
    body: "What your group has done in the last two weeks — first person, first member, streaks, targets reached. Nobody writes these; they are earned.",
  },
  {
    href: "/plans",
    title: "Plans",
    body: "What Growline costs and what each plan includes. Nothing is locked during launch.",
  },
  {
    href: "/voice-log",
    title: "Say today's work",
    body: VOICE_BLURB,
  },
  {
    href: "/leaderboards",
    title: "Boards",
    body: "Four boards — volume, people met, follow-ups and your logging streak. Weekly and monthly.",
  },
  {
    href: "/qualifications",
    title: "Qualifications",
    body: "Conditions and a closing date. Track what is left, see who is already in, and set one for your own line.",
  },
  {
    href: "/duplication",
    title: "Duplication",
    body: "One number: is the work happening only at the top, or all the way down your line? With the level-by-level count behind it.",
  },
];

export default async function MorePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">More</h1>
        <p className="mt-1 text-text-dim">Everything that is not on the bottom bar.</p>
      </div>

      <ul className="flex flex-col gap-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="block rounded-2xl bg-surface p-5 transition-transform duration-150 active:translate-y-px"
            >
              <span className="font-display text-xl font-bold">{l.title}</span>
              <span className="mt-1 block text-sm text-text-dim">{l.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
