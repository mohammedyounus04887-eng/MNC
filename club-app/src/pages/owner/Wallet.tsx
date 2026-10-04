import { useState, useMemo } from "react";
import {
    Wallet as WalletIcon, Search, ArrowUpCircle, TrendingUp,
    Printer, CheckCircle, Clock, XCircle, Edit2, AlertTriangle,
    ShieldCheck, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWallets, useTopUp, useTransactions, usePendingTopupRequests, useApproveTopup, useRejectTopup, getWalletByUserId } from "@/hooks/owner/useWallet";
import { useMembers } from "@/hooks/owner/useMembers";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import type { Wallet as WalletType, User, TopupRequest } from "@/types/firestore";
import { fetchClubAndPrint, generateTxnId } from "@/utils/printReceipt";
import { buildTopUpReceipt } from "@/utils/receiptBuilder";
import AutoPrintCountdown from "@/components/AutoPrintCountdown";

const GREEN = "#2d9653";

type SortOption = "lowest" | "highest" | "name";
type WalletWithMember = (WalletType & { id: string }) & { member?: User };
type TabId = "topup" | "pending" | "history";

export default function WalletPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const { data: wallets, isLoading } = useWallets(clubId);
    const { data: members } = useMembers(clubId);
    const topUp = useTopUp();
    const approve = useApproveTopup();
    const reject = useRejectTopup();
    const { requests: pending, count: pendingCount, loading: pendingLoading } = usePendingTopupRequests(clubId);
    const { data: allTransactions, isLoading: txLoading } = useTransactions(clubId);
    const { toast } = useToast();

    // ─── Tab ────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<TabId>("topup");

    // ─── Top-up tab state ───────────────────────────────
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<SortOption>("lowest");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selected, setSelected] = useState<WalletWithMember | null>(null);
    const [amount, setAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("Cash");
    const [reference, setReference] = useState("");
    const [notes, setNotes] = useState("");
    const [successReceipt, setSuccessReceipt] = useState<any | null>(null);
    const [showAutoPrint, setShowAutoPrint] = useState(false);

    // ─── History tab state ────────────────────────────────
    const [historySearch, setHistorySearch] = useState("");
    const [historyFilter, setHistoryFilter] = useState<"all" | "topup" | "plan_purchase" | "debit">("all");

    // ─── Pending tab state ──────────────────────────────
    const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});
    const [rejectDialog, setRejectDialog] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    // ─── Derived data ───────────────────────────────────
    const memberMap = useMemo(() => {
        const m = new Map<string, User>();
        (members ?? []).forEach((u) => m.set(u.id, u));
        return m;
    }, [members]);

    const walletsWithMembers = useMemo((): WalletWithMember[] => {
        if (!wallets) return [];
        return wallets.map((w) => ({ ...w, member: memberMap.get(w.userId) }));
    }, [wallets, memberMap]);

    const filtered = useMemo(() => {
        let list = walletsWithMembers;
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((w) =>
                w.member?.name?.toLowerCase().includes(q) ||
                w.member?.phone?.includes(q)
            );
        }
        return [...list].sort((a, b) => {
            if (sort === "lowest") return a.balance - b.balance;
            if (sort === "highest") return b.balance - a.balance;
            return (a.member?.name ?? "").localeCompare(b.member?.name ?? "");
        });
    }, [walletsWithMembers, search, sort]);

    const filteredTransactions = useMemo(() => {
        let list = allTransactions ?? [];
        if (historySearch.trim()) {
            const q = historySearch.toLowerCase();
            list = list.filter((tx) => {
                const member = memberMap.get(tx.userId);
                return (member?.name ?? "").toLowerCase().includes(q) ||
                    (tx.description ?? "").toLowerCase().includes(q) ||
                    (tx.approvedBy ?? "").toLowerCase().includes(q);
            });
        }
        if (historyFilter === "topup") list = list.filter((tx) => tx.reason === "topup");
        else if (historyFilter === "plan_purchase") list = list.filter((tx) => tx.reason === "plan_purchase");
        else if (historyFilter === "debit") list = list.filter((tx) => tx.type === "debit");
        return list;
    }, [allTransactions, historySearch, historyFilter, memberMap]);

    const totalBalance = useMemo(() => (wallets ?? []).reduce((s, w) => s + w.balance, 0), [wallets]);
    const lowBalanceCount = useMemo(() => (wallets ?? []).filter((w) => w.balance < 100).length, [wallets]);

    // ─── Top-up handlers ────────────────────────────────
    const openTopUp = (w?: WalletWithMember) => {
        setSelected(w ?? null);
        setAmount("");
        setPaymentMethod("Cash");
        setReference("");
        setNotes("");
        setSuccessReceipt(null);
        setShowAutoPrint(false);
        setDialogOpen(true);
    };

    const handleTopUp = async () => {
        const amt = parseFloat(amount);
        if (!selected || isNaN(amt) || amt <= 0 || !clubId) return;
        try {
            const balanceBefore = selected.balance;
            await topUp.mutateAsync({
                memberId: selected.userId, walletDocId: selected.id,
                clubId, amount: amt, paymentMethod,
                reference: reference || undefined, notes: notes || undefined,
                currentBalance: balanceBefore,
            });
            const rd = {
                memberName: selected.member?.name ?? "Member",
                memberId: (selected.member as any)?.memberId ?? "",
                phone: selected.member?.phone ?? "",
                amount: amt, paymentMethod, reference: reference || undefined,
                balanceBefore, balanceAfter: balanceBefore + amt,
                clubName: club?.name ?? "Magic Nutrition Club",
                clubPhone: club?.phone ?? (club as any)?.ownerPhone ?? "",
                clubEmail: (club as any)?.ownerEmail ?? "",
                clubAddress: (club as any)?.address ?? "",
                clubGst: (club as any)?.gstNumber ?? "",
                transactionId: generateTxnId(),
                date: new Date(),
            };
            setSuccessReceipt(rd);
            setShowAutoPrint(true);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const handlePrint = async () => {
        if (!successReceipt || !clubId) return;
        await fetchClubAndPrint(clubId, (club) =>
            buildTopUpReceipt({
                club,
                memberName:      successReceipt.memberName,
                memberId:        successReceipt.memberId,
                phone:           successReceipt.phone,
                amount:          successReceipt.amount,
                previousBalance: successReceipt.balanceBefore,
                newBalance:      successReceipt.balanceAfter,
                paymentMethod:   successReceipt.paymentMethod,
                transactionId:   successReceipt.transactionId,
                timestamp:       successReceipt.date,
            })
        );
        setShowAutoPrint(false);
    };

    const closeDialog = () => { setDialogOpen(false); setSuccessReceipt(null); setShowAutoPrint(false); };

    const currentBalance = selected?.balance ?? 0;
    const amountNum = parseFloat(amount) || 0;
    const newBalance = currentBalance + amountNum;

    // ─── Pending request handlers ───────────────────────
    const handleApprove = async (req: TopupRequest) => {
        const editedStr = editedAmounts[req.id];
        const amt = editedStr !== undefined ? parseFloat(editedStr) : req.requestedAmount;
        if (isNaN(amt) || amt <= 0) {
            toast({ title: "Invalid amount", variant: "destructive" });
            return;
        }
        try {
            const w = await getWalletByUserId(clubId!, req.memberId);
            if (!w) { toast({ title: "Wallet not found", variant: "destructive" }); return; }
            const result = await approve.mutateAsync({
                request: req, approvedAmount: amt,
                walletDocId: w.id, currentBalance: w.balance,
            });
            toast({ title: "Approved!", description: `${req.memberName} +₹${result.approvedAmount}` });
            setEditedAmounts((prev) => { const n = { ...prev }; delete n[req.id]; return n; });

            // Auto-print receipt for approved top-up
            const rd = {
                memberName: req.memberName ?? "Member",
                memberId: req.memberId,
                phone: (req as any).memberPhone ?? "",
                amount: result.approvedAmount,
                paymentMethod: req.paymentMethod ?? "Cash",
                balanceBefore: w.balance,
                balanceAfter: w.balance + result.approvedAmount,
                clubName: club?.name ?? "Magic Nutrition Club",
                clubPhone: club?.phone ?? (club as any)?.ownerPhone ?? "",
                clubEmail: (club as any)?.ownerEmail ?? "",
                clubAddress: (club as any)?.address ?? "",
                clubGst: (club as any)?.gstNumber ?? "",
                transactionId: generateTxnId(),
                date: new Date(),
            };
            setSuccessReceipt(rd);
            setShowAutoPrint(true);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const handleReject = async () => {
        if (!rejectDialog) return;
        try {
            await reject.mutateAsync({ clubId: clubId!, requestId: rejectDialog, reason: rejectReason });
            toast({ title: "Rejected" });
            setRejectDialog(null);
            setRejectReason("");
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const tabs: { id: TabId; label: string; badge?: number }[] = [
        { id: "topup", label: "Top-up Member" },
        { id: "pending", label: "Pending Requests", badge: pendingCount },
        { id: "history", label: "Transactions" },
    ];

    return (
        <div className="space-y-6 p-5" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <h1 className="text-2xl font-bold" style={{ color: GREEN }}>Wallet Management</h1>

            {/* Stats */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl bg-card p-5 shadow-sm border">
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <WalletIcon className="w-4 h-4" /> Total Club Wallet
                        </div>
                        <p className="text-2xl font-bold mt-1" style={{ color: GREEN }}>
                            ₹{totalBalance.toLocaleString()}
                        </p>
                    </div>
                    <div className="rounded-2xl bg-card p-5 shadow-sm border">
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <TrendingUp className="w-4 h-4" /> Members
                        </div>
                        <p className="text-2xl font-bold mt-1">{wallets?.length ?? 0}</p>
                    </div>
                    <div className="rounded-2xl bg-card p-5 shadow-sm border">
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            Low balance (&lt; ₹100)
                        </div>
                        <p className="text-2xl font-bold mt-1 text-amber-600">{lowBalanceCount}</p>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-muted rounded-xl p-1">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-bold transition-all"
                        style={activeTab === t.id
                            ? { backgroundColor: GREEN, color: "#fff" }
                            : { backgroundColor: "transparent", color: "#6b7280" }}
                    >
                        {t.label}
                        {!!t.badge && t.badge > 0 && (
                            <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-black"
                                style={activeTab === t.id
                                    ? { backgroundColor: "rgba(255,255,255,0.25)", color: "#fff" }
                                    : { backgroundColor: "#ef4444", color: "#fff" }}>
                                {t.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ══════════════ TAB 1: Direct Top-up ══════════════ */}
            {activeTab === "topup" && (
                <>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl" />
                        </div>
                        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                            <SelectTrigger className="w-full sm:w-[180px] rounded-xl"><SelectValue placeholder="Sort by" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="lowest">Lowest balance</SelectItem>
                                <SelectItem value="highest">Highest balance</SelectItem>
                                <SelectItem value="name">Name</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12 rounded-2xl bg-card p-5">No members yet</p>
                    ) : (
                        <div className="space-y-3">
                            {filtered.map((w) => (
                                <div key={w.id} className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-card p-5 shadow-sm border">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <Avatar className="h-10 w-10 shrink-0">
                                            {w.member?.photo ? <AvatarImage src={w.member.photo} /> : null}
                                            <AvatarFallback className="font-bold text-sm" style={{ backgroundColor: "#e8f5e9", color: GREEN }}>
                                                {(w.member?.name ?? "?")[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="font-semibold truncate">{w.member?.name ?? "Unknown"}</p>
                                            <p className="text-sm text-muted-foreground">{w.member?.phone ?? "-"}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 sm:ml-auto">
                                        <div className="text-right">
                                            <p className="text-xl font-bold" style={{ color: GREEN }}>₹{w.balance.toLocaleString()}</p>
                                            {w.balance < 100 && <Badge variant="destructive" className="text-xs mt-1">Low balance</Badge>}
                                        </div>
                                        <Button size="sm" onClick={() => openTopUp(w)} className="gap-1 shrink-0" style={{ backgroundColor: GREEN }}>
                                            <ArrowUpCircle className="w-4 h-4" /> Top Up
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ══════════════ TAB 2: Pending Requests ══════════════ */}
            {activeTab === "pending" && (
                <div className="space-y-3">
                    {pendingLoading ? (
                        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
                    ) : pending.length === 0 ? (
                        <div className="text-center py-16 bg-card rounded-2xl border">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-50 flex items-center justify-center">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                            </div>
                            <p className="font-bold text-foreground">All caught up!</p>
                            <p className="text-sm text-muted-foreground mt-1">No pending top-up requests</p>
                        </div>
                    ) : (
                        pending.map((req) => {
                            const editedAmt = editedAmounts[req.id];
                            const displayAmt = editedAmt !== undefined ? editedAmt : req.requestedAmount.toString();
                            const timeAgo = req.requestedAt?.toDate ? getTimeAgo(req.requestedAt.toDate()) : "";
                            return (
                                <div key={req.id} className="rounded-2xl bg-card border shadow-sm p-5 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <Avatar className="h-10 w-10 shrink-0">
                                            {req.memberPhoto ? <AvatarImage src={req.memberPhoto} /> : null}
                                            <AvatarFallback className="font-bold text-sm" style={{ backgroundColor: "#e8f5e9", color: GREEN }}>
                                                {(req.memberName ?? "?")[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold truncate">{req.memberName}</p>
                                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                                                    <Clock className="w-3 h-3 mr-1" /> Pending
                                                </Badge>
                                                {req.paymentMethod && (
                                                    <span className="text-xs text-muted-foreground">{req.paymentMethod}</span>
                                                )}
                                                {req.reference && (
                                                    <span className="text-xs text-muted-foreground">Ref: {req.reference}</span>
                                                )}
                                            </div>
                                            {timeAgo && <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>}
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 border-t">
                                        <div className="flex items-center gap-2 flex-1">
                                            <span className="text-sm text-muted-foreground whitespace-nowrap">Amount ₹</span>
                                            <div className="relative flex-1 max-w-[140px]">
                                                <Input
                                                    type="number"
                                                    value={displayAmt}
                                                    onChange={(e) =>
                                                        setEditedAmounts((prev) => ({ ...prev, [req.id]: e.target.value }))}
                                                    className="rounded-lg text-lg font-bold pr-8"
                                                    min={1}
                                                />
                                                {editedAmt !== undefined && editedAmt !== req.requestedAmount.toString() && (
                                                    <Edit2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-amber-500" />
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                className="gap-1 flex-1 sm:flex-none"
                                                style={{ backgroundColor: GREEN }}
                                                disabled={approve.isPending}
                                                onClick={() => handleApprove(req)}
                                            >
                                                <CheckCircle className="w-4 h-4" />
                                                {approve.isPending ? "…" : "Approve"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="gap-1 flex-1 sm:flex-none text-red-600 border-red-200 hover:bg-red-50"
                                                disabled={reject.isPending}
                                                onClick={() => { setRejectDialog(req.id); setRejectReason(""); }}
                                            >
                                                <XCircle className="w-4 h-4" /> Reject
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* ══════════════ TAB 3: Transaction History ══════════════ */}
            {activeTab === "history" && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input placeholder="Search by member, description, verifier…" value={historySearch}
                                onChange={(e) => setHistorySearch(e.target.value)} className="pl-9 rounded-xl" />
                        </div>
                        <Select value={historyFilter} onValueChange={(v) => setHistoryFilter(v as any)}>
                            <SelectTrigger className="w-full sm:w-[180px] rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Transactions</SelectItem>
                                <SelectItem value="topup">Top-ups Only</SelectItem>
                                <SelectItem value="plan_purchase">Plan Purchases</SelectItem>
                                <SelectItem value="debit">Debits Only</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {txLoading ? (
                        <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
                    ) : filteredTransactions.length === 0 ? (
                        <div className="text-center py-16 bg-card rounded-2xl border">
                            <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                            <p className="font-bold text-foreground">No transactions found</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredTransactions.map((tx) => {
                                const member = memberMap.get(tx.userId);
                                const isCredit = tx.type === "credit";
                                const timestamp = tx.createdAt?.toDate?.()
                                    ? tx.createdAt.toDate().toLocaleString("en-IN", {
                                        day: "2-digit", month: "short", year: "numeric",
                                        hour: "2-digit", minute: "2-digit",
                                    }) : "";
                                const reasonLabel = tx.reason === "plan_purchase" ? "Plan Purchase"
                                    : tx.reason === "topup" ? "Wallet Top-up"
                                    : tx.reason === "shake_order" ? "Shake Order"
                                    : tx.reason === "membership" ? "Membership"
                                    : tx.reason === "refund" ? "Refund"
                                    : tx.reason;
                                return (
                                    <div key={tx.id} className="rounded-2xl bg-card border shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <Avatar className="h-9 w-9 shrink-0">
                                                {member?.photo ? <AvatarImage src={member.photo} /> : null}
                                                <AvatarFallback className="font-bold text-xs" style={{ backgroundColor: "#e8f5e9", color: GREEN }}>
                                                    {(member?.name ?? "?")[0]}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-sm truncate">{member?.name ?? "Unknown"}</p>
                                                <p className="text-xs text-muted-foreground truncate">{tx.description || reasonLabel}</p>
                                                <p className="text-[11px] text-muted-foreground">{timestamp}</p>
                                                {tx.approvedBy && (
                                                    <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: "#2563eb" }}>
                                                        <ShieldCheck className="w-3 h-3" /> Verified by: {tx.approvedBy}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`text-base font-bold ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
                                                {isCredit ? "+" : "-"}₹{Math.abs(tx.amount).toLocaleString()}
                                            </p>
                                            <Badge variant="outline" className="text-[10px] mt-1">
                                                {reasonLabel}
                                            </Badge>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Auto-print countdown after top-up */}
            {showAutoPrint && successReceipt && (
                <AutoPrintCountdown
                    onPrint={handlePrint}
                    onCancel={() => setShowAutoPrint(false)}
                />
            )}

            {/* Top-up Dialog */}
            <Dialog open={dialogOpen} onOpenChange={closeDialog}>
                <DialogContent className="rounded-2xl max-w-md">
                    <DialogHeader>
                        <DialogTitle>{successReceipt ? "Top Up Successful" : "Top Up Wallet"}</DialogTitle>
                    </DialogHeader>
                    {successReceipt ? (
                        <div className="space-y-4 pt-2">
                            <div className="flex flex-col items-center gap-2 py-4">
                                <CheckCircle className="w-12 h-12 text-emerald-500" />
                                <p className="text-lg font-bold text-emerald-700">₹{successReceipt.amount.toFixed(2)} Added!</p>
                                <p className="text-sm text-muted-foreground text-center">
                                    {successReceipt.memberName} · {successReceipt.paymentMethod}
                                </p>
                                <div className="text-sm text-center space-y-0.5 mt-1">
                                    <p className="text-muted-foreground">
                                        Bal: ₹{successReceipt.balanceBefore} → <span className="font-bold text-emerald-700">₹{successReceipt.balanceAfter}</span>
                                    </p>
                                </div>
                            </div>
                            <Button className="w-full rounded-xl gap-2" style={{ backgroundColor: GREEN }} onClick={handlePrint}>
                                <Printer className="w-4 h-4" /> Print Receipt
                            </Button>
                            <Button variant="outline" className="w-full rounded-xl" onClick={closeDialog}>Close</Button>
                        </div>
                    ) : (
                        <div className="space-y-4 pt-2">
                            {selected ? (
                                <div>
                                    <Label>Member</Label>
                                    <p className="font-medium mt-1">{selected.member?.name ?? "Unknown"}</p>
                                </div>
                            ) : (
                                <div>
                                    <Label>Select member</Label>
                                    <Select value={selected?.userId ?? ""} onValueChange={(v) => {
                                        const w = walletsWithMembers.find((x) => x.userId === v);
                                        setSelected(w ?? null);
                                    }}>
                                        <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Choose member" /></SelectTrigger>
                                        <SelectContent>
                                            {walletsWithMembers.map((w) => (
                                                <SelectItem key={w.id} value={w.userId}>{w.member?.name ?? w.userId}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div>
                                <Label>Amount (₹) *</Label>
                                <Input type="number" min={1} placeholder="Enter amount" value={amount}
                                    onChange={(e) => setAmount(e.target.value)} className="rounded-xl mt-1" />
                            </div>
                            <div>
                                <Label>Payment method</Label>
                                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                    <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Cash">Cash</SelectItem>
                                        <SelectItem value="UPI">UPI</SelectItem>
                                        <SelectItem value="Card">Card</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Reference number (optional)</Label>
                                <Input placeholder="e.g. UPI ref" value={reference}
                                    onChange={(e) => setReference(e.target.value)} className="rounded-xl mt-1" />
                            </div>
                            <div>
                                <Label>Notes (optional)</Label>
                                <Input placeholder="Any notes" value={notes}
                                    onChange={(e) => setNotes(e.target.value)} className="rounded-xl mt-1" />
                            </div>
                            {selected && (
                                <div className="flex justify-between text-sm py-2 border-t">
                                    <span className="text-muted-foreground">Current balance:</span>
                                    <span className="font-semibold">₹{currentBalance.toLocaleString()}</span>
                                </div>
                            )}
                            {selected && amount && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">New balance:</span>
                                    <span className="font-bold" style={{ color: GREEN }}>₹{newBalance.toLocaleString()}</span>
                                </div>
                            )}
                            <Button className="w-full rounded-xl" style={{ backgroundColor: GREEN }}
                                onClick={handleTopUp}
                                disabled={topUp.isPending || !selected || !amount || parseFloat(amount) <= 0}>
                                {topUp.isPending ? "Processing..." : "Confirm Top Up"}
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Reject Confirmation Dialog */}
            <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
                <DialogContent className="rounded-2xl max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-500" /> Reject Request
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div>
                            <Label>Reason for rejection (optional)</Label>
                            <Input placeholder="e.g. payment not received" value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)} className="rounded-xl mt-1" />
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setRejectDialog(null)}>
                                Cancel
                            </Button>
                            <Button className="flex-1 rounded-xl bg-red-600 hover:bg-red-700" onClick={handleReject}
                                disabled={reject.isPending}>
                                {reject.isPending ? "Rejecting..." : "Reject"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function getTimeAgo(date: Date): string {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)} days ago`;
}
