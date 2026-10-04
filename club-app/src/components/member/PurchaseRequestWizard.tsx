import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { CreditCard, Coins, ShoppingBag, Plus, Minus, X, ChevronRight, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useClubMembershipPlans } from "@/hooks/member/useMembership";
import { useSubmitPurchaseRequest } from "@/hooks/usePurchaseRequests";
import type { InventoryProduct, MembershipPlan, PurchaseRequestItem } from "@/types/firestore";

const GREEN = "#2d9653";

type CategoryId = "membership" | "wallet_topup" | "product";
type Step = "categories" | "items" | "review";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clubId: string | null;
    onSubmitted?: () => void;
}

const CATEGORIES: { id: CategoryId; label: string; description: string; icon: any; color: string }[] = [
    {
        id: "membership",
        label: "Buy Membership",
        description: "Pick a plan — adds shake credits",
        icon: CreditCard,
        color: GREEN,
    },
    {
        id: "wallet_topup",
        label: "Top up Wallet",
        description: "Add money to use later",
        icon: Coins,
        color: "#f59e0b",
    },
    {
        id: "product",
        label: "Buy Products",
        description: "Pick from store — handed at reception",
        icon: ShoppingBag,
        color: "#6366f1",
    },
];

const TOPUP_PRESETS = [200, 500, 1000, 2000, 5000];

export default function PurchaseRequestWizard({ open, onOpenChange, clubId, onSubmitted }: Props) {
    const { toast } = useToast();
    const submit = useSubmitPurchaseRequest();
    const { plans, loading: plansLoading } = useClubMembershipPlans(clubId);

    const [step, setStep] = useState<Step>("categories");
    const [pickedCategories, setPickedCategories] = useState<Set<CategoryId>>(new Set());

    // Selections
    const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
    const [topupAmount, setTopupAmount] = useState<number>(0);
    const [topupCustom, setTopupCustom] = useState<string>("");
    const [productCart, setProductCart] = useState<Record<string, { product: InventoryProduct; qty: number }>>({});
    const [notes, setNotes] = useState("");

    // Inventory load (only when needed)
    const [products, setProducts] = useState<InventoryProduct[]>([]);
    const [productsLoading, setProductsLoading] = useState(false);
    useEffect(() => {
        if (!clubId || !pickedCategories.has("product")) return;
        setProductsLoading(true);
        const unsub = onSnapshot(
            collection(db, "clubs", clubId, "inventory"),
            (snap) => {
                const items = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() } as InventoryProduct))
                    .filter((p) => p.isForSale && p.quantity > 0);
                setProducts(items);
                setProductsLoading(false);
            },
            () => setProductsLoading(false),
        );
        return () => unsub();
    }, [clubId, pickedCategories]);

    // Reset state when modal closes
    useEffect(() => {
        if (!open) {
            setStep("categories");
            setPickedCategories(new Set());
            setSelectedPlan(null);
            setTopupAmount(0);
            setTopupCustom("");
            setProductCart({});
            setNotes("");
        }
    }, [open]);

    const toggleCategory = (id: CategoryId) => {
        setPickedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Build items array from current selections
    const items = useMemo<PurchaseRequestItem[]>(() => {
        const list: PurchaseRequestItem[] = [];
        if (pickedCategories.has("membership") && selectedPlan) {
            list.push({
                type: "membership",
                planId: selectedPlan.id,
                planName: selectedPlan.name,
                planCategory: selectedPlan.category,
                price: selectedPlan.price,
                visits: selectedPlan.visits ?? selectedPlan.totalVisits ?? 0,
                durationDays: selectedPlan.durationDays,
            });
        }
        if (pickedCategories.has("wallet_topup") && topupAmount > 0) {
            list.push({ type: "wallet_topup", amount: topupAmount });
        }
        if (pickedCategories.has("product")) {
            for (const { product, qty } of Object.values(productCart)) {
                if (qty <= 0) continue;
                list.push({
                    type: "product",
                    productId: product.id,
                    productName: product.name,
                    unit: product.unit,
                    quantity: qty,
                    unitPrice: product.price,
                    totalPrice: product.price * qty,
                });
            }
        }
        return list;
    }, [pickedCategories, selectedPlan, topupAmount, productCart]);

    const totalAmount = items.reduce((sum, item) => {
        if (item.type === "membership") return sum + item.price;
        if (item.type === "wallet_topup") return sum + item.amount;
        if (item.type === "product") return sum + item.totalPrice;
        return sum;
    }, 0);

    // Required selections per category
    const itemsValid = useMemo(() => {
        if (pickedCategories.has("membership") && !selectedPlan) return false;
        if (pickedCategories.has("wallet_topup") && topupAmount <= 0) return false;
        if (
            pickedCategories.has("product") &&
            Object.values(productCart).filter((c) => c.qty > 0).length === 0
        )
            return false;
        return items.length > 0;
    }, [pickedCategories, selectedPlan, topupAmount, productCart, items]);

    const handleSubmit = async () => {
        try {
            await submit.mutateAsync({ items, notes });
            toast({
                title: "Request sent!",
                description: "Pay at reception to complete.",
            });
            onOpenChange(false);
            onSubmitted?.();
        } catch (err: any) {
            toast({
                title: "Could not send request",
                description: err.message || "Please try again",
                variant: "destructive",
            });
        }
    };

    const adjustProductQty = (product: InventoryProduct, delta: number) => {
        setProductCart((prev) => {
            const current = prev[product.id]?.qty ?? 0;
            const next = Math.max(0, Math.min(product.quantity, current + delta));
            const updated = { ...prev };
            if (next === 0) delete updated[product.id];
            else updated[product.id] = { product, qty: next };
            return updated;
        });
    };

    const setTopupFromCustom = (raw: string) => {
        setTopupCustom(raw);
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) setTopupAmount(n);
        else if (raw === "") setTopupAmount(0);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md p-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5">
                    <DialogTitle className="flex items-center gap-2">
                        {step === "categories" && "What do you need?"}
                        {step === "items" && "Pick items"}
                        {step === "review" && "Review & submit"}
                    </DialogTitle>
                </DialogHeader>

                {/* STEP 1 — Pick categories */}
                {step === "categories" && (
                    <div className="px-5 pb-5 space-y-3">
                        <p className="text-xs text-slate-500">Select all that apply.</p>
                        {CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            const active = pickedCategories.has(cat.id);
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => toggleCategory(cat.id)}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                                    style={{
                                        borderColor: active ? cat.color : "#e5e7eb",
                                        backgroundColor: active ? `${cat.color}10` : "white",
                                    }}
                                >
                                    <div
                                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                        style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm">{cat.label}</p>
                                        <p className="text-xs text-slate-500">{cat.description}</p>
                                    </div>
                                    <div
                                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                                        style={{
                                            borderColor: active ? cat.color : "#cbd5e1",
                                            backgroundColor: active ? cat.color : "transparent",
                                        }}
                                    >
                                        {active && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                </button>
                            );
                        })}
                        <Button
                            className="w-full rounded-xl mt-2"
                            style={{ backgroundColor: GREEN }}
                            disabled={pickedCategories.size === 0}
                            onClick={() => setStep("items")}
                        >
                            Continue
                            <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    </div>
                )}

                {/* STEP 2 — Configure items */}
                {step === "items" && (
                    <div className="px-5 pb-5 space-y-5 max-h-[60vh] overflow-y-auto">
                        {/* Membership */}
                        {pickedCategories.has("membership") && (
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Choose a plan
                                </h3>
                                {plansLoading ? (
                                    <div className="space-y-2">
                                        {[1, 2].map((i) => (
                                            <Skeleton key={i} className="h-14 rounded-xl" />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {plans.map((p) => {
                                            const active = selectedPlan?.id === p.id;
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => setSelectedPlan(p)}
                                                    className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                                                    style={{
                                                        borderColor: active ? GREEN : "#e5e7eb",
                                                        backgroundColor: active ? "#f0fdf4" : "white",
                                                    }}
                                                >
                                                    <div
                                                        className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-sm text-white"
                                                        style={{ backgroundColor: p.color || GREEN }}
                                                    >
                                                        {p.visits ?? p.totalVisits ?? p.name[0]}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-sm">{p.name}</p>
                                                        <p className="text-xs text-slate-500">
                                                            {p.visits || p.totalVisits
                                                                ? `${p.visits || p.totalVisits} credits`
                                                                : `${p.durationDays} days`}
                                                            {p.perShakePrice ? ` · ₹${p.perShakePrice}/shake` : ""}
                                                        </p>
                                                    </div>
                                                    <p className="font-bold text-sm" style={{ color: GREEN }}>
                                                        ₹{p.price}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Wallet topup */}
                        {pickedCategories.has("wallet_topup") && (
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Top-up amount
                                </h3>
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                    {TOPUP_PRESETS.map((amount) => {
                                        const active = topupAmount === amount && topupCustom === "";
                                        return (
                                            <button
                                                key={amount}
                                                type="button"
                                                onClick={() => {
                                                    setTopupAmount(amount);
                                                    setTopupCustom("");
                                                }}
                                                className="py-2.5 rounded-xl border-2 text-sm font-bold"
                                                style={{
                                                    borderColor: active ? GREEN : "#e5e7eb",
                                                    backgroundColor: active ? "#f0fdf4" : "white",
                                                    color: active ? GREEN : "#475569",
                                                }}
                                            >
                                                ₹{amount}
                                            </button>
                                        );
                                    })}
                                </div>
                                <Input
                                    type="number"
                                    placeholder="Custom amount"
                                    value={topupCustom}
                                    onChange={(e) => setTopupFromCustom(e.target.value)}
                                    min={1}
                                />
                            </section>
                        )}

                        {/* Products */}
                        {pickedCategories.has("product") && (
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Available products
                                </h3>
                                {productsLoading ? (
                                    <div className="space-y-2">
                                        {[1, 2].map((i) => (
                                            <Skeleton key={i} className="h-14 rounded-xl" />
                                        ))}
                                    </div>
                                ) : products.length === 0 ? (
                                    <p className="text-sm text-slate-400 text-center py-4">
                                        No products available right now.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {products.map((product) => {
                                            const qty = productCart[product.id]?.qty ?? 0;
                                            return (
                                                <div
                                                    key={product.id}
                                                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white"
                                                >
                                                    {product.imageUrl ? (
                                                        <img
                                                            src={product.imageUrl}
                                                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                                                            alt=""
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xs flex-shrink-0">
                                                            📦
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-sm truncate">{product.name}</p>
                                                        <p className="text-xs text-slate-500">
                                                            ₹{product.price} · {product.quantity} {product.unit}{" "}
                                                            available
                                                        </p>
                                                    </div>
                                                    {qty === 0 ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => adjustProductQty(product, 1)}
                                                            className="rounded-full h-8 px-3 text-xs"
                                                        >
                                                            <Plus className="w-3 h-3 mr-1" />
                                                            Add
                                                        </Button>
                                                    ) : (
                                                        <div
                                                            className="flex items-center gap-1 rounded-full px-1 py-0.5"
                                                            style={{ backgroundColor: `${GREEN}15` }}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => adjustProductQty(product, -1)}
                                                                className="w-6 h-6 rounded-full flex items-center justify-center"
                                                                style={{ color: GREEN }}
                                                                aria-label="Decrease"
                                                            >
                                                                <Minus className="w-3 h-3" />
                                                            </button>
                                                            <span
                                                                className="text-sm font-bold min-w-[1.5rem] text-center"
                                                                style={{ color: GREEN }}
                                                            >
                                                                {qty}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => adjustProductQty(product, 1)}
                                                                disabled={qty >= product.quantity}
                                                                className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-40"
                                                                style={{ color: GREEN }}
                                                                aria-label="Increase"
                                                            >
                                                                <Plus className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                className="flex-1 rounded-xl"
                                onClick={() => setStep("categories")}
                            >
                                Back
                            </Button>
                            <Button
                                className="flex-1 rounded-xl"
                                style={{ backgroundColor: GREEN }}
                                disabled={!itemsValid}
                                onClick={() => setStep("review")}
                            >
                                Review · ₹{totalAmount.toLocaleString()}
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 3 — Review */}
                {step === "review" && (
                    <div className="px-5 pb-5 space-y-4">
                        <div className="rounded-xl border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                            {items.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        {item.type === "membership" && (
                                            <>
                                                <p className="text-sm font-bold truncate">{item.planName}</p>
                                                <p className="text-[11px] text-slate-500">
                                                    {item.visits} credits · {item.durationDays} days
                                                </p>
                                            </>
                                        )}
                                        {item.type === "wallet_topup" && (
                                            <>
                                                <p className="text-sm font-bold">Wallet Top-up</p>
                                                <p className="text-[11px] text-slate-500">
                                                    Adds ₹{item.amount} to your wallet
                                                </p>
                                            </>
                                        )}
                                        {item.type === "product" && (
                                            <>
                                                <p className="text-sm font-bold truncate">{item.productName}</p>
                                                <p className="text-[11px] text-slate-500">
                                                    {item.quantity} {item.unit} × ₹{item.unitPrice}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                    <p className="text-sm font-bold ml-2 flex-shrink-0">
                                        ₹
                                        {item.type === "membership"
                                            ? item.price.toLocaleString()
                                            : item.type === "wallet_topup"
                                              ? item.amount.toLocaleString()
                                              : item.totalPrice.toLocaleString()}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-between items-center px-3">
                            <span className="text-sm font-bold text-slate-700">Total</span>
                            <span className="text-xl font-black" style={{ color: GREEN }}>
                                ₹{totalAmount.toLocaleString()}
                            </span>
                        </div>

                        <Input
                            placeholder="Notes (optional)"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />

                        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-700">
                            💡 After you submit, walk to reception and pay. They'll verify and
                            apply everything to your account.
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="flex-1 rounded-xl"
                                onClick={() => setStep("items")}
                                disabled={submit.isPending}
                            >
                                Back
                            </Button>
                            <Button
                                className="flex-1 rounded-xl"
                                style={{ backgroundColor: GREEN }}
                                disabled={submit.isPending || !itemsValid}
                                onClick={handleSubmit}
                            >
                                {submit.isPending ? "Submitting…" : "Submit Request"}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
