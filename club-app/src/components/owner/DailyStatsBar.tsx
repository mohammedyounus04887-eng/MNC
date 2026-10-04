import { useState } from "react";
import { Users, DollarSign, CalendarCheck, AlertTriangle, ShoppingBag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubContext } from "@/lib/clubDetection";
import { useDashboardLiveStats } from "@/hooks/owner/useDashboardLiveStats";

export default function DailyStatsBar() {
    const { club } = useClubContext();
    const s = useDashboardLiveStats(club?.id ?? null);
    const [showLowStock, setShowLowStock] = useState(false);

    const stats = [
        { key: "checkins", label: "Today's Check-ins", value: s.memberVisits, icon: CalendarCheck, color: "text-violet-600", bg: "bg-violet-50" },
        { key: "shakes", label: "Today's Shakes", value: s.shakesServed, icon: ShoppingBag, color: "text-pink-600", bg: "bg-pink-50" },
        { key: "revenue", label: "Today's Revenue", value: `₹${s.revenue.toLocaleString("en-IN")}`, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
        { key: "active", label: "Active Members", value: s.activeMembers, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
        { key: "lowStock", label: "Low Stock Items", value: s.lowStock.length, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50" },
    ] as const;

    return (
        <div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    const isLow = stat.key === "lowStock";
                    const isDanger = isLow && (stat.value as number) > 0;
                    const clickable = isLow && (stat.value as number) > 0;
                    return (
                        <div
                            key={stat.key}
                            onClick={clickable ? () => setShowLowStock(v => !v) : undefined}
                            className={`rounded-2xl border p-5 transition-all hover:shadow-md ${isDanger ? "border-orange-200 bg-orange-50/50" : "border-border bg-white"} ${clickable ? "cursor-pointer" : ""}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`rounded-xl p-2.5 ${stat.bg}`}>
                                    <Icon className={`w-5 h-5 ${stat.color}`} />
                                </div>
                                <div>
                                    {s.loading ? (
                                        <><Skeleton className="h-7 w-12 mb-1" /><Skeleton className="h-3 w-20" /></>
                                    ) : (
                                        <>
                                            <p className={`text-2xl font-bold ${isDanger ? "text-orange-600" : "text-foreground"}`}>{stat.value}</p>
                                            <p className="text-xs text-muted-foreground font-medium">
                                                {stat.label}{clickable ? " · tap to view" : ""}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {showLowStock && s.lowStock.length > 0 && (
                <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
                    <p className="text-sm font-bold text-orange-800 mb-2">Out of stock ({s.lowStock.length})</p>
                    <div className="flex flex-wrap gap-2">
                        {s.lowStock.map(p => (
                            <span key={p.id} className="text-xs font-bold text-orange-700 bg-white border border-orange-200 rounded-full px-3 py-1">
                                {p.name} · {p.stock} left
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
