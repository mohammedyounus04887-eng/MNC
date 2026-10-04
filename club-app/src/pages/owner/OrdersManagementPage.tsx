import { useState, useMemo } from "react";
import {
    ShoppingCart, TrendingUp, BarChart3, Award, Search, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClubContext } from "@/lib/clubDetection";
import { useTodayOrdersSummary, useAllTodayOrders } from "@/hooks/useOrders";
import OrderSummaryCard from "@/components/orders/OrderSummaryCard";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";

export default function OrdersManagementPage() {
    const { club } = useClubContext();
    const { summary, loading: summaryLoading } = useTodayOrdersSummary();
    const { data: todayOrders, isLoading: ordersLoading } = useAllTodayOrders();
    const [histSearch, setHistSearch] = useState("");

    const currencyName = club?.currencyName || "Coins";

    const filteredOrders = useMemo(() => {
        if (!todayOrders) return [];
        if (!histSearch.trim()) return todayOrders;
        return todayOrders.filter((o) => o.memberName.toLowerCase().includes(histSearch.toLowerCase()));
    }, [todayOrders, histSearch]);

    const exportCSV = () => {
        const rows = [["Member", "Items", "Total", "Status", "Rating", "Date", "Time"]];
        todayOrders?.forEach((o) => {
            rows.push([
                o.memberName,
                o.items.map((i) => `${i.productName}x${i.quantity}`).join("; "),
                String(o.totalCost), o.status, String(o.rating || "—"),
                o.date,
                o.createdAt?.toDate?.().toLocaleTimeString() || "",
            ]);
        });
        const csv = rows.map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <h1 className="text-2xl font-black text-wellness-forest flex items-center gap-2">
                <ShoppingCart className="w-6 h-6" /> Orders
            </h1>

            <Tabs defaultValue="today">
                <TabsList>
                    <TabsTrigger value="today">Today's Summary</TabsTrigger>
                    <TabsTrigger value="history">All Orders</TabsTrigger>
                </TabsList>

                {/* Today's Summary */}
                <TabsContent value="today" className="mt-6 space-y-6">
                    {/* Stats */}
                    {summaryLoading ? (
                        <div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <StatCard icon={<ShoppingCart className="w-5 h-5 text-violet-500" />} label="Total Orders" value={String(summary.totalOrders)} bg="bg-violet-50" />
                            <StatCard icon={<TrendingUp className="w-5 h-5 text-emerald-500" />} label="Revenue" value={`${summary.totalRevenue} ${currencyName}`} bg="bg-emerald-50" />
                            <StatCard icon={<BarChart3 className="w-5 h-5 text-blue-500" />} label="Avg Order" value={`${summary.avgOrderValue} ${currencyName}`} bg="bg-blue-50" />
                            <StatCard icon={<Award className="w-5 h-5 text-amber-500" />} label="Most Popular" value={summary.mostPopular} bg="bg-amber-50" />
                        </div>
                    )}

                    {/* Status breakdown */}
                    {summary && (
                        <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1.5">🟡 Pending: <strong>{summary.statusCounts.pending}</strong></span>
                            <span className="flex items-center gap-1.5">🔵 Preparing: <strong>{summary.statusCounts.preparing}</strong></span>
                            <span className="flex items-center gap-1.5">🟢 Served: <strong>{summary.statusCounts.served}</strong></span>
                        </div>
                    )}

                    {/* Product breakdown */}
                    {todayOrders && todayOrders.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-bold">Products Sold Today</h3>
                            <div className="bg-white rounded-xl border p-4 space-y-2">
                                {(() => {
                                    const counts: Record<string, { name: string; qty: number; revenue: number }> = {};
                                    todayOrders.forEach((o) => o.items.forEach((i) => {
                                        if (!counts[i.productId]) counts[i.productId] = { name: i.productName, qty: 0, revenue: 0 };
                                        counts[i.productId].qty += i.quantity;
                                        counts[i.productId].revenue += i.pricePerUnit * i.quantity;
                                    }));
                                    const sorted = Object.values(counts).sort((a, b) => b.qty - a.qty);
                                    const maxQty = sorted[0]?.qty || 1;
                                    return sorted.map((p) => (
                                        <div key={p.name} className="space-y-1">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="font-medium">{p.name}</span>
                                                <span className="text-xs text-muted-foreground">{p.qty} sold • {p.revenue} {currencyName}</span>
                                            </div>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-violet-400 rounded-full transition-all" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>
                    )}

                    {/* Today's order list */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold">Today's Orders</h3>
                        {ordersLoading ? (
                            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
                        ) : todayOrders && todayOrders.length > 0 ? (
                            todayOrders.map((o) => <OrderSummaryCard key={o.id} order={o} currencyName={currencyName} />)
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-8">No orders today yet.</p>
                        )}
                    </div>
                </TabsContent>

                {/* Order History */}
                <TabsContent value="history" className="mt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input placeholder="Search by member…" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} className="pl-9" />
                        </div>
                        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1">
                            <Download className="w-4 h-4" /> CSV
                        </Button>
                    </div>
                    <div className="space-y-3">
                        {filteredOrders.map((o) => (
                            <OrderSummaryCard key={o.id} order={o} currencyName={currencyName} />
                        ))}
                        {filteredOrders.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-8">No orders found.</p>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
    return (
        <div className={`rounded-2xl p-4 border ${bg}`}>
            <div className="mb-2">{icon}</div>
            <p className="text-xl font-black truncate">{value}</p>
            <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
        </div>
    );
}
