/**
 * Owner dashboard analytics section — real-data charts with a
 * Today / This Month / This Year toggle. Mounted below the daily snapshot.
 */

import { useState } from "react";
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line,
    PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useDashboardAnalytics, type DashPeriod } from "@/hooks/owner/useDashboardAnalytics";

const fmtRs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const PIE_COLORS = ["#16a34a", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#64748b"];

export default function DashboardAnalytics({ clubId }: { clubId: string }) {
    const [period, setPeriod] = useState<DashPeriod>("month");
    const a = useDashboardAnalytics(clubId, period);

    const physicalVsVirtual = [
        { name: "Physical", value: a.membersTotal },
        { name: "Virtual", value: a.virtualTotal },
    ].filter(s => s.value > 0);
    const cashVsUpi = [
        { name: "Cash", value: Math.round(a.cash) },
        { name: "UPI", value: Math.round(a.upi) },
    ].filter(s => s.value > 0);

    return (
        <div className="bg-white rounded-2xl border p-5 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-base font-black text-gray-900">📊 Club Analytics</h3>
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                    {(["today", "month", "year"] as DashPeriod[]).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                            style={period === p ? { background: "#16a34a", color: "white" } : { color: "#64748b" }}
                        >
                            {p === "today" ? "Today" : p === "month" ? "This Month" : "This Year"}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Revenue" value={fmtRs(a.revenue)} color="#16a34a" loading={a.loading} />
                <Kpi label="Shakes Served" value={String(a.shakesServed)} color="#0891b2" loading={a.loading} />
                <Kpi label="Products Sold" value={String(a.productsSold)} color="#0d9488" loading={a.loading} />
                <Kpi label="New Customers" value={String(a.newCustomers)} color="#db2777" loading={a.loading} />
                <Kpi label="Members" value={String(a.membersTotal)} color="#7c3aed" loading={a.loading} />
                <Kpi label="Virtual" value={String(a.virtualTotal)} color="#2563eb" loading={a.loading} />
            </div>

            {/* Revenue trend (month/year) */}
            {period !== "today" && (
                <div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                        {period === "month" ? "Daily Revenue" : "Monthly Revenue"}
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                        {period === "month" ? (
                            <BarChart data={a.trend} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : String(v)} />
                                <Tooltip formatter={(v: any) => fmtRs(Number(v))} labelFormatter={(l) => `Day ${l}`} />
                                <Bar dataKey="value" fill="#16a34a" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        ) : (
                            <LineChart data={a.trend} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : String(v)} />
                                <Tooltip formatter={(v: any) => fmtRs(Number(v))} />
                                <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                            </LineChart>
                        )}
                    </ResponsiveContainer>
                </div>
            )}

            {/* Pie row */}
            <div className="grid sm:grid-cols-3 gap-4">
                <PieCard title="Revenue by Source" data={a.bySource} money loading={a.loading} />
                <PieCard title="Cash vs UPI" data={cashVsUpi} money loading={a.loading} />
                <PieCard title="Physical vs Virtual" data={physicalVsVirtual} loading={a.loading} />
            </div>
        </div>
    );
}

function Kpi({ label, value, color, loading }: { label: string; value: string; color: string; loading: boolean }) {
    return (
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-lg font-black mt-0.5" style={{ color }}>{loading ? "…" : value}</div>
        </div>
    );
}

function PieCard({ title, data, money, loading }: { title: string; data: { name: string; value: number }[]; money?: boolean; loading?: boolean }) {
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
        <div className="rounded-xl border border-gray-100 p-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">{title}</div>
            {loading ? (
                <div className="h-[150px] flex items-center justify-center text-gray-300 text-sm">…</div>
            ) : total === 0 ? (
                <div className="h-[150px] flex items-center justify-center text-gray-300 text-xs font-medium">No data</div>
            ) : (
                <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={58} paddingAngle={2}>
                            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any, n: any) => [money ? fmtRs(Number(v)) : String(v), n]} />
                    </PieChart>
                </ResponsiveContainer>
            )}
            {!loading && total > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    {data.slice(0, 6).map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1 text-[10px] text-gray-600 font-semibold">
                            <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            {d.name}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
