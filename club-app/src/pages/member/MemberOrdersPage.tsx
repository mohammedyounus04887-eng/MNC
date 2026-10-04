import { ShoppingCart, ShieldCheck, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyMemberId } from "@/lib/memberKey";
import { useMyOrders } from "@/hooks/member/useMemberOrders";
import type { Order } from "@/types/firestore";

const STATUS_COLORS: Record<Order["status"], string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    preparing: "bg-blue-100 text-blue-800 border-blue-200",
    served: "bg-green-100 text-green-800 border-green-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
    rejected: "bg-red-100 text-red-800 border-red-200",
};

export default function MemberOrdersPage() {
    // The auth uid used to be passed here. Orders are keyed by the member
    // document id, so this page was empty for every member the club created
    // rather than one who signed themselves up.
    const { data: orders, isLoading } = useMyOrders(useMyMemberId());

    return (
        <div className="space-y-6 px-4 pt-6 pb-24" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <h1 className="text-2xl font-bold" style={{ color: "#2d9653" }}>Order History</h1>

            <div className="space-y-4">
                {isLoading ? (
                    [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
                ) : orders && orders.length > 0 ? (
                    orders.map(order => (
                        <div key={order.id} className="member-card">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <p className="font-bold text-lg flex items-center gap-2">
                                        ₹{order.totalCost}
                                        {order.walletDeducted && (
                                            <ShieldCheck className="w-4 h-4 text-green-600" />
                                        )}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        ID: #{order.id.slice(-6).toUpperCase()}
                                        {' • '}
                                        {order.createdAt?.toDate?.()?.toLocaleDateString()}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <Badge className={`${STATUS_COLORS[order.status]} shadow-none`}>
                                        {order.status.toUpperCase()}
                                    </Badge>
                                </div>
                            </div>

                            <div className="bg-muted rounded-xl p-3 border space-y-2">
                                {order.items.map((item, index) => (
                                    <div key={index} className="flex justify-between text-sm">
                                        <div className="flex gap-2">
                                            <span className="font-bold text-muted-foreground">{item.quantity}x</span>
                                            <span className="font-semibold">{item.productName}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {order.notes && (
                                <p className="text-xs text-orange-600 font-bold mt-3 bg-orange-50 inline-block px-2 py-1 rounded">Note: {order.notes}</p>
                            )}

                            {order.status === 'cancelled' && (
                                <p className="text-xs text-red-600 flex items-center gap-1 mt-3">
                                    <XCircle className="w-3 h-3" />
                                    Refunded ₹{order.totalCost} to your wallet.
                                </p>
                            )}
                        </div>
                    ))
                ) : (
                    <div className="member-card text-center !py-12 text-muted-foreground border-dashed">
                        <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30 text-slate-400" />
                        <p className="font-medium">No previous orders.</p>
                        <p className="text-sm text-slate-400">Your future purchases will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
