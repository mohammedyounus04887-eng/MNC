import { useEffect, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
    collection, doc, getDocs, getDoc, updateDoc, writeBatch, increment,
    query, where, orderBy, limit, startAfter, onSnapshot, collectionGroup,
    runTransaction, Timestamp, QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useMyMemberId } from "@/lib/memberKey";
import { useClubContext } from "@/lib/clubDetection";
import { toDateSafe } from "@/lib/toDateSafe";
import type { Order, Product } from "@/types/firestore";
import { deductKitchenStockForOrder, restoreKitchenStockForOrder } from "@/hooks/useKitchenInventory";

function today() { return new Date().toISOString().slice(0, 10); }

// ─── useTodaysSpecialProducts (real-time) ───────────────────────────────

export function useTodaysSpecialProducts() {
    const { club } = useClubContext();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/menu`),
            where("isAvailableToday", "==", true)
        );
        const unsub = onSnapshot(q,
            (snap) => { setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product)); setLoading(false); },
            (err) => { setError(err.message); setLoading(false); }
        );
        return () => unsub();
    }, [club]);

    return { products, loading, error };
}

// ─── useAllClubProducts ─────────────────────────────────────────────────

/**
 * The club's menu — remembered between visits, so the order screen opens.
 *
 * This is what a member taps when they want a shake, and it used to show four
 * grey skeleton boxes on every single open while a Firestore round trip
 * finished. The menu is the same list it was an hour ago; making somebody watch
 * it load again is the app being slow for no reason.
 *
 * The last menu is kept in localStorage and handed to React Query as its
 * starting data, so the screen paints instantly with real items and then
 * quietly corrects itself when the fresh copy lands. A member who has opened
 * this page before never sees a loading state again.
 *
 * `initialDataUpdatedAt` is what makes the refresh happen: without it React
 * Query treats the stored copy as brand new and would not re-fetch until it
 * aged out — a price change or a sold-out item could sit stale for an hour.
 */
const MENU_CACHE_KEY = (clubId: string) => `mnc_menu_${clubId}`;

/**
 * A Product has three Timestamp fields (createdAt, updatedAt, expiryDate), and
 * JSON.stringify turns each into a plain `{ seconds, nanoseconds }` — the
 * numbers survive, the `.toDate()` method does not. Anything that later called
 * `.toDate()` on one would throw "toDate is not a function" and take the screen
 * down, which is the whole reason lib/toDateSafe exists.
 *
 * Rather than rely on every future reader being careful, the stored copy is
 * rebuilt into real Timestamps on the way back in, so a cached product is
 * indistinguishable from one straight out of Firestore.
 */
function reviveProduct(p: Product): Product {
    const revive = (v: unknown) => {
        const d = toDateSafe(v);
        return d ? Timestamp.fromDate(d) : null;
    };
    return {
        ...p,
        createdAt: revive(p.createdAt) as Product["createdAt"],
        updatedAt: revive(p.updatedAt) as Product["updatedAt"],
        expiryDate: revive(p.expiryDate),
    };
}

function readCachedMenu(clubId: string): { products: Product[]; at: number } | null {
    try {
        const raw = localStorage.getItem(MENU_CACHE_KEY(clubId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { products: Product[]; at: number };
        if (!Array.isArray(parsed?.products) || !parsed.products.length) return null;
        return { products: parsed.products.map(reviveProduct), at: parsed.at };
    } catch {
        return null;
    }
}

function writeCachedMenu(clubId: string, products: Product[]) {
    try {
        localStorage.setItem(MENU_CACHE_KEY(clubId), JSON.stringify({ products, at: Date.now() }));
    } catch {
        // Storage full or blocked — the page still works, it just loads.
    }
}

export const MENU_QUERY_KEY = (clubId: string | null | undefined) =>
    ["orders", "products", clubId] as const;

export const MENU_STALE_MS = 5 * 60_000;

/** Read the menu and remember it. The one place either happens. */
export async function fetchClubMenu(clubId: string): Promise<Product[]> {
    const snap = await getDocs(query(collection(db, `clubs/${clubId}/menu`)));
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
    writeCachedMenu(clubId, products);
    return products;
}

/**
 * Warm the menu before anybody asks for it.
 *
 * Called from the member shell once the current screen has painted: ordering a
 * shake is what most members open the app to do, so by the time they tap
 * through, the request has already finished instead of just starting.
 */
export function prefetchClubMenu(qc: QueryClient, clubId: string) {
    return qc.prefetchQuery({
        queryKey: MENU_QUERY_KEY(clubId),
        queryFn: () => fetchClubMenu(clubId),
        staleTime: MENU_STALE_MS,
    });
}

export function useAllClubProducts() {
    const { club } = useClubContext();
    const cached = club?.id ? readCachedMenu(club.id) : null;

    return useQuery({
        queryKey: MENU_QUERY_KEY(club?.id),
        queryFn: () => fetchClubMenu(club!.id),
        enabled: !!club,
        initialData: cached?.products,
        // Dated honestly, so the stored copy is treated as what it is: real
        // data from a known moment, due a refresh in the background.
        initialDataUpdatedAt: cached?.at,
        staleTime: MENU_STALE_MS,
    });
}

// ─── usePlaceOrder (batch write: order + shakeCredits debit + stock deduction) ─

export function usePlaceOrder() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ memberId, memberName, memberPhoto, staffId, items, totalCost }: {
            memberId: string; memberName: string; memberPhoto: string;
            staffId: string;
            items: { productId: string; productName: string; quantity: number; pricePerUnit: number; notes: string }[];
            totalCost: number;
        }) => {
            if (!club) throw new Error("Club not loaded");

            const totalQty = items.reduce((s, i) => s + i.quantity, 0);

            // Read member doc for shakeCredits
            const memberRef = doc(db, `clubs/${club.id}/members`, memberId);
            const memberSnap = await getDoc(memberRef);
            if (!memberSnap.exists()) throw new Error("Member not found");
            const currentCredits = (memberSnap.data().shakeCredits ?? 0) as number;
            const GRACE_LIMIT = -5;
            if ((currentCredits - totalQty) < GRACE_LIMIT) {
                throw new Error(
                    currentCredits <= GRACE_LIMIT
                        ? "No shake credits remaining. Please renew your plan."
                        : `Only ${currentCredits - GRACE_LIMIT} shake credit${(currentCredits - GRACE_LIMIT) !== 1 ? "s" : ""} remaining (grace limit reached).`
                );
            }

            // Read product stocks + today's special (limited) in one pre-pass so
            // everything commits atomically with the order below.
            const productsToUpdate: { docRef: any; newStock: number }[] = [];
            const specialsToUpdate: { docRef: any; newRemaining: number }[] = [];
            for (const item of items) {
                const prodSnap = await getDoc(doc(db, `clubs/${club.id}/menu`, item.productId));
                if (prodSnap.exists()) {
                    const currentStock = prodSnap.data().stock as number;
                    productsToUpdate.push({
                        docRef: prodSnap.ref,
                        newStock: Math.max(0, currentStock - item.quantity),
                    });
                }
                const specialRef = doc(db, `clubs/${club.id}/todaysSpecial`, item.productId);
                const specialSnap = await getDoc(specialRef);
                if (specialSnap.exists()) {
                    const sd = specialSnap.data() as any;
                    if (sd.stockType === "limited") {
                        const remaining = Math.max(0, (sd.remainingStock ?? 0) - item.quantity);
                        specialsToUpdate.push({ docRef: specialRef, newRemaining: remaining });
                    }
                }
            }

            const batch = writeBatch(db);
            const orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

            // 1. Create order
            batch.set(doc(db, `clubs/${club.id}/orders`, orderId), {
                id: orderId, memberId, memberName, memberPhoto,
                clubId: club.id, staffId, items, totalCost,
                totalAmount: totalCost,
                paymentMethod: "shake_credits",
                orderedFrom: "member_app",
                walletDeducted: false,
                creditsUsed: totalQty,
                status: "pending", rating: null, ratingNote: null,
                date: today(), createdAt: Timestamp.now(), servedAt: null,
            } as Order);

            // 2. Deduct shake credits atomically (increment prevents race with renewals)
            batch.update(memberRef, {
                shakeCredits: increment(-totalQty),
                updatedAt: Timestamp.now(),
            });

            // 3. Deduct inventory stock
            for (const p of productsToUpdate) {
                batch.update(p.docRef, { stock: p.newStock, updatedAt: Timestamp.now() });
            }

            // 4. Deduct today's special limited stock — in the same batch so a
            //    network failure can't leave the order placed with stock un-debited.
            for (const s of specialsToUpdate) {
                batch.update(s.docRef, {
                    remainingStock: s.newRemaining,
                    ...(s.newRemaining <= 0 ? { isActive: false } : {}),
                    updatedAt: Timestamp.now(),
                });
            }

            await batch.commit();

            // Kitchen stock is NOT deducted on order creation anymore — the
            // kitchen deducts ingredients when the shake is actually served.
            // See useUpdateOrderStatus ("served" branch) for the deduction.

            return orderId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["orders"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── useUpdateOrderStatus ───────────────────────────────────────────────

export function useUpdateOrderStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, orderId, newStatus, servedBy, servedByName }: {
            clubId: string; orderId: string; newStatus: "preparing" | "served";
            /** Who handed it over — set when serving by card scan. */
            servedBy?: string; servedByName?: string;
        }) => {
            const updates: Record<string, unknown> = { status: newStatus };
            if (newStatus === "served") {
                updates.servedAt = Timestamp.now();
                // Recording the server turns "I did serve it" / "I never got it"
                // into a question with an answer, and protects the server as
                // much as it checks them.
                if (servedBy) updates.servedBy = servedBy;
                if (servedByName) updates.servedByName = servedByName;
            }

            // We only deduct kitchen stock on the transition to "served" and
            // only once. A plain read-then-update is racy under concurrent
            // serves — use a transaction to atomically flip the flag.
            if (newStatus === "served") {
                const orderRef = doc(db, `clubs/${clubId}/orders`, orderId);
                const result = await runTransaction(db, async (tx) => {
                    const snap = await tx.get(orderRef);
                    if (!snap.exists()) return null;
                    const data = snap.data() as any;
                    const alreadyDeducted = data.kitchenStockDeducted === true;

                    // Orders created by a check-in scan defer the credit to
                    // serving (lib/checkinOrder) — a member who scans in and
                    // leaves without collecting is not charged. Take it now,
                    // inside the same transaction, so it happens exactly once.
                    const chargeNow =
                        data.creditsCharged === false &&
                        data.paymentMethod === "shake_credits" &&
                        data.memberId &&
                        data.memberId !== "guest";
                    const creditsToCharge = chargeNow
                        ? Number(data.creditsUsed ?? 0) ||
                          (data.items as any[] ?? []).reduce(
                              (s, it) => s + Number(it.quantity ?? it.qty ?? 1), 0)
                        : 0;
                    if (chargeNow && creditsToCharge > 0) {
                        tx.update(doc(db, `clubs/${clubId}/members`, data.memberId), {
                            shakeCredits: increment(-creditsToCharge),
                            updatedAt: Timestamp.now(),
                        });
                    }

                    tx.update(orderRef, {
                        ...updates,
                        ...(alreadyDeducted ? {} : { kitchenStockDeducted: true }),
                        ...(chargeNow ? { creditsCharged: true } : {}),
                    });
                    return { alreadyDeducted, items: data.items as any[] };
                });
                if (result && !result.alreadyDeducted) {
                    try {
                        await deductKitchenStockForOrder(clubId, result.items.map(i => ({
                            productId: i.productId,
                            productName: i.productName || i.itemName || "",
                            quantity: i.quantity || i.qty || 1,
                        })));
                    } catch (err) {
                        console.error("[useUpdateOrderStatus] kitchen deduction failed:", err);
                    }
                }
                return;
            }
            await updateDoc(doc(db, `clubs/${clubId}/orders`, orderId), updates);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
    });
}

// ─── useRejectOrder ─────────────────────────────────────────────────────
// Rejects a kitchen order and reverses everything that was charged at
// order-creation time:
//   - member.shakeCredits: refunded
//   - menu.stock:          restored
//   - todaysSpecial.remainingStock: restored (if limited)
//   - kitchenStock ingredients: restored via recipe (best-effort)
// Order's final status is "rejected" with a refund snapshot on the doc.

export function useRejectOrder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            clubId, orderId, rejectedBy, reason,
        }: {
            clubId: string; orderId: string; rejectedBy: string; reason?: string;
        }) => {
            const orderRef = doc(db, `clubs/${clubId}/orders`, orderId);
            const orderSnap = await getDoc(orderRef);
            if (!orderSnap.exists()) throw new Error("Order not found");
            const order = orderSnap.data() as Order;

            if (order.status === "rejected") throw new Error("Order is already rejected");
            if (order.status === "served") throw new Error("Cannot reject an order that is already served");

            // Only refund shake credits for orders that actually paid with credits.
            // Guest orders use paymentMethod === "guest_credit" and never charged
            // the member; cash/upi orders also don't touch shakeCredits.
            //
            // Older Reception writes never stamped a `creditsUsed` field on the
            // order — without a fallback, those rejections silently skipped the
            // refund. Sum the item quantities as a safe back-up since
            // shake_credits orders always charge 1 credit per shake.
            const paymentMethod = (order as any).paymentMethod ?? "";
            const explicitCreditsUsed = Number((order as any).creditsUsed ?? 0);
            const itemsCreditsUsed = (order.items as any[] | undefined ?? [])
                .reduce((s, it) => s + Number(it.quantity ?? it.qty ?? 0), 0);
            const creditsUsed = explicitCreditsUsed > 0 ? explicitCreditsUsed : itemsCreditsUsed;
            // Check-in-scan orders defer the credit to serving, so an unserved
            // one never charged anything — refunding it would hand out a free
            // credit. Only `false` blocks the refund; older orders have no such
            // field and must still refund.
            const creditsWereCharged = (order as any).creditsCharged !== false;
            const shouldRefundCredits =
                paymentMethod === "shake_credits" &&
                order.memberId !== "guest" &&
                creditsUsed > 0 &&
                creditsWereCharged;

            const batch = writeBatch(db);

            // 1. Refund shake credits (atomic — safe under concurrent renewals)
            if (shouldRefundCredits) {
                const memberRef = doc(db, `clubs/${clubId}/members`, order.memberId);
                batch.update(memberRef, {
                    shakeCredits: increment(creditsUsed),
                    updatedAt: Timestamp.now(),
                });
            }

            // 2. Restore menu stock + todaysSpecial remainingStock per item
            const menuRestored: Record<string, number> = {};
            const specialRestored: Record<string, number> = {};

            for (const item of order.items as any[]) {
                const qty = item.quantity || item.qty || 1;
                if (!item.productId || qty <= 0) continue;

                // Menu stock (tolerate missing)
                const prodRef = doc(db, `clubs/${clubId}/menu`, item.productId);
                const prodSnap = await getDoc(prodRef);
                if (prodSnap.exists()) {
                    const current = (prodSnap.data().stock as number) ?? 0;
                    batch.update(prodRef, {
                        stock: current + qty,
                        updatedAt: Timestamp.now(),
                    });
                    menuRestored[item.productId] = qty;
                }

                // Today's special (only if limited stock)
                const specialRef = doc(db, `clubs/${clubId}/todaysSpecial`, item.productId);
                const specialSnap = await getDoc(specialRef);
                if (specialSnap.exists()) {
                    const sd = specialSnap.data() as any;
                    if (sd.stockType === "limited") {
                        batch.update(specialRef, {
                            remainingStock: increment(qty),
                            // If it was sold-out (isActive=false) bring it back
                            isActive: true,
                            updatedAt: Timestamp.now(),
                        });
                        specialRestored[item.productId] = qty;
                    }
                }
            }

            // 3. Mark order as rejected with refund snapshot
            const rejectedAt = Timestamp.now();
            batch.update(orderRef, {
                status: "rejected",
                rejectedAt,
                rejectedBy,
                rejectReason: reason ?? "",
                refund: {
                    shakeCredits: shouldRefundCredits ? creditsUsed : 0,
                    menuStockRestored: menuRestored,
                    todaysSpecialRestored: specialRestored,
                    kitchenStockRestored: false, // updated after best-effort below
                },
            });

            await batch.commit();

            // 4. Restore kitchen stock ONLY if it was actually deducted.
            // Kitchen stock is now deducted at serve-time (see
            // useUpdateOrderStatus), and we refuse to reject served orders
            // above — so for any order that's still pending/preparing when
            // rejected, the kitchen stock was never debited. In that case
            // we skip the restore entirely to avoid over-crediting kitchen
            // stock when a member simply cancelled early.
            let kitchenRestored = false;
            const kitchenStockWasDeducted = (order as any).kitchenStockDeducted === true;
            if (kitchenStockWasDeducted) {
                try {
                    kitchenRestored = await restoreKitchenStockForOrder(
                        clubId,
                        (order.items as any[]).map(i => ({
                            productId: i.productId,
                            productName: i.productName || i.itemName || "",
                            quantity: i.quantity || i.qty || 1,
                        }))
                    );
                    if (kitchenRestored) {
                        await updateDoc(orderRef, { "refund.kitchenStockRestored": true });
                    }
                } catch {
                    // already logged inside helper; don't fail the rejection
                }
            }

            return {
                orderId,
                shakeCreditsRefunded: shouldRefundCredits ? creditsUsed : 0,
                menuRestored,
                specialRestored,
                kitchenRestored,
            };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["orders"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── useTodayRejectedOrders (real-time) ─────────────────────────────────

export function useTodayRejectedOrders() {
    const { club } = useClubContext();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/orders`),
            where("date", "==", today()),
            where("status", "==", "rejected")
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
                // Most recent first
                docs.sort((a, b) => {
                    const at = (a.rejectedAt as any)?.toDate?.()?.getTime() ?? (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                    const bt = (b.rejectedAt as any)?.toDate?.()?.getTime() ?? (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                    return bt - at;
                });
                setOrders(docs);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { orders, loading };
}

// ─── useSubmitRating ────────────────────────────────────────────────────

export function useSubmitRating() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, orderId, rating, ratingNote }: { clubId: string; orderId: string; rating: number; ratingNote: string }) => {
            await updateDoc(doc(db, `clubs/${clubId}/orders`, orderId), { rating, ratingNote });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
    });
}

// ─── useMyOrders (paginated) ────────────────────────────────────────────

const PAGE_SIZE = 20;

export function useMyOrders() {
    // Keyed by the member DOCUMENT id, not the auth uid — see lib/memberKey.
    const memberKey = useMyMemberId();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!memberKey) return;
        const fetchFirst = async () => {
            try {
                const q = query(
                    collectionGroup(db, "orders"),
                    where("memberId", "==", memberKey),
                    orderBy("createdAt", "desc"),
                    limit(PAGE_SIZE)
                );
                const snap = await getDocs(q);
                setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order));
                setLastDoc(snap.docs[snap.docs.length - 1] || null);
                setHasMore(snap.docs.length === PAGE_SIZE);
            } catch (err: any) { setError(err.message); }
            setLoading(false);
        };
        fetchFirst();
    }, [memberKey]);

    const loadMore = useCallback(async () => {
        if (!memberKey || !lastDoc || !hasMore) return;
        const q = query(
            collectionGroup(db, "orders"),
            where("memberId", "==", memberKey),
            orderBy("createdAt", "desc"),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
        );
        const snap = await getDocs(q);
        setOrders((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)]);
        setLastDoc(snap.docs[snap.docs.length - 1] || null);
        setHasMore(snap.docs.length === PAGE_SIZE);
    }, [memberKey, lastDoc, hasMore]);

    return { orders, loadMore, hasMore, loading, error };
}

// ─── useMyUnratedOrders ─────────────────────────────────────────────────

export function useMyUnratedOrders() {
    const memberKey = useMyMemberId();
    return useQuery({
        queryKey: ["orders", "unrated", memberKey],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collectionGroup(db, "orders"),
                    where("memberId", "==", memberKey),
                    where("status", "==", "served"),
                    where("rating", "==", null)
                )
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
        },
        enabled: !!memberKey,
    });
}

// ─── useKitchenOrders (real-time) ───────────────────────────────────────

export function useKitchenOrders() {
    const { club } = useClubContext();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/orders`),
            where("date", "==", today()),
            where("status", "in", ["pending", "preparing"])
        );
        const unsub = onSnapshot(q,
            (snap) => {
                const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
                // Sort client-side to avoid composite index requirement
                docs.sort((a, b) => {
                    const at = (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                    const bt = (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                    return at - bt;
                });
                setOrders(docs);
                setLoading(false);
            },
            (err) => { console.error("[useKitchenOrders]", err.message); setError(err.message); setLoading(false); }
        );
        return () => unsub();
    }, [club]);

    return { orders, loading, error };
}

// ─── useTodayOrdersSummary ──────────────────────────────────────────────

export function useTodayOrdersSummary() {
    const { club } = useClubContext();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/orders`),
            where("date", "==", today())
        );
        const unsub = onSnapshot(q,
            (snap) => { setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)); setLoading(false); },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + o.totalCost, 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // Most popular product
    const productCounts: Record<string, { name: string; count: number }> = {};
    orders.forEach((o) => o.items.forEach((item) => {
        if (!productCounts[item.productId]) productCounts[item.productId] = { name: item.productName, count: 0 };
        productCounts[item.productId].count += item.quantity;
    }));
    const mostPopular = Object.values(productCounts).sort((a, b) => b.count - a.count)[0]?.name || "—";

    const statusCounts = { pending: 0, preparing: 0, served: 0 };
    orders.forEach((o) => { if (o.status in statusCounts) statusCounts[o.status as keyof typeof statusCounts]++; });

    return { summary: { totalOrders, totalRevenue, avgOrderValue, mostPopular, statusCounts }, orders, loading };
}

// ─── useAllTodayOrders ──────────────────────────────────────────────────

export function useAllTodayOrders() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["orders", "today", club?.id],
        queryFn: async () => {
            // Use only where() filter and sort client-side to avoid composite index requirement
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/orders`), where("date", "==", today()))
            );
            const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
            orders.sort((a, b) => {
                const aTime = (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                const bTime = (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                return bTime - aTime;
            });
            return orders;
        },
        enabled: !!club,
    });
}
