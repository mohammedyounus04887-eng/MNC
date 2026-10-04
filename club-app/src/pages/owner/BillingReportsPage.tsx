import { useState, useMemo } from "react";
import { BarChart3, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubContext } from "@/lib/clubDetection";
import { useClubBills } from "@/hooks/useBilling";
import BillHistoryTable from "@/components/billing/BillHistoryTable";
import BillPreviewModal from "@/components/billing/BillPreviewModal";
import type { BillingPrint } from "@/types/firestore";

export default function BillingReportsPage() {
    const { club } = useClubContext();
    const { bills, loadMore, hasMore, loading } = useClubBills();
    const [search, setSearch] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [previewBill, setPreviewBill] = useState<BillingPrint | null>(null);

    const filtered = useMemo(() => {
        let result = bills;
        if (search.trim()) result = result.filter((b) => b.memberName.toLowerCase().includes(search.toLowerCase()));
        if (startDate) result = result.filter((b) => {
            const d = b.printedAt?.toDate?.();
            return d && d >= new Date(startDate);
        });
        if (endDate) result = result.filter((b) => {
            const d = b.printedAt?.toDate?.();
            return d && d <= new Date(endDate + "T23:59:59");
        });
        return result;
    }, [bills, search, startDate, endDate]);

    const totalBills = filtered.length;
    const totalRevenue = filtered.reduce((s, b) => s + b.total, 0);
    const avgBill = totalBills > 0 ? Math.round(totalRevenue / totalBills) : 0;

    const exportCSV = () => {
        const rows = [["Bill#", "Member", "Items", "Total", "Paid Via", "Date", "Time"]];
        filtered.forEach((b) => {
            const d = b.printedAt?.toDate?.();
            rows.push([
                b.id.slice(-6), b.memberName,
                b.items.map((i) => `${i.name}x${i.quantity}`).join("; "),
                String(b.total), b.paidFrom,
                d?.toLocaleDateString("en-IN") || "", d?.toLocaleTimeString() || "",
            ]);
        });
        const csv = rows.map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `billing_report.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <h1 className="text-2xl font-black text-wellness-forest flex items-center gap-2">
                <BarChart3 className="w-6 h-6" /> Billing Reports
            </h1>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4 border bg-violet-50">
                    <p className="text-2xl font-black">{totalBills}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Total Bills</p>
                </div>
                <div className="rounded-2xl p-4 border bg-emerald-50">
                    <p className="text-2xl font-black">₹{totalRevenue.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Total Revenue</p>
                </div>
                <div className="rounded-2xl p-4 border bg-blue-50">
                    <p className="text-2xl font-black">₹{avgBill}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Avg Bill Value</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
                <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search member…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1">
                    <Download className="w-4 h-4" /> CSV
                </Button>
            </div>

            {/* Table */}
            {loading ? (
                <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : (
                <>
                    <BillHistoryTable bills={filtered} onReprint={(bill) => setPreviewBill(bill)} />
                    {hasMore && (
                        <div className="text-center"><Button variant="outline" size="sm" onClick={loadMore}>Load More</Button></div>
                    )}
                </>
            )}

            {previewBill && club && (
                <BillPreviewModal bill={previewBill} club={club} open onClose={() => setPreviewBill(null)} />
            )}
        </div>
    );
}
