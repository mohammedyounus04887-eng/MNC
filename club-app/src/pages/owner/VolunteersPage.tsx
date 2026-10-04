import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { VolunteerSession } from "@/types/firestore";
import AddVolunteerModal from "@/components/owner/AddVolunteerModal";
import VolunteerMonthGrid from "@/components/owner/VolunteerMonthGrid";
import { useVolunteerMembers } from "@/hooks/useVolunteerRoles";

const GREEN = "#2d9653";
const viewToggleBtn: React.CSSProperties = { padding: "8px 16px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" };
const viewToggleActive: React.CSSProperties = { background: GREEN, color: "white", border: `1.5px solid ${GREEN}` };

function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function monthDays(year: number, month0: number) {
    const first = new Date(year, month0, 1);
    const last = new Date(year, month0 + 1, 0);
    const out: Date[] = [];
    const startPad = first.getDay();
    for (let i = 0; i < startPad; i++) out.push(new Date(year, month0, -startPad + i + 1));
    for (let d = 1; d <= last.getDate(); d++) out.push(new Date(year, month0, d));
    while (out.length % 7 !== 0) out.push(new Date(year, month0 + 1, out.length - startPad - last.getDate() + 1));
    return out;
}

function monthLabel(year: number, month0: number): string {
    return new Date(year, month0, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function formatTime(ts: Timestamp | null | undefined): string {
    if (!ts) return "—";
    const d = (ts as any).toDate ? (ts as Timestamp).toDate() : new Date(ts as any);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function groupByMember(sessions: VolunteerSession[]) {
    const map: Record<string, { name: string; photo: string; sessions: VolunteerSession[] }> = {};
    for (const s of sessions) {
        if (!map[s.memberId]) {
            map[s.memberId] = { name: s.memberName, photo: (s as any).memberPhoto || "", sessions: [] };
        }
        map[s.memberId].sessions.push(s);
    }
    for (const k of Object.keys(map)) {
        map[k].sessions.sort((a, b) => ((a.loginTime as any)?.toMillis?.() || 0) - ((b.loginTime as any)?.toMillis?.() || 0));
    }
    return map;
}

export default function VolunteersPage() {
    const { club } = useClubContext();
    const [date, setDate] = useState<string>(ymd(new Date()));
    const [sessions, setSessions] = useState<VolunteerSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [drill, setDrill] = useState<{ memberId: string; name: string; photo: string } | null>(null);
    const [showAddVolunteer, setShowAddVolunteer] = useState(false);
    const [view, setView] = useState<"month" | "day">("month");
    const { members: registeredVolunteers } = useVolunteerMembers();
    const activeVolunteerIds = useMemo(
        () => new Set(sessions.filter((s) => s.status === "active").map((s) => s.memberId)),
        [sessions],
    );

    useEffect(() => {
        if (!club?.id) return;
        let alive = true;
        setLoading(true);
        getDocs(query(collection(db, `clubs/${club.id}/volunteerAttendance`), where("date", "==", date)))
            .then((snap) => {
                if (!alive) return;
                setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession));
            })
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [club?.id, date]);

    const byMember = useMemo(() => groupByMember(sessions), [sessions]);
    const members = useMemo(() => {
        return Object.entries(byMember)
            .map(([id, v]) => ({ id, ...v }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [byMember]);
    const totalMinutes = useMemo(() => sessions.reduce((s, x) => s + (x.totalMinutes || 0), 0), [sessions]);

    return (
        <div style={{ padding: "20px 24px 40px", fontFamily: "Nunito, sans-serif", background: "#f8fafc", minHeight: "100vh" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>🙌 Volunteers</h1>
                    <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                        Who volunteered on a given day — click a person for their full history.
                    </p>
                </div>
                <button
                    onClick={() => setShowAddVolunteer(true)}
                    style={{
                        padding: "10px 16px",
                        borderRadius: 12,
                        border: "none",
                        background: GREEN,
                        color: "white",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: "Nunito, sans-serif",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 4px 14px rgba(45,150,83,0.25)",
                    }}
                >
                    + Add Volunteer
                </button>
            </div>

            {/* Registered volunteers strip — shows green badge if checked in today */}
            {registeredVolunteers.length > 0 && (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "white", borderRadius: 14, border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                        Registered Volunteers ({registeredVolunteers.length}) · auto check-in enabled
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {registeredVolunteers.map((v) => {
                            const isCheckedIn = activeVolunteerIds.has(v.id);
                            return (
                                <div
                                    key={v.id}
                                    title={isCheckedIn ? "Checked in today" : "Not checked in"}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        padding: "5px 10px 5px 5px", borderRadius: 999,
                                        background: isCheckedIn ? "#dcfce7" : "#f3f4f6",
                                        border: `1.5px solid ${isCheckedIn ? "#22c55e" : "#e5e7eb"}`,
                                    }}
                                >
                                    {v.photo ? (
                                        <img src={v.photo} style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: GREEN, color: "white", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {v.name?.[0]?.toUpperCase() || "?"}
                                        </div>
                                    )}
                                    <span style={{ fontSize: 12, fontWeight: 700, color: isCheckedIn ? "#166534" : "#374151" }}>
                                        {v.name?.split(" ")[0]}
                                    </span>
                                    {isCheckedIn && (
                                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 2px #bbf7d0" }} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* View toggle — month grid (default) vs single day */}
            <div style={{ marginTop: 18, display: "flex", gap: 6 }}>
                <button onClick={() => setView("month")} style={{ ...viewToggleBtn, ...(view === "month" ? viewToggleActive : {}) }}>📅 Month grid</button>
                <button onClick={() => setView("day")} style={{ ...viewToggleBtn, ...(view === "day" ? viewToggleActive : {}) }}>📆 Single day</button>
            </div>

            {view === "month" && club?.id && (
                <VolunteerMonthGrid clubId={club.id} registeredVolunteers={registeredVolunteers as any} />
            )}

            {view === "day" && (<>
            <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", background: "white" }}
                />
                <button
                    onClick={() => setDate(ymd(new Date()))}
                    style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito,sans-serif" }}
                >
                    Today
                </button>
                <div style={{ fontSize: 13, color: "#6b7280", marginLeft: "auto" }}>
                    {parseYmd(date).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                </div>
            </div>

            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <StatCard label="Volunteers Today" value={String(members.length)} color={GREEN} />
                <StatCard label="Sessions" value={String(sessions.length)} color="#1a3a2a" />
                <StatCard label="Total Hours" value={`${(totalMinutes / 60).toFixed(1)}h`} color="#f59e0b" />
            </div>

            <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                    {members.length} member{members.length !== 1 ? "s" : ""}
                </div>
                {loading && <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</div>}
                {!loading && members.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af" }}>
                        <div style={{ fontSize: 40, marginBottom: 8 }}>🙌</div>
                        <p style={{ fontSize: 13 }}>No volunteer activity on this day.</p>
                    </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                    {members.map((m) => {
                        const isActive = m.sessions.some((s) => s.status === "active");
                        const first = m.sessions[0];
                        const last = m.sessions[m.sessions.length - 1];
                        return (
                            <button
                                key={m.id}
                                onClick={() => setDrill({ memberId: m.id, name: m.name, photo: m.photo })}
                                style={{
                                    background: isActive ? "#f0fdf4" : "white",
                                    border: `2px solid ${isActive ? "#22c55e" : "#e5e7eb"}`,
                                    borderRadius: 16, padding: "14px 10px", cursor: "pointer",
                                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                                    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                                    fontFamily: "Nunito, sans-serif", position: "relative",
                                }}
                            >
                                {isActive && <div style={{ position: "absolute", top: 8, right: 8, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 3px #bbf7d0" }} />}
                                {m.photo ? (
                                    <img src={m.photo} style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: `2.5px solid ${isActive ? "#22c55e" : "#e5e7eb"}` }} />
                                ) : (
                                    <div style={{ width: 54, height: 54, borderRadius: "50%", background: `linear-gradient(135deg, ${isActive ? "#22c55e" : "#6366f1"}, ${isActive ? "#16a34a" : "#4f46e5"})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "white", fontWeight: 900 }}>
                                        {(m.name || "?").charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a2a", textAlign: "center", lineHeight: 1.2 }}>
                                    {m.name}
                                </div>
                                <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>
                                    In: {formatTime(first?.loginTime)}
                                    <br />
                                    Out: {last?.logoutTime ? formatTime(last.logoutTime) : "—"}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
            </>)}

            {drill && club?.id && (
                <VolunteerDrilldown
                    clubId={club.id}
                    memberId={drill.memberId}
                    name={drill.name}
                    photo={drill.photo}
                    onClose={() => setDrill(null)}
                />
            )}

            <AddVolunteerModal
                open={showAddVolunteer}
                onClose={() => setShowAddVolunteer(false)}
            />
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ background: "white", borderRadius: 14, padding: "14px 18px", boxShadow: "0 2px 10px rgba(0,0,0,0.04)", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color, marginTop: 4 }}>{value}</div>
        </div>
    );
}

function VolunteerDrilldown({
    clubId, memberId, name, photo, onClose,
}: {
    clubId: string; memberId: string; name: string; photo: string; onClose: () => void;
}) {
    const today = new Date();
    const [viewYear, setViewYear] = useState(today.getFullYear());
    const [viewMonth, setViewMonth] = useState(today.getMonth());
    const [sessions, setSessions] = useState<VolunteerSession[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let alive = true;
        const first = ymd(new Date(viewYear, viewMonth, 1));
        const last = ymd(new Date(viewYear, viewMonth + 1, 0));
        setLoading(true);
        getDocs(query(
            collection(db, `clubs/${clubId}/volunteerAttendance`),
            where("memberId", "==", memberId),
            where("date", ">=", first),
            where("date", "<=", last),
        ))
            .then((snap) => {
                if (!alive) return;
                setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession));
            })
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [clubId, memberId, viewYear, viewMonth]);

    const byDay = useMemo(() => {
        const map: Record<string, VolunteerSession[]> = {};
        for (const s of sessions) {
            if (!map[s.date]) map[s.date] = [];
            map[s.date].push(s);
        }
        for (const k of Object.keys(map)) {
            map[k].sort((a, b) => ((a.loginTime as any)?.toMillis?.() || 0) - ((b.loginTime as any)?.toMillis?.() || 0));
        }
        return map;
    }, [sessions]);

    const cells = useMemo(() => monthDays(viewYear, viewMonth), [viewYear, viewMonth]);
    const prevMonth = () => { const d = new Date(viewYear, viewMonth - 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); };
    const nextMonth = () => { const d = new Date(viewYear, viewMonth + 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); };
    const daysThisMonth = Object.keys(byDay).length;
    const hoursThisMonth = sessions.reduce((s, x) => s + (x.totalMinutes || 0), 0) / 60;

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ padding: "20px 24px", background: `linear-gradient(135deg, #6366f1, #4f46e5)`, color: "white", borderRadius: "20px 20px 0 0", display: "flex", alignItems: "center", gap: 14 }}>
                    {photo ? (
                        <img src={photo} style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.8)" }} />
                    ) : (
                        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900 }}>
                            {(name || "?").charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 18, fontWeight: 900 }}>{name}</div>
                        <div style={{ fontSize: 12, opacity: 0.9 }}>Volunteer history</div>
                    </div>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 10, width: 36, height: 36, color: "white", cursor: "pointer", fontSize: 18 }}>✕</button>
                </div>

                <div style={{ padding: "16px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button onClick={prevMonth} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>← Prev</button>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#1a3a2a" }}>{monthLabel(viewYear, viewMonth)}</div>
                    <button onClick={nextMonth} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>Next →</button>
                </div>

                <div style={{ padding: "8px 24px 0", display: "flex", gap: 16, fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                    <span>{daysThisMonth} day{daysThisMonth !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{hoursThisMonth.toFixed(1)}h total</span>
                    {loading && <span style={{ marginLeft: "auto" }}>Loading…</span>}
                </div>

                <div style={{ padding: "14px 24px 24px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 10, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>
                        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                            <div key={i} style={{ textAlign: "center", padding: 4 }}>{d}</div>
                        ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                        {cells.map((d, i) => {
                            const inMonth = d.getMonth() === viewMonth;
                            const key = ymd(d);
                            const daySessions = byDay[key];
                            const isToday = ymd(today) === key;
                            const first = daySessions?.[0];
                            const last = daySessions?.[daySessions.length - 1];
                            return (
                                <div
                                    key={i}
                                    style={{
                                        minHeight: 72,
                                        borderRadius: 8,
                                        background: daySessions ? "#dcfce7" : inMonth ? "#f9fafb" : "transparent",
                                        border: isToday ? `2px solid ${GREEN}` : inMonth ? "1px solid #e5e7eb" : "1px dashed transparent",
                                        color: daySessions ? "#166534" : inMonth ? "#1a3a2a" : "#d1d5db",
                                        padding: "4px 2px",
                                        display: "flex", flexDirection: "column", alignItems: "center",
                                        fontSize: 9, fontWeight: 700,
                                    }}
                                >
                                    <div style={{ fontSize: 11, fontWeight: 900 }}>{d.getDate()}</div>
                                    {daySessions && (
                                        <div style={{ marginTop: 2, textAlign: "center", lineHeight: 1.2 }}>
                                            <div>{formatTime(first?.loginTime)}</div>
                                            <div style={{ opacity: 0.7 }}>↓</div>
                                            <div>{last?.logoutTime ? formatTime(last.logoutTime) : "active"}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
