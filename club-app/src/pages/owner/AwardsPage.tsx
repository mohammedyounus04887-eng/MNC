/**
 * Owner — Awards page (club-day recognition).
 *
 * Three tabs:
 *   1. 🎲 Lucky Dip      — early renewers (had ≥1 credit at renewal)
 *   2. 🏅 100% Attendance — perfect attendance, 1 / 3 / 6 / 12 month windows
 *   3. 💑 Couple Attendance — both partners present every day in the window
 *
 * Each tab supports a month picker (defaults to current month) and a
 * search bar that lets the owner see WHY a specific member doesn't qualify
 * (their calendar grid with missed days highlighted in red).
 *
 * Also accessible from Reception → Settings as the "🏆 Awards" tile.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import {
    useLuckyDip,
    computeMonthAttendance,
    computeConsecutiveMonths,
    computeCouples,
    workingDays,
    type AttendanceEntry,
    type CoupleEntry,
} from "@/hooks/useAwards";
import {
    useClubHolidays,
    addClubHoliday,
    removeClubHoliday,
    type ClubHoliday,
} from "@/hooks/useClubHolidays";

const FONT = "'Nunito', sans-serif";
const fmtRs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const ymd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Tab = "luckydip" | "attendance" | "couple";

export default function AwardsPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const now = new Date();
    const [year, setYear] = useState<number>(now.getFullYear());
    const [month, setMonth] = useState<number>(now.getMonth());
    const [tab, setTab] = useState<Tab>("luckydip");

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: 16 }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>🏆 Awards</div>
                        <div style={{ fontSize: 13, color: "#64748b" }}>Club day recognition · {club?.name}</div>
                    </div>
                    {/* Month picker */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", background: "white", padding: 6, border: "1px solid #e2e8f0", borderRadius: 10 }}>
                        <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))} style={{ padding: 6, border: "none", fontSize: 13, fontWeight: 700, fontFamily: FONT, background: "transparent", cursor: "pointer" }}>
                            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                        </select>
                        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} style={{ padding: 6, border: "none", fontSize: 13, fontWeight: 700, fontFamily: FONT, background: "transparent", cursor: "pointer" }}>
                            {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", marginBottom: 14, flexWrap: "wrap" }}>
                    {([
                        { id: "luckydip",   label: "🎲 Lucky Dip" },
                        { id: "attendance", label: "🏅 100% Attendance" },
                        { id: "couple",     label: "💑 Couple Attendance" },
                    ] as Array<{ id: Tab; label: string }>).map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                padding: "8px 16px", border: "none",
                                background: tab === t.id ? "#0f172a" : "transparent",
                                color: tab === t.id ? "white" : "#64748b",
                                borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
                            }}
                        >{t.label}</button>
                    ))}
                </div>

                {clubId && tab === "luckydip" && <LuckyDipTab clubId={clubId} year={year} month={month} />}
                {clubId && tab === "attendance" && <AttendanceTab clubId={clubId} year={year} month={month} />}
                {clubId && tab === "couple" && <CoupleTab clubId={clubId} year={year} month={month} />}
            </div>
        </div>
    );
}

// ═══ LUCKY DIP TAB ════════════════════════════════════════════════════════

function LuckyDipTab({ clubId, year, month }: { clubId: string; year: number; month: number }) {
    const { entries, allRenewals, loading } = useLuckyDip(clubId, year, month);
    const [search, setSearch] = useState("");
    const [pickedIdx, setPickedIdx] = useState<number | null>(null);
    const [rolling, setRolling] = useState(false);

    const filtered = search
        ? entries.filter(e => (e.memberName || "").toLowerCase().includes(search.toLowerCase()))
        : entries;

    // For the search-based "why not qualified" reveal
    const searchMatchedNonEligible = (search ? allRenewals.filter(r => !r.wasLuckyDipEligible && (r.memberName || "").toLowerCase().includes(search.toLowerCase())) : []);

    const pickWinner = () => {
        if (entries.length === 0 || rolling) return;
        setRolling(true);
        let ticks = 0;
        const interval = setInterval(() => {
            setPickedIdx(Math.floor(Math.random() * entries.length));
            ticks++;
            if (ticks > 20) {
                clearInterval(interval);
                setPickedIdx(Math.floor(Math.random() * entries.length));
                setRolling(false);
            }
        }, 80);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", color: "white", borderRadius: 12, padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.7 }}>Lucky Dip Pool</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 2 }}>{entries.length}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, marginTop: 2 }}>
                        Members who renewed a Lucky-Dip plan in {MONTHS[month]} {year} while holding ≥1 credit
                    </div>
                </div>
                <button onClick={pickWinner} disabled={entries.length === 0 || rolling} style={{ padding: "12px 22px", background: entries.length === 0 ? "rgba(255,255,255,0.15)" : "linear-gradient(135deg,#fbbf24,#f59e0b)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 900, cursor: entries.length === 0 ? "not-allowed" : "pointer", fontFamily: FONT, opacity: entries.length === 0 ? 0.5 : 1 }}>
                    {rolling ? "🎲 Rolling…" : "🎲 Pick a Winner"}
                </button>
            </div>

            <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search member to see if they qualify…" style={{ width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }} />

                {loading ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#64748b" }}>Loading…</div>
                ) : filtered.length === 0 && searchMatchedNonEligible.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                        {entries.length === 0 ? "Nobody has qualified yet this month." : "No matches for that name."}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {filtered.map((e, i) => (
                            <div key={e.memberId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: pickedIdx === i ? "linear-gradient(135deg,#fef3c7,#fbbf24)" : i % 2 === 0 ? "#f8fafc" : "white", borderRadius: 10, border: pickedIdx === i ? "2px solid #d97706" : "1px solid transparent", transition: "all 0.2s" }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", width: 26, textAlign: "center" }}>#{i + 1}</div>
                                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden" }}>
                                    {e.memberPhoto ? <img src={e.memberPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{e.memberName}</div>
                                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                                        Renewed {e.purchaseDate} · had {e.creditsBefore} credit{e.creditsBefore !== 1 ? "s" : ""} left · {e.planName}
                                    </div>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: "#16a34a" }}>{fmtRs(e.amountPaid)}</div>
                                {pickedIdx === i && <div style={{ fontSize: 20 }}>🎉</div>}
                            </div>
                        ))}

                        {/* When search matches a member who DIDN'T qualify, show why */}
                        {searchMatchedNonEligible.map((r: any) => (
                            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
                                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#fecaca", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✗</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "#991b1b" }}>{r.memberName}</div>
                                    <div style={{ fontSize: 10, color: "#7f1d1d", fontWeight: 600 }}>
                                        Renewed {r.date} but had {r.creditsBeforeRenewal ?? 0} credits left — needed ≥1
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══ 100% ATTENDANCE TAB ═══════════════════════════════════════════════════

function AttendanceTab({ clubId, year, month }: { clubId: string; year: number; month: number }) {
    const [period, setPeriod] = useState<1 | 3 | 6 | 12>(1);
    const [members, setMembers] = useState<any[]>([]);
    const [rows, setRows] = useState<AttendanceEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [holidayManagerOpen, setHolidayManagerOpen] = useState(false);
    const { holidaySet, holidays } = useClubHolidays(clubId);

    useEffect(() => {
        const u = onSnapshot(collection(db, `clubs/${clubId}/members`), snap => {
            setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => u();
    }, [clubId]);

    useEffect(() => {
        if (!members.length) { setRows([]); setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        (async () => {
            const out = period === 1
                ? await computeMonthAttendance(clubId, members, year, month, holidaySet)
                : await computeConsecutiveMonths(clubId, members, year, month, period, holidaySet);
            if (!cancelled) { setRows(out); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [clubId, members, year, month, period, holidaySet]);

    const qualified = rows.filter(r => r.qualifies);
    // Non-qualifiers must have at least one required day in the window
    // (otherwise they're new members who joined after the window — we treat
    // them as N/A, not "didn't qualify"). Sort by who came closest first.
    const nonQualified = rows
        .filter(r => !r.qualifies && r.requiredDays > 0)
        .sort((a, b) => b.presentDays - a.presentDays);

    // Apply search filter to both sections so the owner can hone in on a
    // single member regardless of which side they fall on.
    const matchesSearch = (r: AttendanceEntry) => !search || (r.memberName || "").toLowerCase().includes(search.toLowerCase());
    const qualifiedFiltered = qualified.filter(matchesSearch);
    const nonQualifiedFiltered = nonQualified.filter(matchesSearch);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", flexWrap: "wrap" }}>
                {([1, 3, 6, 12] as const).map(p => (
                    <button key={p} onClick={() => setPeriod(p)} style={{ padding: "8px 14px", border: "none", background: period === p ? "#16a34a" : "transparent", color: period === p ? "white" : "#64748b", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                        {p === 1 ? `${MONTHS[month]}` : `Last ${p} months`}
                    </button>
                ))}
            </div>

            <div style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white", borderRadius: 12, padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 }}>Qualifying Members</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 2 }}>{qualified.length}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>
                        100% attendance · {period === 1 ? `${MONTHS[month]} ${year}` : `${period} consecutive months ending ${MONTHS[month]} ${year}`} · Sundays + {holidays.length} concession{holidays.length === 1 ? "" : "s"} excluded
                    </div>
                </div>
                <button
                    onClick={() => setHolidayManagerOpen(true)}
                    style={{ padding: "10px 16px", background: "rgba(255,255,255,0.18)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                >🎉 Manage Concessions ({holidays.length})</button>
            </div>

            <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name across qualified + did-not-qualify…" style={{ width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }} />

                {loading ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#64748b" }}>Loading…</div>
                ) : qualifiedFiltered.length === 0 && nonQualifiedFiltered.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                        {rows.length === 0 ? "Nobody to compute attendance for yet." : "No matches for that search."}
                    </div>
                ) : (
                    <>
                        {/* ── Qualified section ───────────────────────────── */}
                        {qualifiedFiltered.length > 0 && (
                            <>
                                <SectionLabel
                                    color="#15803d"
                                    bg="#dcfce7"
                                    icon="✓"
                                    title={`Qualified · ${qualifiedFiltered.length}`}
                                    subtitle="Present every working day in the window"
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {qualifiedFiltered.map(r => (
                                        <AttendanceRow
                                            key={r.memberId}
                                            entry={r}
                                            year={year}
                                            month={month}
                                            period={period}
                                            holidaySet={holidaySet}
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        {/* ── Missed-day buckets (missed 1 day, 2 days, 3 …) ── */}
                        {nonQualifiedFiltered.length > 0 && (() => {
                            // Group non-qualifiers by exactly how many working
                            // days they missed, then render one section per
                            // count, ascending — "missed 1 day" sits closest to
                            // the 100% list, then 2, 3, 4, 5, and so on. The
                            // exact absent dates are shown inline on each row.
                            const byCount = new Map<number, AttendanceEntry[]>();
                            for (const r of nonQualifiedFiltered) {
                                const c = r.missedDates.length;
                                const arr = byCount.get(c);
                                if (arr) arr.push(r); else byCount.set(c, [r]);
                            }
                            const counts = [...byCount.keys()].sort((a, b) => a - b);
                            return counts.map(c => {
                                const bucket = byCount.get(c)!;
                                return (
                                    <div key={c}>
                                        <SectionLabel
                                            color="#b45309"
                                            bg="#fef3c7"
                                            icon="⚠"
                                            title={`Missed ${c} day${c === 1 ? "" : "s"} · ${bucket.length}`}
                                            subtitle={c === 1
                                                ? "One absence — the exact date is shown below"
                                                : "Exact absent dates shown below"}
                                            topMargin
                                        />
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            {bucket.map(r => (
                                                <AttendanceRow
                                                    key={r.memberId}
                                                    entry={r}
                                                    year={year}
                                                    month={month}
                                                    period={period}
                                                    holidaySet={holidaySet}
                                                    showMissedInline
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </>
                )}
            </div>

            {holidayManagerOpen && (
                <HolidayManagerDialog
                    clubId={clubId}
                    holidays={holidays}
                    year={year}
                    month={month}
                    onClose={() => setHolidayManagerOpen(false)}
                />
            )}
        </div>
    );
}

/** Small section header used to separate Qualified / Did Not Qualify lists. */
function SectionLabel({ color, bg, icon, title, subtitle, topMargin }: {
    color: string; bg: string; icon: string; title: string; subtitle?: string; topMargin?: boolean;
}) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px", background: bg, borderRadius: 8,
            marginTop: topMargin ? 16 : 0, marginBottom: 8,
        }}>
            <div style={{ fontSize: 14, color }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color, letterSpacing: 0.3 }}>{title}</div>
                {subtitle && <div style={{ fontSize: 10, fontWeight: 600, color, opacity: 0.85 }}>{subtitle}</div>}
            </div>
        </div>
    );
}

function AttendanceRow({ entry: r, year, month, period, holidaySet, showMissedInline }: {
    entry: AttendanceEntry;
    year: number; month: number;
    period: 1 | 3 | 6 | 12;
    holidaySet?: Set<string>;
    /**
     * When true, the row renders the missed-dates list inline (without the
     * owner having to expand the calendar). Used in the "Did Not Qualify"
     * section so the answer to "why?" is visible at a glance.
     */
    showMissedInline?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div style={{ background: r.qualifies ? "#f0fdf4" : "#fffbeb", borderRadius: 10, padding: "10px 12px", border: r.qualifies ? "1px solid #86efac" : "1px solid #fde68a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden" }}>
                    {r.memberPhoto ? <img src={r.memberPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                        {r.memberName}
                        {r.qualifies
                            ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "white", background: "#16a34a", padding: "2px 6px", borderRadius: 100 }}>✓ 100%</span>
                            : <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#92400e", background: "#fde68a", padding: "2px 6px", borderRadius: 100 }}>{r.missedDates.length} missed</span>
                        }
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                        {r.presentDays} / {r.requiredDays} days
                    </div>
                </div>
                <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 700 }}>{expanded ? "▴" : "▾"} {expanded ? "Hide" : "Calendar"}</div>
            </div>

            {/* Inline missed-day breakdown for non-qualifiers — surfaces the
                "why" without the owner having to click into the calendar. */}
            {showMissedInline && r.missedDates.length > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: "#fef3c7", borderRadius: 8, fontSize: 11, color: "#7c2d12", lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>Missed working days:</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {r.missedDates.map(d => (
                            <span key={d} style={{ background: "white", border: "1px solid #fcd34d", padding: "2px 8px", borderRadius: 100, fontWeight: 700 }}>
                                {formatShortDate(d)}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {expanded && period === 1 && (
                <MonthCalendar
                    year={year} month={month}
                    missedDates={new Set(r.missedDates)}
                    holidaySet={holidaySet}
                />
            )}
            {expanded && period > 1 && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                    Multi-month view — missed dates: {r.missedDates.length > 0 ? r.missedDates.slice(0, 10).join(", ") + (r.missedDates.length > 10 ? "…" : "") : "none"}
                </div>
            )}
        </div>
    );
}

function formatShortDate(ymdStr: string): string {
    try {
        const [y, m, d] = ymdStr.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    } catch { return ymdStr; }
}

function MonthCalendar({ year, month, missedDates, holidaySet }: { year: number; month: number; missedDates: Set<string>; holidaySet?: Set<string> }) {
    const days = workingDays(year, month);
    const allDays = useMemo(() => {
        const out: Date[] = [];
        const d = new Date(year, month, 1);
        while (d.getMonth() === month) { out.push(new Date(d)); d.setDate(d.getDate() + 1); }
        return out;
    }, [year, month]);
    // pad start so the first day lands in the right weekday column
    const firstWeekday = allDays[0]?.getDay() ?? 0;
    const padding = Array.from({ length: firstWeekday }, () => null);
    const cells = [...padding, ...allDays];
    void days;

    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textAlign: "center", textTransform: "uppercase" }}>{d}</div>
                ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {cells.map((d: Date | null, i: number) => {
                    if (!d) return <div key={i} />;
                    const dStr = ymd(d);
                    const isSunday = d.getDay() === 0;
                    const isHoliday = !!holidaySet?.has(dStr);
                    const isMissed = missedDates.has(dStr);
                    // Holiday wins over missed (concessions excuse absence).
                    let bg = "#dcfce7", color = "#16a34a";
                    if (isSunday) { bg = "#f1f5f9"; color = "#94a3b8"; }
                    else if (isHoliday) { bg = "#fef3c7"; color = "#b45309"; }
                    else if (isMissed) { bg = "#fee2e2"; color = "#dc2626"; }
                    return (
                        <div key={i} title={dStr + (isHoliday ? " · holiday" : "")} style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", background: bg, color, borderRadius: 6, fontSize: 11, fontWeight: 800 }}>
                            {d.getDate()}
                        </div>
                    );
                })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 10, fontWeight: 700, color: "#64748b", flexWrap: "wrap" }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#dcfce7", borderRadius: 3, marginRight: 4, verticalAlign: "middle" }} />Present</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#fee2e2", borderRadius: 3, marginRight: 4, verticalAlign: "middle" }} />Missed</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#fef3c7", borderRadius: 3, marginRight: 4, verticalAlign: "middle" }} />Concession</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#f1f5f9", borderRadius: 3, marginRight: 4, verticalAlign: "middle" }} />Sunday (closed)</span>
            </div>
        </div>
    );
}

// ═══ COUPLE ATTENDANCE TAB ════════════════════════════════════════════════

function CoupleTab({ clubId, year, month }: { clubId: string; year: number; month: number }) {
    const [period, setPeriod] = useState<1 | 3 | 6 | 12>(1);
    const [members, setMembers] = useState<any[]>([]);
    const [monthly, setMonthly] = useState<AttendanceEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [holidayManagerOpen, setHolidayManagerOpen] = useState(false);
    const { holidaySet, holidays } = useClubHolidays(clubId);

    useEffect(() => {
        const u = onSnapshot(collection(db, `clubs/${clubId}/members`), snap => {
            setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => u();
    }, [clubId]);

    useEffect(() => {
        if (!members.length) { setMonthly([]); setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        (async () => {
            const out = period === 1
                ? await computeMonthAttendance(clubId, members.filter(m => m.couplePartnerId), year, month, holidaySet)
                : await computeConsecutiveMonths(clubId, members.filter(m => m.couplePartnerId), year, month, period, holidaySet);
            if (!cancelled) { setMonthly(out); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [clubId, members, year, month, period, holidaySet]);

    const couples = useMemo(() => computeCouples(members, monthly), [members, monthly]);
    const qualified = couples.filter(c => c.qualifies);
    // Non-qualifiers: couples where at least one partner missed working days.
    const nonQualified = couples
        .filter(c => !c.qualifies && (c.monthlyA.requiredDays > 0 || c.monthlyB.requiredDays > 0))
        .sort((a, b) =>
            (b.monthlyA.presentDays + b.monthlyB.presentDays) -
            (a.monthlyA.presentDays + a.monthlyB.presentDays)
        );

    const matchesSearch = (c: CoupleEntry) => !search
        || (c.memberA.name || "").toLowerCase().includes(search.toLowerCase())
        || (c.memberB.name || "").toLowerCase().includes(search.toLowerCase());
    const qualifiedFiltered = qualified.filter(matchesSearch);
    const nonQualifiedFiltered = nonQualified.filter(matchesSearch);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 4, background: "white", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0", width: "fit-content", flexWrap: "wrap" }}>
                {([1, 3, 6, 12] as const).map(p => (
                    <button key={p} onClick={() => setPeriod(p)} style={{ padding: "8px 14px", border: "none", background: period === p ? "#be185d" : "transparent", color: period === p ? "white" : "#64748b", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                        {p === 1 ? `${MONTHS[month]}` : `Last ${p} months`}
                    </button>
                ))}
            </div>

            <div style={{ background: "linear-gradient(135deg,#be185d,#9d174d)", color: "white", borderRadius: 12, padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 }}>Qualifying Couples</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 2 }}>{qualified.length}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>
                        Both partners present every day · {period === 1 ? `${MONTHS[month]} ${year}` : `${period} consecutive months ending ${MONTHS[month]} ${year}`} · Sundays + {holidays.length} concession{holidays.length === 1 ? "" : "s"} excluded
                    </div>
                </div>
                <button
                    onClick={() => setHolidayManagerOpen(true)}
                    style={{ padding: "10px 16px", background: "rgba(255,255,255,0.18)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                >🎉 Manage Concessions ({holidays.length})</button>
            </div>

            <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name across qualified + did-not-qualify…" style={{ width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }} />
                {loading ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#64748b" }}>Loading…</div>
                ) : couples.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                        No couples linked yet. Use Admin → Members → "Link as Couple" to create couple bonds.
                    </div>
                ) : qualifiedFiltered.length === 0 && nonQualifiedFiltered.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>
                        No matches for that search.
                    </div>
                ) : (
                    <>
                        {qualifiedFiltered.length > 0 && (
                            <>
                                <SectionLabel
                                    color="#9d174d" bg="#fce7f3" icon="✓"
                                    title={`Qualified · ${qualifiedFiltered.length}`}
                                    subtitle="Both partners present every working day"
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {qualifiedFiltered.map(c => (
                                        <CoupleRow key={c.coupleId} couple={c} year={year} month={month} period={period} holidaySet={holidaySet} />
                                    ))}
                                </div>
                            </>
                        )}
                        {nonQualifiedFiltered.length > 0 && (
                            <>
                                <SectionLabel
                                    color="#b45309" bg="#fef3c7" icon="⚠"
                                    title={`Did Not Qualify · ${nonQualifiedFiltered.length}`}
                                    subtitle="At least one partner missed working days — listed below"
                                    topMargin
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {nonQualifiedFiltered.map(c => (
                                        <CoupleRow
                                            key={c.coupleId} couple={c}
                                            year={year} month={month} period={period}
                                            holidaySet={holidaySet}
                                            showMissedInline
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>

            {holidayManagerOpen && (
                <HolidayManagerDialog
                    clubId={clubId}
                    holidays={holidays}
                    year={year}
                    month={month}
                    onClose={() => setHolidayManagerOpen(false)}
                />
            )}
        </div>
    );
}

function CoupleRow({ couple: c, year, month, period, holidaySet, showMissedInline }: {
    couple: CoupleEntry;
    year: number; month: number;
    period: 1 | 3 | 6 | 12;
    holidaySet?: Set<string>;
    showMissedInline?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const aMissed = c.monthlyA.missedDates;
    const bMissed = c.monthlyB.missedDates;

    return (
        <div style={{ background: c.qualifies ? "#fdf2f8" : "#fffbeb", borderRadius: 10, padding: 12, border: c.qualifies ? "1px solid #f9a8d4" : "1px solid #fde68a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
                <div style={{ display: "flex" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden", border: "2px solid white" }}>
                        {c.memberA.photo ? <img src={c.memberA.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                    </div>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden", marginLeft: -8, border: "2px solid white" }}>
                        {c.memberB.photo ? <img src={c.memberB.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                        💑 {c.memberA.name} & {c.memberB.name}
                        {c.qualifies
                            ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "white", background: "#be185d", padding: "2px 6px", borderRadius: 100 }}>✓ 100%</span>
                            : <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#92400e", background: "#fde68a", padding: "2px 6px", borderRadius: 100 }}>{aMissed.length + bMissed.length} missed</span>
                        }
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                        {c.memberA.name.split(" ")[0]}: {c.monthlyA.presentDays}/{c.monthlyA.requiredDays} ·
                        {" "}{c.memberB.name.split(" ")[0]}: {c.monthlyB.presentDays}/{c.monthlyB.requiredDays}
                    </div>
                </div>
                <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 700 }}>{expanded ? "▴" : "▾"}</div>
            </div>

            {showMissedInline && (aMissed.length > 0 || bMissed.length > 0) && (
                <div style={{ marginTop: 8, padding: 8, background: "#fef3c7", borderRadius: 8, fontSize: 11, color: "#7c2d12", lineHeight: 1.5 }}>
                    {aMissed.length > 0 && (
                        <div style={{ marginBottom: bMissed.length > 0 ? 6 : 0 }}>
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>{c.memberA.name} missed:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {aMissed.map(d => <span key={d} style={{ background: "white", border: "1px solid #fcd34d", padding: "2px 8px", borderRadius: 100, fontWeight: 700 }}>{formatShortDate(d)}</span>)}
                            </div>
                        </div>
                    )}
                    {bMissed.length > 0 && (
                        <div>
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>{c.memberB.name} missed:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {bMissed.map(d => <span key={d} style={{ background: "white", border: "1px solid #fcd34d", padding: "2px 8px", borderRadius: 100, fontWeight: 700 }}>{formatShortDate(d)}</span>)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {expanded && period === 1 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 6 }}>{c.memberA.name}</div>
                        <MonthCalendar year={year} month={month} missedDates={new Set(c.monthlyA.missedDates)} holidaySet={holidaySet} />
                    </div>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 6 }}>{c.memberB.name}</div>
                        <MonthCalendar year={year} month={month} missedDates={new Set(c.monthlyB.missedDates)} holidaySet={holidaySet} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══ HOLIDAY MANAGER DIALOG ════════════════════════════════════════════════
// Lets the owner add and remove "concession days" — dates that are excluded
// from the required-working-days count on the Awards page. Holidays are
// stored at /clubs/{clubId}/holidays/{YYYY-MM-DD}.
function HolidayManagerDialog({ clubId, holidays, year, month, onClose }: {
    clubId: string; holidays: ClubHoliday[]; year: number; month: number; onClose: () => void;
}) {
    const [date, setDate] = useState<string>("");
    const [reason, setReason] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string>("");

    // Default the input to the currently-viewed month for one-click adds
    useEffect(() => {
        const today = new Date();
        if (today.getFullYear() === year && today.getMonth() === month) {
            setDate(ymd(today));
        } else {
            // First of the displayed month
            setDate(`${year}-${String(month + 1).padStart(2, "0")}-01`);
        }
    }, [year, month]);

    const add = async () => {
        setErr("");
        if (!date) { setErr("Pick a date."); return; }
        setBusy(true);
        try {
            await addClubHoliday(clubId, date, reason);
            setReason("");
        } catch (e: any) {
            setErr(e?.message || "Could not add holiday.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (d: string) => {
        try { await removeClubHoliday(clubId, d); }
        catch (e: any) { setErr(e?.message || "Could not remove holiday."); }
    };

    // Group holidays by year for display
    const upcomingAndPast = useMemo(() => {
        const today = ymd(new Date());
        const upcoming = holidays.filter(h => h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        const past = holidays.filter(h => h.date < today).sort((a, b) => b.date.localeCompare(a.date));
        return { upcoming, past };
    }, [holidays]);

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16, fontFamily: FONT }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 20, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>🎉 Concession Days</div>
                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                            Dates excluded from the required-days count for 100% attendance. Sundays are already excluded automatically.
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 10px", fontWeight: 800, color: "#475569", cursor: "pointer" }}>✕</button>
                </div>

                {/* Add a new holiday */}
                <div style={{ background: "#fef3c7", borderRadius: 12, padding: 12, marginTop: 12, border: "1px solid #fcd34d" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>+ Add a concession day</div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "stretch" }}>
                        <input
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            style={{ padding: 9, border: "1.5px solid #fcd34d", borderRadius: 8, fontSize: 13, fontFamily: FONT, background: "white" }}
                        />
                        <input
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Reason (optional) — e.g. Diwali, Independence Day"
                            style={{ padding: 9, border: "1.5px solid #fcd34d", borderRadius: 8, fontSize: 13, fontFamily: FONT, background: "white" }}
                        />
                        <button
                            onClick={add}
                            disabled={busy || !date}
                            style={{ padding: "9px 16px", background: busy ? "#fcd34d" : "linear-gradient(135deg,#d97706,#b45309)", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: busy ? "wait" : "pointer", fontFamily: FONT }}
                        >{busy ? "Saving…" : "Add"}</button>
                    </div>
                    {err && <div style={{ marginTop: 6, fontSize: 11, color: "#b91c1c", fontWeight: 700 }}>{err}</div>}
                </div>

                {/* Existing holidays */}
                <div style={{ marginTop: 14 }}>
                    {holidays.length === 0 ? (
                        <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12, fontWeight: 700, background: "#f8fafc", borderRadius: 10 }}>
                            No concession days yet. Add holidays the club takes off (Diwali, Independence Day, etc.)
                        </div>
                    ) : (
                        <>
                            {upcomingAndPast.upcoming.length > 0 && (
                                <>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Upcoming + this month</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        {upcomingAndPast.upcoming.map(h => (
                                            <HolidayRow key={h.id} holiday={h} onRemove={() => remove(h.date)} />
                                        ))}
                                    </div>
                                </>
                            )}
                            {upcomingAndPast.past.length > 0 && (
                                <>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.3, marginTop: 14, marginBottom: 6 }}>Past</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        {upcomingAndPast.past.map(h => (
                                            <HolidayRow key={h.id} holiday={h} onRemove={() => remove(h.date)} />
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function HolidayRow({ holiday, onRemove }: { holiday: ClubHoliday; onRemove: () => void }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f8fafc", borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", minWidth: 110 }}>{formatShortDate(holiday.date)}</div>
            <div style={{ flex: 1, fontSize: 12, color: holiday.reason ? "#0f172a" : "#94a3b8", fontWeight: holiday.reason ? 700 : 600, fontStyle: holiday.reason ? "normal" : "italic" }}>
                {holiday.reason || "no reason given"}
            </div>
            <button
                onClick={onRemove}
                style={{ background: "white", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
            >Remove</button>
        </div>
    );
}
