import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/lib/users";
import {
  PUSH_FANOUT_CAP,
  createThread,
  recipientIds,
} from "@/lib/threads-queries";
import { checkBody, checkLinkUrl, isThreadScope } from "@/lib/threads";
import { isPushConfigured, sendToUser } from "@/lib/push";
import { gateLeaderTool } from "@/modules/tiers/queries";

/**
 * A coach broadcasts to their line (F8).
 *
 * POST rather than PUT: this is not idempotent, and it must not be. Two identical
 * announcements sent an hour apart are two announcements, each with its own
 * acknowledgements — collapsing them on content would silently swallow the second.
 */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const sender = await getUserById(uid);
  if (!sender) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // Leader gate (v2 §8) — standing and OPEN; see /api/targets for the reasoning.
  const gate = await gateLeaderTool(sender, "send-threads");
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 402 });

  const body = await req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;

  // Scope is never defaulted. Guessing "all" would broadcast further than the coach
  // asked, and guessing "direct" would quietly withhold a message they meant to send
  // to everyone — both are wrong in a way the sender cannot see afterwards.
  if (!isThreadScope(b.scope)) {
    return NextResponse.json({ error: "Choose who this goes to." }, { status: 400 });
  }
  const scope = b.scope;

  const bodyCheck = checkBody(b.body);
  if (!bodyCheck.ok) {
    return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
  }
  const linkCheck = checkLinkUrl(b.linkUrl);
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.error }, { status: 400 });
  }

  const thread = await createThread({
    sender,
    scope,
    body: bodyCheck.body,
    linkUrl: linkCheck.linkUrl,
  });

  /**
   * Push is best-effort and deliberately after the write.
   *
   * The thread is delivered the moment it is stored — it is in every recipient's
   * inbox query and the Firestore listener surfaces it without a refresh. A push
   * failure must therefore never fail this request: the coach would be told their
   * broadcast did not send when in fact their whole line already has it.
   */
  let pushed = 0;
  let recipients = 0;
  if (isPushConfigured()) {
    const { ids, total } = await recipientIds(sender, scope);
    recipients = total;
    const results = await Promise.allSettled(
      ids.map((id) =>
        sendToUser(id, {
          title: `${sender.name} sent your line a message`,
          // The body itself, trimmed — not a teaser. A coach glancing at a lock
          // screen should be able to act on it without opening the app.
          body: bodyCheck.body.slice(0, 120),
          url: "/threads",
        })
      )
    );
    pushed = results.filter((r) => r.status === "fulfilled").length;
    if (total > PUSH_FANOUT_CAP) {
      // Never let a cap be silent (the no-silent-caps rule): the thread reached
      // everyone, the notification did not.
      console.warn(
        `thread ${thread.id}: notified ${PUSH_FANOUT_CAP} of ${total} recipients ` +
          `(PUSH_FANOUT_CAP). All ${total} have it in their inbox.`
      );
    }
  }

  return NextResponse.json({ ok: true, id: thread.id, recipients, pushed });
}
