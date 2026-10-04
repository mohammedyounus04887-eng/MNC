/**
 * The club theme — dark.
 *
 * Near-black ground, warm cream text, one teal accent and a little brass.
 * Serif for headings and figures, plain sans for anything operational.
 *
 * This is the approved direction. It exists as one file so the next screen can
 * only look consistent — the old app grew three separate styling systems
 * because every feature was styled from scratch by whoever built it that day,
 * and that is the thing being fixed, not just the colours.
 *
 * Green-and-orange was deliberately dropped: it is what the club had been
 * looking at for three months, and the point of the rebuild is that it looks
 * different.
 */

export const T = {
    // grounds, darkest first
    bone: "#0d1211",   // the page
    card: "#151d1b",   // a raised surface
    sunk: "#1d2725",   // an inset within a card
    band: "#0a0f0e",   // header strip

    // text
    ink: "#ece6da",    // warm cream — the reading colour
    ink2: "#a2b0ab",
    ink3: "#6f7e79",
    rule: "#25302d",

    // the one strong colour
    teal: "#54b5a8",       // accents, borders, primary fills
    tealDeep: "#8fd4c9",   // bright — display figures on dark
    tealSoft: "#0f2825",   // teal-tinted panel
    onTeal: "#04160d",     // text that sits on a teal fill

    // used sparingly: numerals, tokens, moments that matter
    brass: "#c9a45c",
    brassSoft: "#241c0c",

    // meaning, not decoration
    good: "#54b5a8",
    warn: "#e0a94a",
    warnSoft: "#241c0c",
    bad: "#f0776b",
    badSoft: "#2b1512",

    serif: `ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`,
    sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif`,

    shadow: "0 1px 2px rgba(0,0,0,.5), 0 16px 40px -24px rgba(0,0,0,.9)",
    radius: 14,
} as const;

export const page: React.CSSProperties = {
    minHeight: "100vh",
    background: T.bone,
    color: T.ink,
    fontFamily: T.sans,
};

export const header: React.CSSProperties = {
    background: T.band,
    color: T.ink,
    borderBottom: `1px solid ${T.rule}`,
    padding: "16px 20px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
};

/** Headings carry the personality; everything operational stays sans. */
export const title = (size = 22): React.CSSProperties => ({
    fontFamily: T.serif,
    fontWeight: 400,
    fontSize: size,
    letterSpacing: "-0.01em",
    color: T.ink,
    margin: 0,
});

/** Small caps label — the quiet structural device of this theme. */
export const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: T.ink3,
};

export const card: React.CSSProperties = {
    background: T.card,
    border: `1px solid ${T.rule}`,
    borderRadius: T.radius,
    boxShadow: T.shadow,
};

export const primaryBtn: React.CSSProperties = {
    background: T.teal,
    color: T.onTeal,
    border: "none",
    borderRadius: 12,
    padding: "16px 20px",
    fontSize: 17,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: T.sans,
};

export const ghostBtn: React.CSSProperties = {
    background: "transparent",
    color: T.ink2,
    border: `1.5px solid ${T.rule}`,
    borderRadius: 11,
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: T.sans,
};
