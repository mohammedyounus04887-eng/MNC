import { useCallback, useEffect, useRef, useState } from "react";
import { cleanTranscript, mergeOverlap } from "./transcriptCleanup";

// ─── useSpeechRecognition ─────────────────────────────────────────────
// Thin wrapper around the browser Web Speech API. Stays continuous until
// stop() is called — the receptionist controls when listening ends via
// the "Done" button. Pure browser, no third-party.
//
// Browser support note: webkit prefix covers Chrome/Edge (which is what
// the reception desk runs). Safari support is partial and Firefox has
// none. The hook reports `supported: false` so the UI can degrade.
//
// Mobile note: on Android Chrome (the tablets at reception desks), the
// engine ends and restarts sessions very aggressively and each new session
// often "re-hears" the tail of the previous utterance, producing patterns
// like  "good" → "good morning" → "morning" → "good morning"  that would
// naively concatenate to  "good good morning morning good morning".
// We defend in two layers:
//   (a) overlap-aware merge when committing each session's text
//   (b) cleanTranscript() pass (dedupes word runs + repeated phrases)
//       applied before exposing the transcript to consumers.

interface SpeechRecognitionResultLike {
    isFinal: boolean;
    [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

export interface UseSpeechRecognitionReturn {
    supported: boolean;
    listening: boolean;
    transcript: string;          // committed (final) text — cleaned
    interimTranscript: string;   // in-progress text (updates live) — cleaned
    error: string | null;
    start: () => void;
    stop: () => void;
    reset: () => void;
}

function detectIsMobile(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    // Coarse but reliable enough for the reception desk vs tablet split.
    return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
}

export function useSpeechRecognition(lang: string = "en-IN"): UseSpeechRecognitionReturn {
    const SpeechRecognitionCtor =
        typeof window !== "undefined"
            ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
            : null;
    const supported = !!SpeechRecognitionCtor;
    const isMobile = detectIsMobile();

    const [listening, setListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [interimTranscript, setInterimTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);

    const recognitionRef = useRef<any>(null);
    // Mirror state into refs so the onend handler can decide to auto-restart
    // without re-creating the recognition instance on every render.
    const wantListeningRef = useRef(false);
    const finalRef = useRef("");
    // Text from sessions that have already ended (engine auto-restarted at
    // ~30s, on silence, or — frequently on Android — after every utterance).
    // Within the current session we always rebuild from the live
    // event.results array, making each onresult idempotent so a re-fired
    // final doesn't get appended twice.
    const committedSessionsRef = useRef("");
    const sessionTextRef = useRef("");

    useEffect(() => {
        if (!supported) return;
        const rec = new SpeechRecognitionCtor();
        // On mobile, continuous mode is flaky and causes the duplicate-
        // utterance avalanche. Falling back to non-continuous + manual
        // restart in onend gives the engine cleaner phrase boundaries.
        rec.continuous = !isMobile;
        rec.interimResults = true;
        rec.lang = lang;
        rec.maxAlternatives = 1;

        rec.onresult = (event: SpeechRecognitionEventLike) => {
            // Rebuild the *full* session-final string from event.results each
            // call. Chrome occasionally re-fires onresult for a final index
            // that was already committed; rebuilding is naturally idempotent.
            let sessionFinal = "";
            let interim = "";
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                const text = result[0]?.transcript ?? "";
                if (result.isFinal) sessionFinal += text + " ";
                else interim += text;
            }
            sessionTextRef.current = sessionFinal.replace(/\s+/g, " ").trim();
            // Overlap-aware combine: if the session's text shares a suffix
            // with the committed text (Android re-hear), the overlap is
            // dropped instead of concatenated. cleanTranscript also
            // collapses any remaining "good good" / "good morning good
            // morning" patterns the engine produced inside one event.
            const combinedRaw = mergeOverlap(committedSessionsRef.current, sessionTextRef.current);
            const cleaned = cleanTranscript(combinedRaw);
            if (cleaned !== finalRef.current) {
                finalRef.current = cleaned;
                setTranscript(cleaned);
            }
            setInterimTranscript(cleanTranscript(interim));
        };

        rec.onerror = (e: any) => {
            // "no-speech" is normal when the user pauses; don't surface it.
            if (e.error === "no-speech" || e.error === "aborted") return;
            setError(e.error || "Speech recognition error");
        };

        rec.onend = () => {
            // Promote this session's final text into the committed bucket
            // before the engine wipes results on the next .start().
            if (sessionTextRef.current) {
                committedSessionsRef.current = cleanTranscript(
                    mergeOverlap(committedSessionsRef.current, sessionTextRef.current),
                );
                sessionTextRef.current = "";
            }
            // Browser stops the engine after ~30s of audio or on silence
            // (much more often on mobile). While the user still wants to
            // listen, transparently restart. Tiny gap on mobile lets the
            // engine release the mic cleanly — without it, .start() throws
            // InvalidStateError half the time on Android.
            if (wantListeningRef.current) {
                const restart = () => {
                    try { rec.start(); } catch { /* ignore — will retry on next onend */ }
                };
                if (isMobile) setTimeout(restart, 80);
                else restart();
                return;
            }
            setListening(false);
        };

        recognitionRef.current = rec;
        return () => {
            try { rec.stop(); } catch { /* ignore */ }
            recognitionRef.current = null;
        };
    }, [SpeechRecognitionCtor, supported, lang, isMobile]);

    const start = useCallback(() => {
        if (!recognitionRef.current) return;
        setError(null);
        finalRef.current = "";
        committedSessionsRef.current = "";
        sessionTextRef.current = "";
        setTranscript("");
        setInterimTranscript("");
        wantListeningRef.current = true;
        try {
            recognitionRef.current.start();
            setListening(true);
        } catch {
            // "already started" — fine, just flip the flag
            setListening(true);
        }
    }, []);

    const stop = useCallback(() => {
        wantListeningRef.current = false;
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        // Final defensive clean (interim may have lingered)
        finalRef.current = cleanTranscript(finalRef.current);
        setTranscript(finalRef.current);
        setListening(false);
        setInterimTranscript("");
    }, []);

    const reset = useCallback(() => {
        finalRef.current = "";
        committedSessionsRef.current = "";
        sessionTextRef.current = "";
        setTranscript("");
        setInterimTranscript("");
        setError(null);
    }, []);

    return { supported, listening, transcript, interimTranscript, error, start, stop, reset };
}
