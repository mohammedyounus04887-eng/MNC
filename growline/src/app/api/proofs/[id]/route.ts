import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { reviewProof, submitProof } from "@/lib/targets-queries";
import { MAX_NOTE } from "@/lib/targets";
import { gateLeaderTool } from "@/modules/tiers/queries";

/** Proof photos are re-encoded client-side; this bounds what the server accepts. */
const MAX_MEDIA_CHARS = 900_000; // ~650 KB of base64

/**
 * One endpoint, two actors, distinguished by intent:
 *
 *   { mediaUrl / submitNote }   → the downline attaching evidence
 *   { decision: approved|rejected } → the upline reviewing it
 *
 * Which of the two the caller is allowed to be is decided in targets-queries.ts, not
 * here, and an unauthorized caller gets the same 404 either way.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;

  const decision = typeof b.decision === "string" ? b.decision : null;
  if (decision !== null) {
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ error: "That decision is not valid." }, { status: 400 });
    }
    const comment = b.comment === undefined || b.comment === null ? "" : String(b.comment).trim();
    if (comment.length > MAX_NOTE) {
      return NextResponse.json({ error: "That comment is too long." }, { status: 400 });
    }
    if (decision === "rejected" && comment === "") {
      // A rejection without a reason is not "trust, digitized" — it is a dead end
      // for the downline, who cannot tell what to fix.
      return NextResponse.json(
        { error: "Add a short comment so they know what to send." },
        { status: 400 }
      );
    }
    // Leader gate (v2 §8) on the REVIEW branch only — standing and OPEN. Submitting
    // proof is the downline's action and stays free on every tier; only the upline's
    // approve/reject is a Leader tool ("validate proofs", §8).
    const gate = await gateLeaderTool(uid, "review-proofs");
    if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 402 });

    const result = await reviewProof(uid, id, decision, comment === "" ? null : comment);
    if (!result.ok) {
      const status = result.error === "Not found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ ok: true });
  }

  const rawMedia = typeof b.mediaUrl === "string" ? b.mediaUrl : "";
  if (rawMedia && !rawMedia.startsWith("data:image/jpeg;base64,")) {
    return NextResponse.json({ error: "That photo could not be used." }, { status: 400 });
  }
  if (rawMedia.length > MAX_MEDIA_CHARS) {
    return NextResponse.json({ error: "That photo is too large." }, { status: 400 });
  }
  const note = b.submitNote === undefined || b.submitNote === null ? "" : String(b.submitNote).trim();
  if (note.length > MAX_NOTE) {
    return NextResponse.json({ error: "That note is too long." }, { status: 400 });
  }

  const result = await submitProof(uid, id, rawMedia || null, note === "" ? null : note);
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
