import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch,
} from "firebase/firestore";
import { X, ShoppingCart, Wallet, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

type StockType = "limited" | "unlimited";

interface CatalogItem {
    id: string;
    name: string;
    category: string;
    description?: string;
    imageUrl?: string | null;
    price: number;
    source: "club" | "global";
}

interface SpecialItem extends CatalogItem {
    stockType: StockType;
    remainingStock: number | null;
    totalStock: number | null;
}

interface OrderModalProps {
    open: boolean;
    onClose: () => void;
    clubId: string;
    memberId: string;
    memberName: string;
    memberPhoto?: string;
    walletBalance: number;
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function categoryEmoji(category: string) {
    if (category === "shake" || category === "drink") return "🥤";
    if (category === "tea") return "🍵";
    if (category === "supplement") return "💊";
    if (category === "snack") return "🍿";
    return "🍽️";
}

export default function OrderModal({
    open,
    onClose,
    clubId,
    memberId,
    memberName,
    memberPhoto,
    walletBalance,
}: OrderModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selected, setSelected] = useState<{ item: SpecialItem } | null>(null);
    const [placing, setPlacing] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ["member-order-modal", clubId, todayStr()],
        enabled: open && !!clubId,
        queryFn: async () => {
            const [clubMenuSnap, globalMenuSnap, todaysSpecialSnap] = await Promise.all([
                getDocs(collection(db, `clubs/${clubId}/menu`)),
                getDocs(query(collection(db, "globalMenu"), where("isActive", "==", true))),
                getDocs(
                    query(
                        collection(db, `clubs/${clubId}/todaysSpecial`),
                        where("isActive", "==", true),
                        where("date", "==", todayStr()),
                    ),
                ),
            ]);

            const clubMenu = clubMenuSnap.docs
                .map((d) => ({ id: d.id, ...d.data() } as any))
                .filter((item) => item.isActive !== false)
                .map<CatalogItem>((item) => ({
                    id: item.id,
                    name: item.name ?? "Unnamed",
                    category: item.category ?? "other",
                    description: item.description ?? "",
                    imageUrl: item.imageUrl ?? item.photo ?? null,
                    price: Number(item.price ?? 0),
                    source: "club",
                }));

            const globalMenu = globalMenuSnap.docs.map((d) => {
                const item = d.data() as any;
                return {
                    id: d.id,
                    name: item.name ?? "Unnamed",
                    category: item.category ?? "other",
                    description: item.description ?? "",
                    imageUrl: item.imageUrl ?? null,
                    price: Number(item.price ?? 0),
                    source: "global" as const,
                };
            });

            const catalogById = new Map<string, CatalogItem>();
            const catalogByName = new Map<string, CatalogItem>();
            [...clubMenu, ...globalMenu].forEach((item) => {
                catalogById.set(item.id, item);
                catalogByName.set(item.name.trim().toLowerCase(), item);
            });

            const specials = todaysSpecialSnap.docs
                .map((d) => {
                    const raw = d.data() as any;
                    const matched = catalogById.get(d.id) || catalogByName.get(String(raw.itemName ?? "").trim().toLowerCase());
                    const price = matched?.price ?? Number(raw.price ?? 0);
                    const stockType = (raw.stockType ?? "unlimited") as StockType;
                    const remainingStock = raw.remainingStock ?? null;
                    if (stockType === "limited" && (remainingStock ?? 0) <= 0) return null;
                    return {
                        id: d.id,
                        name: matched?.name ?? raw.itemName ?? "Unnamed",
                        category: matched?.category ?? raw.category ?? "other",
                        description: matched?.description ?? "",
                        imageUrl: matched?.imageUrl ?? raw.imageUrl ?? null,
                        price,
                        source: matched?.source ?? "club",
                        stockType,
                        remainingStock,
                        totalStock: raw.totalStock ?? null,
                    } satisfies SpecialItem;
                })
                .filter(Boolean) as SpecialItem[];

            return { specials };
        },
    });

    const totalAmount = selected?.item.price ?? 0;

    const selectShake = (item: SpecialItem) => {
        setSelected((prev) => (prev?.item.id === item.id ? null : { item }));
    };

    const handlePlaceOrder = async () => {
        if (!clubId || !memberId || !selected) return;

        if (walletBalance < totalAmount) {
            const shortfall = totalAmount - walletBalance;
            toast({
                title: "Insufficient balance",
                description: `Add Rs.${shortfall.toLocaleString("en-IN")} to wallet.`,
                variant: "destructive",
            });
            return;
        }

        setPlacing(true);
        try {
            const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
            const walletSnap = await getDoc(walletRef);
            if (!walletSnap.exists()) throw new Error("Wallet not found");

            const currentBalance = Number(walletSnap.data().balance ?? 0);
            if (currentBalance < totalAmount) {
                const shortfall = totalAmount - currentBalance;
                throw new Error(`Insufficient balance. Add Rs.${shortfall.toLocaleString("en-IN")} to wallet.`);
            }

            const batch = writeBatch(db);
            const orderRef = doc(collection(db, `clubs/${clubId}/orders`));
            const txnRef = doc(collection(db, `clubs/${clubId}/members/${memberId}/transactions`));
            const newBalance = currentBalance - totalAmount;
            const { item } = selected;

            batch.update(walletRef, {
                balance: increment(-totalAmount),
                lastUpdated: serverTimestamp(),
            });

            batch.set(orderRef, {
                memberId,
                memberName,
                memberPhoto: memberPhoto ?? "",
                clubId,
                staffId: "member_app",
                items: [{
                    productId: item.id,
                    productName: item.name,
                    quantity: 1,
                    pricePerUnit: item.price,
                    notes: "",
                    itemId: item.id,
                    itemName: item.name,
                    price: item.price,
                    qty: 1,
                }],
                totalCost: totalAmount,
                totalAmount,
                paymentMethod: "wallet",
                status: "pending",
                orderedFrom: "member_app",
                walletDeducted: true,
                rating: null,
                ratingNote: null,
                date: todayStr(),
                createdAt: serverTimestamp(),
                servedAt: null,
            });

            batch.set(txnRef, {
                userId: memberId,
                clubId,
                type: "debit",
                amount: totalAmount,
                reason: "shake_order",
                description: `Shake order - ${item.name}`,
                orderId: orderRef.id,
                paymentMethod: "wallet",
                addedBy: "member_app",
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                createdAt: serverTimestamp(),
            });

            const specialRef = doc(db, `clubs/${clubId}/todaysSpecial`, item.id);
            const specialSnap = await getDoc(specialRef);
            if (specialSnap.exists()) {
                const specialData = specialSnap.data() as any;
                if (specialData.stockType === "limited" && (specialData.remainingStock ?? 0) > 0) {
                    batch.update(specialRef, {
                        remainingStock: increment(-1),
                        updatedAt: serverTimestamp(),
                    });
                }
            }

            await batch.commit();

            queryClient.invalidateQueries({ queryKey: ["member-wallet"] });
            queryClient.invalidateQueries({ queryKey: ["member-dashboard-orders"] });
            queryClient.invalidateQueries({ queryKey: ["orders"] });
            queryClient.invalidateQueries({ queryKey: ["member-order-modal"] });

            toast({
                title: "Order placed!",
                description: `Kitchen is preparing your ${item.name}.`,
            });
            setSelected(null);
            onClose();
        } catch (err: any) {
            toast({
                title: "Order failed",
                description: err?.message ?? "Could not place order.",
                variant: "destructive",
            });
        } finally {
            setPlacing(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-end justify-center">
            <div className="w-full max-w-2xl bg-white rounded-t-[28px] shadow-2xl max-h-[92vh] overflow-hidden font-[Nunito,sans-serif]">
                <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
                    <div>
                        <h2 className="text-xl font-black text-slate-900">🥤 Order Shake</h2>
                        <p className="text-xs text-slate-500 mt-1">Pick one shake from today's specials.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-10 w-10 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto px-4 py-4 pb-36 space-y-3">
                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
                            ))}
                        </div>
                    ) : !(data?.specials.length) ? (
                        <div className="rounded-2xl border border-dashed p-8 text-sm text-slate-500 text-center">
                            No active specials right now.
                        </div>
                    ) : (
                        <>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Today's Special ⭐ — pick one</p>
                            {data.specials.map((item) => {
                                const isSelected = selected?.item.id === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => selectShake(item)}
                                        className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                                            isSelected
                                                ? "border-emerald-400 bg-emerald-50"
                                                : "border-slate-100 bg-white hover:border-emerald-200"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {item.imageUrl ? (
                                                <img
                                                    src={item.imageUrl}
                                                    className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                                                    alt={item.name}
                                                />
                                            ) : (
                                                <div className="w-14 h-14 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl flex-shrink-0">
                                                    {categoryEmoji(item.category)}
                                                </div>
                                            )}
                                            <div className="flex-1">
                                                <p className="font-black text-slate-900 text-base">{item.name}</p>
                                                <p className="text-emerald-700 font-black text-sm">Rs.{item.price}</p>
                                                <p className="text-[11px] text-slate-400 mt-0.5">
                                                    {item.stockType === "limited"
                                                        ? `${item.remainingStock ?? 0}/${item.totalStock ?? 0} left`
                                                        : "Unlimited"}
                                                </p>
                                            </div>
                                            {isSelected && <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />}
                                        </div>
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-white border-t px-4 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
                    <div className="max-w-2xl mx-auto space-y-3">
                        {selected ? (
                            <div className="flex items-center justify-between text-sm">
                                <div className="font-bold text-slate-800">{selected.item.name}</div>
                                <div className="font-black text-slate-900">Rs.{totalAmount}</div>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 text-center">Select a shake above</p>
                        )}
                        <div className="flex items-center justify-between text-sm text-slate-500">
                            <div className="flex items-center gap-2">
                                <Wallet className="w-4 h-4" />
                                Wallet Balance
                            </div>
                            <div className="font-bold text-slate-700">Rs.{walletBalance}</div>
                        </div>
                        <button
                            onClick={handlePlaceOrder}
                            disabled={!selected || placing}
                            className="w-full rounded-2xl py-4 text-white font-black text-base disabled:opacity-50"
                            style={{ background: "linear-gradient(135deg, #2d9653, #1a6e3c)" }}
                        >
                            {placing ? "Placing Order..." : "Place Order"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
