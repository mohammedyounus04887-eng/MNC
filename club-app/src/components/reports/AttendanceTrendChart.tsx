import React from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO } from "date-fns";

export interface AttendanceTrendChartProps {
    data: { date: string; count: number }[];
    totalActiveMembers: number;
    primaryColor: string;
}

export default function AttendanceTrendChart({ data, totalActiveMembers, primaryColor }: AttendanceTrendChartProps) {
    if (!data || data.length === 0) {
        return <div className="h-[300px] flex items-center justify-center text-muted-foreground">No data for selected period</div>;
    }

    const formattedData = data.map(d => ({
        ...d,
        displayDate: format(parseISO(d.date), "dd MMM"),
        rate: totalActiveMembers > 0 ? (d.count / totalActiveMembers) * 100 : 0
    }));

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border rounded-xl shadow-premium text-sm space-y-1">
                    <p className="font-bold text-slate-800 border-b pb-1 mb-1">{label}</p>
                    {payload.map((p: any, i: number) => (
                        <p key={i} className="font-semibold flex justify-between gap-4" style={{ color: p.color }}>
                            <span>{p.name}:</span>
                            <span>{p.dataKey === "rate" ? `${p.value.toFixed(1)}%` : p.value}</span>
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600, paddingTop: 10 }} />
                    <Bar yAxisId="left" name="Total Attendance" dataKey="count" fill={`${primaryColor}80`} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line yAxisId="right" name="Attendance Rate" type="monotone" dataKey="rate" stroke={primaryColor} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
