import { useState } from "react";

interface Props {
    open: boolean;
    onClose: () => void;
}

// ─── MagicianHelpCard ──────────────────────────────────────────────────
// Full reference of voice commands the receptionist can use. Mounted
// from the ❓ icon next to the floating Magician button on the
// Reception home screen. Searchable + grouped by category.

interface Cmd {
    say: string;
    does: string;
}

interface Section {
    title: string;
    icon: string;
    intro?: string;
    cmds: Cmd[];
}

const SECTIONS: Section[] = [
    {
        title: "Welcome / Arrival",
        icon: "👋",
        intro: "All of these mark attendance + auto-order the member's day-of-week shake (or last week's most-ordered if no preference set).",
        cmds: [
            { say: "Welcome Vignesh", does: "Mark attendance + order his usual shake" },
            { say: "Hi Vignesh", does: "Same" },
            { say: "Hello Vignesh", does: "Same" },
            { say: "Hey Vignesh", does: "Same" },
            { say: "Namaste Vignesh", does: "Same" },
            { say: "Namaskar Vignesh", does: "Same" },
            { say: "Good morning Vignesh", does: "Same" },
            { say: "Good evening Vignesh", does: "Same" },
            { say: "Vignesh has arrived", does: "Same" },
            { say: "Vignesh just came", does: "Same" },
            { say: "Vignesh is here", does: "Same" },
        ],
    },
    {
        title: "Multiple people at once",
        icon: "👥",
        cmds: [
            { say: "Welcome Soumya and Krishna", does: "Mark both + order each one's usual" },
            { say: "Welcome Prasad, Devansh, Usha and Arun", does: "All four" },
            { say: "Soumya, Krishna, Usha have arrived", does: "Same as Welcome form" },
            { say: "Hi Prasad and Devansh", does: "Both get their preferences" },
        ],
    },
    {
        title: "By member ID",
        icon: "🔢",
        cmds: [
            { say: "Welcome 042", does: "Whoever is MNC-042" },
            { say: "Welcome 1 Prasad", does: "MNC-001 (name is just confirmation)" },
            { say: "Order shake for member 042", does: "Just that member" },
            { say: "Attendance for 042, 088, 103", does: "Three members by ID" },
            { say: "Attendance for members 011 to 020", does: "Range — all ten" },
        ],
    },
    {
        title: "Override the shake",
        icon: "🥤",
        intro: "If the member wants something different from their usual today.",
        cmds: [
            { say: "Welcome Vignesh but wants chocolate today", does: "Attendance + chocolate (overrides preference)" },
            { say: "Welcome Sujata with mango", does: "Same — mango override" },
            { say: "Give Vignesh a mango shake", does: "Same — instant order with mango" },
            { say: "Make Sujata a strawberry", does: "Same" },
            { say: "Send Prasad a special shake", does: "Same" },
            { say: "Vignesh wants mango today", does: "Same" },
            { say: "Sujata needs her usual shake", does: "Attendance + her usual (no override)" },
        ],
    },
    {
        title: "Teams",
        icon: "👫",
        intro: "Create teams in Reception → Settings → Teams. Then voice-trigger the whole group.",
        cmds: [
            { say: "Team A has arrived", does: "Mark + order for every member of Team A" },
            { say: "Welcome Team A", does: "Same" },
            { say: "Team A arrived without Shekhar", does: "Whole team except Shekhar" },
            { say: "Team A but Ashwini wants strawberry", does: "Team defaults + Ashwini overridden to strawberry" },
            { say: "Team A but Ashwini and Krishna want mango", does: "Multi-member override" },
        ],
    },
    {
        title: "Volunteer attendance",
        icon: "🙌",
        intro: "Members who volunteer today get a separate volunteer record alongside their regular attendance.",
        cmds: [
            { say: "Welcome Vignesh and mark volunteer attendance", does: "Attendance + shake + volunteer record" },
            { say: "Welcome Sujata as volunteer", does: "Same" },
            { say: "Team A arrived as volunteers", does: "Whole team marked as volunteers" },
            { say: "Bye Sujata", does: "Sign her out of her volunteer session" },
            { say: "Sign out Sujata", does: "Same" },
            { say: "Sujata is leaving", does: "Same" },
        ],
    },
    {
        title: "First Day (new visitors)",
        icon: "☀️",
        intro: "Brand-new walk-in: name + phone + optional referrer. Up to 2 complimentary shakes per phone.",
        cmds: [
            { say: "First day for David, number 9876543210", does: "New First Day record" },
            { say: "First day David 9876543210 invited by Prasad", does: "+ tag who referred them" },
            { say: "First day Anita 9123456789 invited by 042", does: "+ inviter by ID" },
        ],
    },
    {
        title: "Paid actions (need accountant verify)",
        icon: "💰",
        intro: "Magician parses the intent and shows a review card. Submit triggers accountant face-verify.",
        cmds: [
            { say: "Order one-day mango shake for Chandana", does: "₹240 paid one-day shake" },
            { say: "Two-day shake for 042 mango", does: "₹480 for 2 days, 1 banked" },
            { say: "Day shake for Prasad mango", does: "FREE redeem from his banked credits" },
            { say: "Top up Prasad 500", does: "Add ₹500 to wallet" },
            { say: "Top up 042 1000 UPI", does: "₹1000 UPI top-up" },
            { say: "Renew gold plan for Prasad cash", does: "Plan renewal" },
            { say: "Sell whey to Prasad cash", does: "Product sale (chained verify)" },
            { say: "Gift whey to Sujata", does: "Free product transfer" },
        ],
    },
    {
        title: "Ask Magician (queries)",
        icon: "❓",
        intro: "Magician speaks the answer back and shows a toast. No DB writes.",
        cmds: [
            { say: "Show today's report", does: "Opens the full report modal" },
            { say: "Print today's report", does: "Opens report ready to print" },
            { say: "How much cash today?", does: "Speaks ₹ total" },
            { say: "How much UPI today?", does: "Speaks ₹ total" },
            { say: "How many shakes today?", does: "Speaks count" },
            { say: "How many guests today?", does: "Speaks count" },
            { say: "How many people came today?", does: "Speaks count of checked-in members" },
            { say: "How many absent today?", does: "Speaks count of active - present" },
            { say: "Did Meenakshi come today?", does: "Yes/no + check-in time + orders" },
            { say: "Check if Prasad came today", does: "Same" },
            { say: "Show Prasad profile", does: "Navigates to his full profile" },
        ],
    },
    {
        title: "Tips",
        icon: "💡",
        cmds: [
            { say: "—", does: "Always pause between IDs (commas matter!): '042, 088, 103' not '042 088 103'" },
            { say: "—", does: "Say 'zero four two' not 'forty two' for clearer digit recognition" },
            { say: "—", does: "If a name is ambiguous, the review card shows candidates — tap to pick" },
            { say: "—", does: "Tap Cancel on any review card to abort with no changes" },
            { say: "—", does: "All paid actions still need accountant face-verify — voice is just the input" },
        ],
    },
];

export default function MagicianHelpCard({ open, onClose }: Props) {
    const [search, setSearch] = useState("");

    if (!open) return null;

    const q = search.toLowerCase().trim();
    const filteredSections = q
        ? SECTIONS.map((s) => ({
            ...s,
            cmds: s.cmds.filter((c) =>
                c.say.toLowerCase().includes(q) || c.does.toLowerCase().includes(q)
                || s.title.toLowerCase().includes(q)
            ),
          })).filter((s) => s.cmds.length > 0)
        : SECTIONS;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, zIndex: 9998,
                background: "rgba(15, 23, 42, 0.78)",
                backdropFilter: "blur(8px)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20,
                fontFamily: "Nunito, sans-serif",
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: "white", borderRadius: 20,
                    maxWidth: 720, width: "min(720px, 95vw)",
                    maxHeight: "90vh", overflow: "hidden",
                    display: "flex", flexDirection: "column",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
                }}
            >
                {/* Header */}
                <div style={{
                    padding: "18px 22px",
                    background: "linear-gradient(135deg, #7c3aed, #06b6d4)",
                    color: "white",
                    display: "flex", alignItems: "center", gap: 12,
                }}>
                    <span style={{ fontSize: 28 }}>🪄</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 18, fontWeight: 900 }}>Magician — Voice Command Guide</div>
                        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                            Everything the receptionist can say. Tap any line to copy.
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: "rgba(255,255,255,0.2)", border: "none",
                        color: "white", fontSize: 18, fontWeight: 700,
                        width: 32, height: 32, borderRadius: 16, cursor: "pointer",
                    }}>✕</button>
                </div>

                {/* Search */}
                <div style={{ padding: "12px 22px 0", background: "white" }}>
                    <input
                        type="text"
                        placeholder="🔎 Search commands (e.g. 'mango', 'topup', 'volunteer')"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{
                            width: "100%", padding: "10px 14px",
                            border: "1.5px solid #e5e7eb", borderRadius: 10,
                            fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
                            outline: "none",
                        }}
                    />
                </div>

                {/* Body */}
                <div style={{ overflowY: "auto", padding: "12px 22px 22px", flex: 1 }}>
                    {filteredSections.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
                            No commands match "{search}"
                        </div>
                    ) : filteredSections.map((s) => (
                        <div key={s.title} style={{ marginTop: 14 }}>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 8,
                                fontSize: 13, fontWeight: 900, color: "#1f2937",
                                marginBottom: 4,
                            }}>
                                <span style={{ fontSize: 16 }}>{s.icon}</span>
                                <span>{s.title}</span>
                            </div>
                            {s.intro && (
                                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, lineHeight: 1.5 }}>
                                    {s.intro}
                                </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {s.cmds.map((c, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            if (c.say === "—") return;
                                            try { navigator.clipboard.writeText(c.say); } catch {}
                                        }}
                                        title={c.say !== "—" ? "Click to copy" : ""}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: c.say === "—" ? "1fr" : "1fr 1fr",
                                            gap: 10, padding: "8px 12px",
                                            background: "#f9fafb",
                                            border: "1px solid #f1f5f9",
                                            borderRadius: 8,
                                            cursor: c.say === "—" ? "default" : "pointer",
                                            fontFamily: "inherit", textAlign: "left",
                                            transition: "background 120ms",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (c.say !== "—") (e.currentTarget as HTMLButtonElement).style.background = "#eef2ff";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (c.say !== "—") (e.currentTarget as HTMLButtonElement).style.background = "#f9fafb";
                                        }}
                                    >
                                        {c.say !== "—" && (
                                            <span style={{
                                                fontSize: 12, fontWeight: 700, color: "#5b21b6",
                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                            }}>
                                                "{c.say}"
                                            </span>
                                        )}
                                        <span style={{
                                            fontSize: 11, color: c.say === "—" ? "#475569" : "#6b7280",
                                            fontStyle: c.say === "—" ? "normal" : "italic",
                                            lineHeight: 1.4,
                                        }}>
                                            {c.say === "—" ? "💡 " + c.does : c.does}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
