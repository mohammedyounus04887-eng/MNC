import { useState } from "react";
import { Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { TopupRequest } from "@/types/firestore";
import { useClubContext } from "@/lib/clubDetection";

interface Props {
    request: TopupRequest;
    onApprove: (amount: number) => void;
    onReject: () => void;
    isApproving: boolean;
    isRejecting: boolean;
}

export default function TopupRequestCard({ request, onApprove, onReject, isApproving, isRejecting }: Props) {
    const { club } = useClubContext();
    const [amount, setAmount] = useState(request.requestedAmount);
    const [showReject, setShowReject] = useState(false);

    const timeAgo = request.requestedAt?.toDate
        ? getTimeAgo(request.requestedAt.toDate())
        : "Just now";

    return (
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-white">
            <Avatar className="h-10 w-10">
                {request.memberPhoto ? <AvatarImage src={request.memberPhoto} /> : null}
                <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-sm">
                    {request.memberName?.[0] || "?"}
                </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{request.memberName}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{timeAgo}</span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="text-right mr-2">
                    <p className="text-xs text-muted-foreground">Requested</p>
                    <p className="text-sm font-bold">{request.requestedAmount} {club?.currencyName}</p>
                </div>
                <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-20 text-center text-sm font-semibold"
                    min={0}
                />
                <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={isApproving || amount <= 0}
                    onClick={() => onApprove(amount)}
                >
                    <Check className="w-4 h-4" />
                </Button>
                <Button
                    size="sm"
                    variant="destructive"
                    disabled={isRejecting}
                    onClick={() => setShowReject(true)}
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <AlertDialog open={showReject} onOpenChange={setShowReject}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reject request?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Reject {request.memberName}'s topup request for {request.requestedAmount}?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onReject}>Reject</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function getTimeAgo(date: Date): string {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)} days ago`;
}
