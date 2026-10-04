import { NextResponse } from "next/server";
import { getProspectForCoach, updateProspect } from "@/lib/prospects";
import { getSessionUserId } from "@/lib/session";
import { isStage } from "@/lib/pipeline";
import { touchProspect } from "@/modules/retention/activity";

const MAX_NOTES = 2000;
/** A follow-up further out than this is a typo, not a plan. */
const MAX_FOLLOWUP_DAYS = 730;

/**
 * Pipeline edits: stage, next follow-up, notes. Deliberately separate from the
 * details PATCH, which validates the six capture fields as a set — a one-tap stage
 * move must not have to resend a name and phone to succeed.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  // Same 404 for "not yours" as for "not found".
  const existing = await getProspectForCoach(id, uid);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const data: { stage?: string; nextFollowupAt?: Date | null; notes?: string | null } =
    {};

  if (b.stage !== undefined) {
    if (!isStage(b.stage)) {
      return NextResponse.json({ error: "That stage is not valid." }, { status: 400 });
    }
    data.stage = b.stage;
  }

  if (b.nextFollowupAt !== undefined) {
    if (b.nextFollowupAt === null || b.nextFollowupAt === "") {
      data.nextFollowupAt = null;
    } else {
      const when = new Date(String(b.nextFollowupAt));
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "That date is not valid." }, { status: 400 });
      }
      const limit = Date.now() + MAX_FOLLOWUP_DAYS * 86_400_000;
      if (when.getTime() > limit) {
        return NextResponse.json(
          { error: "Pick a follow-up date within the next two years." },
          { status: 400 }
        );
      }
      data.nextFollowupAt = when;
    }
  }

  if (b.notes !== undefined) {
    const notes = b.notes === null ? "" : String(b.notes);
    if (notes.length > MAX_NOTES) {
      return NextResponse.json(
        { error: "That note is too long." },
        { status: 400 }
      );
    }
    // Store trimmed: checking `.trim()` for emptiness but saving the raw string
    // would keep a note's padding while discarding an all-whitespace one.
    const trimmed = notes.trim();
    data.notes = trimmed === "" ? null : trimmed;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const updated = await updateProspect(id, data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /**
   * A stage move is activity, and it is one of the two things RULES P5 names (the other
   * is the prospect opening their report). Awaited rather than fired off, because this
   * route already went to the database and losing the touch would eventually delete
   * health data on a live relationship.
   *
   * Only a STAGE move. Editing notes or nudging a follow-up date is the coach tidying
   * their own records, not contact with the person, and counting it would let a
   * prospect's health data survive on activity they took no part in.
   */
  if (data.stage !== undefined) await touchProspect(id, "stage");
  return NextResponse.json({
    ok: true,
    prospect: {
      id: updated.id,
      stage: updated.stage,
      nextFollowupAt: updated.nextFollowupAt,
      notes: updated.notes,
    },
  });
}
