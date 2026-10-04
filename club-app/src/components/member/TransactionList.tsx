import { useState, useMemo } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TransactionItem from "./TransactionItem";
import type { WalletTransaction } from "@/types/firestore";

interface Props {
    transactions: WalletTransaction[];
    loadMore: () => void;
    hasMore: boolean;
    loading: boolean;
    currencyName: string;
}

type FilterId = "all" | "topup" | "orders" | "products" | "membership";

const FILTERS: { id: FilterId; label: string }[] = [
    { id: "all", label: "All" },
    { id: "topup", label: "Top-ups" },
    { id: "orders", label: "Orders" },
    { id: "products", label: "Products" },
    { id: "membership", label: "Membership" },
];

const FILTER_MAP: Record<FilterId, string[]> = {
    all: [],
    topup: ["topup", "refund", "shake_credits_added"],
    orders: ["shake_order"],
    products: ["product"],
    membership: ["membership"],
};

export default function TransactionList({ transactions, loadMore, hasMore, loading, currencyName }: Props) {
    const [filter, setFilter] = useState<FilterId>("all");

    const filtered = useMemo(() => {
        if (filter === "all") return transactions;
        const reasons = FILTER_MAP[filter];
        return transactions.filter((tx) => reasons.includes(tx.reason));
    }, [transactions, filter]);

    if (loading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Filter tabs */}
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                {FILTERS.map((f) => {
                    const count = f.id === "all"
                        ? transactions.length
                        : transactions.filter((tx) => FILTER_MAP[f.id].includes(tx.reason)).length;
                    const active = filter === f.id;
                    return (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0"
                            style={active
                                ? { backgroundColor: "#2d9653", color: "#fff" }
                                : { backgroundColor: "#f3f4f6", color: "#6b7280" }}
                        >
                            {f.label}
                            {count > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                                    style={active
                                        ? { backgroundColor: "rgba(255,255,255,0.25)" }
                                        : { backgroundColor: "#e5e7eb" }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Grouped transactions */}
            {filtered.length === 0 ? (
                <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center">
                        <Inbox className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {filter === "all" ? "No transactions yet." : `No ${FILTERS.find(f => f.id === filter)?.label?.toLowerCase()} transactions.`}
                    </p>
                    {filter === "all" && (
                        <p className="text-xs text-muted-foreground mt-1">Add coins to get started.</p>
                    )}
                </div>
            ) : (
                <>
                    {groupByDate(filtered).map(({ label, items }) => (
                        <div key={label}>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
                                {label}
                            </p>
                            <div className="bg-white rounded-xl border divide-y divide-border">
                                {items.map((tx) => (
                                    <TransactionItem key={tx.id} transaction={tx} currencyName={currencyName} />
                                ))}
                            </div>
                        </div>
                    ))}

                    {hasMore && (
                        <div className="text-center pt-2">
                            <Button variant="outline" size="sm" onClick={loadMore} className="text-xs">
                                <Loader2 className="w-3 h-3 mr-1" /> Load More
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function groupByDate(transactions: WalletTransaction[]): { label: string; items: WalletTransaction[] }[] {
    const groups: Record<string, WalletTransaction[]> = {};

    const todayStr = new Date().toDateString();
    const yesterdayStr = new Date(Date.now() - 86400000).toDateString();

    for (const tx of transactions) {
        const date = tx.createdAt?.toDate?.();
        if (!date) continue;
        const dateStr = date.toDateString();
        let label: string;
        if (dateStr === todayStr) label = "Today";
        else if (dateStr === yesterdayStr) label = "Yesterday";
        else label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        if (!groups[label]) groups[label] = [];
        groups[label].push(tx);
    }

    return Object.entries(groups).map(([label, items]) => ({ label, items }));
}
