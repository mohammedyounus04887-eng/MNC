/**
 * Admin — Loyalty Program.
 *
 * Five of the eleven rules count themselves: attendance, couples, guests,
 * renewals and BTC sessions are already recorded, so nobody types those in.
 * The other six describe things the app never sees — a Life Style Day, a home
 * visit, a PPV — and they are entered here.
 *
 * The page also sets **when the club started counting**. That one date decides
 * what All Time means on the leaderboard, and keeps the very first load cheap:
 * a club three weeks into the programme should not be reading a year of
 * attendance to draw it.
 *
 * The board itself is at /loyalty-program, behind the TV PIN.
 */

import { useMemo, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useMembers } from "@/hooks/owner/useMembers";
import { todayLocal } from "@/lib/clubDay";
import {
    AWARDABLE_RULES,
    LOYALTY_RULES,
    LOYALTY_TIERS,
    type LoyaltyRule,
} from "@/lib/loyaltyProgram";
import { awardLoyaltyPoints, removeLoyaltyAward, fetchLoyaltyAwards, type LoyaltyAward } from "@/lib/loyaltyAwards";
import { useLoyaltyStandings, useLoyaltyStartDate, monthStart } from "@/hooks/useLoyalty";

const FONT = "'Nunito', sans-serif";

export default function LoyaltyPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const qc = useQueryClient();

    const { data: members = [] } = useMembers(clubId);
    const { data: startDate } = useLoyaltyStartDate(clubId);
    const { data: standings, isLoading: standingsLoading } = useLoyaltyStandings(clubId, "all");

    // ── Award form ───────────────────────────────────────────────────────
    const [search, setSearch] = useState("");
    const [picked, setPicked] = useState<{ id: string; name: string; code: string } | null>(null);
    const [ruleId, setRuleId] = useState<string>(AWARDABLE_RULES[0].id);
    const [points, setPoints] = useState("");
    const [date, setDate] = useState(todayLocal());
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

    const rule: LoyaltyRule =
        AWARDABLE_RULES.find((r) => r.id === ruleId) ?? AWARDABLE_RULES[0];
    const needsPoints = rule.points == null;

    const matches = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return [];
        return members
            .filter(
                (m) =>
                    (m.name || "").toLowerCase().includes(q) ||
                    (m.memberId || "").toLowerCase().includes(q) ||
                    (m.phone || "").includes(q),
            )
            .slice(0, 8);
    }, [members, search]);

    // ── Recent awards ────────────────────────────────────────────────────
    const awardsFrom = startDate ?? monthStart();
    const { data: awards = [], refetch: refetchAwards } = useQuery<LoyaltyAward[]>({
        queryKey: ["loyaltyAwards", clubId, awardsFrom],
        queryFn: () => fetchLoyaltyAwards(clubId as string, awardsFrom, todayLocal()),
        enabled: !!clubId,
        staleTime: 60_000,
    });

    function refreshEverything() {
        refetchAwards();
        qc.invalidateQueries({ queryKey: ["loyaltyStandings"] });
    }

    async function submit() {
        if (!clubId || !picked) {
            setMsg({ kind: "bad", text: "Choose a member first." });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            await awardLoyaltyPoints({
                clubId,
                memberId: picked.id,
                memberName: picked.name,
                ruleId: rule.id,
                points: needsPoints ? Number(points) : undefined,
                note: note.trim(),
                date,
            });
            setMsg({ kind: "ok", text: `${rule.label} awarded to ${picked.name}.` });
            setPicked(null);
            setSearch("");
            setPoints("");
            setNote("");
            refreshEverything();
        } catch (e) {
            setMsg({ kind: "bad", text: e instanceof Error ? e.message : "Could not award the points." });
        } finally {
            setSaving(false);
        }
    }

    async function undo(award: LoyaltyAward) {
        if (!clubId) return;
        try {
            await removeLoyaltyAward(clubId, award.id);
            refreshEverything();
        } catch {
            setMsg({ kind: "bad", text: "Could not remove that award." });
        }
    }

    async function saveStartDate(value: string) {
        if (!clubId || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
        await setDoc(doc(db, "clubs", clubId), { loyaltyStartDate: value }, { merge: true });
        qc.invalidateQueries({ queryKey: ["loyaltyStartDate"] });
        qc.invalidateQueries({ queryKey: ["loyaltyStandings"] });
    }

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
            <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>🏆 Loyalty Program</div>
                        <div style={{ fontSize: 13, color: "#64748b" }}>
                            {club?.name} · the board members see is at <b>/loyalty-program</b> (TV PIN)
                        </div>
                    </div>
                    <a href="/loyalty-program" target="_blank" rel="noreferrer" style={linkBtn}>
                        Open the board ↗
                    </a>
                </div>

                {/* How points are earned */}
                <Card title="How the eleven rules are counted">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 }}>
                        {LOYALTY_RULES.map((r) => (
                            <div key={r.id} style={ruleTile}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                                    <span style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>{r.label}</span>
                                    <span style={{ fontWeight: 900, fontSize: 13, color: "#059669", whiteSpace: "nowrap" }}>
                                        {r.pointsLabel}
                                    </span>
                                </div>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 5 }}>
                                    <span style={r.source === "auto" ? pillAuto : pillManual}>
                                        {r.source === "auto" ? "Automatic" : "By hand"}
                                    </span>
                                    <span style={{ fontSize: 11, color: "#64748b" }}>{r.note}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={hint}>
                        <b>UMS Renewal</b> is counted on every plan payment recorded. Nothing stored on a
                        payment says whether it was taken before the plan expired, so a late renewal still
                        scores — take those ten points off with a <b>manual adjustment</b> below.
                    </div>
                </Card>

                {/* Award points */}
                <Card title="Award points by hand">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
                        {/* Member */}
                        <div>
                            <label style={label}>Member</label>
                            {picked ? (
                                <div style={pickedBox}>
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: 14 }}>{picked.name}</div>
                                        <div style={{ fontSize: 11, color: "#64748b" }}>{picked.code || "no member ID"}</div>
                                    </div>
                                    <button onClick={() => setPicked(null)} style={ghostBtn}>Change</button>
                                </div>
                            ) : (
                                <>
                                    <input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search name, member ID or phone…"
                                        style={input}
                                    />
                                    {matches.length > 0 && (
                                        <div style={resultBox}>
                                            {matches.map((m) => (
                                                <button
                                                    key={m.id}
                                                    onClick={() =>
                                                        setPicked({ id: m.id, name: m.name || "Unnamed", code: m.memberId || "" })
                                                    }
                                                    style={resultRow}
                                                >
                                                    <span style={{ fontWeight: 700 }}>{m.name || "Unnamed"}</span>
                                                    <span style={{ fontSize: 11, color: "#64748b" }}>{m.memberId || m.phone}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Rule */}
                        <div>
                            <label style={label}>What for</label>
                            <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} style={input}>
                                {AWARDABLE_RULES.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.label} — {r.pointsLabel}
                                    </option>
                                ))}
                            </select>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{rule.note}</div>
                        </div>

                        {/* Points (only where the rule has no fixed value) */}
                        {needsPoints && (
                            <div>
                                <label style={label}>Points</label>
                                <input
                                    value={points}
                                    onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ""))}
                                    placeholder={rule.id === "adjustment" ? "e.g. -10" : "e.g. 25"}
                                    inputMode="numeric"
                                    style={input}
                                />
                            </div>
                        )}

                        {/* Date */}
                        <div>
                            <label style={label}>Date it happened</label>
                            <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} style={input} />
                        </div>

                        {/* Note */}
                        <div style={{ gridColumn: "1 / -1" }}>
                            <label style={label}>Note {rule.id === "adjustment" ? "(say why)" : "(optional)"}</label>
                            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the club should be able to read back later" style={input} />
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                        <button onClick={submit} disabled={saving || !picked} style={{ ...primaryBtn, opacity: saving || !picked ? 0.5 : 1 }}>
                            {saving ? "Saving…" : "Award points"}
                        </button>
                        {msg && (
                            <span style={{ fontSize: 13, fontWeight: 700, color: msg.kind === "ok" ? "#059669" : "#dc2626" }}>
                                {msg.text}
                            </span>
                        )}
                    </div>
                </Card>

                {/* Awards ledger */}
                <Card title={`Awarded by hand since ${awardsFrom}`}>
                    {awards.length === 0 ? (
                        <div style={{ fontSize: 13, color: "#64748b" }}>Nothing awarded by hand yet.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflow: "auto" }}>
                            {awards.map((a) => (
                                <div key={a.id} style={awardRow}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, fontSize: 13 }}>{a.memberName}</div>
                                        <div style={{ fontSize: 11, color: "#64748b" }}>
                                            {a.ruleLabel} · {a.date}
                                            {a.note ? ` · ${a.note}` : ""}
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <span style={{ fontWeight: 900, color: a.points < 0 ? "#dc2626" : "#059669" }}>
                                            {a.points > 0 ? "+" : ""}
                                            {a.points}
                                        </span>
                                        <button onClick={() => undo(a)} style={ghostBtn}>Remove</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                {/* When counting started */}
                <Card title="When the club started counting">
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                            type="date"
                            value={startDate ?? monthStart()}
                            max={todayLocal()}
                            onChange={(e) => saveStartDate(e.target.value)}
                            style={{ ...input, maxWidth: 200 }}
                        />
                        <span style={{ fontSize: 12, color: "#64748b", flex: 1, minWidth: 220 }}>
                            This is the "All Time" range on the leaderboard. Set it to the day the
                            programme was announced — anything before that was not a loyalty point.
                        </span>
                    </div>
                </Card>

                {/* Standings preview */}
                <Card title="Standings (all time)">
                    {standingsLoading && <div style={{ fontSize: 13, color: "#64748b" }}>Counting…</div>}
                    {!standingsLoading && (standings?.standings.length ?? 0) === 0 && (
                        <div style={{ fontSize: 13, color: "#64748b" }}>
                            Nobody has points yet in this range.
                        </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(standings?.standings ?? []).slice(0, 20).map((s, i) => (
                            <div key={s.memberId} style={awardRow}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                                    <span style={{ width: 26, fontWeight: 900, color: "#94a3b8" }}>{i + 1}</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, fontSize: 13 }}>{s.name}</div>
                                        <div style={{ fontSize: 11, color: "#64748b" }}>
                                            {s.breakdown.map((b) => `${b.label} +${b.points}`).join(" · ")}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <div style={{ fontWeight: 900, color: "#059669" }}>{s.points}</div>
                                    {s.points >= LOYALTY_TIERS[0].points && (
                                        <div style={{ fontSize: 10, color: "#b45309", fontWeight: 800 }}>gift unlocked</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}

// ─── small pieces ────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 12 }}>{title}</div>
            {children}
        </div>
    );
}

const label: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 5,
};

const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    fontSize: 14,
    fontFamily: FONT,
    outline: "none",
    background: "white",
    minHeight: 44,
};

const primaryBtn: React.CSSProperties = {
    background: "#059669",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "11px 24px",
    fontSize: 14,
    fontWeight: 900,
    fontFamily: FONT,
    cursor: "pointer",
    minHeight: 44,
};

const ghostBtn: React.CSSProperties = {
    background: "white",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: FONT,
    cursor: "pointer",
    color: "#475569",
};

const linkBtn: React.CSSProperties = {
    ...ghostBtn,
    display: "inline-flex",
    alignItems: "center",
    textDecoration: "none",
    padding: "10px 16px",
    fontSize: 13,
};

const pillAuto: React.CSSProperties = {
    background: "#d1fae5",
    color: "#065f46",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
};

const pillManual: React.CSSProperties = {
    ...pillAuto,
    background: "#fef3c7",
    color: "#92400e",
};

const ruleTile: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#f8fafc",
};

const hint: React.CSSProperties = {
    marginTop: 12,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 12,
    color: "#92400e",
    lineHeight: 1.5,
};

const pickedBox: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    border: "1px solid #a7f3d0",
    background: "#ecfdf5",
    borderRadius: 10,
    padding: "8px 12px",
    minHeight: 44,
};

const resultBox: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    marginTop: 6,
    overflow: "hidden",
    background: "white",
};

const resultRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    border: "none",
    borderBottom: "1px solid #f1f5f9",
    background: "white",
    fontFamily: FONT,
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
};

const awardRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "8px 12px",
    background: "#f8fafc",
};
