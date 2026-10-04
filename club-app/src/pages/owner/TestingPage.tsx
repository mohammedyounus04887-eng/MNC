/**
 * QA checklist — /admin/testing
 *
 * A non-developer works down this list, sets a status against each feature and
 * types what they saw. Results are saved per club so several people can test
 * over several sessions and pick up where the last one left off.
 *
 * ADDITIVE ONLY. This page reads the feature inventory and writes its own
 * results collection. It does not touch, call or change any existing feature.
 *
 * Results live at clubs/{clubId}/qaResults/{featureId} — ONE level below the
 * club, which is what the live security rules actually permit. A deeper path
 * would be refused, which is a mistake this codebase has made twice before.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { todayLocal } from "@/lib/clubDay";
import { QA_MODULES, ALL_FEATURES, CLUB_SPECIFIC, type QaFeature } from "@/data/qaFeatures";

type Status = "untested" | "working" | "partial" | "broken";

interface QaResult {
    status: Status;
    remarks: string;
    testedBy: string;
    testedOn: string;
}

const STATUS: Record<Status, { label: string; short: string; bg: string; border: string; text: string }> = {
    untested: { label: "⏭️ Not tested", short: "Not tested", bg: "#f8fafc", border: "#e2e8f0", text: "#64748b" },
    working: { label: "✅ Working", short: "Working", bg: "#f0fdf4", border: "#86efac", text: "#15803d" },
    partial: { label: "⚠️ Partial", short: "Partial", bg: "#fffbeb", border: "#fcd34d", text: "#b45309" },
    broken: { label: "❌ Broken", short: "Broken", bg: "#fef2f2", border: "#fca5a5", text: "#b91c1c" },
};

const LS_TESTER = "mnh_qa_tester";

export default function TestingPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [results, setResults] = useState<Record<string, QaResult>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [err, setErr] = useState("");
    const [tester, setTester] = useState(() => {
        try { return localStorage.getItem(LS_TESTER) || ""; } catch { return ""; }
    });
    const [openModule, setOpenModule] = useState<string | null>(QA_MODULES[0]?.key ?? null);
    const [filter, setFilter] = useState<"all" | "todo" | "problems">("all");

    // ── Load previous sessions ──────────────────────────────────────────
    const load = useCallback(async () => {
        if (!clubId) return;
        setLoading(true); setErr("");
        try {
            const snap = await getDocs(collection(db, "clubs", clubId, "qaResults"));
            const out: Record<string, QaResult> = {};
            snap.docs.forEach((d) => {
                const r = d.data() as any;
                out[d.id] = {
                    status: (r.status as Status) || "untested",
                    remarks: r.remarks || "",
                    testedBy: r.testedBy || "",
                    testedOn: r.testedOn || "",
                };
            });
            setResults(out);
        } catch (e: any) {
            setErr(e?.message || "Could not load previous results.");
        } finally {
            setLoading(false);
        }
    }, [clubId]);

    useEffect(() => { load(); }, [load]);

    // ── Save one feature ────────────────────────────────────────────────
    const save = async (featureId: string, patch: Partial<QaResult>) => {
        if (!clubId) return;
        const prev = results[featureId] || { status: "untested" as Status, remarks: "", testedBy: "", testedOn: "" };
        const next: QaResult = {
            ...prev,
            ...patch,
            // Stamped automatically — the tester never types a name twice or a date at all.
            testedBy: tester || prev.testedBy || "—",
            testedOn: todayLocal(),
        };
        setResults((r) => ({ ...r, [featureId]: next }));
        setSaving(featureId); setErr("");
        try {
            await setDoc(doc(db, "clubs", clubId, "qaResults", featureId), {
                ...next,
                featureId,
                updatedAt: serverTimestamp(),
            }, { merge: true });
        } catch (e: any) {
            setErr(`Could not save "${featureId}": ${e?.message || "unknown error"}. Your other answers are safe.`);
        } finally {
            setSaving(null);
        }
    };

    const statusOf = (id: string): Status => results[id]?.status || "untested";

    // ── Progress ────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const total = ALL_FEATURES.length;
        let tested = 0, working = 0, partial = 0, broken = 0;
        for (const f of ALL_FEATURES) {
            const s = statusOf(f.id);
            if (s !== "untested") tested++;
            if (s === "working") working++;
            if (s === "partial") partial++;
            if (s === "broken") broken++;
        }
        return {
            total, tested, working, partial, broken,
            pctTested: total ? Math.round((tested / total) * 100) : 0,
            // Passing is measured against everything, not just what has been
            // tested — otherwise one green tick reads as "100% passing".
            pctPassing: total ? Math.round((working / total) * 100) : 0,
        };
    }, [results]);

    const moduleStats = (key: string) => {
        const feats = QA_MODULES.find((m) => m.key === key)?.features ?? [];
        const done = feats.filter((f) => statusOf(f.id) !== "untested").length;
        const bad = feats.filter((f) => statusOf(f.id) === "broken" || statusOf(f.id) === "partial").length;
        return { done, total: feats.length, bad };
    };

    const visible = (f: QaFeature) => {
        if (filter === "todo") return statusOf(f.id) === "untested";
        if (filter === "problems") return statusOf(f.id) === "broken" || statusOf(f.id) === "partial";
        return true;
    };

    // ── Export ──────────────────────────────────────────────────────────
    const exportCsv = () => {
        const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const rows: string[] = [];
        rows.push(esc(`QA report — ${club?.name || "Club"}`));
        rows.push(esc(`Generated ${new Date().toLocaleString("en-IN")}`));
        rows.push("");
        rows.push([esc("Tested"), esc(`${stats.tested} of ${stats.total} (${stats.pctTested}%)`)].join(","));
        rows.push([esc("Working"), esc(String(stats.working))].join(","));
        rows.push([esc("Partial"), esc(String(stats.partial))].join(","));
        rows.push([esc("Broken"), esc(String(stats.broken))].join(","));
        rows.push([esc("Not tested"), esc(String(stats.total - stats.tested))].join(","));
        rows.push("");
        rows.push(["Module", "Feature", "Expected behaviour", "Status", "Remarks", "Tested by", "Date", "Club-specific — must be configurable"].map(esc).join(","));
        for (const f of ALL_FEATURES) {
            const r = results[f.id];
            rows.push([
                f.moduleTitle, f.name, f.expected,
                STATUS[statusOf(f.id)].short,
                r?.remarks || "", r?.testedBy || "", r?.testedOn || "",
                f.clubSpecific || "",
            ].map(esc).join(","));
        }
        const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `qa-report-${(club?.name || "club").replace(/\s+/g, "-").toLowerCase()}-${todayLocal()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // Printed through the browser so it needs no extra library and comes out
    // as a PDF via "Save as PDF" in the print dialog.
    const exportPdf = () => {
        const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
        const rowsFor = (m: typeof QA_MODULES[number]) => m.features.map((f) => {
            const r = results[f.id];
            const s = STATUS[statusOf(f.id)];
            return `<tr>
                <td>${esc(f.name)}<div class="exp">${esc(f.expected)}</div></td>
                <td class="st" style="color:${s.text}">${esc(s.short)}</td>
                <td>${esc(r?.remarks || "")}</td>
                <td class="who">${esc(r?.testedBy || "")}<br>${esc(r?.testedOn || "")}</td>
            </tr>`;
        }).join("");

        const html = `<!doctype html><html><head><meta charset="utf-8"><title>QA report</title><style>
      body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:24px;color:#0f172a}
      h1{font-size:20px;margin:0 0 2px} .sub{color:#64748b;font-size:12px;margin-bottom:14px}
      .kpis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
      .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:12px}
      .kpi b{display:block;font-size:18px}
      h2{font-size:14px;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;background:#f8fafc;padding:5px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
      td{padding:5px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top}
      .exp{color:#94a3b8;font-size:10px;margin-top:2px}
      .st{font-weight:800;white-space:nowrap} .who{color:#94a3b8;font-size:10px;white-space:nowrap}
      .cs{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:11px}
      .cs li{margin:3px 0}
      @media print{ h2{break-after:avoid} tr{break-inside:avoid} }
    </style></head><body>
      <h1>QA report — ${esc(club?.name || "Club")}</h1>
      <div class="sub">Generated ${esc(new Date().toLocaleString("en-IN"))}</div>
      <div class="kpis">
        <div class="kpi"><b>${stats.pctTested}%</b>tested (${stats.tested}/${stats.total})</div>
        <div class="kpi"><b>${stats.working}</b>working</div>
        <div class="kpi"><b>${stats.partial}</b>partial</div>
        <div class="kpi"><b>${stats.broken}</b>broken</div>
        <div class="kpi"><b>${stats.total - stats.tested}</b>not tested</div>
      </div>
      <div class="cs"><b>Must become configurable before duplicating this app (${CLUB_SPECIFIC.length})</b><ul>
        ${CLUB_SPECIFIC.map((f) => `<li><b>${esc(f.name)}</b> — ${esc(f.clubSpecific)}</li>`).join("")}
      </ul></div>
      ${QA_MODULES.map((m) => `<h2>${esc(m.title)} <span style="font-weight:400;color:#94a3b8">· ${esc(m.where)}</span></h2>
        <table><thead><tr><th style="width:42%">Feature</th><th>Status</th><th style="width:30%">Remarks</th><th>Tested by</th></tr></thead>
        <tbody>${rowsFor(m)}</tbody></table>`).join("")}
    </body></html>`;

        const w = window.open("", "_blank");
        if (!w) { setErr("The browser blocked the print window. Allow pop-ups for this site and try again."); return; }
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 300);
    };

    // ── UI ──────────────────────────────────────────────────────────────
    if (!clubId) {
        return <div className="p-6 text-sm text-slate-500">No club loaded. Open this from your club's own address.</div>;
    }

    return (
        <div className="space-y-4 pb-24">
            <div>
                <h1 className="text-2xl font-black text-slate-900">Feature testing</h1>
                <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                    Work down each section. Try the feature, set what happened, and write anything worth
                    remembering. Your answers save on their own, so you can stop and come back — and someone
                    else can carry on where you left off.
                </p>
            </div>

            {/* Who is testing */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-1.5">Your name</label>
                <input
                    value={tester}
                    onChange={(e) => {
                        setTester(e.target.value);
                        try { localStorage.setItem(LS_TESTER, e.target.value); } catch { /* private mode */ }
                    }}
                    placeholder="Type your name once — it is stamped on everything you answer"
                    className="w-full rounded-xl border-2 border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-emerald-500"
                />
            </div>

            {/* Progress */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                    <div>
                        <div className="text-xs font-black uppercase tracking-wider text-slate-500">Progress</div>
                        <div className="text-3xl font-black text-slate-900 leading-none mt-1">{stats.pctTested}%</div>
                        <div className="text-xs text-slate-500 mt-0.5">{stats.tested} of {stats.total} features tested</div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={exportPdf} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">🖨️ PDF report</button>
                        <button onClick={exportCsv} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">⬇️ CSV</button>
                    </div>
                </div>
                {/* One bar, three colours — proportion of the WHOLE list. */}
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div style={{ width: `${(stats.working / stats.total) * 100}%` }} className="bg-emerald-500" />
                    <div style={{ width: `${(stats.partial / stats.total) * 100}%` }} className="bg-amber-400" />
                    <div style={{ width: `${(stats.broken / stats.total) * 100}%` }} className="bg-red-500" />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
                    <span className="text-emerald-700">✅ {stats.working} working ({stats.pctPassing}%)</span>
                    <span className="text-amber-700">⚠️ {stats.partial} partial</span>
                    <span className="text-red-700">❌ {stats.broken} broken</span>
                    <span className="text-slate-500">⏭️ {stats.total - stats.tested} not tested</span>
                </div>
            </div>

            {/* Club-specific */}
            {CLUB_SPECIFIC.length > 0 && (
                <details className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <summary className="cursor-pointer text-sm font-black text-amber-900">
                        ⚙️ {CLUB_SPECIFIC.length} things are fixed to this club — tap to see what must change before copying the app
                    </summary>
                    <ul className="mt-2 space-y-1.5 text-xs text-amber-900">
                        {CLUB_SPECIFIC.map((f) => (
                            <li key={f.id}><b>{f.name}</b> — {f.clubSpecific}</li>
                        ))}
                    </ul>
                </details>
            )}

            {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">{err}</div>}
            {loading && <div className="text-sm text-slate-400">Loading previous answers…</div>}

            {/* Filter */}
            <div className="flex gap-2">
                {([["all", "Everything"], ["todo", "Still to test"], ["problems", "Problems found"]] as const).map(([k, label]) => (
                    <button
                        key={k}
                        onClick={() => setFilter(k)}
                        className={`rounded-xl px-3 py-2 text-xs font-black ${filter === k ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                    >{label}</button>
                ))}
            </div>

            {/* Modules */}
            {QA_MODULES.map((m) => {
                const ms = moduleStats(m.key);
                const open = openModule === m.key;
                const feats = m.features.filter(visible);
                if (filter !== "all" && feats.length === 0) return null;
                return (
                    <div key={m.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <button
                            onClick={() => setOpenModule(open ? null : m.key)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                            <div className="min-w-0">
                                <div className="text-sm font-black text-slate-900">{m.title}</div>
                                <div className="truncate text-xs text-slate-400">{m.where}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {ms.bad > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">{ms.bad} issue{ms.bad === 1 ? "" : "s"}</span>}
                                <span className="text-xs font-bold text-slate-500">{ms.done}/{ms.total}</span>
                                <span className="text-slate-400">{open ? "▲" : "▼"}</span>
                            </div>
                        </button>

                        {open && (
                            <div className="divide-y divide-slate-100 border-t border-slate-100">
                                {feats.map((f) => {
                                    const r = results[f.id];
                                    const s = statusOf(f.id);
                                    const st = STATUS[s];
                                    return (
                                        <div key={f.id} className="p-4" style={{ background: st.bg }}>
                                            <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-black text-slate-900">{f.name}</div>
                                                    <div className="mt-0.5 text-xs leading-relaxed text-slate-600">{f.expected}</div>
                                                    {f.clubSpecific && (
                                                        <div className="mt-1 text-[11px] font-bold text-amber-700">⚙️ Fixed to this club: {f.clubSpecific}</div>
                                                    )}
                                                </div>
                                                {saving === f.id && <span className="text-[10px] font-bold text-slate-400">saving…</span>}
                                            </div>

                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <select
                                                    value={s}
                                                    onChange={(e) => save(f.id, { status: e.target.value as Status })}
                                                    className="rounded-xl border-2 px-3 py-2 text-sm font-black outline-none"
                                                    style={{ borderColor: st.border, color: st.text, background: "white" }}
                                                >
                                                    {(Object.keys(STATUS) as Status[]).map((k) => (
                                                        <option key={k} value={k}>{STATUS[k].label}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    defaultValue={r?.remarks || ""}
                                                    onBlur={(e) => {
                                                        if ((r?.remarks || "") !== e.target.value) save(f.id, { remarks: e.target.value });
                                                    }}
                                                    placeholder="What happened? Anything worth remembering."
                                                    className="min-w-[200px] flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                                                />
                                            </div>

                                            {(r?.testedBy || r?.testedOn) && (
                                                <div className="mt-1.5 text-[11px] font-semibold text-slate-400">
                                                    {r.testedBy} · {r.testedOn}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
