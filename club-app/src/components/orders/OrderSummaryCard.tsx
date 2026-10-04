import { Star } from "lucide-react";
import OrderStatusBadge from "./OrderStatusBadge";
import type { Order } from "@/types/firestore";

interface Props {
    order: Order;
    currencyName: string;
    onRate?: () => void;
}

export default function OrderSummaryCard({ order, currencyName, onRate }: Props) {
    const date = order.createdAt?.toDate?.();

    return (
        <div className="rounded-xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="text-xs text-muted-foreground">
                        {date?.toLocaleDateString()} {date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                </div>
                <p className="text-sm font-bold text-violet-600">{order.totalCost} {currencyName}</p>
            </div>

            <div className="space-y-1">
                {order.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{item.productName} × {item.quantity}</span>
                        <span className="font-medium">{item.pricePerUnit * item.quantity}</span>
                    </div>
                ))}
            </div>

            {/* Rating */}
            {order.status === "served" && (
                <div className="pt-2 border-t">
                    {order.rating ? (
                        <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                                <Star key={s} className={`w-4 h-4 ${s <= order.rating! ? "text-yellow-400 fill-yellow-400" : "text-gray-200"}`} />
                            ))}
                            {order.ratingNote && <span className="text-xs text-muted-foreground ml-2">"{order.ratingNote}"</span>}
                        </div>
                    ) : (
                        onRate && (
                            <button onClick={onRate} className="text-xs font-bold text-violet-600 hover:underline flex items-center gap-1">
                                <Star className="w-3 h-3" /> Rate this order
                            </button>
                        )
                    )}
                </div>
            )}
        </div>
    );
}
