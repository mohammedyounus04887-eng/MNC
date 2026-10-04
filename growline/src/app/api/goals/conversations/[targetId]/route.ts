import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { targetDocId } from "@/lib/collections";
import { currentMonth, isMonthKey } from "@/lib/targets";
import {
  accept,
  getConversation,
  propose,
  requestChange,
  setActionDone,
  type ConversationResult,
} from "@/modules/goals/conversations";

/**
 * The conversation around one target (A3).
 *
 * Four actions on one route because they are four moves in a single exchange and each
 * one's authorisation depends on the same document: who proposed, and who it is for.
 * Splitting them across four routes would mean loading and re-deriving that four times.
 *
 * Proposing is a SEPARATE call from setting the target itself. `/api/targets` is existing,
 * working code this work was not authorised to change, so the client sets the number and
 * then records the agreement. The two can therefore diverge — a target with no
 * conversation — and that is handled where it matters rather than pretended away: a target
 * with no conversation reads as "proposed", the same as one nobody has answered yet, which
 * is exactly what every target set before this feature existed actually is.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ targetId: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { targetId } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";

  let result: ConversationResult;

  switch (action) {
    case "propose": {
      const coachId = typeof b.coachId === "string" ? b.coachId : "";
      if (b.month !== undefined && b.month !== null && !isMonthKey(b.month)) {
        return NextResponse.json({ error: "That month is not valid." }, { status: 400 });
      }
      const month = isMonthKey(b.month) ? b.month : currentMonth();

      // The target id is derived from (coach, month), so recomputing it is a complete
      // check: an upline cannot attach a conversation to a target id they invented or
      // copied from somebody else's screen.
      if (!coachId || targetDocId(coachId, month) !== targetId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      result = await propose({
        targetId,
        coachId,
        uplineId: uid,
        month,
        proposedPoints: Number(b.proposedPoints),
        actions: b.actions,
      });
      break;
    }

    case "accept":
      result = await accept(targetId, uid);
      break;

    case "request-change":
      result = await requestChange(targetId, uid, b.note);
      break;

    case "set-action-done":
      result = await setActionDone(targetId, uid, Number(b.index), b.done === true);
      break;

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (!result.ok) {
    // "Not found" covers both a missing conversation and one the caller has no part in,
    // so this cannot be used to probe who has a target set.
    const status = result.error === "Not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, conversation: result.conversation });
}

/** The state of one conversation, for a screen that needs it on its own. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ targetId: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { targetId } = await params;
  const conversation = await getConversation(targetId);
  if (!conversation || (conversation.coachId !== uid && conversation.uplineId !== uid)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}
