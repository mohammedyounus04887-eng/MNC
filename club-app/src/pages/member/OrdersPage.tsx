import { useState, useMemo } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useClubContext } from "@/lib/clubDetection";
import { useMyOrders, useSubmitRating } from "@/hooks/useOrders";
import OrderSummaryCard from "@/components/orders/OrderSummaryCard";
import RatingModal from "@/components/orders/RatingModal";
import type { Order } from "@/types/firestore";

export default function OrdersPage() {
    const { toast } = useToast();
    const { club } = useClubContext();
    const { orders, loadMore, hasMore, loading } = useMyOrders();
    const submitRating = useSubmitRating();
    const [ratingOrder, setRatingOrder] = useState<Order | null>(null);
    const [statusFilter, setStatusFilter] = useState("all");

    const currencyName = club?.currencyName || "Coins";

    const filteredOrders = useMemo(() => {
        if (statusFilter === "all") return orders;
        return orders.filter((o) => o.status === statusFilter);
    }, [orders, statusFilter]);

    const handleRate = (rating: number, note: string) => {
        if (!ratingOrder) return;
        submitRating.mutate(
            { clubId: club?.id || "", orderId: ratingOrder.id, rating, ratingNote: note },
            {
                onSuccess: () => { toast({ title: "Thanks! ⭐" }); setRatingOrder(null); },
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <h1 className="text-2xl font-black text-wellness-forest">My Orders</h1>

            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="pending">Pending</TabsTrigger>
                    <TabsTrigger value="preparing">Preparing</TabsTrigger>
                    <TabsTrigger value="served">Served</TabsTrigger>
                </TabsList>
            </Tabs>

            {loading ? (
                <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
            ) : filteredOrders.length === 0 ? (
                <div className="text-center py-16 space-y-3">
                    <Inbox className="w-12 h-12 text-gray-200 mx-auto" />
                    <p className="text-sm text-muted-foreground">No orders found.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredOrders.map((order) => (
                        <OrderSummaryCard
                            key={order.id}
                            order={order}
                            currencyName={currencyName}
                            onRate={order.status === "served" && !order.rating ? () => setRatingOrder(order) : undefined}
                        />
                    ))}
                    {hasMore && (
                        <div className="text-center pt-2">
                            <Button variant="outline" size="sm" onClick={loadMore} className="text-xs gap-1">
                                <Loader2 className="w-3 h-3" /> Load More
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {ratingOrder && (
                <RatingModal order={ratingOrder} open onSubmit={handleRate} onClose={() => setRatingOrder(null)} />
            )}
        </div>
    );
}
