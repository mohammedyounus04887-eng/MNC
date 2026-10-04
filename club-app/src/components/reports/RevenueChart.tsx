import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { format, parseISO } from "date-fns";

export interface RevenueChartProps {
    data: { date: string; amount: number }[];
    currencyName: string;
    primaryColor: string;
}

export default function RevenueChart({ data, currencyName, primaryColor }: RevenueChartProps) {
    if (!data || data.length === 0) {
        return <div className="h-[300px] flex items-center justify-center text-muted-foreground">No data for selected period</div>;
    }

    const formattedData = data.map(d => ({
        ...d,
        displayDate: format(parseISO(d.date), "dd MMM")
    }));

    const isLineChart = data.length > 30;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border rounded-xl shadow-premium text-sm">
                    <p className="font-bold text-slate-800">{label}</p>
                    <p className="font-black mt-1" style={{ color: primaryColor }}>
                        {payload[0].value.toLocaleString()} {currencyName}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                {isLineChart ? (
                    <LineChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(val) => val.toLocaleString()} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="amount" stroke={primaryColor} strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                    </LineChart>
                ) : (
                    <BarChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(val) => val.toLocaleString()} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="amount" fill={primaryColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}
