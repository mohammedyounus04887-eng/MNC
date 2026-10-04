/**
 * The Loyalty Program board — the club's slide, on the wall.
 *
 * Built to be read from across the room, so every size is a `clamp()` against
 * the viewport rather than a fixed pixel: the same page fills a 1080p TV, a
 * reception tablet and a phone without a second layout to keep in step.
 *
 * It holds no content of its own. Everything printed here comes from
 * `lib/loyaltyProgram.ts`, so correcting a point value on the wall is one edit
 * in one file, not a hunt through screens.
 */

import { useEffect, useState } from "react";
import {
    LOYALTY_HEADINGS,
    LOYALTY_RULES,
    LOYALTY_TIERS,
    type LoyaltyGift,
} from "@/lib/loyaltyProgram";

const BG = "linear-gradient(135deg, #0a1f14, #1a3a2a)";
const ACCENT = "#86efac";
const GOLD = "#fbbf24";
const CARD_BG = "rgba(255,255,255,0.06)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.14)";

/** Tier accents, brightest at the top prize. */
const TIER_COLOR = ["#86efac", "#7dd3fc", "#fbbf24"];

interface LoyaltyBoardProps {
    clubName: string;
    clubLogo?: string;
    /** Shown as the one action on the board. */
    onViewLeaderboard: () => void;
}

export default function LoyaltyBoard({ clubName, clubLogo, onViewLeaderboard }: LoyaltyBoardProps) {
    const [now, setNow] = useState(() => new Date());

    // A TV left running for a week should still show the right day.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    return (
        <div style={styles.root}>
            <style>{KEYFRAMES}</style>

            {/* ── Header ─────────────────────────────────────────────── */}
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    {clubLogo ? (
                        <img src={clubLogo} alt="" style={styles.logo} />
                    ) : (
                        <div style={styles.logoFallback}>{(clubName || "M").charAt(0)}</div>
                    )}
                    <div>
                        <div style={styles.clubName}>{clubName || "Magic Nutrition Club"}</div>
                        <div style={styles.kicker}>Rewarding the people who show up</div>
                    </div>
                </div>
                <div style={styles.headerRight}>
                    <div style={styles.time}>
                        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={styles.date}>
                        {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                    </div>
                </div>
            </header>

            <h1 style={styles.title}>LOYALTY PROGRAM</h1>

            {/* ── The two halves of the slide ────────────────────────── */}
            <div style={styles.body}>
                {/* Earning */}
                <section style={styles.column}>
                    <div style={{ ...styles.columnHead, background: "rgba(134,239,172,0.15)", color: ACCENT }}>
                        {LOYALTY_HEADINGS.earn}
                    </div>
                    <ul style={styles.ruleList}>
                        {LOYALTY_RULES.map((rule) => (
                            <li key={rule.id} style={styles.ruleRow}>
                                <span style={styles.bullet}>&#10148;</span>
                                <span style={styles.ruleLabel}>{rule.label}</span>
                                <span style={styles.leader} />
                                <span style={styles.rulePoints}>{rule.pointsLabel}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Spending */}
                <section style={styles.column}>
                    <div style={{ ...styles.columnHead, background: "rgba(251,191,36,0.15)", color: GOLD }}>
                        {LOYALTY_HEADINGS.spend}
                    </div>
                    <div style={styles.tierStack}>
                        {LOYALTY_TIERS.map((tier, i) => (
                            <div
                                key={tier.points}
                                style={{ ...styles.tierCard, borderColor: `${TIER_COLOR[i]}55` }}
                            >
                                <div style={styles.tierHead}>
                                    <span style={{ ...styles.tierPoints, color: TIER_COLOR[i] }}>
                                        {tier.points} points
                                    </span>
                                    <span style={styles.tierNote}>({LOYALTY_HEADINGS.chooseOne})</span>
                                </div>
                                <div style={styles.productGrid}>
                                    {tier.products.map((p) => (
                                        <Gift key={p.name} gift={p} accent={TIER_COLOR[i]} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {/* ── Footer ─────────────────────────────────────────────── */}
            <footer style={styles.footer}>
                <div style={styles.footNote}>
                    Points are counted automatically from your attendance, guests and renewals.
                </div>
                <button onClick={onViewLeaderboard} style={styles.cta}>
                    &#127942;&nbsp; View Leaderboard
                </button>
            </footer>
        </div>
    );
}

/**
 * One gift: its photograph, with its name under it.
 *
 * The photo is fetched from Herbalife's own asset host. This screen is left
 * running on a wall all day, so it has to survive that host being slow or
 * having moved a file: a failed image is removed and the name stands on its
 * own, centred, exactly as the board read before the pictures existed. A broken
 * image icon on a TV in a club is worse than no image at all.
 */
function Gift({ gift, accent }: { gift: LoyaltyGift; accent: string }) {
    const [failed, setFailed] = useState(false);
    const showImage = !!gift.image && !failed;

    return (
        <div style={styles.product}>
            {showImage && (
                <img
                    src={gift.image}
                    alt=""
                    loading="eager"
                    decoding="async"
                    onError={() => setFailed(true)}
                    style={styles.productImage}
                />
            )}
            <div style={styles.productName}>
                <span style={{ ...styles.bullet, color: accent }}>&#10148;</span>
                {gift.name}
            </div>
        </div>
    );
}

const KEYFRAMES = `
@keyframes loyalty-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
`;

const styles: Record<string, React.CSSProperties> = {
    root: {
        minHeight: "100dvh",
        background: BG,
        color: "#fff",
        fontFamily: "Nunito, sans-serif",
        display: "flex",
        flexDirection: "column",
        padding: "clamp(12px, 1.6vw, 30px) clamp(14px, 2.4vw, 46px)",
        gap: "clamp(8px, 1vh, 16px)",
        animation: "loyalty-in 0.4s ease-out",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        paddingBottom: "clamp(8px, 1vh, 16px)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
    },
    headerLeft: { display: "flex", alignItems: "center", gap: "clamp(10px, 1vw, 20px)" },
    logo: {
        width: "clamp(40px, 3.6vw, 72px)",
        height: "clamp(40px, 3.6vw, 72px)",
        borderRadius: "50%",
        objectFit: "cover",
        border: `2px solid ${ACCENT}`,
    },
    logoFallback: {
        width: "clamp(40px, 3.6vw, 72px)",
        height: "clamp(40px, 3.6vw, 72px)",
        borderRadius: "50%",
        background: "#2d9653",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "clamp(20px, 1.8vw, 36px)",
        fontWeight: 900,
    },
    clubName: { fontSize: "clamp(17px, 1.7vw, 34px)", fontWeight: 900, letterSpacing: 0.4 },
    kicker: { fontSize: "clamp(11px, 0.85vw, 17px)", opacity: 0.65, marginTop: 2 },
    headerRight: { textAlign: "right" },
    time: { fontSize: "clamp(18px, 1.9vw, 38px)", fontWeight: 900, color: ACCENT, lineHeight: 1 },
    date: { fontSize: "clamp(11px, 0.9vw, 18px)", opacity: 0.75, marginTop: 4 },

    title: {
        margin: 0,
        textAlign: "center",
        fontSize: "clamp(30px, 4.2vw, 84px)",
        fontWeight: 900,
        letterSpacing: "clamp(1px, 0.35vw, 7px)",
        color: ACCENT,
        textShadow: "0 4px 30px rgba(134,239,172,0.25)",
        lineHeight: 1.05,
    },

    body: {
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
        gap: "clamp(12px, 1.4vw, 28px)",
        overflow: "auto",
    },
    column: { display: "flex", flexDirection: "column", gap: "clamp(8px, 0.9vh, 14px)", minWidth: 0 },
    columnHead: {
        padding: "clamp(7px, 0.8vh, 14px) clamp(10px, 1vw, 20px)",
        borderRadius: 10,
        fontSize: "clamp(13px, 1.12vw, 24px)",
        fontWeight: 900,
        letterSpacing: 0.3,
        textAlign: "center",
    },

    ruleList: {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "clamp(4px, 0.55vh, 10px)",
        flex: 1,
    },
    ruleRow: {
        display: "flex",
        alignItems: "baseline",
        gap: "clamp(6px, 0.6vw, 12px)",
        background: CARD_BG,
        border: CARD_BORDER,
        borderRadius: 10,
        padding: "clamp(6px, 0.75vh, 14px) clamp(10px, 1vw, 20px)",
    },
    bullet: { color: ACCENT, fontSize: "clamp(11px, 0.9vw, 18px)", flexShrink: 0 },
    // Deliberately allowed to wrap: on a phone, "UMS Renewal (ON Time)" beside
    // its points is wider than the screen, and a row that grows a line is
    // better than one that runs off the side.
    ruleLabel: { fontSize: "clamp(13px, 1.15vw, 25px)", fontWeight: 700 },
    leader: {
        flex: 1,
        borderBottom: "1px dotted rgba(255,255,255,0.28)",
        transform: "translateY(-4px)",
        minWidth: 8,
    },
    rulePoints: {
        fontSize: "clamp(13px, 1.15vw, 25px)",
        fontWeight: 900,
        color: ACCENT,
        whiteSpace: "nowrap",
    },

    tierStack: { display: "flex", flexDirection: "column", gap: "clamp(8px, 0.9vh, 16px)", flex: 1 },
    tierCard: {
        background: CARD_BG,
        border: "2px solid",
        borderRadius: 14,
        padding: "clamp(8px, 1vh, 18px) clamp(10px, 1vw, 22px)",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "clamp(5px, 0.6vh, 12px)",
        justifyContent: "center",
    },
    tierHead: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
    tierPoints: { fontSize: "clamp(18px, 1.7vw, 36px)", fontWeight: 900 },
    tierNote: { fontSize: "clamp(10px, 0.82vw, 17px)", opacity: 0.7, fontStyle: "italic" },
    productGrid: {
        display: "grid",
        // Narrower than the text-only version was: the tiles now carry a
        // picture, so five of them still have to fit across a tier.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 130px), 1fr))",
        gap: "clamp(4px, 0.5vh, 10px) clamp(8px, 0.8vw, 18px)",
        alignItems: "end",
    },
    product: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "clamp(2px, 0.3vh, 6px)",
        minWidth: 0,
    },
    productImage: {
        // The source shots are 1500x770 with transparency. `contain` keeps every
        // product at its true proportions, so a tall canister and a flat sachet
        // sit together without either being stretched.
        // Sized against viewport height so the three tiers still fit one 1080p
        // screen without scrolling: ~75px a shot there, and it shrinks with the
        // screen rather than pushing the bottom tier off a tablet.
        width: "100%",
        height: "clamp(40px, 7vh, 120px)",
        objectFit: "contain",
        objectPosition: "center bottom",
        filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.45))",
    },
    productName: {
        fontSize: "clamp(11px, 0.95vw, 20px)",
        fontWeight: 700,
        display: "flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1.25,
    },

    footer: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        paddingTop: "clamp(8px, 1vh, 16px)",
        borderTop: "1px solid rgba(255,255,255,0.12)",
    },
    footNote: { fontSize: "clamp(11px, 0.88vw, 18px)", opacity: 0.6 },
    cta: {
        background: ACCENT,
        color: "#0a1f14",
        border: "none",
        borderRadius: 999,
        padding: "clamp(10px, 1.1vh, 18px) clamp(20px, 2vw, 42px)",
        fontSize: "clamp(14px, 1.2vw, 26px)",
        fontWeight: 900,
        fontFamily: "Nunito, sans-serif",
        cursor: "pointer",
        boxShadow: "0 6px 26px rgba(134,239,172,0.35)",
        minHeight: 48,
    },
};
