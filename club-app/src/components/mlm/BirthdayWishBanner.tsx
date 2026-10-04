import { Gift, Heart } from "lucide-react";
import { useTodaysCelebrations } from "@/hooks/useMemberFeatures";
import type { User } from "@/types/firestore";

type Props = {
    clubId?: string;
    theme?: "light" | "dark";
    className?: string;
};

function Avatar({ user, ringColor }: { user: User; ringColor: string }) {
    const photo = (user as any).photoUrl || user.photo || (user as any).photoURL;
    return (
        <div
            className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{ background: "white", border: `2px solid ${ringColor}`, color: ringColor }}
            title={user.name}
        >
            {photo ? (
                <img src={photo} alt={user.name} className="w-full h-full object-cover" />
            ) : (
                <span>{user.name?.[0]?.toUpperCase() || "?"}</span>
            )}
        </div>
    );
}

export default function BirthdayWishBanner({ clubId, theme = "light", className = "" }: Props) {
    const { data } = useTodaysCelebrations(clubId);
    if (!data) return null;
    const { birthdays, anniversaries } = data;
    if (birthdays.length === 0 && anniversaries.length === 0) return null;

    const isDark = theme === "dark";
    const containerBg = isDark
        ? "linear-gradient(135deg, rgba(236,72,153,0.18), rgba(139,92,246,0.18))"
        : "linear-gradient(135deg, #fdf2f8, #faf5ff)";
    const containerBorder = isDark ? "1px solid rgba(255,255,255,0.15)" : "1px solid #fbcfe8";
    const titleColor = isDark ? "#ffffff" : "#9f1239";
    const subColor = isDark ? "rgba(255,255,255,0.7)" : "#9d174d";
    const chipBg = isDark ? "rgba(255,255,255,0.10)" : "white";
    const chipText = isDark ? "white" : "#831843";
    const chipBorder = isDark ? "rgba(255,255,255,0.18)" : "#fbcfe8";

    const wishFor = (list: User[], kind: "birthday" | "anniversary") => {
        const names = list.map(u => u.name?.split(" ")[0] || "friend");
        if (kind === "birthday") {
            if (names.length === 1) return `Wishing ${names[0]} a very Happy Birthday!`;
            if (names.length === 2) return `Wishing ${names[0]} & ${names[1]} a very Happy Birthday!`;
            return `Wishing ${names.slice(0, -1).join(", ")} & ${names.slice(-1)} a very Happy Birthday!`;
        }
        if (names.length === 1) return `Happy Anniversary, ${names[0]}!`;
        return `Happy Anniversary to ${names.join(", ")}!`;
    };

    return (
        <div
            className={className}
            style={{
                background: containerBg,
                border: containerBorder,
                borderRadius: 18,
                padding: "14px 16px",
                fontFamily: "Nunito, sans-serif",
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }}
        >
            {birthdays.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 22 }}>🎂</span>
                        <Gift className="w-4 h-4" style={{ color: isDark ? "#fca5a5" : "#db2777" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: titleColor, lineHeight: 1.2 }}>
                            {wishFor(birthdays, "birthday")}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: subColor, marginTop: 2 }}>
                            {birthdays.length} member{birthdays.length !== 1 ? "s" : ""} celebrating today
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {birthdays.slice(0, 6).map(u => (
                            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 999, padding: "3px 10px 3px 3px" }}>
                                <Avatar user={u} ringColor="#db2777" />
                                <span style={{ fontSize: 12, fontWeight: 700, color: chipText }}>{u.name?.split(" ")[0]}</span>
                            </div>
                        ))}
                        {birthdays.length > 6 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: subColor }}>+{birthdays.length - 6}</span>
                        )}
                    </div>
                </div>
            )}

            {anniversaries.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 22 }}>💞</span>
                        <Heart className="w-4 h-4" style={{ color: isDark ? "#c4b5fd" : "#7c3aed" }} fill="currentColor" />
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: titleColor, lineHeight: 1.2 }}>
                            {wishFor(anniversaries, "anniversary")}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: subColor, marginTop: 2 }}>
                            {anniversaries.length} member{anniversaries.length !== 1 ? "s" : ""} celebrating today
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {anniversaries.slice(0, 6).map(u => (
                            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 999, padding: "3px 10px 3px 3px" }}>
                                <Avatar user={u} ringColor="#7c3aed" />
                                <span style={{ fontSize: 12, fontWeight: 700, color: chipText }}>{u.name?.split(" ")[0]}</span>
                            </div>
                        ))}
                        {anniversaries.length > 6 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: subColor }}>+{anniversaries.length - 6}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
