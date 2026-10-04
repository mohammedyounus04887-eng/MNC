import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getLogState, saveLog } from "@/lib/daily-log-queries";
import { getUserById } from "@/lib/users";
import { onEvent } from "@/modules/wall/queries";
import {
  LOG_FIELDS,
  MAX_COUNT,
  MAX_NOTE,
  milestoneFor,
  todayKey,
  type DailyLogValues,
} from "@/lib/daily-log";

/** Today's log and streak, for the log screen. */
export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const state = await getLogState(uid);
  return NextResponse.json(state);
}

/**
 * Saves a day's log. PUT because it is idempotent: the same day sent twice — a
 * corrected number, or a retried offline sync — overwrites rather than duplicating.
 *
 * PUT semantics, so the body is the WHOLE day: an omitted field is written as zero
 * and an omitted note clears it. Every caller sends the complete set; do not treat
 * this as a partial merge.
 */
export async function PUT(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const values = { note: null } as DailyLogValues;
  for (const field of LOG_FIELDS) {
    const raw = b[field.key];
    const n = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_COUNT || !Number.isInteger(n)) {
      return NextResponse.json(
        { error: `${field.label} should be a whole number up to ${MAX_COUNT}.` },
        { status: 400 }
      );
    }
    values[field.key] = n;
  }

  if (b.note !== undefined && b.note !== null) {
    const note = String(b.note).trim();
    if (note.length > MAX_NOTE) {
      return NextResponse.json({ error: "That note is too long." }, { status: 400 });
    }
    values.note = note === "" ? null : note;
  }

  // Defaults to today in the app timezone; an offline sync sends the day it was
  // actually written for.
  const key = typeof b.dayKey === "string" && b.dayKey ? b.dayKey : todayKey();
  const result = await saveLog(uid, key, values);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Recognition Wall (Feature B): a wall-worthy streak posts a card. Same guard as the
  // private milestone below — first save of TODAY only, so a backfill or a corrected
  // number never replays it. Not awaited: a wall post must never slow a log save.
  if (key === todayKey() && result.wasFirstSaveOfDay) {
    void getUserById(uid).then((u) => u && onEvent.streakReached(u, result.streak));
  }

  return NextResponse.json({
    ok: true,
    streak: result.streak,
    // Celebrate only on the FIRST save of today: a backfilled day is not an
    // achievement to announce, and correcting a number should not replay the
    // milestone the coach already saw.
    milestone:
      key === todayKey() && result.wasFirstSaveOfDay
        ? milestoneFor(result.streak)
        : null,
  });
}
