import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/lib/users";
import {
  PUSH_FANOUT_CAP,
  rebroadcast,
  recipientIds,
} from "@/lib/threads-queries";
import { isThreadScope } from "@/lib/threads";
import { isPushConfigured, sendToUser } from "@/lib/push";

/**
 * Pass a received message down to your own line (F8).
 *
 * This is the mechanism that lets one announcement reach thousands of people while
 * every sender only ever writes to their own line. It creates a NEW thread owned by
 * this coach, carrying the original author's name for attribution — see `rebroadcast`
 * for why a copy rather than a pointer.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const sender = await getUserById(uid);
  if (!sender) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isThreadScope(b.scope)) {
    return NextResponse.json({ error: "Choose who this goes to." }, { status: 400 });
  }

  const thread = await rebroadcast({ sender, threadId: id, scope: b.scope });
  // Null covers three cases on purpose — no such thread, not addressed to this coach,
  // or their own thread — and they answer identically so forwarding cannot be used to
  // probe for threads somebody was never sent.
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let pushed = 0;
  let recipients = 0;
  if (isPushConfigured()) {
    const { ids, total } = await recipientIds(sender, b.scope);
    recipients = total;
    const results = await Promise.allSettled(
      ids.map((id2) =>
        sendToUser(id2, {
          title: `${sender.name} passed on a message`,
          body: thread.body.slice(0, 120),
          url: "/threads",
        })
      )
    );
    pushed = results.filter((r) => r.status === "fulfilled").length;
    if (total > PUSH_FANOUT_CAP) {
      console.warn(
        `thread ${thread.id}: notified ${PUSH_FANOUT_CAP} of ${total} recipients ` +
          `(PUSH_FANOUT_CAP). All ${total} have it in their inbox.`
      );
    }
  }

  return NextResponse.json({ ok: true, id: thread.id, recipients, pushed });
}
