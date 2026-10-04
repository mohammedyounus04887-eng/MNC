import { Wallet as WalletIcon } from "lucide-react";
import type { Wallet } from "@/types/firestore";

interface Props {
    wallet: Wallet;
    currencyName: string;
    primaryColor?: string;
}

export default function WalletBalanceCard({ wallet, currencyName, primaryColor }: Props) {
    const lastUpdated = wallet.lastUpdated?.toDate?.();
    const timeAgo = lastUpdated ? getTimeAgo(lastUpdated) : "";

    return (
        <div className="wallet-balance-card">
            {/* Decorative circles */}
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/5" />

            <div className="relative z-10 space-y-4">
                <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
                        <WalletIcon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium opacity-90">{currencyName}</span>
                </div>

                <div>
                    <p className="wallet-label">Available Balance</p>
                    <p className="wallet-amount">
                        {Math.max(0, wallet.balance).toLocaleString()}
                    </p>
                </div>

                {timeAgo && (
                    <p className="text-xs opacity-60">Updated {timeAgo}</p>
                )}
            </div>
        </div>
    );
}

function getTimeAgo(date: Date): string {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return date.toLocaleDateString();
}

function shiftColor(hex: string): string {
    // Shift hue slightly for gradient effect
    try {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.min(255, r + 40)}, ${Math.max(0, g - 20)}, ${Math.min(255, b + 30)})`;
    } catch {
        return "#6D28D9";
    }
}
