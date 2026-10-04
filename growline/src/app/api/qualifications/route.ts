import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { APP_TIMEZONE } from "@/lib/day";
import { checkDefinition } from "@/modules/qualifications/model";
import { createQualification } from "@/modules/qualifications/queries";

/**
 * Creating a qualification (F14).
 *
 * The creator is the session, never the body. A route that accepted a `creatorId`
 * would let any coach announce a qualification in somebody else's name, to somebody
 * else's line — and the audience is derived from that id, so it would also be a way
 * to address a line you are not in.
 *
 * The whole definition is re-validated here even though the form already did it: the
 * form is one client, and the checks that matter (a target of zero, a deadline in the
 * past, a criterion type this app cannot count) are the ones a hand-written request
 * would skip.
 *
 * ## Timezone
 *
 * The deadline is interpreted in `APP_TIMEZONE` rather than in anything the client
 * sends. A body-supplied zone would let a coach push their own closing date forward
 * by picking one, and E1's whole point is that a day boundary is decided in one place.
 * The value travels onto the document so the day this app serves a second zone, the
 * qualifications written today still mean what they meant.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to create." }, { status: 400 });
  }

  const checked = checkDefinition(
    {
      title: (body as Record<string, unknown>).title,
      criteria: (body as Record<string, unknown>).criteria,
      audience: (body as Record<string, unknown>).audience,
      deadlineKey: (body as Record<string, unknown>).deadlineKey,
    },
    APP_TIMEZONE
  );
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const result = await createQualification(user, checked.definition);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
