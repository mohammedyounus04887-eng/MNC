import { useState, useRef } from "react";
import { Shield, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import TopupRequestCard from "@/components/owner/TopupRequestCard";
import { usePendingTopupRequests, useApproveTopup, useRejectTopup, useTopupHistory } from "@/hooks/useOwner";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AutoPrintCountdown from "@/components/AutoPrintCountdown";
import { fetchClubAndPrint } from "@/utils/printReceipt";
import { buildTopUpReceipt } from "@/utils/receiptBuilder";
import { useClubContext } from "@/lib/clubDetection";

const SESSION_TTL = 60 * 60 * 1000; // 1 hour

export default function WalletApprovalsPage() {
    const { toast } = useToast();
    const { firebaseUser } = useAuth();
    const { club } = useClubContext();
    const { requests, loading } = usePendingTopupRequests();
    const { data: history, isLoading: historyLoading } = useTopupHistory();
    const approveTopup = useApproveTopup();
    const rejectTopup = useRejectTopup();

    // Auto-print state
    const [showAutoPrint, setShowAutoPrint] = useState(false);
    const [approvalReceiptData, setApprovalReceiptData] = useState<{
        memberName: string; memberId: string; phone: string;
        amount: number; previousBalance: number; newBalance: number;
        paymentMethod: string; transactionId: string;
    } | null>(null);

    // Session-based wallet PIN logic
    const sessionRef = useRef<number | null>(null);
    const [pinDialog, setPinDialog] = useState(false);
    const [pinInput, setPinInput] = useState("");
    const [pinError, setPinError] = useState("");
    const [verifying, setVerifying] = useState(false);
    const pendingApprovalRef = useRef<{ requestId: string; amount: number; requestData: any } | null>(null);

    const isSessionValid = () => sessionRef.current && Date.now() - sessionRef.current < SESSION_TTL;

    const handleApprove = (requestId: string, amount: number, requestData: any) => {
        if (isSessionValid()) {
            executeApproval(requestId, amount, requestData);
        } else {
            pendingApprovalRef.current = { requestId, amount, requestData };
            setPinInput("");
            setPinError("");
            setPinDialog(true);
        }
    };

    const executeApproval = (requestId: string, amount: number, requestData: any) => {
        approveTopup.mutate(
            { requestId, approvedAmount: amount, resolvedBy: firebaseUser?.uid || "" },
            {
                onSuccess: async () => {
                    toast({ title: "Approved!", description: `${amount} credited to member's wallet.` });
                    const prevBal = requestData?.walletBalance ?? 0;
                    setApprovalReceiptData({
                        memberName:      requestData?.memberName ?? "",
                        memberId:        requestData?.memberId ?? "",
                        phone:           requestData?.memberPhone ?? "",
                        amount,
                        previousBalance: prevBal,
                        newBalance:      prevBal + amount,
                        paymentMethod:   "Wallet Top-up",
                        transactionId:   "TXN" + Date.now().toString().slice(-8),
                    });
                    setShowAutoPrint(true);
                    // Auto-upgrade visiting → permanent on first topup approval
                    try {
                        const memberRef = doc(db, "clubs", club?.id || "", "members", requestData?.memberId ?? "");
                        const memberSnap = await getDoc(memberRef);
                        const memberData = memberSnap.data();
                        if (memberData && !memberData.isPermanent) {
                            await updateDoc(memberRef, {
                                isPermanent:    true,
                                isActiveMember: true,
                                memberType:     "permanent",
                                status:         "active",
                                activatedAt:    serverTimestamp(),
                                activatedBy:    "first_topup",
                            });
                        }
                    } catch (err) {
                        console.error("Error upgrading member:", err);
                    }
                },
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    const handlePinVerify = async () => {
        if (!pinInput || !club?.id) return;
        setVerifying(true);
        setPinError("");
        try {
            const snap = await getDoc(doc(db, "clubs", club.id));
            const storedPin = snap.data()?.walletPin;
            if (!storedPin) {
                toast({ title: "Wallet PIN not set", description: "Ask your super admin to set the Wallet Confirmation PIN.", variant: "destructive" });
                return;
            }
            if (pinInput.trim() !== String(storedPin).trim()) {
                setPinError("Incorrect PIN. Please try again.");
                return;
            }
            sessionRef.current = Date.now();
            setPinDialog(false);
            setPinInput("");
            if (pendingApprovalRef.current) {
                executeApproval(pendingApprovalRef.current.requestId, pendingApprovalRef.current.amount, pendingApprovalRef.current.requestData);
                pendingApprovalRef.current = null;
            }
        } catch {
            toast({ title: "Error verifying PIN", description: "Please try again.", variant: "destructive" });
        } finally { setVerifying(false); }
    };

    const handleReject = (requestId: string) => {
        rejectTopup.mutate(
            { requestId, resolvedBy: firebaseUser?.uid || "" },
            {
                onSuccess: () => toast({ title: "Request rejected" }),
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-wellness-forest">Wallet Topup Approvals</h1>
                <Badge variant="secondary">{requests.length} pending</Badge>
            </div>

            <Tabs defaultValue="pending">
                <TabsList>
                    <TabsTrigger value="pending">Pending ({requests.length})</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="pending" className="mt-6 space-y-3">
                    {loading ? (
                        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
                    ) : requests.length === 0 ? (
                        <div className="text-center py-16 border border-dashed rounded-2xl bg-white">
                            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                            <p className="text-muted-foreground text-sm">No pending requests 🎉</p>
                        </div>
                    ) : (
                        requests.map((r) => (
                            <TopupRequestCard
                                key={r.id}
                                request={r}
                                onApprove={(amount) => handleApprove(r.id, amount, r)}
                                onReject={() => handleReject(r.id)}
                                isApproving={approveTopup.isPending}
                                isRejecting={rejectTopup.isPending}
                            />
                        ))
                    )}
                </TabsContent>

                <TabsContent value="history" className="mt-6">
                    {historyLoading ? (
                        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                    ) : history && history.length > 0 ? (
                        <div className="space-y-2">
                            {history.map((r) => (
                                <div key={r.id} className="flex items-center justify-between p-3 rounded-xl border bg-white text-sm">
                                    <div>
                                        <p className="font-medium">{r.memberName}</p>
                                        <p className="text-xs text-muted-foreground">{r.resolvedAt?.toDate?.().toLocaleString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-medium">{r.requestedAmount} → {r.approvedAmount || 0}</p>
                                        <Badge variant={r.status === "approved" ? "outline" : "destructive"} className="text-xs">{r.status}</Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">No history yet</p>
                    )}
                </TabsContent>
            </Tabs>

            {/* Auto-print countdown after top-up approval */}
            {showAutoPrint && approvalReceiptData && (
                <AutoPrintCountdown
                    onPrint={() => {
                        setShowAutoPrint(false);
                        fetchClubAndPrint(
                            club?.id || "",
                            (clubData) => buildTopUpReceipt({
                                club:            clubData,
                                memberName:      approvalReceiptData.memberName,
                                memberId:        approvalReceiptData.memberId,
                                phone:           approvalReceiptData.phone,
                                amount:          approvalReceiptData.amount,
                                previousBalance: approvalReceiptData.previousBalance,
                                newBalance:      approvalReceiptData.newBalance,
                                paymentMethod:   approvalReceiptData.paymentMethod,
                                transactionId:   approvalReceiptData.transactionId,
                            })
                        );
                    }}
                    onCancel={() => {
                        setShowAutoPrint(false);
                        setApprovalReceiptData(null);
                    }}
                />
            )}

            {/* Wallet PIN Dialog */}
            <Dialog open={pinDialog} onOpenChange={(open) => { setPinDialog(open); if (!open) { setPinInput(""); setPinError(""); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Confirm Wallet Top-up</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Enter Wallet Confirmation PIN (4 digits)</Label>
                            <Input
                                type="password"
                                inputMode="numeric"
                                maxLength={4}
                                value={pinInput}
                                onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                                onKeyDown={(e) => e.key === "Enter" && handlePinVerify()}
                                placeholder="----"
                                className="font-mono tracking-widest w-32"
                                autoFocus
                            />
                            {pinError && <p className="text-sm text-destructive font-medium">{pinError}</p>}
                        </div>
                        <p className="text-xs text-muted-foreground">This PIN is set by the super admin under Club Settings → Access PINs.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPinDialog(false)}>Cancel</Button>
                        <Button onClick={handlePinVerify} disabled={verifying || pinInput.length < 4}>{verifying ? "Verifying…" : "Confirm"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
