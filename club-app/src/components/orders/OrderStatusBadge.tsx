import { Badge } from "@/components/ui/badge";

interface Props {
    status: "pending" | "preparing" | "served" | "cancelled" | "rejected";
}

const config: Record<string, { label: string; color: string }> = {
    pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    preparing: { label: "Preparing", color: "bg-blue-100 text-blue-800 border-blue-200" },
    served: { label: "Served", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 border-red-200" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-200" },
};

export default function OrderStatusBadge({ status }: Props) {
    const c = config[status] || config.pending;
    return <Badge variant="outline" className={`text-[10px] font-bold ${c.color}`}>{c.label}</Badge>;
}
