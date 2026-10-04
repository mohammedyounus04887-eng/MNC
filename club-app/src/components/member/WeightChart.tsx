import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { toDateSafe } from "@/lib/toDateSafe";
import type { WeightLog } from "@/types/firestore";

interface Props {
    logs: WeightLog[];
    targetWeight?: number;
}

export default function WeightChart({ logs, targetWeight }: Props) {
    // We need logs sorted chronologically for the chart
    const data = useMemo(() => {
        // A weigh-in whose date is not a Timestamp used to take the whole
        // progress screen down rather than being left out of the chart.
        return [...logs]
            .map(log => ({ log, at: toDateSafe(log.date) }))
            .filter((x): x is { log: typeof x.log; at: Date } => x.at !== null)
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .map(({ log, at }) => ({
                date: at.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                weight: log.weight,
            }));
    }, [logs]);

    if (data.length === 0) {
        return (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed">
                <p className="text-sm font-medium">No progress logs yet.</p>
                <p className="text-xs mt-1">Add your first weight log to start tracking!</p>
            </div>
        );
    }

    // Calculate domain bounds closely around user's max/min
    const minWeight = Math.min(...data.map(d => d.weight), targetWeight || Infinity);
    const maxWeight = Math.max(...data.map(d => d.weight), targetWeight || -Infinity);

    // Padding for Y axis
    const domainMin = Math.floor(minWeight - 5);
    const domainMax = Math.ceil(maxWeight + 5);

    return (
        <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        dy={10}
                    />
                    <YAxis
                        domain={[domainMin, domainMax]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                    />
                    <Tooltip
                        contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", fontSize: "12px", fontWeight: "bold" }}
                        itemStyle={{ color: "#8b5cf6" }}
                    />

                    {targetWeight && (
                        <ReferenceLine y={targetWeight} stroke="#10b981" strokeDasharray="4 4" label={{ position: 'top', value: 'Target', fill: '#10b981', fontSize: 10 }} />
                    )}

                    <Area
                        type="monotone"
                        dataKey="weight"
                        stroke="#8b5cf6"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorWeight)"
                        activeDot={{ r: 6, fill: "#8b5cf6", stroke: "#fff", strokeWidth: 2 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
