/**
 * Admin → Virtual Numbers.
 *
 * Dedicated admin view for virtual members: list + search, membership expiry
 * ("Active · N days left" / "Expired N days/months ago"), last renewal date,
 * and the FULL renewal history (the renewals subcollection that was being
 * written but never shown). Plus Add and Bulk Add.
 *
 * Renewals themselves are taken at Reception (which runs the full payment +
 * inventory flow); this page is the accountability / history view.
 */

import { useMemo, useState } from "react";
import { getAllRenewalsByMember } from "@/lib/virtualRenewals";
import { todayLocal } from "@/lib/clubDay";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { useClubContext } from "@/lib/clubDetection";
import {
    useVirtualMembers, useVirtualMemberRenewals,
    addVirtualMember, bulkAddVirtualMembers, expiryStatus,
    type VirtualMemberLite,
} from "@/hooks/owner/useVirtualMembers";

const FONT = "Nunito, sans-serif";
const GREEN = "#2d9653";

const fmtDate = (t: any): string => {
    if (!t) return "—";
    try { const d = t?.toDate ? t.toDate() : new Date(t); return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
};

// ISO date (YYYY-MM-DD) for export files — sortable & locale-independent.
const fmtDateISO = (t: any): string => {
    if (!t) return "";
    try { const d = t?.toDate ? t.toDate() : new Date(t); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); } catch { return ""; }
};

const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function VirtualNumbersPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const { members, loading } = useVirtualMembers(clubId);
    const [search, setSearch] = useState("");
    const [expandId, setExpandId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);

    const filtered = useMemo(() => {
        const t = search.trim().toLowerCase();
        if (!t) return members;
        return members.filter(m =>
            (m.name || "").toLowerCase().includes(t) ||
            (m.memberId || "").toLowerCase().includes(t) ||
            (m.phone || "").includes(t));
    }, [members, search]);

    const stats = useMemo(() => {
        let active = 0, expired = 0, noPlan = 0;
        for (const m of members) {
            const s = expiryStatus(m.membershipEnd);
            if (!s.set) noPlan++; else if (s.expired) expired++; else active++;
        }
        return { active, expired, noPlan, total: members.length };
    }, [members]);

    // ─── Export ─────────────────────────────────────────────────────────
    // Exports the CURRENT view (whatever the search box has filtered to).
    const buildExportRows = () => filtered.map(m => ({
        "Member ID": m.memberId || "",
        "Name": m.name || "",
        "Phone": m.phone || "",
        "Plan": m.planName || "",
        "Membership Start": fmtDateISO(m.membershipStart),
        "Membership End": fmtDateISO(m.membershipEnd),
        "Last Renewal": fmtDateISO(m.lastRenewalAt),
        "Status": expiryStatus(m.membershipEnd).label,
    }));
    const exportBaseName = `virtual_members_${new Date().toISOString().slice(0, 10)}`;

    const exportCsv = () => {
        const rows = buildExportRows();
        const headers = ["Member ID", "Name", "Phone", "Plan", "Membership Start", "Membership End", "Last Renewal", "Status"];
        const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = [headers.join(","), ...rows.map(r => headers.map(h => esc((r as any)[h])).join(","))].join("\r\n");
        triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${exportBaseName}.csv`);
    };

    const exportXlsx = () => {
        const ws = XLSX.utils.json_to_sheet(buildExportRows());
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Virtual Members");
        XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
    };

    const exportJson = () => {
        triggerDownload(new Blob([JSON.stringify(buildExportRows(), null, 2)], { type: "application/json" }), `${exportBaseName}.json`);
    };

    const exportPdf = () => {
        const rows = buildExportRows();
        const headers = ["Member ID", "Name", "Phone", "Plan", "Start", "End", "Last Renewal", "Status"];
        const keys = ["Member ID", "Name", "Phone", "Plan", "Membership Start", "Membership End", "Last Renewal", "Status"];
        const colW = [24, 42, 28, 34, 22, 22, 28, 50]; // mm — fits A4 landscape
        const pdf = new jsPDF("l", "mm", "a4");
        const pageH = pdf.internal.pageSize.getHeight();
        const marginX = 12;
        let y = 16;
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
        pdf.text(`Virtual Members (${rows.length})`, marginX, y);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110);
        pdf.text(`${club?.name || ""}  ·  Generated ${new Date().toLocaleString("en-IN")}`, marginX, y + 5);
        pdf.setTextColor(0);
        y += 12;
        const totalW = colW.reduce((a, b) => a + b, 0);
        const drawHeader = () => {
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
            let x = marginX;
            headers.forEach((h, i) => { pdf.text(h, x, y); x += colW[i]; });
            y += 1.5; pdf.setLineWidth(0.2); pdf.line(marginX, y, marginX + totalW, y); y += 4;
            pdf.setFont("helvetica", "normal");
        };
        drawHeader();
        pdf.setFontSize(8);
        for (const r of rows) {
            if (y > pageH - 12) { pdf.addPage(); y = 16; drawHeader(); pdf.setFontSize(8); }
            let x = marginX;
            keys.forEach((k, i) => {
                const text = String((r as any)[k] ?? "");
                const fit = pdf.splitTextToSize(text, colW[i] - 2)[0] || "";
                pdf.text(fit, x, y); x += colW[i];
            });
            y += 5;
        }
        pdf.save(`${exportBaseName}.pdf`);
    };

    // ─── Complete Export ────────────────────────────────────────────────
    //
    // The export above is a snapshot of the list on screen: one row per member,
    // one "Last Renewal" date. This one answers the question the club actually
    // asks — for EVERY member, every date they have renewed, how many times,
    // and how much. Somebody who joined in August shows one renewal; somebody
    // who has been here since January shows nine.
    //
    // It ignores the search box on purpose: "complete" means the whole club.
    //
    // Renewals are read through lib/virtualRenewals, which merges the history
    // collection with the payments that recorded renewals before that
    // collection existed. Reading either one alone silently under-reports
    // every long-standing member — exactly the people this report is for.
    const [completeBusy, setCompleteBusy] = useState(false);
    const [completeErr, setCompleteErr] = useState("");

    const exportComplete = async () => {
        if (!clubId || completeBusy) return;
        setCompleteBusy(true);
        setCompleteErr("");
        try {
            const byMember = await getAllRenewalsByMember(clubId);

            // Every month that appears anywhere, so the grid has a column for it.
            const months = new Set<string>();
            for (const list of byMember.values()) {
                for (const r of list) {
                    const d = String(r.date ?? "");
                    if (/^\d{4}-\d{2}/.test(d)) months.add(d.slice(0, 7));
                }
            }
            const monthCols = Array.from(months).sort();

            const summary: Record<string, unknown>[] = [];
            const detail: Record<string, unknown>[] = [];
            const grid: Record<string, unknown>[] = [];

            // Every member, including those who have never renewed — a member
            // with nothing is a fact worth exporting, not a row to leave out.
            for (const m of members) {
                const all = byMember.get(m.id) ?? [];
                // Back-dated expiry corrections are not renewals and carry no
                // money. Counting them would overstate how often somebody paid.
                const renewals = all.filter(r => !r.backdated);
                const dates = renewals
                    .map(r => String(r.date ?? ""))
                    .filter(Boolean)
                    .sort();
                const paid = renewals.reduce((s, r) => s + (Number(r.amount) || 0), 0);

                // Most virtual members have membership dates but NO itemised
                // renewal record — the history writes were refused by Firestore
                // rules until that was fixed, and members migrated in never had
                // one at all. Printing a bare "0" next to a member the club
                // renewed six times reads as "we lost your money"; it means
                // "nothing was written down". The two are worth telling apart
                // on the page, so the column says which.
                const lastOnRecord = fmtDateISO(m.lastRenewalAt);
                summary.push({
                    "Member ID": m.memberId || "",
                    "Name": m.name || "",
                    "Phone": m.phone || "",
                    "Plan": m.planName || "",
                    "Status": expiryStatus(m.membershipEnd).label,
                    "Membership Start": fmtDateISO(m.membershipStart),
                    "Membership End": fmtDateISO(m.membershipEnd),
                    "Itemised History": renewals.length ? "Yes" : (lastOnRecord ? "Not recorded" : "None"),
                    "Renewals Recorded": renewals.length,
                    "First Renewal": dates[0] || "",
                    "Last Renewal": dates[dates.length - 1] || "",
                    // Straight off the member document. For the members with no
                    // itemised history this is the ONLY renewal fact that
                    // survives — one date, not a count.
                    "Last Renewal (member record)": lastOnRecord,
                    "Months Renewed": new Set(dates.map(d => d.slice(0, 7))).size,
                    "Total Paid (recorded)": paid,
                    "All Renewal Dates": dates.join(", "),
                });

                for (const r of all) {
                    detail.push({
                        "Member ID": m.memberId || "",
                        "Name": m.name || "",
                        "Phone": m.phone || "",
                        "Date": r.date || "",
                        "Amount": Number(r.amount) || 0,
                        "Method": (r.paymentMethod as string) || "",
                        "Plan": (r.planName as string) || "",
                        "Entry Type": r.backdated ? "Back-dated expiry fix" : "Renewal",
                        "Bulk": r.bulkRenewal ? "Yes" : "",
                        "Extended To": (r.extendedTo as string) || "",
                        "Note": (r.note as string) || "",
                        "Source": r.source === "history" ? "Renewal history" : "Payment record",
                    });
                }

                const row: Record<string, unknown> = {
                    "Member ID": m.memberId || "",
                    "Name": m.name || "",
                };
                const perMonth = new Map<string, number>();
                for (const d of dates) {
                    const k = d.slice(0, 7);
                    perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
                }
                for (const mc of monthCols) row[mc] = perMonth.get(mc) ?? "";
                row["Total"] = renewals.length;
                grid.push(row);
            }

            // Newest first reads better than grouped-by-member for the detail.
            detail.sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"])));

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Every Renewal");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grid), "Month Grid");
            XLSX.writeFile(wb, `virtual_members_complete_${todayLocal()}.xlsx`);
        } catch (e) {
            // Say what went wrong on screen. A silent no-op on a report button
            // reads as "there is no data", which is a different and worse thing.
            setCompleteErr(e instanceof Error ? e.message : "Could not build the export.");
        } finally {
            setCompleteBusy(false);
        }
    };

    const doExport = (fmt: "csv" | "xlsx" | "json" | "pdf") => {
        setExportOpen(false);
        if (!filtered.length) return;
        if (fmt === "csv") exportCsv();
        else if (fmt === "xlsx") exportXlsx();
        else if (fmt === "json") exportJson();
        else exportPdf();
    };

    if (!clubId) return null;

    return (
        <div style={{ padding: "20px 24px 40px", fontFamily: FONT, background: "#f8fafc", minHeight: "100vh" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>👤 Virtual Numbers</h1>
                    <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>Virtual members, renewal history &amp; expiry. Renew from Reception → Virtual Members.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ position: "relative" }}>
                        <button
                            onClick={() => setExportOpen(o => !o)}
                            disabled={filtered.length === 0}
                            title={filtered.length === 0 ? "Nothing to export" : "Download member data"}
                            style={{ ...btnGhost, opacity: filtered.length === 0 ? 0.5 : 1, cursor: filtered.length === 0 ? "not-allowed" : "pointer" }}
                        >
                            ⬇ Export ({filtered.length}) ▾
                        </button>
                        {exportOpen && (
                            <>
                                <div onClick={() => setExportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "white", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", overflow: "hidden", minWidth: 200 }}>
                                    {([
                                        { fmt: "csv" as const, label: "CSV (.csv)", icon: "📄" },
                                        { fmt: "xlsx" as const, label: "Excel (.xlsx)", icon: "📊" },
                                        { fmt: "json" as const, label: "JSON (.json)", icon: "🧩" },
                                        { fmt: "pdf" as const, label: "PDF (.pdf)", icon: "📕" },
                                    ]).map(o => (
                                        <button
                                            key={o.fmt}
                                            onClick={() => doExport(o.fmt)}
                                            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px", background: "white", border: "none", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: "#1a3a2a", cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
                                            onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                                            onMouseLeave={e => (e.currentTarget.style.background = "white")}
                                        >
                                            <span style={{ fontSize: 16 }}>{o.icon}</span>{o.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    {/* Whole club, every renewal date — not the filtered view */}
                    <button
                        onClick={exportComplete}
                        disabled={completeBusy || !members.length}
                        title="Every virtual member, every date they renewed, how many times, and how much"
                        style={{ ...btnGhost, opacity: completeBusy || !members.length ? 0.5 : 1 }}
                    >
                        {completeBusy ? "Building…" : `📋 Complete Export (${members.length})`}
                    </button>
                    <button onClick={() => setAddOpen(true)} style={btnPrimary}>+ Add</button>
                    <button onClick={() => setBulkOpen(true)} style={btnGhost}>Bulk Add</button>
                </div>
            </div>

            {completeErr && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13, fontWeight: 700 }}>
                    Complete export failed: {completeErr}
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
                <Stat label="Total" value={stats.total} color="#1a3a2a" />
                <Stat label="Active" value={stats.active} color={GREEN} />
                <Stat label="Expired" value={stats.expired} color="#dc2626" />
                <Stat label="No plan set" value={stats.noPlan} color="#94a3b8" />
            </div>

            <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, ID or phone…"
                style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, marginBottom: 14, boxSizing: "border-box" }}
            />

            {loading && <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>Loading…</div>}
            {!loading && filtered.length === 0 && (
                <div style={{ background: "white", borderRadius: 14, padding: 40, textAlign: "center", color: "#9ca3af", fontWeight: 700 }}>
                    {members.length === 0 ? "No virtual members yet — add one above." : "No matches."}
                </div>
            )}

            <div style={{ display: "grid", gap: 8 }}>
                {filtered.map(m => {
                    const s = expiryStatus(m.membershipEnd);
                    const expanded = expandId === m.id;
                    return (
                        <div key={m.id} style={{ background: "white", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                                <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eef2ff", color: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13 }}>
                                    {(m.memberId || "VM").replace(/^MNC-?/, "")}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1a3a2a" }}>{m.name || "—"}</div>
                                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>
                                        {m.memberId || "—"}{m.phone ? ` · ${m.phone}` : ""}{m.planName ? ` · ${m.planName}` : ""}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginTop: 1 }}>
                                        Last renewal: {fmtDate(m.lastRenewalAt)} · Expires: {fmtDate(m.membershipEnd)}
                                    </div>
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 800, color: s.color, background: s.expired ? "#fef2f2" : s.set ? "#f0fdf4" : "#f8fafc", border: `1px solid ${s.color}33`, padding: "4px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>{s.label}</span>
                                <button onClick={() => setExpandId(expanded ? null : m.id)} style={{ ...btnGhost, padding: "6px 12px" }}>{expanded ? "Hide" : "History"}</button>
                            </div>
                            {expanded && <RenewalHistory clubId={clubId} memberDocId={m.id} />}
                        </div>
                    );
                })}
            </div>

            {addOpen && <AddDialog clubId={clubId} existing={members} bulk={false} onClose={() => setAddOpen(false)} />}
            {bulkOpen && <AddDialog clubId={clubId} existing={members} bulk onClose={() => setBulkOpen(false)} />}
        </div>
    );
}

function RenewalHistory({ clubId, memberDocId }: { clubId: string; memberDocId: string }) {
    const { renewals, loading } = useVirtualMemberRenewals(clubId, memberDocId);
    return (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 14px", background: "#fafafa" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Renewal history ({renewals.length})
            </div>
            {loading && <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading…</div>}
            {!loading && renewals.length === 0 && <div style={{ fontSize: 12, color: "#9ca3af" }}>No renewals recorded yet.</div>}
            <div style={{ display: "grid", gap: 4 }}>
                {renewals.map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "white", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}>
                        <span style={{ fontWeight: 800, color: "#1a3a2a", minWidth: 92 }}>{r.date || fmtDate(r.createdAt)}</span>
                        <span style={{ flex: 1, color: "#6b7280" }}>{r.planName || "—"}{r.backdated ? " · back-dated" : ""}{r.bulkRenewal ? " · bulk" : ""}</span>
                        {r.paymentMethod && <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", background: "#f1f5f9", padding: "2px 8px", borderRadius: 100 }}>{r.paymentMethod}</span>}
                        <span style={{ fontWeight: 900, color: GREEN, minWidth: 60, textAlign: "right" }}>{r.amount ? `₹${Math.round(r.amount).toLocaleString("en-IN")}` : "—"}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AddDialog({ clubId, existing, bulk, onClose }: { clubId: string; existing: VirtualMemberLite[]; bulk: boolean; onClose: () => void }) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [bulkText, setBulkText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const save = async () => {
        setBusy(true); setErr("");
        try {
            if (bulk) {
                // One per line: "Name, Phone" or just "Name"
                const rows = bulkText.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
                    const [n, p] = l.split(",");
                    return { name: (n || "").trim(), phone: (p || "").trim() };
                }).filter(r => r.name);
                if (!rows.length) { setErr("Enter at least one name."); setBusy(false); return; }
                await bulkAddVirtualMembers(clubId, existing, rows);
            } else {
                if (!name.trim()) { setErr("Name is required."); setBusy(false); return; }
                await addVirtualMember(clubId, existing, { name, phone });
            }
            onClose();
        } catch (e: any) {
            setErr(e?.message || "Could not save");
            setBusy(false);
        }
    };

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 22, maxWidth: 440, width: "100%", fontFamily: FONT }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#1a3a2a", marginBottom: 12 }}>{bulk ? "Bulk Add Virtual Numbers" : "Add Virtual Number"}</div>
                {bulk ? (
                    <>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>One per line: <b>Name, Phone</b> (phone optional). IDs auto-assigned.</div>
                        <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8} placeholder={"Lakshmi, 9876543210\nVignesh\nPriya, 9000000000"} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1.5px solid #e0f0e9", fontSize: 13, fontFamily: FONT, boxSizing: "border-box" }} />
                    </>
                ) : (
                    <>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoFocus style={{ width: "100%", padding: 10, borderRadius: 8, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, marginBottom: 8, boxSizing: "border-box" }} />
                        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }} />
                    </>
                )}
                {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{err}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                    <button onClick={save} disabled={busy} style={{ ...btnPrimary, flex: 1, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving…" : bulk ? "Add All" : "Add"}</button>
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div style={{ background: "white", borderRadius: 14, padding: "14px 18px", boxShadow: "0 2px 10px rgba(0,0,0,0.04)", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color, marginTop: 4 }}>{value}</div>
        </div>
    );
}

const btnPrimary: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "none", background: GREEN, color: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const btnGhost: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
