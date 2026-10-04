import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { getUserById } from "@/lib/users";
import { shiftKey, todayKey } from "@/lib/daily-log";
import type { DailyLogValues, LogFieldKey } from "@/lib/daily-log";
import {
  isSavableDayKey,
  MAX_AUDIO_BYTES,
  MAX_DURATION_MS,
  UNCOUNTED_TTL_DAYS,
  VOICE_LOGS,
  voiceLogDocId,
  type VoiceLogStatus,
} from "./model";

/**
 * The database side of voice notes. Server only — split from `model.ts` and `parse.ts`
 * so the recorder (a client component) can import the caps and the parser without
 * dragging `firebase-admin` into the browser bundle (E2).
 *
 * This module writes to `voiceLogs` and to nothing else. In particular it never writes
 * a daily log: the counts a coach confirms go to `PUT /api/logs`, which is the existing
 * writer, so there is exactly one piece of code that creates a `dailyLogs` document no
 * matter which of the two screens the coach came from.
 */

const collection = () => db.collection(VOICE_LOGS);

export type SaveNoteInput = {
  userId: string;
  dayKey: string;
  /** base64, already stripped of any `data:` prefix by the route. */
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  transcript: string | null;
  heard: LogFieldKey[];
};

export type SaveNoteResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Stores a recording, replacing any earlier one for the same day.
 *
 * Saved at the moment the coach stops speaking, BEFORE they confirm the numbers. That
 * ordering is deliberate: the gap between speaking and confirming is exactly where a
 * road, a tunnel or a dying battery lands, and a note that only existed in a React
 * state variable would be gone. What survives that gap is a note the coach can come
 * back to; what does not survive it is a log, which is correct — nobody confirmed one.
 */
export async function saveNote(
  input: SaveNoteInput,
  /**
   * Today, passed in rather than read from the clock — E1's rule, and the same shape
   * `purgeExpiredNotes` and `rankCallList` already take, so the bound below is
   * testable against a fixed date instead of against whenever the suite runs.
   */
  todayKeyValue: string = todayKey()
): Promise<SaveNoteResult> {
  // Shape AND range. A future day key would never fall behind the purge cutoff, so a
  // note filed under one would outlive the retention this app promises — see
  // `isSavableDayKey`, where the reasoning and the reproduction live.
  if (!isSavableDayKey(input.dayKey, todayKeyValue)) {
    return { ok: false, error: "That date is not valid." };
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    return { ok: false, error: "That recording is empty." };
  }
  if (input.durationMs > MAX_DURATION_MS + 2_000) {
    // A little slack over the client-side cap: MediaRecorder's final chunk can land
    // after the stop, and rejecting a note for 200ms of overrun helps nobody.
    return { ok: false, error: "That recording is too long." };
  }

  const rawBytes = Math.floor((input.audioBase64.length * 3) / 4);
  if (rawBytes > MAX_AUDIO_BYTES) {
    return { ok: false, error: "That recording is too large to save." };
  }
  if (rawBytes === 0) {
    return { ok: false, error: "That recording is empty." };
  }

  const id = voiceLogDocId(input.userId, input.dayKey);
  const owner = await getUserById(input.userId);
  if (!owner?.workspaceId) return { ok: false, error: "A verified workspace is required." };
  await collection().doc(id).set({
    userId: input.userId,
    workspaceId: owner.workspaceId,
    dayKey: input.dayKey,
    status: "uncounted" satisfies VoiceLogStatus,
    durationMs: Math.round(input.durationMs),
    mimeType: input.mimeType,
    audioBase64: input.audioBase64,
    transcript: input.transcript,
    heard: input.heard,
    countedValues: null,
    createdAt: Timestamp.now(),
    countedAt: null,
  });

  return { ok: true, id };
}

/**
 * Marks a note counted and DELETES its audio.
 *
 * Called after `PUT /api/logs` has succeeded, never before — the note may only claim to
 * be counted once a `dailyLogs` document actually exists, or the status becomes a lie
 * the purge job would then act on.
 *
 * The recording is dropped here rather than left to expire. Once the numbers are in the
 * log and the transcript is in its note, the audio is a recording of somebody's working
 * day being kept for no stated purpose. Data minimisation is not a nicety in a codebase
 * that already purges prospect health data on a schedule (v2 §5.3).
 *
 * Missing note is not an error: a coach whose recording failed to upload but who still
 * tapped their numbers in has logged their day, and failing this call would undo that.
 */
export async function markCounted(
  userId: string,
  dayKey: string,
  values: DailyLogValues
): Promise<{ ok: true; existed: boolean }> {
  const ref = collection().doc(voiceLogDocId(userId, dayKey));
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, existed: false };

  const counts = Object.fromEntries(Object.entries(values).filter(([key]) => key !== "note"));
  await ref.update({
    status: "counted" satisfies VoiceLogStatus,
    audioBase64: null,
    countedValues: counts,
    countedAt: Timestamp.now(),
  });
  return { ok: true, existed: true };
}

export type VoiceNoteSummary = {
  dayKey: string;
  status: VoiceLogStatus;
  durationMs: number;
  transcript: string | null;
  hasAudio: boolean;
};

/** Today's note, if the coach already recorded one. Never returns the audio blob. */
export async function getNoteSummary(
  userId: string,
  dayKey: string
): Promise<VoiceNoteSummary | null> {
  const snap = await collection().doc(voiceLogDocId(userId, dayKey)).get();
  const d = snap.data();
  if (!d) return null;
  return {
    dayKey: d.dayKey,
    status: d.status,
    durationMs: d.durationMs ?? 0,
    transcript: d.transcript ?? null,
    hasAudio: typeof d.audioBase64 === "string" && d.audioBase64.length > 0,
  };
}

/**
 * Deletes uncounted notes past their thirty days.
 *
 * Whole documents, not just the audio: an uncounted note's transcript and duration are
 * a record of the same day by another name, and half-deleting personal data is the kind
 * of retention control that reads well and does nothing.
 *
 * Counted notes are left alone — they hold no audio by then, and their `countedValues`
 * are a two-integer-wide receipt tying a log to the voice capture that produced it.
 * Bounded per run so one job cannot try to delete a year of backlog in a single pass.
 */
export async function purgeExpiredNotes(
  todayKeyValue: string,
  limit = 400,
  dryRun = false,
): Promise<{ deleted: number; wouldDelete: number; skipped: number; dryRun: boolean; cutoffKey: string }> {
  const cutoffKey = shiftKey(todayKeyValue, -UNCOUNTED_TTL_DAYS);

  const stale = await collection()
    .where("status", "==", "uncounted")
    .where("dayKey", "<", cutoffKey)
    .limit(Math.max(1, Math.min(400, limit)))
    .get();

  let wouldDelete = 0;
  let skipped = 0;
  for (const candidate of stale.docs) {
    const removed = await db.runTransaction(async (tx) => {
      const current = await tx.get(candidate.ref);
      const data = current.data();
      if (!data || data.status !== "uncounted" || typeof data.dayKey !== "string" || data.dayKey >= cutoffKey ||
          typeof data.userId !== "string" || typeof data.workspaceId !== "string" || !data.workspaceId) return false;
      const owner = await tx.get(db.doc(`users/${data.userId}`));
      if (owner.get("workspaceId") !== data.workspaceId) return false;
      // Replaced or newly recorded backdated notes must still receive the full retention window.
      if (!(data.createdAt instanceof Timestamp) || data.createdAt.toMillis() >= Date.parse(`${cutoffKey}T00:00:00+05:30`)) return false;
      if (!dryRun) tx.delete(current.ref);
      return true;
    });
    if (removed) wouldDelete++; else skipped++;
  }
  return { deleted: dryRun ? 0 : wouldDelete, wouldDelete, skipped, dryRun, cutoffKey };
}
