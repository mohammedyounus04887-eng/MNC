"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  LOG_FIELDS,
  MAX_COUNT,
  MAX_NOTE,
  milestoneMessage,
  type DailyLogValues,
  type LogFieldKey,
} from "@/lib/daily-log";
import {
  AUDIO_BITS_PER_SECOND,
  MAX_DURATION_MS,
} from "./model";
import { EMPTY_PARSE, describeHeard, parseSpokenLog, type ParseResult } from "./parse";
import * as copy from "./copy";

/**
 * The voice note recorder (session 4, feature 1).
 *
 * ## The shape, and why it always ends on a confirm step
 *
 * Speak → check → save. The middle step is not friction that survived a review; it is
 * the feature. Speech recognition mishears, and these five numbers roll up to an
 * upline, drive the streak and rank the boards. A parser writing straight through to
 * the log would put numbers on a coach's team screen that they never said and cannot
 * trace, and the first time that happens they stop believing any number here.
 *
 * The confirm step is also what keeps the 30-second rule true rather than nominally
 * true: the steppers arrive filled in, so the interaction is a glance and one tap.
 *
 * ## Every failure lands on the same screen
 *
 * No microphone, permission refused, no speech recognition on this phone, a recogniser
 * that heard nothing, a recogniser that heard words but no numbers, an upload that
 * failed — all six end at the confirm step with steppers the coach can tap. The one
 * outcome this component will not produce is a coach who thinks they logged and did
 * not. The recording is a convenience; the log is the point.
 *
 * ## Two writes, in one order
 *
 *   1. `POST /api/voice-logs` the moment recording stops, before anything is confirmed,
 *      so the gap between speaking and confirming — a tunnel, a dead battery — cannot
 *      lose the note.
 *   2. `PUT /api/logs` on confirm. THE EXISTING WRITER. Then `PATCH /api/voice-logs` to
 *      mark the note counted and drop its audio, and never in the other order: a note
 *      claiming to be counted before the log exists is a lie the purge job would act on.
 *
 * ## Motion (G5)
 *
 * One pulsing dot while recording and a plain seconds counter. `prefers-reduced-motion`
 * is handled globally in `globals.css`, which flattens the animation to a state change.
 */

/* ── Minimal Web Speech typings ──────────────────────────────────────────────
   Not in lib.dom for this TS version, and pulling a package for four fields would
   be a dependency for a type. Declared narrowly: only what is actually read. */
type SpeechResultList = { length: number; [i: number]: { [j: number]: { transcript: string } } };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** The first MIME type this browser will actually produce. Opus where available. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) {
      return type;
    }
  }
  return "";
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

type Phase = "checking" | "ready" | "recording" | "confirm" | "saved" | "nomic";

/**
 * Whether this browser can record is an EXTERNAL fact, not component state.
 *
 * It used to be mirrored in with `useEffect(() => setPhase(canRecord() ? ... ), [])`,
 * which the React Compiler rejects (`set-state-in-effect`) and is right to: that is a
 * synchronous setState on every mount, so the component renders "checking", throws it
 * away, and renders again — a cascading render to read a value that was available all
 * along.
 *
 * It cannot simply be a lazy `useState` initialiser either, because `canRecord()` touches
 * `MediaRecorder` and `navigator.mediaDevices`, neither of which exists during the server
 * render — that is a hydration mismatch rather than a fix.
 *
 * `useSyncExternalStore` is the shape built for exactly this: the server snapshot renders
 * the skeleton, the client snapshot reports the real capability, and React reconciles the
 * two without a warning and without an extra state write. Same fix as `ThemeToggle`, which
 * had the same bug for the same reason.
 *
 * The subscribe callback is a no-op because microphone support does not change within a
 * session. A store that never notifies is still a store.
 */
const subscribeToCapability = () => () => {};
const capabilitySnapshot = (): Phase => (canRecord() ? "ready" : "nomic");
const capabilityServerSnapshot = (): Phase => "checking";

export default function Recorder({ dayKey }: { dayKey: string }) {
  /**
   * `phase` is the capability until something transitions it, then the transition wins.
   *
   * Splitting it this way keeps all five real transitions below writing to `setPhase`
   * exactly as before — only the initial value stops being a state write.
   */
  const capability = useSyncExternalStore(
    subscribeToCapability,
    capabilitySnapshot,
    capabilityServerSnapshot
  );
  const [phaseOverride, setPhase] = useState<Phase | null>(null);
  const phase = phaseOverride ?? capability;
  const [secondsLeft, setSecondsLeft] = useState(MAX_DURATION_MS / 1000);
  const [parse, setParse] = useState<ParseResult>(EMPTY_PARSE);
  const [values, setValues] = useState<DailyLogValues>({ ...EMPTY_PARSE.values });
  const [transcript, setTranscript] = useState("");
  const [noteSaved, setNoteSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [streak, setStreak] = useState<number | null>(null);
  const [milestone, setMilestone] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const heardTextRef = useRef("");
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    timerRef.current = null;
    stopTimeoutRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already ended */
    }
    recognitionRef.current = null;
  }, []);

  // A coach who navigates away mid-recording must not leave the microphone open.
  useEffect(() => cleanup, [cleanup]);

  /** Uploads the recording. Failure is reported quietly and never blocks the log. */
  const uploadNote = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number, result: ParseResult, text: string) => {
      try {
        const audioBase64 = await toBase64(blob);
        const res = await fetch("/api/voice-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dayKey,
            audioBase64,
            mimeType,
            durationMs,
            transcript: text || null,
            heard: result.heard,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        setNoteSaved(res.ok);
      } catch {
        setNoteSaved(false);
      }
    },
    [dayKey]
  );

  const finish = useCallback(() => {
    const durationMs = Math.max(1, Date.now() - startedAtRef.current);
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    const text = heardTextRef.current.trim();
    const result = parseSpokenLog(text);

    setTranscript(text);
    setParse(result);
    setValues({ ...result.values });
    setPhase("confirm");
    cleanup();

    if (blob.size > 0) {
      void uploadNote(blob, recorderRef.current?.mimeType || "audio/webm", durationMs, result, text);
    } else {
      setNoteSaved(false);
    }
  }, [cleanup, uploadNote]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else if (phase === "recording") {
      finish();
    }
  }, [finish, phase]);

  const start = useCallback(async () => {
    setError("");
    setNoteSaved(null);
    chunksRef.current = [];
    heardTextRef.current = "";

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("nomic");
      return;
    }
    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      cleanup();
      setPhase("nomic");
      return;
    }

    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = finish;

    // Speech recognition runs alongside, and its absence is not an error — this is
    // the single most common degradation and it lands on the same confirm screen.
    const Ctor = speechRecognitionCtor();
    if (Ctor) {
      try {
        const recognition = new Ctor();
        recognition.lang = navigator.language || "en-IN";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e) => {
          let text = "";
          for (let i = 0; i < e.results.length; i++) text += ` ${e.results[i][0].transcript}`;
          heardTextRef.current = text;
        };
        recognition.onerror = () => {};
        recognition.onend = () => {};
        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        recognitionRef.current = null;
      }
    }

    startedAtRef.current = Date.now();
    recorder.start();
    setPhase("recording");
    setSecondsLeft(MAX_DURATION_MS / 1000);

    timerRef.current = setInterval(() => {
      const left = Math.ceil((MAX_DURATION_MS - (Date.now() - startedAtRef.current)) / 1000);
      setSecondsLeft(Math.max(0, left));
    }, 250);

    // A hard stop, so a coach who pockets the phone mid-sentence does not record until
    // the battery dies or the document limit is hit.
    stopTimeoutRef.current = setTimeout(stop, MAX_DURATION_MS);
  }, [cleanup, finish, stop]);

  const bump = (key: LogFieldKey, delta: number) =>
    setValues((v) => ({
      ...v,
      [key]: Math.min(MAX_COUNT, Math.max(0, (v[key] || 0) + delta)),
    }));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");

    // The transcript becomes the day's one-line note (F6 has exactly one), so what the
    // coach said survives even though the recording will not.
    const note = transcript ? transcript.slice(0, MAX_NOTE) : null;

    try {
      const res = await fetch("/api/logs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayKey, ...values, note }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      setStreak(typeof data.streak === "number" ? data.streak : null);
      setMilestone(typeof data.milestone === "number" ? data.milestone : null);

      // Only now: the note may claim to be counted once the log actually exists.
      await fetch("/api/voice-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayKey, ...values }),
      }).catch(() => {});

      setPhase("saved");
    } catch {
      setError("Could not save. Please try again when you have network.");
    }
    setBusy(false);
  };

  /* ── Screens ─────────────────────────────────────────────────────────────── */

  if (phase === "checking") {
    return <div className="h-40 rounded-2xl bg-surface" aria-hidden />;
  }

  if (phase === "nomic") {
    return (
      <section className="rounded-2xl bg-surface p-5" data-testid="voice-nomic">
        <h2 className="font-display text-xl font-bold">{copy.NO_MIC_HEADING}</h2>
        <p className="mt-2 text-text-dim">{copy.NO_MIC_BODY}</p>
        <Link
          href="/log"
          className="metal-gold neopop mt-4 inline-flex min-h-12 items-center px-5 font-semibold"
        >
          {copy.GO_TO_LOG}
        </Link>
      </section>
    );
  }

  if (phase === "saved") {
    return (
      <section className="rounded-2xl bg-surface p-5" data-testid="voice-saved">
        <h2 className="font-display text-2xl font-bold">{copy.SAVED_HEADING}</h2>
        <p className="mt-2 text-text-dim">{copy.AUDIO_DROPPED}</p>
        {streak !== null && (
          <p className="numeral mt-4 text-4xl text-text" data-testid="voice-streak">
            {streak}
            <span className="ml-2 font-sans text-base font-medium text-text-dim">
              {streak === 1 ? "day in a row" : "days in a row"}
            </span>
          </p>
        )}
        {milestone !== null && (
          <p className="animate-rise mt-3 text-text">{milestoneMessage(milestone)}</p>
        )}
        <Link
          href="/log"
          className="mt-5 inline-flex min-h-12 items-center text-text-dim underline"
        >
          See today&apos;s log
        </Link>
      </section>
    );
  }

  if (phase === "confirm") {
    const heardSomething = parse.heard.length > 0;
    const missingLabels = parse.mentionedWithoutNumber.map((k) =>
      LOG_FIELDS.find((f) => f.key === k)!.label.toLowerCase()
    );

    return (
      <div className="flex flex-col gap-4" data-testid="voice-confirm">
        <section className="rounded-2xl bg-surface p-5">
          <h2 className="font-display text-xl font-bold">
            {heardSomething ? copy.HEARD_HEADING : copy.NOT_HEARD_HEADING}
          </h2>
          {heardSomething ? (
            <p className="mt-1 text-text-dim" data-testid="voice-heard">
              {describeHeard(parse)}. Change anything that is wrong.
            </p>
          ) : (
            <p className="mt-1 text-text-dim">{copy.NOT_HEARD_BODY}</p>
          )}
          {missingLabels.length > 0 && (
            <p className="mt-2 text-sm text-text-dim">{copy.partialBody(missingLabels)}</p>
          )}
          {transcript && (
            <p className="mt-3 border-l-2 border-hairline pl-3 text-sm text-text-dim">
              &ldquo;{transcript.slice(0, MAX_NOTE)}&rdquo;
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          {LOG_FIELDS.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-text">{field.label}</p>
                <p className="text-sm text-text-dim">
                  {parse.heard.includes(field.key) ? "heard" : field.hint}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => bump(field.key, -1)}
                  aria-label={`One fewer ${field.label}`}
                  className="h-12 w-12 rounded-xl bg-elevated text-2xl leading-none text-text"
                >
                  −
                </button>
                <span
                  className="numeral w-10 text-center text-2xl text-text"
                  data-testid={`voice-value-${field.key}`}
                >
                  {values[field.key]}
                </span>
                <button
                  type="button"
                  onClick={() => bump(field.key, 1)}
                  aria-label={`One more ${field.label}`}
                  className="h-12 w-12 rounded-xl bg-elevated text-2xl leading-none text-text"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </section>

        {error && <p className="text-heat">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={busy}
          data-testid="voice-save"
          className="metal-gold neopop min-h-14 w-full text-lg font-bold disabled:opacity-60"
        >
          {busy ? "Saving…" : copy.CONFIRM_LABEL}
        </button>

        <p className="text-sm text-text-dim">
          {noteSaved === false
            ? "The recording did not upload, which changes nothing here — the numbers above are what counts."
            : copy.UNCOUNTED_FATE}
        </p>
      </div>
    );
  }

  /* ready | recording */
  const recording = phase === "recording";
  return (
    <div className="flex flex-col gap-4" data-testid="voice-recorder">
      <section className="rounded-2xl bg-surface p-5">
        <p className="text-text">{copy.NOT_A_LOG_YET}</p>
        <p className="mt-3 text-sm text-text-dim">{copy.HOW_TO_SPEAK}</p>
      </section>

      <button
        type="button"
        onClick={recording ? stop : start}
        data-testid="voice-record"
        className="metal-gold neopop flex min-h-20 w-full items-center justify-center gap-3 text-lg font-bold"
      >
        {recording ? (
          <>
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-current" aria-hidden />
            {copy.STOP_LABEL} · {secondsLeft}s
          </>
        ) : (
          copy.RECORD_LABEL
        )}
      </button>

      {recording && (
        <p className="text-center text-text-dim" role="status">
          {copy.RECORDING_LABEL}
        </p>
      )}

      <p className="text-sm text-text-dim">{copy.WHERE_THE_AUDIO_GOES}</p>
      <p className="text-sm text-text-dim">{copy.UNCOUNTED_FATE}</p>

      <Link href="/log" className="inline-flex min-h-12 items-center text-text-dim underline">
        {copy.GO_TO_LOG}
      </Link>
    </div>
  );
}
