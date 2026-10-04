/**
 * BTC Winners — award-ceremony reveal page for TV / projector.
 *
 * Opened on the TV during the BTC prize ceremony. The owner drives it:
 *   - "Reveal Top 5" runs a ~24s suspense roll, then reveals 1st place with full
 *     stats; a "Next" button repeats it for 2nd…5th, then shows the final podium.
 *   - "Reveal Highest Fat Loss" does the same roll for the single fat-loss winner.
 *   - "Show Winners" jumps straight to the static combined board (no animation),
 *     for leaving on the TV after the ceremony.
 *
 * All stats are REAL — pulled from the active challenge's leaderboard
 * (useBtcLeaderboard ranks weight by pctLossFromBaseline, fat by
 * fatLossFromBaseline) + computeDisciplineStats for attendance %.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useClubContext } from "@/lib/clubDetection";
import {
    useActiveBtcChallenge,
    useBtcLeaderboard,
    useBtcChallengeMeals,
    computeDisciplineStats,
} from "@/hooks/useBtcChallenges";

const FONT = "'Nunito', system-ui, sans-serif";

// ── helpers ──────────────────────────────────────────────────────────────
const n1 = (v: any) => (v == null || Number.isNaN(Number(v)) ? "—" : (Math.round(Number(v) * 10) / 10).toString());
const n2 = (v: any) => (v == null || Number.isNaN(Number(v)) ? "—" : (Math.round(Number(v) * 100) / 100).toString());

const RANK_THEME = [
    { label: "1st Place", medal: "🥇", ring: "#fbbf24", glow: "rgba(251,191,36,0.65)", grad: "linear-gradient(135deg,#fde047,#f59e0b)" },
    { label: "2nd Place", medal: "🥈", ring: "#cbd5e1", glow: "rgba(203,213,225,0.6)", grad: "linear-gradient(135deg,#e2e8f0,#94a3b8)" },
    { label: "3rd Place", medal: "🥉", ring: "#f59e0b", glow: "rgba(217,119,6,0.55)", grad: "linear-gradient(135deg,#fdba74,#c2410c)" },
    { label: "4th Place", medal: "4", ring: "#60a5fa", glow: "rgba(96,165,250,0.5)", grad: "linear-gradient(135deg,#93c5fd,#2563eb)" },
    { label: "5th Place", medal: "5", ring: "#a78bfa", glow: "rgba(167,139,250,0.5)", grad: "linear-gradient(135deg,#c4b5fd,#7c3aed)" },
];
const FAT_THEME = { label: "Highest Fat Loss", medal: "🔥", ring: "#fb7185", glow: "rgba(251,113,133,0.6)", grad: "linear-gradient(135deg,#fda4af,#e11d48)" };

type Row = any;

// ── confetti (canvas, no deps) ─────────────────────────────────────────────
function burstConfetti(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = (canvas.width = canvas.offsetWidth);
    const H = (canvas.height = canvas.offsetHeight);
    const colors = ["#fde047", "#f59e0b", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb7185", "#ffffff"];
    const make = (ox: number) =>
        Array.from({ length: 90 }, () => ({
            x: ox, y: H * 0.32 + (Math.random() - 0.5) * 40,
            vx: (Math.random() - 0.5) * 10 + (ox < W / 2 ? 4 : -4),
            vy: Math.random() * -13 - 4, g: 0.28 + Math.random() * 0.18,
            size: 6 + Math.random() * 9, color: colors[(Math.random() * colors.length) | 0],
            rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        }));
    const parts = [...make(W * 0.18), ...make(W * 0.82), ...make(W * 0.5)];
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
        const elapsed = t - start;
        ctx.clearRect(0, 0, W, H);
        const life = Math.max(0, 1 - elapsed / 3800);
        for (const p of parts) {
            p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
            ctx.save(); ctx.globalAlpha = life; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); ctx.restore();
        }
        if (elapsed < 3800) raf = requestAnimationFrame(tick);
        else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
}

// ── synthesized fanfare (web audio, no asset) ───────────────────────────────
function playFanfare() {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ac = new Ctx();
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
            const o = ac.createOscillator(); const g = ac.createGain();
            o.type = "triangle"; o.frequency.value = f;
            const t0 = ac.currentTime + i * 0.13;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
            o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + 0.6);
        });
        setTimeout(() => ac.close().catch(() => {}), 1600);
    } catch { /* autoplay/unsupported — silent */ }
}

// ── avatar ──────────────────────────────────────────────────────────────────
function Avatar({ photo, name, size, ring, glow }: { photo?: string; name?: string; size: number; ring?: string; glow?: string }) {
    const common: React.CSSProperties = {
        width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
        border: ring ? `${Math.max(4, size * 0.04)}px solid ${ring}` : undefined,
        boxShadow: glow ? `0 0 ${size * 0.35}px ${glow}, 0 0 ${size * 0.1}px ${glow}` : undefined,
        background: "#1e293b",
    };
    if (photo) return <img src={photo} alt={name || ""} style={common} />;
    return (
        <div style={{ ...common, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: size * 0.4, color: "#fff", background: "linear-gradient(135deg,#334155,#0f172a)" }}>
            {(name || "?").charAt(0).toUpperCase()}
        </div>
    );
}

// ── the suspense roll ───────────────────────────────────────────────────────
function RevealRoll({ photos, durationMs, label, theme, onDone, onSkip }: {
    photos: { photo?: string; name?: string }[];
    durationMs: number; label: string; theme: { glow: string; ring: string };
    onDone: () => void; onSkip: () => void;
}) {
    const [spot, setSpot] = useState(0);
    const [count, setCount] = useState<number | null>(null);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;
    const pool = photos.length ? photos : [{ name: "?" }];

    useEffect(() => {
        let alive = true;
        const start = performance.now();
        let timer: any;
        const step = () => {
            if (!alive) return;
            const elapsed = performance.now() - start;
            const p = Math.min(1, elapsed / durationMs);
            setSpot((s) => (pool.length > 1 ? (s + 1 + ((Math.random() * (pool.length - 1)) | 0)) % pool.length : 0));
            const remain = durationMs - elapsed;
            setCount(remain <= 3000 && remain > 0 ? Math.ceil(remain / 1000) : null);
            if (elapsed >= durationMs) { doneRef.current(); return; }
            const delay = 45 + Math.pow(p, 2.3) * 760; // ease-out: speeds slow as it ends
            timer = setTimeout(step, delay);
        };
        timer = setTimeout(step, 45);
        return () => { alive = false; clearTimeout(timer); };
    }, [durationMs, pool.length]);

    const cur = pool[spot % pool.length];
    return (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {/* drifting photo cloud */}
            <div style={{ position: "absolute", inset: 0, opacity: 0.18, filter: "blur(2px)" }}>
                {pool.slice(0, 28).map((m, i) => (
                    <div key={i} className="bw-float" style={{ position: "absolute", left: `${(i * 37) % 92 + 3}%`, top: `${(i * 53) % 86 + 4}%`, animationDelay: `${(i % 7) * 0.4}s` }}>
                        <Avatar photo={m.photo} name={m.name} size={92} />
                    </div>
                ))}
            </div>
            {/* floating question marks */}
            {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="bw-qmark" style={{ left: `${(i * 11) % 90 + 4}%`, animationDelay: `${(i % 5) * 0.7}s`, fontSize: 30 + (i % 4) * 14 }}>?</div>
            ))}

            <div style={{ fontSize: "clamp(18px,3vw,34px)", fontWeight: 900, color: "#fde68a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 28, textShadow: "0 2px 18px rgba(0,0,0,0.6)", zIndex: 2 }}>
                Revealing {label}…
            </div>

            {/* spotlight */}
            <div className="bw-spotlight" style={{ position: "relative", zIndex: 2 }}>
                <div style={{ position: "absolute", inset: -38, borderRadius: "50%", background: `radial-gradient(circle, ${theme.glow}, transparent 70%)` }} className="bw-pulse" />
                <Avatar photo={cur?.photo} name={cur?.name} size={Math.min(360, 38 * 8)} ring={theme.ring} glow={theme.glow} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 160, fontWeight: 900, color: "rgba(255,255,255,0.85)", textShadow: "0 4px 30px rgba(0,0,0,0.8)" }} className="bw-pulse">
                    {count != null ? count : "?"}
                </div>
            </div>

            <div style={{ marginTop: 30, fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.6)", letterSpacing: 1, zIndex: 2 }} className="bw-blink">
                {count != null ? "GET READY!" : "Building suspense…"}
            </div>

            <button onClick={onSkip} style={{ position: "absolute", bottom: 22, right: 26, zIndex: 5, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.75)", borderRadius: 12, padding: "10px 18px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                Skip ⏭
            </button>
        </div>
    );
}

// ── one stat pill ─────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
    return (
        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "14px 12px", textAlign: "center", minWidth: 120 }}>
            <div style={{ fontSize: "clamp(22px,2.4vw,34px)", fontWeight: 900, color: accent || "#fff", lineHeight: 1.05 }}>{value}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 }}>{label}</div>
        </div>
    );
}

// ── big winner card ──────────────────────────────────────────────────────
function WinnerCard({ row, theme, variant }: { row: Row; theme: typeof FAT_THEME; variant: "weight" | "fat" }) {
    const stats = variant === "weight"
        ? [
            { label: "Initial Weight", value: `${n1(row.baselineWeight)} kg` },
            { label: "Final Weight", value: `${n1(row.latestWeight)} kg`, accent: "#86efac" },
            { label: "Weight Lost", value: `${n1(row.kgLossFromBaseline)} kg`, accent: "#fde047" },
            { label: "Weight Loss %", value: `${n2(row.pctLossFromBaseline)}%`, accent: "#fde047" },
            { label: "Fat Lost", value: `${n2(row.fatLossFromBaseline)} pp`, accent: "#fca5a5" },
            { label: "Fat Loss %", value: row.fatLossPct == null ? "—" : `${n2(row.fatLossPct)}%`, accent: "#fca5a5" },
            { label: "Attendance", value: row.attendancePct == null ? "—" : `${n1(row.attendancePct)}%`, accent: "#93c5fd" },
            ...(row.muscleGainPct != null ? [{ label: "Muscle Gain %", value: `${n2(row.muscleGainPct)}%`, accent: "#c4b5fd" }] : []),
        ]
        : [
            { label: "Initial Fat %", value: `${n2(row.baselineBodyFat)}%` },
            { label: "Final Fat %", value: `${n2(row.latestBodyFat)}%`, accent: "#86efac" },
            { label: "Fat Lost", value: `${n2(row.fatLossFromBaseline)} pp`, accent: "#fde047" },
            { label: "Fat Loss %", value: row.fatLossPct == null ? "—" : `${n2(row.fatLossPct)}%`, accent: "#fde047" },
            { label: "Weight Lost", value: `${n1(row.kgLossFromBaseline)} kg`, accent: "#86efac" },
            { label: "Weight Loss %", value: `${n2(row.pctLossFromBaseline)}%`, accent: "#86efac" },
            { label: "Attendance", value: row.attendancePct == null ? "—" : `${n1(row.attendancePct)}%`, accent: "#93c5fd" },
        ];
    const headline = variant === "weight" ? `${n2(row.pctLossFromBaseline)}%` : `${n2(row.fatLossFromBaseline)} pp`;
    const headlineLabel = variant === "weight" ? "total weight loss" : "body-fat dropped";
    return (
        <div className="bw-pop" style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 2, maxWidth: "92vw" }}>
            <div style={{ fontSize: "clamp(20px,2.6vw,32px)", fontWeight: 900, color: theme.ring, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
                {theme.medal} {theme.label}
            </div>
            <Avatar photo={row.memberPhoto} name={row.memberName} size={Math.min(280, 36 * 8)} ring={theme.ring} glow={theme.glow} />
            <div style={{ fontSize: "clamp(34px,5vw,72px)", fontWeight: 900, color: "#fff", marginTop: 16, textShadow: "0 4px 26px rgba(0,0,0,0.6)", textAlign: "center", lineHeight: 1.05 }}>
                {row.memberName || "Member"}
            </div>
            <div style={{ marginTop: 6, fontSize: "clamp(16px,2vw,22px)", fontWeight: 800, color: "rgba(255,255,255,0.6)" }}>
                <span style={{ color: theme.ring, fontSize: "clamp(28px,3.4vw,46px)", fontWeight: 900 }}>{headline}</span> {headlineLabel}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 24, maxWidth: 900 }}>
                {stats.map((s) => <Stat key={s.label} {...s} />)}
            </div>
        </div>
    );
}

// ── small podium card (final board) ─────────────────────────────────────────
function PodiumCard({ row, rank, size }: { row: Row; rank: number; size: "lg" | "md" | "sm" }) {
    const t = RANK_THEME[rank];
    const photo = size === "lg" ? 150 : size === "md" ? 110 : 88;
    const name = size === "lg" ? "clamp(22px,2.4vw,34px)" : size === "md" ? "clamp(18px,1.8vw,26px)" : "clamp(15px,1.5vw,20px)";
    return (
        <div style={{ background: "rgba(255,255,255,0.05)", border: `2px solid ${t.ring}`, borderRadius: 22, padding: size === "lg" ? "26px 24px" : "18px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, boxShadow: `0 0 36px ${t.glow}`, minWidth: photo + 60 }}>
            <div style={{ fontSize: size === "lg" ? 40 : 28, fontWeight: 900 }}>{t.medal}</div>
            <Avatar photo={row.memberPhoto} name={row.memberName} size={photo} ring={t.ring} glow={t.glow} />
            <div style={{ fontSize: name, fontWeight: 900, color: "#fff", textAlign: "center", lineHeight: 1.1 }}>{row.memberName || "Member"}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: t.ring, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.label}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                <span style={chip}>⚖ {n1(row.kgLossFromBaseline)}kg · {n2(row.pctLossFromBaseline)}%</span>
                <span style={chip}>🔥 {n2(row.fatLossFromBaseline)}pp</span>
                <span style={chip}>📅 {row.attendancePct == null ? "—" : n1(row.attendancePct) + "%"}</span>
            </div>
        </div>
    );
}
const chip: React.CSSProperties = { background: "rgba(255,255,255,0.08)", borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.85)" };

// ── podium column for the static full-screen board (card on a gradient pedestal) ──
// Columns are bottom-aligned and pedestal heights descend by rank, so the cards
// staircase down from the champion and the whole row fills the screen height.
const PEDESTAL_H = ["30vh", "24vh", "19vh", "14vh", "10vh"];
const PEDESTAL_CAP = [300, 240, 192, 144, 108];

function PodiumColumn({ row, rank, fat }: { row: Row; rank?: number; fat?: boolean }) {
    const t = fat ? FAT_THEME : RANK_THEME[rank!];
    const label = fat ? "Highest Fat Loss" : t.label;
    const featured = !fat && rank === 0;
    const photo = fat ? 116 : featured ? 138 : 102;
    const width = fat ? 224 : featured ? 248 : 208;
    const pedH = fat ? "min(20vh,184px)" : `min(${PEDESTAL_H[rank!]},${PEDESTAL_CAP[rank!]}px)`;
    const numeral = fat ? "🔥" : String(rank! + 1);
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            {/* winner card */}
            <div style={{
                width, maxWidth: "16vw", background: "rgba(255,255,255,0.055)", border: `2px solid ${t.ring}`,
                borderRadius: 22, padding: featured ? "22px 18px 20px" : "18px 14px 16px", display: "flex",
                flexDirection: "column", alignItems: "center", gap: 8, boxShadow: `0 0 ${featured ? 52 : 34}px ${t.glow}`,
                backdropFilter: "blur(2px)", transform: featured ? "scale(1.03)" : undefined,
            }}>
                <div style={{ fontSize: featured ? 40 : 30, fontWeight: 900, lineHeight: 1 }}>{t.medal}</div>
                <Avatar photo={row.memberPhoto} name={row.memberName} size={photo} ring={t.ring} glow={t.glow} />
                <div style={{ fontSize: featured ? "clamp(20px,2vw,30px)" : "clamp(15px,1.5vw,23px)", fontWeight: 900, color: "#fff", textAlign: "center", lineHeight: 1.1, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{row.memberName || "Member"}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: t.ring, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, width: "100%" }}>
                    <span style={chip}>⚖ {n1(row.kgLossFromBaseline)}kg · {n2(row.pctLossFromBaseline)}%</span>
                    <span style={chip}>🔥 {n2(row.fatLossFromBaseline)}pp</span>
                    <span style={chip}>📅 {row.attendancePct == null ? "—" : n1(row.attendancePct) + "%"}</span>
                </div>
            </div>
            {/* pedestal */}
            <div style={{
                width, maxWidth: "16vw", height: pedH, marginTop: 12, background: t.grad, borderRadius: "16px 16px 0 0",
                display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 14,
                boxShadow: `0 -6px 30px ${t.glow}, inset 0 2px 0 rgba(255,255,255,0.25)`,
                position: "relative", overflow: "hidden",
            }}>
                <span style={{ fontSize: featured ? "clamp(38px,5vw,72px)" : "clamp(30px,3.8vw,56px)", fontWeight: 900, color: "rgba(0,0,0,0.55)", textShadow: "0 2px 0 rgba(255,255,255,0.25)", lineHeight: 1 }}>{numeral}</span>
            </div>
        </div>
    );
}

// ── final podium (1 big center, 2-3 medium, 4-5 small) ──────────────────────
function FinalPodium({ top5 }: { top5: Row[] }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, width: "100%" }}>
            {top5[0] && <PodiumCard row={top5[0]} rank={0} size="lg" />}
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", justifyContent: "center" }}>
                {top5[1] && <PodiumCard row={top5[1]} rank={1} size="md" />}
                {top5[2] && <PodiumCard row={top5[2]} rank={2} size="md" />}
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
                {top5[3] && <PodiumCard row={top5[3]} rank={3} size="sm" />}
                {top5[4] && <PodiumCard row={top5[4]} rank={4} size="sm" />}
            </div>
        </div>
    );
}

// ── main ─────────────────────────────────────────────────────────────────
type View = "home" | "reveal" | "winner" | "finalTop5" | "showAll";
const ROLL_MS = 24000;

export default function BtcWinners() {
    const navigate = useNavigate();
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const { challenge, loading: cl } = useActiveBtcChallenge(clubId);
    const { weight, bodyFat, participants, weighIns, loading: ll } = useBtcLeaderboard(clubId, challenge?.id || null);
    const { meals } = useBtcChallengeMeals(clubId, challenge?.id || null);

    const [view, setView] = useState<View>("home");
    const [seq, setSeq] = useState<"top5" | "fat">("top5");
    const [rank, setRank] = useState(0);
    const [revealKey, setRevealKey] = useState(0);
    const [muted, setMuted] = useState(false);
    const confettiRef = useRef<HTMLCanvasElement>(null);

    const sessions = challenge?.weighInSessions || [];
    const partById = useMemo(() => new Map(participants.map((p: any) => [p.memberId, p])), [participants]);

    const enrich = useCallback((row: Row): Row => {
        const p = partById.get(row.memberId);
        const mine = weighIns.filter((w: any) => w.memberId === row.memberId);
        const d = p ? computeDisciplineStats(p, mine, meals, sessions) : null;
        return { ...row, attendancePct: d?.attendancePct ?? null, fatLossPct: d?.fatLossPct ?? null, muscleGainPct: row.muscleGainPct ?? d?.muscleGainPct ?? null };
    }, [partById, weighIns, meals, sessions]);

    const top5 = useMemo(() => weight.filter((r: any) => !r.disqualified).slice(0, 5).map(enrich), [weight, enrich]);
    const fatWinner = useMemo(() => { const w = bodyFat.filter((r: any) => !r.disqualified)[0]; return w ? enrich(w) : null; }, [bodyFat, enrich]);
    const rollPhotos = useMemo(() => participants.filter((p: any) => !p.disqualified).map((p: any) => ({ photo: p.memberPhoto, name: p.memberName })), [participants]);

    // celebrate when a winner card appears
    useEffect(() => {
        if (view !== "winner") return;
        const stop = burstConfetti(confettiRef.current);
        const t = setTimeout(() => burstConfetti(confettiRef.current), 700);
        if (!muted) playFanfare();
        return () => { stop?.(); clearTimeout(t); };
    }, [view, rank, seq, muted]);

    const startReveal = (which: "top5" | "fat", atRank = 0) => {
        setSeq(which); setRank(atRank); setRevealKey((k) => k + 1); setView("reveal");
    };

    const loading = cl || ll;
    const noData = !challenge || (top5.length === 0 && !fatWinner);

    // ── shell ──
    return (
        <div style={{ position: "fixed", inset: 0, fontFamily: FONT, color: "#fff", overflow: "hidden", background: "radial-gradient(circle at 50% 25%, #1e293b, #0b1220 60%, #060a14)" }}>
            <style>{KEYFRAMES}</style>
            <canvas ref={confettiRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50 }} />

            {/* corner controls */}
            <button onClick={() => setMuted((m) => !m)} title={muted ? "Unmute" : "Mute"} style={cornerBtn(22, "left")}>{muted ? "🔇" : "🔊"}</button>
            <button onClick={() => navigate(-1)} title="Close" style={cornerBtn(22, "right")}>✕ Close</button>

            {loading ? (
                <Centered><div className="bw-blink" style={{ fontSize: 26, fontWeight: 800, color: "rgba(255,255,255,0.6)" }}>Loading the ceremony…</div></Centered>
            ) : noData ? (
                <Centered>
                    <div style={{ fontSize: 64, marginBottom: 14 }}>🏆</div>
                    <div style={{ fontSize: 28, fontWeight: 900 }}>No results to reveal yet</div>
                    <div style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", marginTop: 8, maxWidth: 520, textAlign: "center" }}>
                        {challenge ? "This challenge has no ranked participants with weigh-ins yet." : "There's no active BTC challenge. Mark one active in BTC → Challenges."}
                    </div>
                </Centered>
            ) : view === "home" ? (
                <Centered>
                    <div style={{ fontSize: "clamp(28px,4vw,56px)", fontWeight: 900, textShadow: "0 4px 30px rgba(0,0,0,0.5)" }}>🏆 BTC Winners</div>
                    <div style={{ fontSize: "clamp(14px,1.6vw,20px)", color: "#fde68a", fontWeight: 800, letterSpacing: 1, marginTop: 4 }}>{challenge?.name} · {club?.name}</div>
                    <div style={{ display: "flex", gap: 26, flexWrap: "wrap", justifyContent: "center", marginTop: 48 }}>
                        <BigBtn onClick={() => startReveal("top5", 0)} emoji="🏆" title="Reveal Top 5" sub="Weight-loss winners" grad="linear-gradient(135deg,#f59e0b,#b45309)" disabled={top5.length === 0} />
                        <BigBtn onClick={() => startReveal("fat", 0)} emoji="🔥" title="Reveal Highest" sub="Fat-loss champion" grad="linear-gradient(135deg,#e11d48,#9f1239)" disabled={!fatWinner} />
                    </div>
                    <button onClick={() => setView("showAll")} style={{ marginTop: 40, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.25)", color: "#fff", borderRadius: 14, padding: "14px 30px", fontSize: 17, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                        📺 Show Winners (static board)
                    </button>
                </Centered>
            ) : view === "reveal" ? (
                <RevealRoll
                    key={revealKey}
                    photos={rollPhotos}
                    durationMs={ROLL_MS}
                    label={seq === "fat" ? "Highest Fat Loss" : RANK_THEME[rank]?.label || "the winner"}
                    theme={seq === "fat" ? FAT_THEME : RANK_THEME[rank]}
                    onDone={() => setView("winner")}
                    onSkip={() => setView("winner")}
                />
            ) : view === "winner" ? (
                <Centered>
                    {seq === "fat" && fatWinner
                        ? <WinnerCard row={fatWinner} theme={FAT_THEME} variant="fat" />
                        : top5[rank] && <WinnerCard row={top5[rank]} theme={RANK_THEME[rank]} variant="weight" />}
                    <div style={{ display: "flex", gap: 14, marginTop: 36, zIndex: 3 }}>
                        {seq === "top5" && rank < top5.length - 1 && (
                            <button onClick={() => startReveal("top5", rank + 1)} style={primaryBtn}>Reveal {RANK_THEME[rank + 1].label} →</button>
                        )}
                        {seq === "top5" && rank >= top5.length - 1 && (
                            <button onClick={() => setView("finalTop5")} style={primaryBtn}>🎉 Show Final Top 5 →</button>
                        )}
                        {seq === "fat" && (
                            <button onClick={() => setView("home")} style={primaryBtn}>← Back to menu</button>
                        )}
                        <button onClick={() => setView("home")} style={ghostBtn}>Menu</button>
                    </div>
                </Centered>
            ) : view === "finalTop5" ? (
                <Scroll>
                    <div style={{ fontSize: "clamp(24px,3vw,44px)", fontWeight: 900, marginBottom: 26, textAlign: "center" }}>🏆 Top 5 — Weight-Loss Champions</div>
                    <FinalPodium top5={top5} />
                    <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 34 }}>
                        {fatWinner && <button onClick={() => startReveal("fat", 0)} style={primaryBtn}>🔥 Reveal Highest Fat Loss →</button>}
                        <button onClick={() => setView("showAll")} style={ghostBtn}>📺 Static board</button>
                        <button onClick={() => setView("home")} style={ghostBtn}>Menu</button>
                    </div>
                </Scroll>
            ) : (
                /* showAll — static combined board: one screen, full width, no scroll,
                   weight-loss top 5 + fat-loss champion side by side. */
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "clamp(16px,3vh,40px) clamp(20px,2.5vw,52px) 0", overflow: "hidden" }}>
                    <div style={{ fontSize: "clamp(22px,3vw,44px)", fontWeight: 900, textAlign: "center", lineHeight: 1.1 }}>🏆 {challenge?.name} — Winners</div>
                    <div style={{ fontSize: "clamp(12px,1.4vw,17px)", color: "rgba(255,255,255,0.5)", marginTop: 4, marginBottom: "clamp(10px,2vh,22px)", textAlign: "center" }}>{club?.name}</div>

                    {/* podium row — bottom-aligned, fills the screen height, full width */}
                    <div style={{ display: "flex", alignItems: "stretch", justifyContent: "space-evenly", gap: "clamp(6px,0.8vw,18px)", width: "100%", flex: 1, minHeight: 0 }}>
                        {top5.map((row, i) => <PodiumColumn key={row.memberId || i} row={row} rank={i} />)}
                        {fatWinner && <div style={{ alignSelf: "stretch", width: 2, margin: "0 clamp(4px,0.6vw,14px)", background: "linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)" }} />}
                        {fatWinner && <PodiumColumn row={fatWinner} fat />}
                    </div>

                    <button onClick={() => setView("home")} style={{ ...ghostBtn, position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", padding: "9px 22px", fontSize: 14 }}>← Menu</button>
                </div>
            )}
        </div>
    );
}

// ── little layout + button helpers ──────────────────────────────────────────
function Centered({ children }: { children: React.ReactNode }) {
    return <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>{children}</div>;
}
function Scroll({ children }: { children: React.ReactNode }) {
    return <div style={{ position: "absolute", inset: 0, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 24px 40px" }}>{children}</div>;
}
function BigBtn({ onClick, emoji, title, sub, grad, disabled }: { onClick: () => void; emoji: string; title: string; sub: string; grad: string; disabled?: boolean }) {
    return (
        <button onClick={onClick} disabled={disabled} className={disabled ? "" : "bw-hover"} style={{
            width: 320, maxWidth: "80vw", padding: "40px 28px", borderRadius: 28, border: "none", cursor: disabled ? "not-allowed" : "pointer",
            background: disabled ? "rgba(255,255,255,0.07)" : grad, color: "#fff", fontFamily: FONT, opacity: disabled ? 0.45 : 1,
            boxShadow: disabled ? "none" : "0 14px 50px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
            <span style={{ fontSize: 64 }}>{emoji}</span>
            <span style={{ fontSize: 30, fontWeight: 900 }}>{title}</span>
            <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.85 }}>{sub}</span>
        </button>
    );
}
const primaryBtn: React.CSSProperties = { background: "linear-gradient(135deg,#fbbf24,#d97706)", color: "#1a1206", border: "none", borderRadius: 14, padding: "16px 30px", fontSize: 18, fontWeight: 900, cursor: "pointer", fontFamily: FONT, boxShadow: "0 8px 28px rgba(251,191,36,0.4)" };
const ghostBtn: React.CSSProperties = { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.22)", borderRadius: 14, padding: "16px 24px", fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const cornerBtn = (top: number, side: "left" | "right"): React.CSSProperties => ({
    position: "fixed", top, [side]: 22, zIndex: 60, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)",
    color: "rgba(255,255,255,0.8)", borderRadius: 12, padding: "10px 16px", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
});

const KEYFRAMES = `
@keyframes bw-pulse { 0%,100% { transform: scale(1); opacity: 0.9 } 50% { transform: scale(1.08); opacity: 1 } }
@keyframes bw-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
@keyframes bw-qmark { 0% { transform: translateY(20vh) scale(0.6); opacity: 0 } 20% { opacity: 0.5 } 100% { transform: translateY(-90vh) scale(1.2); opacity: 0 } }
@keyframes bw-blink { 0%,100% { opacity: 0.45 } 50% { opacity: 1 } }
@keyframes bw-pop { 0% { transform: scale(0.7); opacity: 0 } 60% { transform: scale(1.06) } 100% { transform: scale(1); opacity: 1 } }
.bw-pulse { animation: bw-pulse 1.1s ease-in-out infinite; }
.bw-float { animation: bw-float 3.2s ease-in-out infinite; }
.bw-spotlight { animation: bw-pulse 0.9s ease-in-out infinite; }
.bw-qmark { position: absolute; bottom: 0; font-weight: 900; color: rgba(253,224,71,0.5); animation: bw-qmark 4.5s linear infinite; z-index: 1; }
.bw-blink { animation: bw-blink 1s ease-in-out infinite; }
.bw-pop { animation: bw-pop 0.6s cubic-bezier(.2,.9,.3,1.3) both; }
.bw-hover { transition: transform 0.15s ease, box-shadow 0.15s ease; }
.bw-hover:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 22px 60px rgba(0,0,0,0.55); }
`;
