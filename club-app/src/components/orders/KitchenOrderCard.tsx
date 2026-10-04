import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Order } from "@/types/firestore";

interface Props {
    order: Order;
    onStatusUpdate: (orderId: string, newStatus: "preparing" | "served") => void;
    isUpdating?: boolean;
}

export default function KitchenOrderCard({ order, onStatusUpdate, isUpdating }: Props) {
    const time = order.createdAt?.toDate?.();
    const isPending = order.status === "pending";
    const isPreparing = order.status === "preparing";
    const hasWithoutIce = order.items.some(
        (item: any) => item.notes?.toLowerCase().includes("without ice")
    );

    const cardStyle = hasWithoutIce
        ? "border-orange-400 bg-orange-50"
        : isPending
            ? "border-yellow-300 bg-yellow-50"
            : "border-blue-300 bg-blue-50";

    return (
        <div className={`rounded-2xl border-2 p-5 space-y-4 transition-all ${cardStyle}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                        {order.memberPhoto ? <AvatarImage src={order.memberPhoto} /> : null}
                        <AvatarFallback className="text-lg font-bold bg-white">{order.memberName?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="text-lg font-black">{order.memberName}</p>
                        <p className="text-sm text-muted-foreground">
                            #{order.id.slice(-6)} • {time?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                    </div>
                </div>
                <Badge className={`text-sm py-1 px-3 ${hasWithoutIce ? "bg-orange-200 text-orange-900" : isPending ? "bg-yellow-200 text-yellow-900" : "bg-blue-200 text-blue-900"}`}>
                    {isPending ? "🟡 Pending" : "🔵 Preparing"}
                </Badge>
            </div>

            {/* Items */}
            <div className="space-y-2 bg-white/60 rounded-xl p-3">
                {order.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                        <div>
                            <p className="text-xl font-bold">{item.productName}</p>
                            {item.notes && <p className="text-xs text-muted-foreground italic">"{item.notes}"</p>}
                        </div>
                        <span className="text-2xl font-black text-gray-700">×{item.quantity}</span>
                    </div>
                ))}
            </div>

            {/* Action */}
            {isPending && (
                <Button
                    className="w-full text-lg py-5 bg-blue-600 hover:bg-blue-700"
                    disabled={isUpdating}
                    onClick={() => onStatusUpdate(order.id, "preparing")}
                >
                    {isUpdating ? "Updating…" : "🔵 Start Preparing"}
                </Button>
            )}
            {isPreparing && (
                <Button
                    className="w-full text-lg py-5 bg-emerald-600 hover:bg-emerald-700"
                    disabled={isUpdating}
                    onClick={() => onStatusUpdate(order.id, "served")}
                >
                    {isUpdating ? "Updating…" : "✅ Mark as Served"}
                </Button>
            )}
        </div>
    );
}
