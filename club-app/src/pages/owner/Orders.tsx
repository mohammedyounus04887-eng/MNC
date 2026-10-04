import { useState, useMemo } from "react";
import { ShoppingCart, Search, User, CheckCircle2, Clock, XCircle, AlertTriangle, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useTodayOrders, usePlaceOrder, useUpdateOrderStatus, useCancelOrder } from "@/hooks/owner/useOrders";
import { useAvailableTodayItems } from "@/hooks/owner/useMenu";
import { useMembers } from "@/hooks/owner/useMembers";
import { useWallets } from "@/hooks/owner/useWallet";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Order } from "@/types/firestore";

const STATUS_COLORS: Record<Order["status"], string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    preparing: "bg-blue-100 text-blue-800 border-blue-200",
    served: "bg-green-100 text-green-800 border-green-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
    rejected: "bg-red-100 text-red-800 border-red-200",
};

export default function Orders() {
    const { club } = useClubContext();
    const { toast } = useToast();

    const { data: todayOrders = [], isLoading: ordersLoading } = useTodayOrders(club?.id ?? null);
    const { data: members = [] } = useMembers(club?.id ?? null);
    const { data: menuItems = [] } = useAvailableTodayItems(club?.id ?? null);
    const { data: wallets = [] } = useWallets(club?.id ?? null);

    const placeOrder = usePlaceOrder();
    const updateStatus = useUpdateOrderStatus();
    const cancelOrder = useCancelOrder();

    // Stats
    const activeOrders = todayOrders.filter(o => o.status !== "cancelled");
    const todayRevenue = activeOrders.reduce((s, o) => s + o.totalCost, 0);
    const pendingCount = activeOrders.filter(o => o.status === "pending").length;
    const preparingCount = activeOrders.filter(o => o.status === "preparing").length;
    const servedCount = activeOrders.filter(o => o.status === "served").length;

    const handleStatusUpdate = (orderId: string, status: Order["status"]) => {
        updateStatus.mutate(
            { clubId: club?.id ?? "", orderId, status },
            {
                onSuccess: () => toast({ title: "Status updated" }),
                onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
            }
        );
    };

    return (
        <div className="space-y-6 p-5 max-w-5xl mx-auto" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <h1 className="text-2xl font-bold" style={{ color: "#2d9653" }}>Orders & Kitchen</h1>
            </div>

            <Tabs defaultValue="new-order" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-md h-12 rounded-xl mb-6">
                    <TabsTrigger value="new-order" className="rounded-lg h-10 font-bold text-sm">New Order</TabsTrigger>
                    <TabsTrigger value="today-orders" className="rounded-lg h-10 font-bold text-sm">
                        Today's Orders
                        {pendingCount > 0 && (
                            <Badge variant="destructive" className="ml-2 w-5 h-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                {pendingCount}
                            </Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="new-order">
                    <NewOrderView
                        clubId={club?.id ?? ""}
                        members={members}
                        menuItems={menuItems}
                        wallets={wallets}
                        placeOrder={placeOrder}
                        toast={toast}
                    />
                </TabsContent>

                <TabsContent value="today-orders">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-card rounded-2xl p-4 border shadow-sm">
                                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Revenue</p>
                                <p className="text-xl font-black mt-1" style={{ color: "#2d9653" }}>₹{todayRevenue}</p>
                            </div>
                            <div className="bg-card rounded-2xl p-4 border shadow-sm flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Pending</p>
                                    <p className="text-xl font-black mt-1 text-yellow-600">{pendingCount}</p>
                                </div>
                                <Clock className="w-6 h-6 text-yellow-200" />
                            </div>
                            <div className="bg-card rounded-2xl p-4 border shadow-sm flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Preparing</p>
                                    <p className="text-xl font-black mt-1 text-blue-600">{preparingCount}</p>
                                </div>
                                <ShoppingCart className="w-6 h-6 text-blue-200" />
                            </div>
                            <div className="bg-card rounded-2xl p-4 border shadow-sm flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Served</p>
                                    <p className="text-xl font-black mt-1 text-green-600">{servedCount}</p>
                                </div>
                                <CheckCircle2 className="w-6 h-6 text-green-200" />
                            </div>
                        </div>

                        <div className="space-y-3">
                            {ordersLoading ? (
                                [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
                            ) : todayOrders.length > 0 ? (
                                todayOrders.map((order) => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        clubId={club?.id ?? ""}
                                        onStatusUpdate={handleStatusUpdate}
                                        cancelOrder={cancelOrder}
                                        toast={toast}
                                        isUpdating={updateStatus.isPending}
                                    />
                                ))
                            ) : (
                                <div className="bg-card rounded-2xl p-12 text-center text-muted-foreground border border-dashed">
                                    <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                    <p>No orders placed today.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function getCategoryEmoji(cat: string) {
    if (cat === "shake") return "🥤";
    if (cat === "supplement") return "💊";
    if (cat === "snack") return "🍿";
    return "🍽️";
}

function NewOrderView({
    clubId,
    members,
    menuItems,
    wallets,
    placeOrder,
    toast,
}: {
    clubId: string;
    members: any[];
    menuItems: any[];
    wallets: any[];
    placeOrder: any;
    toast: any;
}) {
    const [memberSearch, setMemberSearch] = useState("");
    const [selectedMember, setSelectedMember] = useState<any | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [notes, setNotes] = useState("");

    const filteredMembers = useMemo(() => {
        if (!memberSearch.trim()) return members.slice(0, 10);
        const q = memberSearch.toLowerCase();
        return members.filter((m) => m.name.toLowerCase().includes(q) || (m.phone && m.phone.includes(q))).slice(0, 10);
    }, [members, memberSearch]);

    const filteredItems = useMemo(() => {
        if (categoryFilter === "all") return menuItems;
        return menuItems.filter((i) => i.category === categoryFilter);
    }, [menuItems, categoryFilter]);

    const wallet = selectedMember ? wallets.find((w: any) => w.userId === selectedMember.id) : null;
    const balance = wallet?.balance ?? 0;

    const cartItems = useMemo(() => {
        return menuItems
            .filter((m) => (quantities[m.id] ?? 0) > 0)
            .map((m) => ({
                productId: m.id,
                productName: m.name,
                quantity: quantities[m.id] ?? 0,
                pricePerUnit: m.price,
                notes: "",
            }));
    }, [menuItems, quantities]);

    const total = cartItems.reduce((s, i) => s + i.quantity * i.pricePerUnit, 0);
    const remainingBalance = balance - total;
    const isInsufficient = remainingBalance < 0;

    const reset = () => {
        setMemberSearch("");
        setSelectedMember(null);
        setQuantities({});
        setNotes("");
    };

    const handleSubmit = () => {
        if (!selectedMember || cartItems.length === 0 || !wallet) {
            toast({ title: "Select member and add items", variant: "destructive" });
            return;
        }
        if (isInsufficient) {
            toast({ title: "Insufficient balance", description: "Top-up required before placing this order.", variant: "destructive" });
            return;
        }

        placeOrder.mutate(
            {
                clubId,
                memberId: selectedMember.id,
                memberName: selectedMember.name,
                memberPhoto: selectedMember.photo ?? "",
                items: cartItems,
                total,
                notes: notes.trim(),
                walletDocId: wallet.id,
                currentBalance: balance,
            },
            {
                onSuccess: () => {
                    toast({ title: "Order placed successfully!", description: "Has been sent to kitchen." });
                    reset();
                },
                onError: (e: Error) => toast({ title: "Order Failed", description: e.message, variant: "destructive" }),
            }
        );
    };

    if (!selectedMember) {
        return (
            <div className="bg-card rounded-3xl border p-6 shadow-sm min-h-[400px]">
                <h2 className="text-lg font-bold mb-4">Step 1: Select Member</h2>
                <div className="relative mb-6">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        placeholder="Search member by name or phone..."
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        className="pl-12 h-14 rounded-2xl text-lg bg-muted border-slate-200"
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredMembers.map((m) => {
                        const mWallet = wallets.find((w: any) => w.userId === m.id);
                        const mBal = mWallet?.balance ?? 0;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                className="flex items-center gap-4 p-4 rounded-2xl border hover:border-green-500 hover:bg-green-50 transition-all text-left"
                                onClick={() => setSelectedMember(m)}
                            >
                                <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0">
                                    {m.photo ? <img src={m.photo} alt={m.name} className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-slate-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-foreground truncate">{m.name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Badge variant="outline" className="text-[10px]">{(m as any).shakeCredits ?? 0} credits</Badge>
                                        <span className={`text-xs font-bold ${mBal < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>₹{mBal}</span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                    {filteredMembers.length === 0 && <p className="text-sm text-muted-foreground py-4 col-span-full text-center">No members found.</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Area - Menu Selection */}
            <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-3xl border shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0">
                            {selectedMember.photo ? <img src={selectedMember.photo} alt={selectedMember.name} className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-slate-400" />}
                        </div>
                        <div>
                            <p className="font-bold text-lg">{selectedMember.name}</p>
                            <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setSelectedMember(null)}>
                                Change member
                            </Button>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Wallet Balance</p>
                        <p className="text-2xl font-black text-foreground">₹{balance}</p>
                    </div>
                </div>

                <div className="bg-card rounded-3xl border p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold">Step 2: Menu Items</h2>
                        <div className="flex gap-2 p-1 bg-muted rounded-xl overflow-x-auto no-scrollbar">
                            {[{ id: 'all', label: 'All' }, { id: 'shake', label: 'Shakes' }, { id: 'supplement', label: 'Supplements' }, { id: 'snack', label: 'Snacks' }].map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategoryFilter(cat.id)}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${categoryFilter === cat.id ? 'bg-card text-green-700 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {menuItems.length === 0 ? (
                        <div className="py-12 text-center border-2 border-dashed rounded-2xl">
                            <UtensilsCrossed className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                            <p className="text-muted-foreground font-medium">No items available today.</p>
                            <p className="text-xs text-slate-400 mt-1">Go to Menu Management to mark items as available.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filteredItems.map(item => {
                                const q = quantities[item.id] ?? 0;
                                const isSelected = q > 0;

                                return (
                                    <div
                                        key={item.id}
                                        className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${isSelected ? 'border-green-500 bg-green-50/30 shadow-sm' : 'border-slate-100'}`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 overflow-hidden" style={{ backgroundColor: "#e8f5e9", color: "#2d9653" }}>
                                                {item.photo ? <img src={item.photo} alt="" className="w-full h-full object-cover" /> : getCategoryEmoji(item.category)}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-sm truncate">{item.name}</p>
                                                <p className="text-xs font-bold text-muted-foreground mt-1">₹{item.price}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-600" onClick={() => setQuantities(prev => ({ ...prev, [item.id]: Math.max(0, q - 1) }))}>
                                                −
                                            </Button>
                                            <span className="w-6 text-center font-bold text-sm">{q}</span>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-green-600" onClick={() => setQuantities(prev => ({ ...prev, [item.id]: q + 1 }))}>
                                                +
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Area - Cart & Checkout */}
            <div className="bg-card rounded-3xl border shadow-sm flex flex-col h-[calc(100vh-140px)] sticky top-6">
                <div className="p-6 border-b">
                    <h2 className="text-lg font-bold">Step 3: Summary</h2>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {cartItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <ShoppingCart className="w-12 h-12 mb-3 opacity-20" />
                            <p className="text-sm font-medium">Cart is empty</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {cartItems.map(item => (
                                <div key={item.productId} className="flex justify-between text-sm">
                                    <div className="flex gap-2 text-foreground">
                                        <span className="font-bold text-green-600">{item.quantity}x</span>
                                        <span className="font-medium">{item.productName}</span>
                                    </div>
                                    <span className="font-bold text-foreground">₹{item.quantity * item.pricePerUnit}</span>
                                </div>
                            ))}

                            <div className="pt-4 mt-4 border-t border-dashed">
                                <Label className="text-xs text-muted-foreground mb-2 block">Order Notes (Optional)</Label>
                                <Textarea
                                    className="resize-none h-20 text-sm bg-muted"
                                    placeholder="e.g. Less ice, extra scoop..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t bg-muted rounded-b-3xl">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-muted-foreground font-medium">Total Amount</span>
                        <span className="text-2xl font-black text-foreground">₹{total}</span>
                    </div>

                    {total > 0 && (
                        <div className={`p-4 rounded-xl flex items-start gap-3 mb-6 ${isInsufficient ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                            {isInsufficient ? <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />}
                            <div>
                                <p className={`text-sm font-bold ${isInsufficient ? 'text-red-800' : 'text-green-800'}`}>
                                    {isInsufficient ? 'Insufficient Balance!' : 'Balance Sufficient'}
                                </p>
                                <p className={`text-xs mt-1 ${isInsufficient ? 'text-red-600' : 'text-green-600'}`}>
                                    New balance after order: ₹{remainingBalance}
                                </p>
                            </div>
                        </div>
                    )}

                    <Button
                        size="lg"
                        className="w-full h-14 text-lg font-bold shadow-green-600/20 shadow-lg transition-transform active:scale-95"
                        style={{ backgroundColor: total > 0 && !isInsufficient && !placeOrder.isPending ? "#2d9653" : undefined }}
                        onClick={handleSubmit}
                        disabled={placeOrder.isPending || total === 0 || isInsufficient}
                    >
                        {placeOrder.isPending ? "Placing..." : "Place Order"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function OrderCard({
    order,
    clubId,
    onStatusUpdate,
    cancelOrder,
    toast,
    isUpdating,
}: {
    order: Order;
    clubId: string;
    onStatusUpdate: (id: string, status: Order["status"]) => void;
    cancelOrder: any;
    toast: any;
    isUpdating: boolean;
}) {
    const [cancelOpen, setCancelOpen] = useState(false);
    const { data: wallets } = useWallets(clubId); // To lookup wallet ID for refund

    // Safety check - we shouldn't really fetch all wallets here per card, but since we are owner parsing today's, the cache is active.
    const wallet = wallets?.find(w => w.userId === order.memberId);

    const itemsSummary = order.items.map((i) => `${i.quantity}x ${i.productName}`).join(", ");
    const time = order.createdAt?.toDate?.()?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) ?? "";

    const handleCancel = () => {
        if (!wallet) {
            toast({ title: "Error", description: "Could not locate member wallet for refund.", variant: "destructive" });
            return;
        }
        cancelOrder.mutate({
            orderId: order.id,
            memberId: order.memberId,
            clubId: clubId,
            refundAmount: order.totalCost,
            walletDocId: wallet.id,
            currentBalance: wallet.balance
        }, {
            onSuccess: () => {
                toast({ title: "Order Cancelled", description: `Refunded ₹${order.totalCost} to ${order.memberName}'s wallet.` });
                setCancelOpen(false);
            },
            onError: (e: Error) => toast({ title: "Error cancelling", description: e.message, variant: "destructive" })
        })
    };

    return (
        <>
            <div className={`rounded-2xl p-5 border shadow-sm transition-all ${order.status === 'cancelled' ? 'bg-muted opacity-60 grayscale' : 'bg-card'}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted flex items-center justify-center shrink-0 border">
                            {order.memberPhoto ? <img src={order.memberPhoto} alt={order.memberName} className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-slate-400" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <p className="font-bold text-lg">{order.memberName}</p>
                                <span className="text-xs font-bold text-slate-400">#{order.id.slice(-5).toUpperCase()}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 font-medium">{itemsSummary}</p>
                            {order.notes && (
                                <p className="text-xs text-orange-600 font-bold mt-1 bg-orange-50 inline-block px-2 py-1 rounded">Note: {order.notes}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-3 min-w-[120px]">
                        <div className="text-right">
                            <p className="text-lg font-black text-foreground">₹{order.totalCost}</p>
                            <p className="text-xs text-slate-400 font-bold flex items-center justify-end gap-1 mt-0.5"><Clock className="w-3 h-3" /> {time}</p>
                        </div>

                        <Badge className={`${STATUS_COLORS[order.status]} shadow-none`}>{order.status.toUpperCase()}</Badge>
                    </div>
                </div>

                {order.status !== 'cancelled' && order.status !== 'served' && (
                    <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-dashed">
                        {order.status === "pending" && (
                            <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setCancelOpen(true)}>
                                <XCircle className="w-4 h-4 mr-1" /> Cancel & Refund
                            </Button>
                        )}
                        {order.status === "pending" && (
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" disabled={isUpdating} onClick={() => onStatusUpdate(order.id, "preparing")}>
                                Start Preparing
                            </Button>
                        )}
                        {order.status === "preparing" && (
                            <Button size="sm" style={{ backgroundColor: "#2d9653" }} disabled={isUpdating} onClick={() => onStatusUpdate(order.id, "served")}>
                                Mark Served
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cancel Order?</DialogTitle>
                        <DialogDescription>
                            This will cancel Order #{order.id.slice(-5).toUpperCase()} and immediately refund <strong>₹{order.totalCost}</strong> to {order.memberName}'s wallet.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setCancelOpen(false)}>Nevermind</Button>
                        <Button variant="destructive" onClick={handleCancel} disabled={cancelOrder.isPending}>
                            {cancelOrder.isPending ? "Refunding..." : "Confirm Cancel & Refund"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
