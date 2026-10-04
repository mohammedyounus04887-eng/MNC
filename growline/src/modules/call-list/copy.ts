/**
 * Every sentence the call list says (session 4, feature 2).
 *
 * Pure and collected, so `tests/call-list.test.ts` can walk it for L1, L2 and L4 the
 * way the other modules do. The tone rule here: this screen tells a coach what to do
 * next, so it must never sound like a scolding for what they have not done. "8 days
 * late" is a fact they can act on this evening; "you have neglected 8 people" is a
 * verdict, and a verdict makes the screen something to avoid.
 */

export const TITLE = "Who to call today";

export const SUBTITLE =
  "Your own people, in the order they need you. The reason is next to every name.";

/** How the order was arrived at, in one line, on the screen rather than in a doc. */
export const HOW_IT_IS_ORDERED =
  "People you promised a call come first, oldest promise at the top. Then today's promises. Then the ones nobody has set a date for, furthest through the conversation first.";

/** Nobody has ever been captured. */
export const NO_PROSPECTS_HEADING = "Nothing to call yet";
export const NO_PROSPECTS_BODY =
  "This fills itself from the people you save. Capture someone on your next walk and they appear here the day a call is due — or straight away if you set no date.";

/** People exist, all with dates in the future. The good empty state. */
export const ALL_SCHEDULED_HEADING = "Nothing due today";

export function allScheduledBody(nextInDays: number | null): string {
  if (nextInDays === null || nextInDays <= 0) return "Every follow-up is set for later.";
  if (nextInDays === 1) return "Your next follow-up is tomorrow. Today is clear.";
  return `Your next follow-up is in ${nextInDays} days. Today is clear.`;
}

/** People exist, but every one of them has joined. */
export const ALL_MEMBERS_HEADING = "Everyone has joined";
export const ALL_MEMBERS_BODY =
  "Every person you are tracking is a member now, so there is nobody left to call. Capture someone new and this list starts again.";

export const CALL_LABEL = "Call";
export const WHATSAPP_LABEL = "WhatsApp";

/** Said once at the foot, because a capped list must admit it is capped. */
export function cappedNote(shown: number, total: number): string {
  if (total <= shown) return "";
  return `Showing ${shown} of ${total}. The rest are here tomorrow — a list you cannot finish is a list you do not start.`;
}

/** The privacy statement, said plainly because it is the point (P1). */
export const YOURS_ONLY =
  "These are your people only. Nobody in your line sees this list, and you never see theirs.";

/**
 * The hub line. It said "the six people worth a call" until the L4 test caught it:
 * "worth" beside a ranked list of people reads as an estimate of what each one is
 * worth, which is the exact thing a ranking of prospects must never be mistaken for.
 */
export const HUB_BLURB =
  "The people who need a call this evening, in order, with the reason next to each name.";
