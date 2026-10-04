import { useEffect, useState } from "react";
import { Clock, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import type { TopupRequest } from "@/types/firestore";

interface Props {
    request: TopupRequest;
    currencyName: string;
    onDismiss?: () => void;
}

export default function PendingRequestBanner({ request, currencyName, onDismiss }: Props) {
    const [show, setShow] = useState(true);

    // Auto-dismiss approved/rejected after 8 seconds
    useEffect(() => {
        if (request.status === "approved" || request.status === "rejected") {
            const timer = setTimeout(() => {
                setShow(false);
                onDismiss?.();
            }, 8000);
            return () => clearTimeout(timer);
        }
    }, [request.status, onDismiss]);

    if (!show) return null;

    const timeAgo = request.requestedAt?.toDate?.()
        ? getTimeAgo(request.requestedAt.toDate())
        : "";

    // ─── Approved ────────────────────────────────
    if (request.status === "approved") {
        return (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 animate-in fade-in slide-in-from-top-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800">
                        ✅ Your topup of {(request.approvedAmount ?? request.requestedAmount).toLocaleString()} {currencyName} has been approved!
                    </p>
                    <p className="text-xs text-emerald-600 mt-0.5">
                        Coins have been added to your wallet.
                    </p>
                </div>
            </div>
        );
    }

    // ─── Rejected ────────────────────────────────
    if (request.status === "rejected") {
        return (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 animate-in fade-in slide-in-from-top-2">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                    <XCircle className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-800">
                        Request for {request.requestedAmount.toLocaleString()} {currencyName} was declined
                    </p>
                    {request.rejectionReason && (
                        <p className="text-xs text-red-600 mt-0.5">
                            Reason: {request.rejectionReason}
                        </p>
                    )}
                    <p className="text-xs text-red-500 mt-1">
                        Contact your club admin for details.
                    </p>
                </div>
            </div>
        );
    }

    // ─── Pending ─────────────────────────────────
    return (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 animate-in">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                    Your request for {request.requestedAmount.toLocaleString()} {currencyName} is waiting for admin approval
                </p>
                {timeAgo && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                        <Clock className="w-3 h-3" />
                        <span>Requested {timeAgo}</span>
                    </div>
                )}
            </div>
            {/* Pulsing dot to indicate active pending */}
            <div className="flex-shrink-0">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
            </div>
        </div>
    );
}

function getTimeAgo(date: Date): string {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
}
