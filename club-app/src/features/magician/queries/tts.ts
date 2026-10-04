// ─── Text-to-speech ───────────────────────────────────────────────────
// Wraps the browser's free SpeechSynthesis API. Used for quick spoken
// answers when receptionist asks Magician a question. Falls back silently
// if the browser doesn't support TTS (rare — Chrome/Edge/Safari all do).

export function speak(text: string): void {
    try {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
        // Cancel any in-flight utterance so a rapid second query doesn't
        // queue up behind the first.
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-IN";
        u.rate = 1.05;
        u.pitch = 1.0;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
    } catch (e) {
        console.warn("[magician tts]", e);
    }
}
