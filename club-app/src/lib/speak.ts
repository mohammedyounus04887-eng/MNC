/**
 * Saying things out loud at the club — one chooser, one speaker.
 *
 * A browser cannot install a voice. `speechSynthesis` can only use voices the
 * device already has, so the job here is to pick the best one present rather
 * than to supply one. The order we want is:
 *
 *   1. An Indian English female voice   (Veena, Heera, Neerja, Google en-IN…)
 *   2. Any Indian English voice
 *   3. Any English female voice
 *   4. Any English voice
 *
 * If the tablet has no Indian voice at all, nothing here can conjure one — the
 * device needs the voice added in its own settings (on Android: Settings →
 * Text-to-speech → install the English (India) voice data).
 */

// Indian English female voices as the platforms actually name them.
// macOS / iOS: Veena · Windows: Heera, Neerja · Android & Chrome OS ship
// "Google English (India)", which is female.
const INDIAN_FEMALE = [
    "veena", "heera", "neerja", "priya", "lekha", "raveena",
    "aditi", "kalpana", "isha", "swara", "ananya", "shreya",
];

// Voices that are female but not Indian — used only as a later fallback.
const FEMALE_HINTS = [
    "female", "woman", "samantha", "zira", "aria", "jenny",
    "libby", "sonia", "karen", "moira", "tessa", "fiona", "serena",
];

const isIndian = (v: SpeechSynthesisVoice) =>
    v.lang === "en-IN" || (v.lang || "").toLowerCase().replace("_", "-") === "en-in";

const isEnglish = (v: SpeechSynthesisVoice) =>
    (v.lang || "").toLowerCase().startsWith("en");

const looksFemale = (v: SpeechSynthesisVoice) => {
    const n = (v.name || "").toLowerCase();
    if (INDIAN_FEMALE.some(f => n.includes(f))) return true;
    if (FEMALE_HINTS.some(f => n.includes(f))) return true;
    // Google's Indian English voice has no gender in its name and is female.
    if (n.includes("google") && n.includes("india")) return true;
    return false;
};

/**
 * Rank a voice for reading a member's name at reception. Higher wins.
 * Exported so the trial page and any future screen rank identically.
 */
export function scoreVoice(v: SpeechSynthesisVoice): number {
    let s = 0;
    if (isIndian(v)) s += 100;
    else if (isEnglish(v)) s += 40;
    else return -1;                       // never read Indian names in a non-English voice
    if (looksFemale(v)) s += 50;
    if (v.localService) s += 5;           // on-device voices don't stall on a slow line
    return s;
}

/** The best available voice, or null when the device offers nothing usable. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const usable = voices.filter(v => scoreVoice(v) >= 0);
    if (usable.length === 0) return null;
    return usable.reduce((best, v) => (scoreVoice(v) > scoreVoice(best) ? v : best), usable[0]);
}

/**
 * Say "Welcome <first name>".
 *
 * Deliberately does NOT cancel speech already in progress: the receptionist
 * taps down a queue of arrivals and every name should be heard in turn.
 *
 * `voiceNameOverride` lets the club pin a specific voice from settings when the
 * automatic choice isn't the one they like on their own tablet.
 */
export function speakWelcome(name: string, voiceNameOverride?: string | null): void {
    try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const first = String(name || "").trim().split(/\s+/)[0];
        const u = new SpeechSynthesisUtterance(first ? `Welcome ${first}` : "Welcome");
        u.rate = 1.05;
        u.pitch = 1.05;   // a touch brighter — reads as warmer on the desk speaker
        u.volume = 1;

        const voices = synth.getVoices();
        const chosen = (voiceNameOverride && voices.find(v => v.name === voiceNameOverride))
            || pickVoice(voices);
        if (chosen) {
            u.voice = chosen;
            u.lang = chosen.lang || "en-IN";
        } else {
            u.lang = "en-IN";
        }
        synth.speak(u);
    } catch (e) {
        // Speech is a nicety — it must never break a check-in.
        console.warn("[speakWelcome]", e);
    }
}
