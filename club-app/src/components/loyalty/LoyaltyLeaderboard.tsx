/**
 * Who is actually working the programme.
 *
 * The board on the wall says what a point is worth. This says who has them —
 * ranked, with the gift tier each person has already reached, and the workings
 * behind every total. The workings matter: the prize is a product, so "why has
 * she got forty and I have thirty" has to be answerable at the desk without
 * anyone taking somebody's word for it.
 *
 * Nothing here is stored. Every number is recalculated from the club's own
 * records by `lib/loyaltyPoints.ts` — see that file for where each one comes
 * from.
 */

import { useMemo, useState } from "react";
import { useLoyaltyStandings, type LoyaltyPeriod } from "@/hooks/useLoyalty";
import { LOYALTY_TIERS, tierProgress } from "@/lib/loyaltyProgram";
import type { LoyaltyStanding } from "@/lib/loyaltyPoints";

const BG = "linear-gradient(135deg, #0a1f14, #1a3a2a)";
const ACCENT = "#86efac";
const GOLD = "#fbbf24";
const CARD_BG = "rgba(255,255,255,0.06)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.14)";

const MEDAL = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
const RANK_COLOR = ["#fbbf24", "#d4d4d8", "#d97757"];

interface Props {
    clubId: string | null;
    clubName: string;
    onBack: () => void;
}

export default function LoyaltyLeaderboard({ clubId, clubName, onBack }: Props) {
    const [period, setPeriod] = useState<LoyaltyPeriod>("month");
    const [search, setSearch] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);

    const { data, isLoading, isFetching, error, refetch } = useLoyaltyStandings(clubId, period);

    const rows = useMemo(() => {
        const all = data?.standings ?? [];
        // Rank is the position in the full club standings, so filtering the list
        // never renumbers anybody — searching for one member still shows the
        // rank they actually hold.
        const ranked = all.map((s, i) => ({ ...s, rank: i + 1 }));
        const q = search.trim().toLowerCase();
        if (!q) return ranked;
        return ranked.filter(
            (r) => r.name.toLowerCase().includes(q) || r.memberCode.toLowerCase().includes(q),
        );
    }, [data, search]);

    const qualified = (data?.standings ?? []).filter((s) => s.points >= LOYALTY_TIERS[0].points).length;

    return (
        <div style={styles.root}>
            {/* ── Header ─────────────────────────────────────────────── */}
            <header style={styles.header}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                    <button onClick={onBack} style={styles.back} aria-label="Back to the loyalty board">
                        &#8592;
                    </button>
                    <div style={{ minWidth: 0 }}>
                        <div style={styles.title}>&#127942; Loyalty Leaderboard</div>
                        <div style={styles.sub}>
                            {clubName}
                            {data ? ` · ${data.from} to ${data.to}` : ""}
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    style={{ ...styles.ghost, opacity: isFetching ? 0.5 : 1 }}
                >
                    {isFetching ? "Refreshing…" : "Refresh"}
                </button>
            </header>

            {/* ── Controls ───────────────────────────────────────────── */}
            <div style={styles.controls}>
                <div style={styles.tabs}>
                    {([
                        ["month", "This Month"],
                        ["all", "All Time"],
                    ] as [LoyaltyPeriod, string][]).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setPeriod(key)}
                            style={{
                                ...styles.tab,
                                ...(period === key ? styles.tabOn : null),
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search a name or member ID…"
                    style={styles.search}
                />
            </div>

            {/* ── Summary strip ──────────────────────────────────────── */}
            {data && (
                <div style={styles.stats}>
                    <Stat label="On the board" value={String(data.standings.length)} />
                    <Stat label="Reached 100+" value={String(qualified)} color={GOLD} />
                    <Stat label="Club days counted" value={String(data.clubOpenDays)} />
                    <Stat label="Members" value={String(data.memberCount)} />
                </div>
            )}

            {/* ── The list ───────────────────────────────────────────── */}
            <div style={styles.list}>
                {isLoading && <div style={styles.empty}>Counting points…</div>}

                {!isLoading && error && (
                    <div style={{ ...styles.empty, color: "#fca5a5" }}>
                        Could not read the points. Check the connection and press Refresh.
                    </div>
                )}

                {!isLoading && !error && rows.length === 0 && (
                    <div style={styles.empty}>
                        {search
                            ? "Nobody matches that search."
                            : "No points yet for this period. They appear as members are marked present, bring guests and renew."}
                    </div>
                )}

                {rows.map((row) => (
                    <Row
                        key={row.memberId}
                        row={row}
                        open={openId === row.memberId}
                        onToggle={() => setOpenId(openId === row.memberId ? null : row.memberId)}
                    />
                ))}
            </div>

            <div style={styles.foot}>
                Points are recalculated from the club's own records each time this opens —
                nothing is stored, so a corrected attendance corrects the leaderboard.
            </div>
        </div>
    );
}

// ─── pieces ──────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div style={styles.stat}>
            <div style={{ ...styles.statValue, color: color ?? ACCENT }}>{value}</div>
            <div style={styles.statLabel}>{label}</div>
        </div>
    );
}

function Row({
    row,
    open,
    onToggle,
}: {
    row: LoyaltyStanding & { rank: number };
    open: boolean;
    onToggle: () => void;
}) {
    const top3 = row.rank <= 3;
    const { reached, next, toNext } = tierProgress(row.points);

    return (
        <div
            style={{
                ...styles.row,
                ...(top3 ? { borderColor: `${RANK_COLOR[row.rank - 1]}66`, background: "rgba(255,255,255,0.09)" } : null),
            }}
        >
            <button onClick={onToggle} style={styles.rowMain}>
                <div
                    style={{
                        ...styles.rank,
                        ...(top3 ? { color: RANK_COLOR[row.rank - 1], borderColor: `${RANK_COLOR[row.rank - 1]}66` } : null),
                    }}
                >
                    {top3 ? MEDAL[row.rank - 1] : row.rank}
                </div>

                {row.photo ? (
                    <img src={row.photo} alt="" style={styles.avatar} />
                ) : (
                    <div style={styles.avatarFallback}>{row.name.charAt(0).toUpperCase()}</div>
                )}

                <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <div style={styles.name}>{row.name}</div>
                    <div style={styles.meta}>
                        {row.memberCode ? `${row.memberCode} · ` : ""}
                        {reached ? (
                            <span style={{ color: GOLD, fontWeight: 900 }}>
                                {reached.points}-point gift unlocked
                            </span>
                        ) : next ? (
                            <span>{toNext} more for the {next.points}-point gift</span>
                        ) : null}
                    </div>
                </div>

                <div style={{ textAlign: "right" }}>
                    <div style={styles.points}>{row.points}</div>
                    <div style={styles.pointsLabel}>points</div>
                </div>
                <span style={{ ...styles.chevron, transform: open ? "rotate(90deg)" : "none" }}>&#8250;</span>
            </button>

            {open && (
                <div style={styles.breakdown}>
                    {row.breakdown.map((b) => (
                        <div key={b.ruleId} style={styles.breakdownRow}>
                            <span style={styles.breakdownLabel}>{b.label}</span>
                            {b.count > 1 && <span style={styles.breakdownCount}>&times;{b.count}</span>}
                            <span style={styles.breakdownDots} />
                            <span style={styles.breakdownPoints}>+{b.points}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── styles ──────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    root: {
        minHeight: "100dvh",
        background: BG,
        color: "#fff",
        fontFamily: "Nunito, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(8px, 1vh, 16px)",
        padding: "clamp(12px, 1.6vw, 30px) clamp(14px, 2.4vw, 46px)",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        paddingBottom: "clamp(8px, 1vh, 14px)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
    },
    back: {
        background: "rgba(255,255,255,0.08)",
        border: CARD_BORDER,
        color: "#fff",
        borderRadius: 12,
        width: 48,
        height: 48,
        fontSize: 24,
        cursor: "pointer",
        flexShrink: 0,
        fontFamily: "Nunito, sans-serif",
    },
    title: { fontSize: "clamp(19px, 1.9vw, 38px)", fontWeight: 900, color: ACCENT },
    sub: { fontSize: "clamp(11px, 0.85vw, 17px)", opacity: 0.65, marginTop: 2 },
    ghost: {
        background: "rgba(255,255,255,0.08)",
        border: CARD_BORDER,
        color: "#fff",
        borderRadius: 999,
        padding: "10px 20px",
        fontSize: "clamp(12px, 0.95vw, 18px)",
        fontWeight: 800,
        cursor: "pointer",
        minHeight: 44,
        fontFamily: "Nunito, sans-serif",
    },

    controls: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
    tabs: {
        display: "flex",
        gap: 4,
        background: "rgba(255,255,255,0.07)",
        border: CARD_BORDER,
        borderRadius: 12,
        padding: 4,
    },
    tab: {
        background: "transparent",
        border: "none",
        color: "rgba(255,255,255,0.7)",
        borderRadius: 9,
        padding: "10px 22px",
        fontSize: "clamp(12px, 1vw, 20px)",
        fontWeight: 800,
        cursor: "pointer",
        minHeight: 44,
        fontFamily: "Nunito, sans-serif",
    },
    tabOn: { background: ACCENT, color: "#0a1f14" },
    search: {
        flex: 1,
        minWidth: 200,
        background: "rgba(255,255,255,0.07)",
        border: CARD_BORDER,
        color: "#fff",
        borderRadius: 12,
        padding: "12px 18px",
        fontSize: "clamp(12px, 1vw, 20px)",
        outline: "none",
        minHeight: 44,
        fontFamily: "Nunito, sans-serif",
    },

    stats: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
        gap: 10,
    },
    stat: {
        background: CARD_BG,
        border: CARD_BORDER,
        borderRadius: 12,
        padding: "clamp(8px, 1vh, 14px) 16px",
        textAlign: "center",
    },
    statValue: { fontSize: "clamp(19px, 1.8vw, 36px)", fontWeight: 900, lineHeight: 1.1 },
    statLabel: { fontSize: "clamp(10px, 0.78vw, 15px)", opacity: 0.65, marginTop: 3 },

    list: { flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 },
    empty: {
        background: CARD_BG,
        border: CARD_BORDER,
        borderRadius: 14,
        padding: "clamp(24px, 4vh, 60px) 24px",
        textAlign: "center",
        fontSize: "clamp(13px, 1.05vw, 21px)",
        opacity: 0.8,
    },

    row: { background: CARD_BG, border: CARD_BORDER, borderRadius: 14, overflow: "hidden" },
    rowMain: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "clamp(8px, 1vw, 18px)",
        padding: "clamp(8px, 1vh, 16px) clamp(10px, 1.1vw, 22px)",
        background: "transparent",
        border: "none",
        color: "inherit",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "Nunito, sans-serif",
        minHeight: 56,
    },
    rank: {
        width: "clamp(34px, 3vw, 58px)",
        height: "clamp(34px, 3vw, 58px)",
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "clamp(14px, 1.25vw, 26px)",
        fontWeight: 900,
        flexShrink: 0,
    },
    avatar: {
        width: "clamp(34px, 3vw, 58px)",
        height: "clamp(34px, 3vw, 58px)",
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        background: "rgba(255,255,255,0.1)",
    },
    avatarFallback: {
        width: "clamp(34px, 3vw, 58px)",
        height: "clamp(34px, 3vw, 58px)",
        borderRadius: "50%",
        background: "rgba(45,150,83,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "clamp(14px, 1.2vw, 26px)",
        fontWeight: 900,
        flexShrink: 0,
    },
    name: {
        fontSize: "clamp(14px, 1.2vw, 26px)",
        fontWeight: 800,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    meta: { fontSize: "clamp(10px, 0.82vw, 16px)", opacity: 0.7, marginTop: 2 },
    points: { fontSize: "clamp(19px, 1.8vw, 38px)", fontWeight: 900, color: ACCENT, lineHeight: 1 },
    pointsLabel: { fontSize: "clamp(9px, 0.7vw, 14px)", opacity: 0.55, letterSpacing: 1 },
    chevron: {
        fontSize: "clamp(18px, 1.4vw, 28px)",
        opacity: 0.5,
        transition: "transform 0.15s ease",
        flexShrink: 0,
    },

    breakdown: {
        borderTop: "1px solid rgba(255,255,255,0.1)",
        padding: "clamp(8px, 1vh, 14px) clamp(12px, 1.2vw, 26px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "rgba(0,0,0,0.18)",
    },
    breakdownRow: { display: "flex", alignItems: "baseline", gap: 8 },
    breakdownLabel: { fontSize: "clamp(11px, 0.92vw, 18px)", fontWeight: 700, opacity: 0.9 },
    breakdownCount: { fontSize: "clamp(10px, 0.8vw, 16px)", opacity: 0.6 },
    breakdownDots: { flex: 1, borderBottom: "1px dotted rgba(255,255,255,0.2)", minWidth: 8 },
    breakdownPoints: { fontSize: "clamp(11px, 0.92vw, 18px)", fontWeight: 900, color: ACCENT },

    foot: {
        fontSize: "clamp(10px, 0.8vw, 15px)",
        opacity: 0.5,
        textAlign: "center",
        paddingTop: 6,
    },
};
