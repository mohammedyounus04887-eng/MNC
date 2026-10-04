/**
 * Volunteer month grid — dates × volunteers in one view.
 *
 * One row per volunteer (registered volunteers included even at 0% so
 * absentees are visible), one column per day of the selected month. Each
 * cell shows the first login time for that day; the final columns show
 * days present, attendance %, and total hours. "Download PDF" emits a
 * per-volunteer summary (names, attendance, %, avg login, hours).
 *
 * Reads clubs/{clubId}/volunteerAttendance for the month in ONE range query
 * (single-field date range — no composite index needed), matching the source
 * the rest of the Volunteers page already uses.
 *
 * Attendance % denominator = working days (non-Sunday) in the month up to
 * today. (The club has no per-volunteer schedule, so this is the fairest
 * club-wide denominator; Sundays are treated as closed, matching Awards.)
 */

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "@/lib/firebase";
import type { VolunteerSession } from "@/types/firestore";

const GREEN = "#2d9653";

function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysInMonthCount(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
}
function workingDaysUpTo(year: number, month0: number, today: Date): number {
    const last = daysInMonthCount(year, month0);
    let count = 0;
    for (let d = 1; d <= last; d++) {
        const dt = new Date(year, month0, d);
        if (dt.getDay() === 0) continue;              // Sunday — club closed
        if (dt.getTime() > today.getTime()) continue; // future day in current month
        count++;
    }
    return count;
}
function toDate(ts: Timestamp | null | undefined): Date | null {
    if (!ts) return null;
    return (ts as any).toDate ? (ts as Timestamp).toDate() : new Date(ts as any);
}
function fmtClock(mins: number): string {
    const h = Math.floor(mins / 60), m = mins % 60;
    const ap = h < 12 ? "AM" : "PM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function fmtShort(ts: Timestamp | null | undefined): string {
    const d = toDate(ts);
    if (!d) return "";
    const h12 = d.getHours() % 12 || 12;
    return `${h12}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function minutesOfDay(ts: Timestamp | null | undefined): number | null {
    const d = toDate(ts);
    return d ? d.getHours() * 60 + d.getMinutes() : null;
}

interface VolRow {
    id: string;
    name: string;
    photo: string;
    byDate: Map<string, VolunteerSession[]>;
}

interface VolStat {
    present: number;
    pct: number;
    hours: number;
    avgIn: number | null;     // minutes-of-day
}

export default function VolunteerMonthGrid({ clubId, registeredVolunteers }: {
    clubId: string;
    registeredVolunteers: { id: string; name: string; photo: string }[];
}) {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [sessions, setSessions] = useState<VolunteerSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [exportFmt, setExportFmt] = useState<"excel" | "pdf" | "csv" | "json">("excel");

    useEffect(() => {
        if (!clubId) return;
        let alive = true;
        const first = ymd(new Date(year, month, 1));
        const last = ymd(new Date(year, month + 1, 0));
        setLoading(true);
        getDocs(query(
            collection(db, `clubs/${clubId}/volunteerAttendance`),
            where("date", ">=", first),
            where("date", "<=", last),
        ))
            .then((snap) => {
                if (!alive) return;
                setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VolunteerSession));
            })
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [clubId, year, month]);

    const dayCount = daysInMonthCount(year, month);
    const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);
    const workingDays = useMemo(() => workingDaysUpTo(year, month, today), [year, month]); // eslint-disable-line react-hooks/exhaustive-deps
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

    const rows = useMemo(() => {
        const map = new Map<string, VolRow>();
        for (const v of registeredVolunteers) {
            map.set(v.id, { id: v.id, name: v.name || "—", photo: v.photo || "", byDate: new Map() });
        }
        for (const s of sessions) {
            let r = map.get(s.memberId);
            if (!r) { r = { id: s.memberId, name: s.memberName || "—", photo: (s as any).memberPhoto || "", byDate: new Map() }; map.set(s.memberId, r); }
            const arr = r.byDate.get(s.date) || [];
            arr.push(s);
            r.byDate.set(s.date, arr);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [sessions, registeredVolunteers]);

    const statOf = (r: VolRow): VolStat => {
        const present = r.byDate.size;
        const pct = workingDays > 0 ? Math.round((present / workingDays) * 100) : 0;
        let totalMin = 0;
        const firstMins: number[] = [];
        for (const arr of r.byDate.values()) {
            const sorted = [...arr].sort((a, b) => ((a.loginTime as any)?.toMillis?.() || 0) - ((b.loginTime as any)?.toMillis?.() || 0));
            const mo = minutesOfDay(sorted[0]?.loginTime);
            if (mo != null) firstMins.push(mo);
            for (const s of arr) totalMin += s.totalMinutes || 0;
        }
        const avgIn = firstMins.length ? Math.round(firstMins.reduce((a, b) => a + b, 0) / firstMins.length) : null;
        return { present, pct, hours: totalMin / 60, avgIn };
    };

    const prevMonth = () => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
    const nextMonth = () => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
    const monthName = new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    // ─── Export ──────────────────────────────────────────────────────────
    // All four formats render the SAME matrix you see on screen: volunteer
    // names down the side, dates across the top, first login time in each cell,
    // then Days / Attendance % / Hours summary columns.
    const buildMatrix = () => {
        const dayHeaders = days.map((d) => {
            const dt = new Date(year, month, d);
            return `${d} ${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][dt.getDay()]}`;
        });
        const dataRows = rows.map((r) => {
            const s = statOf(r);
            const cells = days.map((d) => {
                const arr = r.byDate.get(ymd(new Date(year, month, d)));
                if (!arr) return "";
                const first = [...arr].sort((a, b) => ((a.loginTime as any)?.toMillis?.() || 0) - ((b.loginTime as any)?.toMillis?.() || 0))[0];
                return first ? fmtShort(first.loginTime) : "✓";
            });
            return { name: r.name, cells, present: s.present, pct: s.pct, hours: Number(s.hours.toFixed(1)) };
        });
        return { dayHeaders, dataRows };
    };

    const downloadBlob = (filename: string, content: string, mime: string) => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    };

    const exportExcel = () => {
        const { dayHeaders, dataRows } = buildMatrix();
        const header = ["Volunteer", ...dayHeaders, "Days Present", "Attendance %", "Total Hours"];
        const aoa: (string | number)[][] = [header];
        for (const r of dataRows) aoa.push([r.name, ...r.cells, r.present, `${r.pct}%`, r.hours]);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 22 }, ...days.map(() => ({ wch: 6 })), { wch: 13 }, { wch: 13 }, { wch: 11 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Volunteers ${monthStr}`);
        XLSX.writeFile(wb, `volunteers-${monthStr}.xlsx`);
    };

    const exportCsv = () => {
        const { dayHeaders, dataRows } = buildMatrix();
        const esc = (v: any) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const lines = [["Volunteer", ...dayHeaders, "Days Present", "Attendance %", "Total Hours"].map(esc).join(",")];
        for (const r of dataRows) lines.push([r.name, ...r.cells, r.present, `${r.pct}%`, r.hours].map(esc).join(","));
        downloadBlob(`volunteers-${monthStr}.csv`, lines.join("\r\n"), "text/csv;charset=utf-8");
    };

    const exportJson = () => {
        const { dataRows } = buildMatrix();
        const out = {
            month: monthName, monthKey: monthStr, workingDays,
            volunteers: dataRows.map((r) => ({
                name: r.name, daysPresent: r.present, attendancePct: r.pct, totalHours: r.hours,
                logins: days.reduce((acc, d, i) => { acc[ymd(new Date(year, month, d))] = r.cells[i] || null; return acc; }, {} as Record<string, string | null>),
            })),
        };
        downloadBlob(`volunteers-${monthStr}.json`, JSON.stringify(out, null, 2), "application/json");
    };

    const exportPdf = async () => {
        const { dataRows } = buildMatrix();
        const { default: jsPDF } = await import("jspdf");
        const docPdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
        const pageW = docPdf.internal.pageSize.getWidth();
        const pageH = docPdf.internal.pageSize.getHeight();
        const left = 24, right = 24, top = 64, sumW = 36;
        const nameW = 96;
        const gridW = pageW - left - right - nameW - sumW * 3;
        const dayW = gridW / Math.max(1, days.length);
        const dayX = (i: number) => left + nameW + i * dayW + dayW / 2;
        const sumX = (n: number) => left + nameW + gridW + sumW * n + sumW / 2;

        docPdf.setFontSize(13);
        docPdf.text(`Volunteer Attendance — ${monthName}`, left, 30);
        docPdf.setFontSize(8); docPdf.setTextColor(120);
        docPdf.text(`Working days (Sun excl.): ${workingDays} · Volunteers: ${dataRows.length}`, left, 44);
        docPdf.setTextColor(0);

        let y = top;
        const drawHeader = () => {
            docPdf.setFontSize(6.5); docPdf.setFont(undefined as any, "bold");
            docPdf.text("Volunteer", left, y);
            days.forEach((d, i) => docPdf.text(String(d), dayX(i), y, { align: "center" }));
            docPdf.text("Days", sumX(0), y, { align: "center" });
            docPdf.text("Att%", sumX(1), y, { align: "center" });
            docPdf.text("Hrs", sumX(2), y, { align: "center" });
            docPdf.setFont(undefined as any, "normal");
            y += 4; docPdf.setDrawColor(210); docPdf.line(left, y, pageW - right, y); y += 11;
        };
        drawHeader();
        docPdf.setFontSize(6);
        for (const r of dataRows) {
            if (y > pageH - 24) { docPdf.addPage(); y = top; drawHeader(); docPdf.setFontSize(6); }
            docPdf.text(String(r.name).slice(0, 24), left, y);
            r.cells.forEach((c, i) => { if (c) docPdf.text(c, dayX(i), y, { align: "center" }); });
            docPdf.text(String(r.present), sumX(0), y, { align: "center" });
            docPdf.text(`${r.pct}%`, sumX(1), y, { align: "center" });
            docPdf.text(r.hours.toFixed(1), sumX(2), y, { align: "center" });
            y += 12;
        }
        docPdf.save(`volunteers-${monthStr}.pdf`);
    };

    const exportAs = (f: "excel" | "pdf" | "csv" | "json") => {
        if (rows.length === 0) return;
        if (f === "excel") exportExcel();
        else if (f === "csv") exportCsv();
        else if (f === "json") exportJson();
        else void exportPdf();
    };

    const pctColor = (pct: number) => pct >= 80 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";

    return (
        <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <button onClick={prevMonth} style={navBtn}>← Prev</button>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#1a3a2a", minWidth: 150, textAlign: "center" }}>{monthName}</div>
                <button onClick={nextMonth} style={navBtn}>Next →</button>
                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                    {workingDays} working days · {rows.length} volunteers
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                        value={exportFmt}
                        onChange={(e) => setExportFmt(e.target.value as any)}
                        title="Choose export format"
                        style={{ ...navBtn, padding: "8px 10px", cursor: "pointer" }}
                    >
                        <option value="excel">Excel (.xlsx)</option>
                        <option value="pdf">PDF</option>
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                    </select>
                    <button
                        onClick={() => exportAs(exportFmt)}
                        disabled={rows.length === 0}
                        style={{ ...navBtn, background: GREEN, color: "white", border: "none", opacity: rows.length === 0 ? 0.5 : 1, cursor: rows.length === 0 ? "not-allowed" : "pointer" }}
                    >⬇ Download</button>
                </div>
            </div>

            {loading && <div style={{ color: "#9ca3af", fontSize: 13, padding: 8 }}>Loading…</div>}

            {!loading && rows.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af" }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>🙌</div>
                    <p style={{ fontSize: 13 }}>No volunteers to show for this month.</p>
                </div>
            )}

            {!loading && rows.length > 0 && (
                <div style={{ overflowX: "auto", background: "white", borderRadius: 14, border: "1px solid #e5e7eb" }}>
                    <table style={{ borderCollapse: "collapse", fontFamily: "Nunito, sans-serif", fontSize: 11 }}>
                        <thead>
                            <tr>
                                <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, background: "#f8fafc", textAlign: "left", minWidth: 150 }}>Volunteer</th>
                                {days.map((d) => {
                                    const dt = new Date(year, month, d);
                                    const sun = dt.getDay() === 0;
                                    return (
                                        <th key={d} style={{ ...thStyle, color: sun ? "#cbd5e1" : "#6b7280", minWidth: 40 }}>
                                            {d}
                                            <div style={{ fontSize: 8, fontWeight: 600 }}>{["S", "M", "T", "W", "T", "F", "S"][dt.getDay()]}</div>
                                        </th>
                                    );
                                })}
                                <th style={{ ...thStyle, minWidth: 54 }}>Days</th>
                                <th style={{ ...thStyle, minWidth: 54 }}>Att %</th>
                                <th style={{ ...thStyle, minWidth: 54 }}>Hours</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const s = statOf(r);
                                return (
                                    <tr key={r.id}>
                                        <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, background: "white", textAlign: "left", fontWeight: 800, color: "#1a3a2a", display: "flex", alignItems: "center", gap: 6, minWidth: 150 }}>
                                            {r.photo
                                                ? <img src={r.photo} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                                                : <div style={{ width: 22, height: 22, borderRadius: "50%", background: GREEN, color: "white", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{(r.name || "?")[0].toUpperCase()}</div>}
                                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{r.name}</span>
                                        </td>
                                        {days.map((d) => {
                                            const key = ymd(new Date(year, month, d));
                                            const arr = r.byDate.get(key);
                                            const dt = new Date(year, month, d);
                                            const sun = dt.getDay() === 0;
                                            const first = arr ? [...arr].sort((a, b) => ((a.loginTime as any)?.toMillis?.() || 0) - ((b.loginTime as any)?.toMillis?.() || 0))[0] : null;
                                            return (
                                                <td key={d} style={{ ...tdStyle, background: arr ? "#dcfce7" : sun ? "#f9fafb" : "white", color: arr ? "#166534" : "#cbd5e1" }}>
                                                    {arr ? (first ? fmtShort(first.loginTime) : "✓") : ""}
                                                </td>
                                            );
                                        })}
                                        <td style={{ ...tdStyle, fontWeight: 800 }}>{s.present}</td>
                                        <td style={{ ...tdStyle, fontWeight: 900, color: pctColor(s.pct) }}>{s.pct}%</td>
                                        <td style={{ ...tdStyle, fontWeight: 700 }}>{s.hours.toFixed(1)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

const navBtn: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" };
const thStyle: React.CSSProperties = { padding: "8px 6px", fontSize: 10, fontWeight: 800, color: "#6b7280", borderBottom: "1.5px solid #e5e7eb", textAlign: "center", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "6px", fontSize: 11, textAlign: "center", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
