import { useState, useMemo } from "react";
import { Search, User, ShoppingCart, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { useAllClubProducts, usePlaceOrder } from "@/hooks/useOrders";
import ProductCard from "@/components/orders/ProductCard";
import type { Product, User as UserType } from "@/types/firestore";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface CartItem { product: Product; quantity: number; }

export default function OrderEntryPage() {
    const { toast } = useToast();
    const { firebaseUser } = useAuth();
    const { club } = useClubContext();
    const { data: members, isLoading: membersLoading } = useClubMembers();
    const { data: products, isLoading: productsLoading } = useAllClubProducts();
    const placeOrder = usePlaceOrder();

    const currencyName = club?.currencyName || "Coins";
    const [step, setStep] = useState(1);
    const [search, setSearch] = useState("");
    const [selectedMember, setSelectedMember] = useState<UserType | null>(null);
    const [memberBalance, setMemberBalance] = useState<number>(0);
    const [cart, setCart] = useState<Record<string, CartItem>>({});
    const [orderPlaced, setOrderPlaced] = useState(false);

    // Load member balance
    const selectMember = async (member: UserType) => {
        setSelectedMember(member);
        if (club) {
            const walletSnap = await getDoc(doc(db, `clubs/${club.id}/members/${member.id}/wallet`, "data"));
            setMemberBalance(walletSnap.exists() ? (walletSnap.data().balance ?? 0) : 0);
        }
        setStep(2);
    };

    const totalCost = useMemo(() =>
        Object.values(cart).reduce((s, c) => s + c.product.price * c.quantity, 0), [cart]);

    const handleSelect = (product: Product, qty: number) => {
        setCart((prev) => {
            const next = { ...prev };
            if (qty <= 0) { delete next[product.id]; return next; }
            next[product.id] = { product, quantity: qty };
            return next;
        });
    };

    const handleConfirm = async () => {
        if (!selectedMember || !firebaseUser) return;
        const items = Object.values(cart).map((c) => ({
            productId: c.product.id, productName: c.product.name,
            quantity: c.quantity, pricePerUnit: c.product.price, notes: "",
        }));
        try {
            await placeOrder.mutateAsync({
                memberId: selectedMember.id, memberName: selectedMember.name,
                memberPhoto: selectedMember.photo || "", staffId: firebaseUser.uid,
                items, totalCost,
            });
            setOrderPlaced(true);
        } catch (err: any) {
            toast({ title: "Order failed", description: err.message, variant: "destructive" });
        }
    };

    const resetForm = () => {
        setSelectedMember(null); setCart({}); setStep(1); setOrderPlaced(false); setSearch(""); setMemberBalance(0);
    };

    if (orderPlaced) {
        return (
            <div className="flex flex-col items-center py-20 animate-fade-in space-y-4">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-black text-emerald-800">Order Placed!</h2>
                <p className="text-sm text-muted-foreground">
                    {selectedMember?.name}'s order has been sent to the kitchen.
                </p>
                <div className="flex gap-3 mt-4">
                    <Button onClick={resetForm}>New Order</Button>
                    <Button variant="outline" onClick={resetForm}>Done</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <h1 className="text-2xl font-black text-wellness-forest flex items-center gap-2">
                <ShoppingCart className="w-6 h-6" /> New Order
            </h1>

            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs font-bold">
                <span className={step >= 1 ? "text-violet-600" : "text-muted-foreground"}>1. Member</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className={step >= 2 ? "text-violet-600" : "text-muted-foreground"}>2. Items</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className={step >= 3 ? "text-violet-600" : "text-muted-foreground"}>3. Confirm</span>
            </div>

            {/* Step 1: Select Member */}
            {step === 1 && (
                <div className="space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input placeholder="Search member by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                    </div>
                    {membersLoading ? (
                        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                    ) : (
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                            {members?.filter((m) => m.status === "active" && (m.name.toLowerCase().includes(search.toLowerCase()) || m.phone.includes(search)))
                                .slice(0, 20)
                                .map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => selectMember(m)}
                                        className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-gray-50 text-left"
                                    >
                                        <Avatar className="h-10 w-10">
                                            {m.photo ? <AvatarImage src={m.photo} /> : null}
                                            <AvatarFallback className="bg-violet-100 text-violet-700 font-bold">{m.name[0]}</AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-sm font-bold">{m.name}</p>
                                            <p className="text-xs text-muted-foreground">{m.phone}</p>
                                        </div>
                                    </button>
                                ))}
                        </div>
                    )}
                </div>
            )}

            {/* Step 2: Select Items */}
            {step === 2 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <Button size="sm" variant="ghost" onClick={() => setStep(1)} className="gap-1"><ArrowLeft className="w-3 h-3" /> Back</Button>
                        <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs bg-violet-100 text-violet-700">{selectedMember?.name[0]}</AvatarFallback></Avatar>
                            <span className="text-sm font-bold">{selectedMember?.name}</span>
                            <Badge variant="outline" className="text-[10px]">{memberBalance} {currencyName}</Badge>
                            {memberBalance < 50 && <Badge variant="destructive" className="text-[10px]">Low</Badge>}
                        </div>
                    </div>

                    {productsLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}</div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {products?.map((p) => (
                                <ProductCard key={p.id} product={p} currencyName={currencyName} isSelected={!!cart[p.id]} currentQty={cart[p.id]?.quantity} onSelect={handleSelect} />
                            ))}
                        </div>
                    )}

                    {Object.keys(cart).length > 0 && (
                        <div className="flex items-center justify-between p-4 rounded-xl border bg-white">
                            <div>
                                <p className="text-sm font-bold">{Object.values(cart).reduce((s, c) => s + c.quantity, 0)} items • {totalCost} {currencyName}</p>
                                {totalCost > memberBalance && (
                                    <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Insufficient balance</p>
                                )}
                            </div>
                            <Button disabled={totalCost > memberBalance} onClick={() => setStep(3)}>Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
                        </div>
                    )}
                </div>
            )}

            {/* Step 3: Confirm */}
            {step === 3 && (
                <div className="space-y-4">
                    <Button size="sm" variant="ghost" onClick={() => setStep(2)} className="gap-1"><ArrowLeft className="w-3 h-3" /> Back</Button>

                    <div className="bg-white rounded-xl border p-5 space-y-4">
                        <div className="flex items-center gap-3">
                            <Avatar className="h-12 w-12">
                                {selectedMember?.photo ? <AvatarImage src={selectedMember.photo} /> : null}
                                <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-lg">{selectedMember?.name[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="text-lg font-bold">{selectedMember?.name}</p>
                                <p className="text-xs text-muted-foreground">{selectedMember?.phone}</p>
                            </div>
                        </div>

                        <div className="border-t pt-3 space-y-2">
                            {Object.values(cart).map((c) => (
                                <div key={c.product.id} className="flex justify-between text-sm">
                                    <span>{c.product.name} × {c.quantity}</span>
                                    <span className="font-medium">{c.product.price * c.quantity}</span>
                                </div>
                            ))}
                        </div>

                        <div className="border-t pt-3 space-y-1">
                            <div className="flex justify-between text-sm font-bold">
                                <span>Total</span>
                                <span>{totalCost} {currencyName}</span>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Balance before</span><span>{memberBalance}</span>
                            </div>
                            <div className="flex justify-between text-xs font-bold text-violet-600">
                                <span>Balance after</span><span>{memberBalance - totalCost}</span>
                            </div>
                        </div>

                        <Button className="w-full" disabled={placeOrder.isPending} onClick={handleConfirm}>
                            {placeOrder.isPending ? "Placing…" : "Confirm & Place Order"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
