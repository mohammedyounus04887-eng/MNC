import { ArrowUpCircle, ArrowDownCircle, RotateCcw, Award, GlassWater, Wallet, ShieldCheck, ShoppingBag } from "lucide-react";
import type { WalletTransaction } from "@/types/firestore";

interface Props {
    transaction: WalletTransaction;
    currencyName: string;
}

const REASON_CONFIG: Record<string, { label: string; icon: typeof ArrowUpCircle; bgColor: string; iconColor: string }> = {
    topup: { label: "Wallet Top-up", icon: Wallet, bgColor: "#ecfdf5", iconColor: "#059669" },
    shake_order: { label: "Shake Order", icon: GlassWater, bgColor: "#fef2f2", iconColor: "#dc2626" },
    membership: { label: "Membership", icon: Award, bgColor: "#eff6ff", iconColor: "#2563eb" },
    product: { label: "Product Purchase", icon: ShoppingBag, bgColor: "#fef3c7", iconColor: "#b45309" },
    shake_credits_added: { label: "Shake Credits", icon: GlassWater, bgColor: "#ecfdf5", iconColor: "#059669" },
    refund: { label: "Refund", icon: ArrowUpCircle, bgColor: "#ecfdf5", iconColor: "#16a34a" },
    referral_bonus: { label: "Referral Bonus", icon: ArrowUpCircle, bgColor: "#f0fdf4", iconColor: "#16a34a" },
    adjustment: { label: "Adjustment", icon: RotateCcw, bgColor: "#f3f4f6", iconColor: "#6b7280" },
    plan_purchase: { label: "Plan Purchase", icon: Award, bgColor: "#eff6ff", iconColor: "#2563eb" },
};

export default function TransactionItem({ transaction: tx, currencyName }: Props) {
    const isCredit = tx.type === "credit";
    const config = REASON_CONFIG[tx.reason] || {
        label: tx.reason,
        icon: isCredit ? ArrowUpCircle : ArrowDownCircle,
        bgColor: isCredit ? "#ecfdf5" : "#fef2f2",
        iconColor: isCredit ? "#059669" : "#dc2626",
    };
    const Icon = config.icon;

    const timestamp = tx.createdAt?.toDate?.()
        ? tx.createdAt.toDate().toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "";
    const subtitle = tx.note || tx.description || config.label;
    const amountValue = Math.abs(tx.amount);

    return (
        <div className="flex items-center gap-3 py-3 px-1">
            {/* Styled icon */}
            <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: config.bgColor }}
            >
                <Icon className="w-5 h-5" style={{ color: config.iconColor }} />
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                    {tx.description || config.label}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {subtitle}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                    {timestamp}
                </p>
                {tx.paymentMethod && (
                    <p className="text-[11px] mt-0.5 text-muted-foreground">
                        Paid via: {tx.paymentMethod === 'upi' ? 'UPI' : tx.paymentMethod === 'cash' ? 'Cash' : tx.paymentMethod}
                    </p>
                )}
                {tx.approvedBy && (
                    <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: "#2563eb" }}>
                        <ShieldCheck className="w-3 h-3" /> Verified by: {tx.approvedBy}
                    </p>
                )}
            </div>

            {/* Amount & balance */}
            <div className="text-right flex-shrink-0">
                <p className={`text-sm font-bold ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
                    {isCredit ? "+" : "-"}Rs.{amountValue.toLocaleString("en-IN")}
                </p>
                {tx.balanceAfter !== undefined && (
                    <p className="text-[10px] text-muted-foreground">
                        Bal: Rs.{tx.balanceAfter.toLocaleString("en-IN")}
                    </p>
                )}
            </div>
        </div>
    );
}
