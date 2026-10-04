import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { parseProspectInput } from "@/lib/prospect";
import { ensureCurrentReport } from "@/lib/report";
import { createProspect, listProspectsByCoach } from "@/lib/prospects";

const MAX_CLIENT_ID = 64;

export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // Scoped to the signed-in coach only. An upline has no route to these rows
  // (Section 5.4) — only activity counts ever travel upward.
  const rows = await listProspectsByCoach(uid);
  const prospects = rows.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    age: p.age,
    gender: p.gender,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    stage: p.stage,
    source: p.source,
    createdAt: p.createdAt,
  }));
  return NextResponse.json({ prospects });
}

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["name", "phone", "age", "gender", "heightCm", "weightKg", "clientId", "consentGiven"].includes(key))) {
    return NextResponse.json({ error: "Could not read this person's details." }, { status: 400 });
  }
  const parsed = parseProspectInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const rawClientId = (body as Record<string, unknown>)?.clientId;
  const clientId =
    typeof rawClientId === "string" && rawClientId.length > 0
      ? rawClientId.slice(0, MAX_CLIENT_ID)
      : null;

  /**
   * Mode A consent is a HARD requirement (v2 §5.2, RULES P6), enforced here and not only
   * by a disabled button.
   *
   * The person whose name, number and body measurements are being stored is not in this
   * request and cannot object to it, so the gate has to live where it cannot be skipped
   * — a client that omits the flag is refused rather than defaulted.
   *
   * Strict `=== true`: no coercion, for the same reason as the privacy toggle (D50).
   * `Boolean("false")` is `true`, and recording consent nobody gave is the one mistake
   * this field must not be able to make.
   */
  if ((body as Record<string, unknown>)?.consentGiven !== true) {
    return NextResponse.json(
      {
        error:
          "Please confirm this person knows you are saving their details and agrees.",
      },
      { status: 400 }
    );
  }

  // Replaying a queued capture must not create a second person. The check is no
  // longer a lookup-then-insert: the composite document id makes it atomic (D35).
  let created;
  try { created = await createProspect({
    coachId: uid,
    clientId,
    source: "manual",
    consentGiven: true,
    ...parsed.value,
  }); } catch (error) {
    const conflict = error instanceof Error && error.message === "CAPTURE_IDEMPOTENCY_CONFLICT";
    return NextResponse.json({ error: conflict ? "These details conflict with the saved capture." : "Your workspace is unavailable. Please ask your administrator for help." }, { status: conflict ? 409 : 403 });
  }
  const { prospect, duplicate } = created;
  if (duplicate) {
    return NextResponse.json({ ok: true, id: prospect.id, duplicate: true });
  }

  // F3: the report is generated on save, not on demand, so it's ready to send.
  const report = await ensureCurrentReport(prospect);
  return NextResponse.json({
    ok: true,
    id: prospect.id,
    name: prospect.name,
    reportToken: report?.token ?? null,
  });
}
