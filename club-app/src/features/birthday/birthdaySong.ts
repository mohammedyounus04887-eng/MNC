// ─── Birthday song ────────────────────────────────────────────────────
// Plays "Happy Birthday to You" via the Web Audio API — pure synth, no
// audio file dependency, no third-party. Total runtime ~9 seconds.
//
// The traditional melody (in C major):
//   C  C  D  C  F  E
//   C  C  D  C  G  F
//   C  C  C5 A  F  E  D
//   Bb Bb A  F  G  F

const NOTE_FREQ: Record<string, number> = {
    C:  261.63, D:  293.66, E:  329.63, F:  349.23,
    G:  391.99, A:  440.00, Bb: 466.16, B:  493.88,
    C5: 523.25, D5: 587.33, E5: 659.25,
};

// (note, duration in beats — quarter = 1)
const MELODY: Array<[string, number]> = [
    ["C", 0.75], ["C", 0.25], ["D", 1], ["C", 1], ["F", 1], ["E", 2],
    ["C", 0.75], ["C", 0.25], ["D", 1], ["C", 1], ["G", 1], ["F", 2],
    ["C", 0.75], ["C", 0.25], ["C5", 1], ["A", 1], ["F", 1], ["E", 1], ["D", 2],
    ["Bb", 0.75], ["Bb", 0.25], ["A", 1], ["F", 1], ["G", 1], ["F", 2],
];

export function playBirthdaySong(): void {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const beat = 0.32;          // seconds per beat ≈ 188 bpm — sprightly
        let t = ctx.currentTime;
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.18;
        masterGain.connect(ctx.destination);

        for (const [note, beats] of MELODY) {
            const freq = NOTE_FREQ[note];
            if (!freq) continue;
            const dur = beats * beat;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            // simple AD envelope so notes don't click
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(g);
            g.connect(masterGain);
            osc.start(t);
            osc.stop(t + dur);
            t += dur;
        }
    } catch (e) {
        console.warn("[birthday]", e);
    }
}

// ─── isBirthdayToday ──────────────────────────────────────────────────
// Member.dob is a Firestore Timestamp (or any value with toDate()). We
// compare the MM-DD only — year ignored.

export function isBirthdayToday(dob: any): boolean {
    if (!dob) return false;
    let d: Date | null = null;
    if (typeof dob.toDate === "function") d = dob.toDate();
    else if (dob instanceof Date) d = dob;
    else if (typeof dob === "string" || typeof dob === "number") d = new Date(dob);
    if (!d || isNaN(d.getTime())) return false;
    const today = new Date();
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}
