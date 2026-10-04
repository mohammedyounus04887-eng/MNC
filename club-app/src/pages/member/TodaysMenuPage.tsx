import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Star, ShoppingCart, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useMyMemberId } from "@/lib/memberKey";
import { memberPhotoOf } from "@/lib/memberPhoto";
import { useClubContext } from "@/lib/clubDetection";
import { useAllClubProducts, usePlaceOrder, useMyUnratedOrders, useSubmitRating } from "@/hooks/useOrders";
import { useTodaysSpecials, getStockBadgeInfo } from "@/hooks/useTodaysSpecial";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ProductCard from "@/components/orders/ProductCard";
import RatingModal from "@/components/orders/RatingModal";
import type { Product, Order } from "@/types/firestore";

interface CartItem {
    product: Product;
    quantity: number;
}

export default function TodaysMenuPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const { data: products = [], isLoading: loading } = useAllClubProducts();
    const placeOrder = usePlaceOrder();
    const { data: unrated } = useMyUnratedOrders();
    const submitRating = useSubmitRating();
    const [cart, setCart] = useState<Record<string, CartItem>>({});
    const [orderPlaced, setOrderPlaced] = useState(false);
    const [ratingOrder, setRatingOrder] = useState<Order | null>(null);

    // Read shake credits directly from Firestore (not cached userProfile) to avoid stale data.
    // Keyed by the member document id — the auth uid only matches it for
    // members who signed themselves up. See lib/memberKey.
    const memberKey = useMyMemberId();
    const [liveCredits, setLiveCredits] = useState<number | null>(null);
    useEffect(() => {
        if (!club?.id || !memberKey) return;
        getDoc(doc(db, `clubs/${club.id}/members/${memberKey}`))
            .then(snap => { if (snap.exists()) setLiveCredits(snap.data().shakeCredits ?? 0); })
            .catch(() => {});
    }, [club?.id, memberKey, orderPlaced]);
    const shakeCredits = liveCredits ?? (userProfile as any)?.shakeCredits ?? 0;
    const currencyName = club?.currencyName || "Coins";
    const { specials } = useTodaysSpecials(club?.id ?? null);

    const totalCost = useMemo(() =>
        Object.values(cart).reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);
    const totalQty = useMemo(() =>
        Object.values(cart).reduce((sum, item) => sum + item.quantity, 0), [cart]);
    const GRACE_LIMIT = -5;
    const insufficientCredits = (shakeCredits - totalQty) < GRACE_LIMIT;
    const isGrace = shakeCredits <= 0 && shakeCredits > GRACE_LIMIT;
    const graceUsed = Math.abs(Math.min(0, shakeCredits));

    const handleSelect = (product: Product, quantity: number) => {
        setCart((prev) => {
            const next = { ...prev };
            if (quantity <= 0) { delete next[product.id]; return next; }
            next[product.id] = { product, quantity };
            return next;
        });
    };

    const handlePlaceOrder = async () => {
        if (!memberKey || !userProfile || insufficientCredits) return;
        const items = Object.values(cart).map((c) => ({
            productId: c.product.id, productName: c.product.name,
            quantity: c.quantity, pricePerUnit: c.product.price,
            notes: "",
        }));
        try {
            await placeOrder.mutateAsync({
                memberId: memberKey, memberName: userProfile.name,
                // Through memberPhotoOf: a member enrolled at the desk has
                // their picture under photoUrl and nothing under photo, so the
                // raw field sent the kitchen an empty photo for exactly the
                // members most likely to order.
                memberPhoto: memberPhotoOf(userProfile), staffId: memberKey,
                items, totalCost,
            });
            setOrderPlaced(true);
            setTimeout(() => navigate("/member/orders"), 3000);
        } catch (err: any) {
            toast({ title: "Order failed", description: err.message, variant: "destructive" });
        }
    };

    const handleRate = (rating: number, note: string) => {
        if (!ratingOrder) return;
        submitRating.mutate(
            { clubId: club?.id || "", orderId: ratingOrder.id, rating, ratingNote: note },
            {
                onSuccess: () => { toast({ title: "Thanks for your rating! ⭐" }); setRatingOrder(null); },
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    if (orderPlaced) {
        return (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in space-y-4">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-black text-emerald-800">Order Placed! ☕</h2>
                <p className="text-sm text-muted-foreground">Your order has been sent to the kitchen</p>
                <p className="text-xs text-muted-foreground">Redirecting to orders…</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-32">
            <div>
                <h1 className="text-2xl font-black text-wellness-forest">Today's Menu</h1>
                <p className="text-sm text-muted-foreground">
                    {club?.name} • {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
            </div>

            {/* Unrated orders banner */}
            {unrated && unrated.length > 0 && (
                <button
                    onClick={() => setRatingOrder(unrated[0])}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-left"
                >
                    <Star className="w-5 h-5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                    <p className="text-sm font-medium text-yellow-800">
                        You have {unrated.length} order{unrated.length > 1 ? "s" : ""} waiting for your rating ⭐
                    </p>
                </button>
            )}

            {/* Products grid */}
            {loading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}
                </div>
            ) : products.length === 0 ? (
                <div className="text-center py-16 space-y-3">
                    <ShoppingCart className="w-12 h-12 text-gray-200 mx-auto" />
                    <p className="text-sm text-muted-foreground">No items available today.</p>
                    <p className="text-xs text-muted-foreground">Check back later!</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {products.map((p) => {
                        const special = specials[p.id];
                        const badge = getStockBadgeInfo(special);
                        const isSoldOut = special?.stockType === "limited" && (special?.remainingStock ?? 0) <= 0;
                        return (
                            <div key={p.id} className="relative">
                                {/* Stock badge overlay */}
                                {badge && (
                                    <div style={{
                                        position: "absolute",
                                        top: 8,
                                        right: 8,
                                        zIndex: 10,
                                        padding: "3px 9px",
                                        borderRadius: 99,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        background: badge.cls === "sold-out" ? "rgba(0,0,0,0.6)" : badge.cls === "low-stock" ? "#fde8e8" : "#d8f3dc",
                                        color: badge.cls === "sold-out" ? "white" : badge.cls === "low-stock" ? "#c0392b" : "#2d6a4f",
                                        animation: badge.cls === "low-stock" ? "pulse 1.5s infinite" : "none",
                                        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                                    }}>
                                        {badge.label}
                                    </div>
                                )}
                                <div style={{ opacity: isSoldOut ? 0.45 : 1, pointerEvents: isSoldOut ? "none" : "auto" }}>
                                    <ProductCard
                                        product={p}
                                        currencyName={currencyName}
                                        isSelected={!!cart[p.id]}
                                        currentQty={cart[p.id]?.quantity}
                                        onSelect={isSoldOut ? undefined : handleSelect}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Sticky order summary */}
            {Object.keys(cart).length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-2xl p-4 z-40 animate-in">
                    <div className="max-w-2xl mx-auto space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-bold">
                                    {totalQty} shake{totalQty !== 1 ? "s" : ""}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5" style={{ color: shakeCredits <= 0 ? '#ef4444' : undefined }}>
                                    {shakeCredits} credit{shakeCredits !== 1 ? "s" : ""} remaining
                                    {isGrace && <span className="ml-1 text-amber-600">(grace: {graceUsed}/5 used)</span>}
                                </p>
                            </div>
                            {insufficientCredits && (
                                <Badge variant="destructive" className="text-[10px] gap-1">
                                    <AlertTriangle className="w-3 h-3" /> Credits exhausted
                                </Badge>
                            )}
                            {!insufficientCredits && isGrace && (
                                <Badge className="text-[10px] gap-1 bg-amber-100 text-amber-700 border-amber-300">
                                    <AlertTriangle className="w-3 h-3" /> Grace period
                                </Badge>
                            )}
                        </div>

                        <Button
                            className="w-full"
                            disabled={insufficientCredits || placeOrder.isPending}
                            onClick={handlePlaceOrder}
                        >
                            {placeOrder.isPending ? "Placing…" : `Place Order — ${totalQty} credit${totalQty !== 1 ? "s" : ""}`}
                        </Button>
                    </div>
                </div>
            )}

            {/* Rating modal */}
            {ratingOrder && (
                <RatingModal order={ratingOrder} open onSubmit={handleRate} onClose={() => setRatingOrder(null)} />
            )}
        </div>
    );
}
