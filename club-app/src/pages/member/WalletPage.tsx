import { useMemo } from "react";
import { TrendingDown, TrendingUp, BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubContext } from "@/lib/clubDetection";
import WalletBalanceCard from "@/components/member/WalletBalanceCard";
import PendingRequestBanner from "@/components/member/PendingRequestBanner";
import TopupRequestForm from "@/components/member/TopupRequestForm";
import TransactionList from "@/components/member/TransactionList";
import {
    useMyWallet,
    useMyTransactions,
    useMyPendingRequest,
    useMyLatestRequest,
} from "@/hooks/useMemberWallet";

export default function WalletPage() {
    const { club } = useClubContext();
    const { wallet, loading: walletLoading } = useMyWallet();
    const { transactions, loadMore, hasMore, loading: txLoading } = useMyTransactions();
    const { pendingRequest, hasPending } = useMyPendingRequest();
    const { latestRequest } = useMyLatestRequest();

    const currencyName = club?.currencyName || "Coins";
    const primaryColor = club?.primaryColor || "#8B5CF6";

    // Quick stats from transactions
    const stats = useMemo(() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        let spentMonth = 0;
        let addedMonth = 0;
        let totalSpent = 0;

        for (const tx of transactions) {
            const date = tx.createdAt?.toDate?.();
            if (tx.type === "debit") {
                totalSpent += tx.amount;
                if (date && date >= monthStart) spentMonth += tx.amount;
            } else {
                if (date && date >= monthStart) addedMonth += tx.amount;
            }
        }

        return { spentMonth, addedMonth, totalSpent };
    }, [transactions]);

    if (walletLoading) {
        return (
            <div className="space-y-6 animate-fade-in">
                <Skeleton className="h-44 rounded-3xl" />
                <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
                </div>
                <Skeleton className="h-64 rounded-2xl" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-24 px-4 pt-6">
            {/* Balance Card + Actions */}
            <div className="space-y-4">
                {wallet ? (
                    <WalletBalanceCard wallet={wallet} currencyName={currencyName} primaryColor={primaryColor} />
                ) : (
                    <div className="rounded-3xl bg-gray-100 p-8 text-center text-muted-foreground text-sm">
                        Wallet not found. Contact your club admin.
                    </div>
                )}

                {/* Pending / Resolved Banner */}
                {latestRequest && (
                    <PendingRequestBanner request={latestRequest} currencyName={currencyName} />
                )}

                {/* Add Coins Button */}
                <div className="flex justify-end">
                    <TopupRequestForm currencyName={currencyName} disabled={hasPending} />
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
                <StatChip
                    icon={<TrendingDown className="w-4 h-4 text-red-500" />}
                    label="Spent this month"
                    value={stats.spentMonth}
                    currencyName={currencyName}
                    bg="bg-red-50"
                />
                <StatChip
                    icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
                    label="Added this month"
                    value={stats.addedMonth}
                    currencyName={currencyName}
                    bg="bg-emerald-50"
                />
                <StatChip
                    icon={<BarChart3 className="w-4 h-4 text-violet-600" />}
                    label="Total spent ever"
                    value={stats.totalSpent}
                    currencyName={currencyName}
                    bg="bg-violet-50"
                />
            </div>

            {/* Transaction History */}
            <div className="space-y-3">
                <h2 className="text-sm font-bold text-wellness-forest">Transaction History</h2>
                <TransactionList
                    transactions={transactions}
                    loadMore={loadMore}
                    hasMore={hasMore}
                    loading={txLoading}
                    currencyName={currencyName}
                />
            </div>
        </div>
    );
}

function StatChip({
    icon, label, value, currencyName, bg,
}: {
    icon: React.ReactNode; label: string; value: number; currencyName: string; bg: string;
}) {
    return (
        <div className={`member-card !p-3 ${bg}`}>
            <div className="flex items-center gap-1.5 mb-1">{icon}</div>
            <p className="text-lg font-bold">{value.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</p>
        </div>
    );
}
