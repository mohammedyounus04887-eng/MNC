import React, { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";

export interface ProductUsageChartProps {
    data: { productName: string; totalQuantity: number; totalRevenue: number }[];
    currencyName: string;
    primaryColor: string;
}

export default function ProductUsageChart({ data, currencyName, primaryColor }: ProductUsageChartProps) {
    const [view, setView] = useState<"quantity" | "revenue">("quantity");

    const activeData = [...data].sort((a, b) => {
        return view === "quantity"
            ? b.totalQuantity - a.totalQuantity
            : b.totalRevenue - a.totalRevenue;
    }).slice(0, 10); // top 10

    if (!activeData || activeData.length === 0) {
        return <div className="h-[300px] flex items-center justify-center text-muted-foreground">No data for selected period</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-end gap-2">
                <Button
                    size="sm"
                    variant={view === "quantity" ? "default" : "outline"}
                    onClick={() => setView("quantity")}
                >
                    By Quantity
                </Button>
                <Button
                    size="sm"
                    variant={view === "revenue" ? "default" : "outline"}
                    onClick={() => setView("revenue")}
                >
                    By Revenue
                </Button>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activeData} layout="vertical" margin={{ top: 0, right: 30, left: 60, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="productName" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={100} />
                        <Tooltip cursor={{ fill: "transparent" }} content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                const val = payload[0].value;
                                return (
                                    <div className="bg-white p-3 border rounded-xl shadow-premium text-sm">
                                        <p className="font-bold text-slate-800 mb-1">{payload[0].payload.productName}</p>
                                        <p className="font-semibold text-primary">
                                            {view === "quantity"
                                                ? `${val} Units`
                                                : `${Number(val).toLocaleString()} ${currencyName}`}
                                        </p>
                                    </div>
                                );
                            }
                            return null;
                        }} />
                        <Bar
                            dataKey={view === "quantity" ? "totalQuantity" : "totalRevenue"}
                            fill={primaryColor}
                            radius={[0, 4, 4, 0]}
                            barSize={32}
                            label={{ position: "right", fill: "#64748B", fontSize: 10, formatter: (val: number) => view === "quantity" ? val : `${val.toLocaleString()}` }}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
