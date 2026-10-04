import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { LOG_FIELDS, MAX_COUNT, todayKey, type DailyLogValues } from "@/lib/daily-log";
import { MAX_AUDIO_BYTES } from "@/modules/voice-log/model";
import { markCounted, saveNote } from "@/modules/voice-log/queries";

/**
 * The voice note's two writes (session 4, feature 1).
 *
 * POST   stores a recording for a day, replacing any earlier one.
 * PATCH  marks that day's note counted, once the numbers have landed in the daily log.
 *
 * ## What this route deliberately does NOT do
 *
 * It never writes a `dailyLogs` document. The confirmed counts go to the existing
 * `PUT /api/logs`, which owns that collection, validates the same way for both screens,
 * and keeps the streak, the boards and the upline roll-up reading one writer's output.
 * A second writer here would be the "same job done five different ways" this project
 * was rebuilt to stop.
 *
 * ## Body size
 *
 * The audio arrives as base64 in JSON. That is bounded twice — once in the recorder,
 * once in `saveNote` — because a client-side cap is a courtesy and a server-side cap is
 * the actual limit.
 */

/** base64 is 4 characters per 3 bytes; the ceiling in characters, plus padding slack. */
const MAX_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8;

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const audio = typeof b.audioBase64 === "string" ? b.audioBase64 : "";
  // A `data:` URL is what a FileReader hands back; accept it and keep only the payload.
  const payload = audio.includes(",") ? audio.slice(audio.indexOf(",") + 1) : audio;
  if (!payload) {
    return NextResponse.json({ error: "That recording is empty." }, { status: 400 });
  }
  if (payload.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: "That recording is too large to save." }, { status: 413 });
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) {
    return NextResponse.json({ error: "That recording is not readable." }, { status: 400 });
  }

  const mimeType = typeof b.mimeType === "string" && b.mimeType ? b.mimeType.slice(0, 80) : "audio/webm";
  if (!mimeType.startsWith("audio/")) {
    return NextResponse.json({ error: "That is not an audio recording." }, { status: 400 });
  }

  const transcriptRaw = typeof b.transcript === "string" ? b.transcript.trim() : "";
  const heard = Array.isArray(b.heard)
    ? b.heard.filter((k): k is (typeof LOG_FIELDS)[number]["key"] =>
        LOG_FIELDS.some((f) => f.key === k)
      )
    : [];

  const result = await saveNote({
    userId: uid,
    dayKey: typeof b.dayKey === "string" && b.dayKey ? b.dayKey : todayKey(),
    audioBase64: payload,
    mimeType,
    durationMs: Number(b.durationMs),
    // Bounded so a recogniser that runs away cannot write an essay into the document.
    transcript: transcriptRaw ? transcriptRaw.slice(0, 500) : null,
    heard,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id });
}

/**
 * Marks the day's note counted and drops its audio.
 *
 * Sent by the recorder only after `PUT /api/logs` returned ok. Validating the counts
 * again here is not duplication for its own sake — they are written onto the note as a
 * receipt, and a receipt nobody checked is a number that can disagree with the log it
 * claims to describe.
 */
export async function PATCH(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const values = { note: null } as DailyLogValues;
  for (const field of LOG_FIELDS) {
    const n = b[field.key] === undefined || b[field.key] === null ? 0 : Number(b[field.key]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
      return NextResponse.json({ error: "Those numbers are not valid." }, { status: 400 });
    }
    values[field.key] = n;
  }

  const dayKey = typeof b.dayKey === "string" && b.dayKey ? b.dayKey : todayKey();
  const result = await markCounted(uid, dayKey, values);
  return NextResponse.json({ ok: true, noteExisted: result.existed });
}
