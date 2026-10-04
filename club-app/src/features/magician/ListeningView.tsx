import { useEffect, useRef } from "react";

interface Props {
    transcript: string;
    interim: string;
    onDone: () => void;
    onCancel: () => void;
}

// ─── ListeningView ──────────────────────────────────────────────────────
// What the receptionist sees while speaking. Three things on screen:
//   1. A pulsing waveform animation so they know mic is live
//   2. Live transcript (final + interim) — builds trust by showing
//      exactly what the engine is hearing in real time
//   3. The cheat-sheet panel with the 5 patterns — no need to look away
//      to remember the grammar

export default function ListeningView({ transcript, interim, onDone, onCancel }: Props) {
    // Auto-scroll the transcript box as new words come in
    const transcriptRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
    }, [transcript, interim]);

    return (
        <div style={{
            background: "white",
            borderRadius: 20,
            padding: 22,
            maxWidth: 940,
            width: "min(940px, 92vw)",
            display: "grid",
            gridTemplateColumns: "1fr 280px",
            gap: 18,
            fontFamily: "Nunito, sans-serif",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}>
            {/* LEFT — waveform + transcript */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                {/* waveform */}
                <div style={{
                    height: 100,
                    background: "linear-gradient(135deg,#1e1b4b,#4c1d95)",
                    borderRadius: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 4,
                    position: "relative",
                    overflow: "hidden",
                }}>
                    {/* simple CSS bars */}
                    {Array.from({ length: 30 }).map((_, i) => (
                        <div key={i} style={{
                            width: 4,
                            background: "linear-gradient(180deg,#a78bfa,#22d3ee)",
                            borderRadius: 2,
                            animation: `magicianBar 0.9s ease-in-out ${i * 0.05}s infinite alternate`,
                        }} />
                    ))}
                    <style>{`
                        @keyframes magicianBar {
                            0%   { height: 8px;  opacity: 0.6 }
                            100% { height: 64px; opacity: 1 }
                        }
                    `}</style>
                    <div style={{
                        position: "absolute", top: 10, left: 14,
                        color: "#c4b5fd", fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
                        textTransform: "uppercase",
                    }}>
                        ● Listening
                    </div>
                </div>

                {/* live transcript */}
                <div
                    ref={transcriptRef}
                    style={{
                        background: "#0f172a", color: "#e2e8f0",
                        padding: 16, borderRadius: 12,
                        minHeight: 180, maxHeight: 260, overflowY: "auto",
                        fontSize: 15, lineHeight: 1.55,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                >
                    {transcript && <span>{transcript}</span>}
                    {interim && <span style={{ color: "#94a3b8", fontStyle: "italic" }}>{transcript ? " " : ""}{interim}</span>}
                    {!transcript && !interim && (
                        <span style={{ color: "#475569", fontStyle: "italic" }}>
                            Speak your commands. Tap "Done" when finished.
                        </span>
                    )}
                </div>

                {/* buttons */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button
                        onClick={onCancel}
                        style={{ padding: "10px 18px", border: "1.5px solid #d1d5db", background: "white", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#374151" }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onDone}
                        style={{
                            padding: "10px 26px", border: "none",
                            background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
                            color: "white", borderRadius: 10, fontSize: 14, fontWeight: 800,
                            cursor: "pointer", fontFamily: "inherit",
                            boxShadow: "0 4px 12px rgba(124,58,237,0.4)",
                        }}
                    >
                        ✓ Done
                    </button>
                </div>
            </div>

            {/* RIGHT — cheat sheet */}
            <div style={{
                background: "#faf5ff",
                border: "1.5px solid #e9d5ff",
                borderRadius: 14,
                padding: 14,
                fontSize: 12, lineHeight: 1.4,
                color: "#581c87",
                maxHeight: 480, overflowY: "auto",
            }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8, color: "#7c3aed" }}>
                    How to speak
                </div>

                <CheatRow n="1" title="By ID">
                    "Attendance for member 042"<br/>
                    "Mango shake for member 042"
                </CheatRow>
                <CheatRow n="2" title="By name">
                    "Attendance for Prasad"<br/>
                    "Mango for Devansh"
                </CheatRow>
                <CheatRow n="3" title="Many people (commas!)">
                    "Mango for 042, 088, 103"<br/>
                    "Attendance for Prasad, Usha, Arun"
                </CheatRow>
                <CheatRow n="4" title="A range">
                    "Strawberry for 011 to 020"
                </CheatRow>
                <CheatRow n="5" title="Everything in one go">
                    "Mango for 042, Devansh.
                    Special for 024 to 030.
                    Attendance for all."
                </CheatRow>
                <CheatRow n="6" title="New visitor (First Day)">
                    "First day for David,
                    number 9876543210,
                    invited by Prasad"
                </CheatRow>
                <CheatRow n="7" title="One-day shake (paid)">
                    "Order one-day kulfi shake for Chandana"<br/>
                    "Two-day shake for 042 mango"
                </CheatRow>
                <CheatRow n="8" title="Day-shake redeem (free)">
                    "Day shake for Prasad mango"
                </CheatRow>
                <CheatRow n="9" title="Wallet top-up">
                    "Top up Prasad 500"<br/>
                    "Top up 042 1000 UPI"
                </CheatRow>
                <CheatRow n="10" title="Plan renewal">
                    "Renew gold plan for Prasad cash"
                </CheatRow>
                <CheatRow n="11" title="Ask Magician (queries)">
                    "Show today's report"<br/>
                    "How much cash today?"<br/>
                    "How many shakes today?"<br/>
                    "Did Meenakshi come today?"<br/>
                    "Show Prasad profile"<br/>
                    "Print today's report"
                </CheatRow>
                <CheatRow n="12" title="Has arrived (uses preferences)">
                    "Vignesh has arrived"<br/>
                    "Soumya, Krishna and Vignesh have arrived"<br/>
                    "Vignesh has arrived but wants chocolate"
                </CheatRow>
                <CheatRow n="13" title="Team arrivals">
                    "Team A has arrived"<br/>
                    "Team A arrived without Shekhar"<br/>
                    "Team A but Ashwini wants strawberry"
                </CheatRow>
                <CheatRow n="14" title="Welcome (same as arrived)">
                    "Welcome Vignesh"<br/>
                    "Welcome Sujata and Ashwini"<br/>
                    "Hi Vignesh" / "Hello Sujata" / "Namaste Prasad"
                </CheatRow>
                <CheatRow n="15" title="+ mark as volunteer">
                    "Welcome Vignesh and mark volunteer attendance"<br/>
                    "Welcome Sujata as volunteer"<br/>
                    "Team A arrived as volunteers"
                </CheatRow>

                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed #d8b4fe", color: "#6b21a8", fontSize: 11 }}>
                    💡 Always pause between IDs (commas matter!).<br/>
                    💡 Common names ask "which one?" — just tap.
                </div>
            </div>
        </div>
    );
}

function CheatRow({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "#7c3aed", marginBottom: 2 }}>
                {n}. {title}
            </div>
            <div style={{
                background: "white", padding: "5px 8px", borderRadius: 6,
                color: "#1f2937", fontFamily: "ui-monospace, monospace",
                fontSize: 11, whiteSpace: "pre-line",
            }}>
                {children}
            </div>
        </div>
    );
}
