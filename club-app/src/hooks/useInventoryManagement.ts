import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, getDocs, getDoc, setDoc, updateDoc, addDoc,
    query, where, orderBy, onSnapshot, writeBatch,
    Timestamp, serverTimestamp, increment,
} from "firebase/firestore";
import { normalizeTender } from "@/lib/paymentSplit";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { logInvoice } from "@/utils/invoice";
import type {
    InventoryProduct, GlobalProduct, KitchenUsage, KitchenUsageItem,
    ProductSale, VirtualProductSet, InventoryLog,
} from "@/types/firestore";

function today() { return new Date().toISOString().slice(0, 10); }
function genId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ─── useInventoryProducts (real-time) ─────────────────────────────────
// Reads from the unified `inventory` collection (same fields — name,
// quantity, unit, price, imageUrl, isForSale — so InventoryProduct shape
// works as a read view).

export function useInventoryProducts() {
    const { club } = useClubContext();
    const [products, setProducts] = useState<InventoryProduct[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/inventory`),
            (snap) => {
                const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InventoryProduct);
                items.sort((a, b) => a.name.localeCompare(b.name));
                setProducts(items);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { products, loading };
}

// ─── useGlobalProducts ────────────────────────────────────────────────

export function useGlobalProducts() {
    return useQuery({
        queryKey: ["global-products"],
        queryFn: async () => {
            const snap = await getDocs(collection(db, "globalProducts"));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GlobalProduct);
        },
    });
}

// ─── useAddInventoryProduct ───────────────────────────────────────────

export function useAddInventoryProduct() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (data: {
            name: string; category: string; unit: string; imageUrl: string;
            quantity: number; price: number; lowStockThreshold: number; isForSale: boolean;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();

            // 1. Add to global products if not exists
            const globalSnap = await getDocs(
                query(collection(db, "globalProducts"), where("name", "==", data.name))
            );
            let globalProductId: string;
            if (globalSnap.empty) {
                globalProductId = genId("gp");
                await setDoc(doc(db, "globalProducts", globalProductId), {
                    id: globalProductId,
                    name: data.name,
                    category: data.category,
                    unit: data.unit,
                    imageUrl: data.imageUrl || "",
                    createdAt: now,
                    createdBy: club.id,
                });
            } else {
                globalProductId = globalSnap.docs[0].id;
            }

            // 2. Add to club inventory (unified `inventory` collection).
            // Legacy callers (Club Settings → Inventory Update) don't ask for
            // pack size, so default to 1; admin can fix it in the new
            // Inventory page once they spot it.
            const invId = genId("inv");
            await setDoc(doc(db, `clubs/${club.id}/inventory`, invId), {
                id: invId,
                name: data.name,
                size: 1,
                unit: data.unit,
                quantity: data.quantity,
                category: data.category,
                price: data.price,
                isForSale: data.isForSale,
                lowStockThreshold: data.lowStockThreshold,
                imageUrl: data.imageUrl || "",
                createdAt: now,
                lastUpdated: now,
            });

            // 3. Log initial stock
            if (data.quantity > 0) {
                await addDoc(collection(db, `clubs/${club.id}/inventoryLogs`), {
                    id: genId("log"),
                    clubId: club.id,
                    type: "restock",
                    productId: invId,
                    productName: data.name,
                    quantityChange: data.quantity,
                    quantityBefore: 0,
                    quantityAfter: data.quantity,
                    performedBy: "admin",
                    date: today(),
                    createdAt: now,
                });
            }

            return invId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
            qc.invalidateQueries({ queryKey: ["global-products"] });
        },
    });
}

// ─── useUpdateInventoryProduct ────────────────────────────────────────

export function useUpdateInventoryProduct() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ productId, data }: {
            productId: string;
            data: Partial<InventoryProduct>;
        }) => {
            if (!club) throw new Error("Club not loaded");
            await updateDoc(doc(db, `clubs/${club.id}/inventory`, productId), {
                ...data,
                lastUpdated: Timestamp.now(),
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
        },
    });
}

// ─── useSaveKitchenUsage ──────────────────────────────────────────────

export function useSaveKitchenUsage() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ items, verifiedBy, verifiedById }: {
            items: KitchenUsageItem[];
            verifiedBy: string;
            verifiedById: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const usageId = genId("ku");
            const batch = writeBatch(db);

            // 1. Save kitchen usage record
            batch.set(doc(db, `clubs/${club.id}/kitchenUsage`, usageId), {
                id: usageId,
                clubId: club.id,
                items,
                verifiedBy,
                verifiedById,
                date: today(),
                createdAt: now,
            });

            // 2. Deduct inventory + create logs
            for (const item of items) {
                const prodRef = doc(db, `clubs/${club.id}/inventory`, item.productId);
                const prodSnap = await getDoc(prodRef);
                if (!prodSnap.exists()) continue;
                const current = prodSnap.data().quantity ?? 0;
                const newQty = Math.max(0, current - item.quantity);

                batch.update(prodRef, {
                    quantity: newQty,
                    updatedAt: now,
                });

                const logId = genId("log");
                batch.set(doc(db, `clubs/${club.id}/inventoryLogs`, logId), {
                    id: logId,
                    clubId: club.id,
                    type: "kitchen_usage",
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: -item.quantity,
                    quantityBefore: current,
                    quantityAfter: newQty,
                    referenceId: usageId,
                    performedBy: verifiedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
            return usageId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
            qc.invalidateQueries({ queryKey: ["kitchen-usage"] });
            qc.invalidateQueries({ queryKey: ["inventory-logs"] });
        },
    });
}

// ─── useSaveProductSale ───────────────────────────────────────────────

export function useSaveProductSale() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (sale: {
            productId: string; productName: string; quantity: number; unit: string;
            price: number; totalAmount: number;
            buyerId: string; buyerName: string; isGift: boolean;
            paymentMethod: "cash" | "upi" | "wallet" | "split";
            cashAmount?: number;
            upiAmount?: number;
            upiAccountId?: string;
            upiAccountName?: string;
            upiNumber?: string;
            accountantVerifiedBy: string; accountantVerifiedById: string;
            inventoryVerifiedBy: string; inventoryVerifiedById: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const saleId = genId("ps");
            const batch = writeBatch(db);

            // 1. Save product sale record
            batch.set(doc(db, `clubs/${club.id}/productSales`, saleId), {
                ...sale,
                id: saleId,
                clubId: club.id,
                date: today(),
                createdAt: now,
            });

            // 2. Deduct inventory
            const prodRef = doc(db, `clubs/${club.id}/inventory`, sale.productId);
            const prodSnap = await getDoc(prodRef);
            if (prodSnap.exists()) {
                const current = prodSnap.data().quantity ?? 0;
                const newQty = Math.max(0, current - sale.quantity);
                batch.update(prodRef, { quantity: newQty, updatedAt: now });

                // 3. Inventory log
                const logId = genId("log");
                batch.set(doc(db, `clubs/${club.id}/inventoryLogs`, logId), {
                    id: logId,
                    clubId: club.id,
                    type: "product_sale",
                    productId: sale.productId,
                    productName: sale.productName,
                    quantityChange: -sale.quantity,
                    quantityBefore: current,
                    quantityAfter: newQty,
                    referenceId: saleId,
                    performedBy: sale.inventoryVerifiedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            // 4. Record payment
            // Through the shared rule, so the parts always equal the whole. A
            // hand-rolled split can store a total the two sides do not add up
            // to, and every report then has to guess at the difference.
            const invTender = normalizeTender(sale.totalAmount, sale.paymentMethod, sale.cashAmount, sale.upiAmount);
            const splitFields = {
                cashAmount: invTender.cashAmount,
                upiAmount: invTender.upiAmount,
                ...(sale.paymentMethod !== "cash" && sale.paymentMethod !== "wallet" && sale.upiAccountId ? {
                    upiAccountId: sale.upiAccountId,
                    upiAccountName: sale.upiAccountName ?? null,
                    upiNumber: sale.upiNumber ?? null,
                } : {}),
            };
            batch.set(doc(collection(db, `clubs/${club.id}/payments`)), {
                type: "product_sale",
                memberId: sale.buyerId,
                memberName: sale.buyerName,
                amount: sale.totalAmount,
                paymentMethod: sale.paymentMethod,
                ...splitFields,
                productName: sale.productName,
                productId: sale.productId,
                quantity: sale.quantity,
                isGift: sale.isGift,
                description: sale.isGift
                    ? `Gift: ${sale.productName} x${sale.quantity} to ${sale.buyerName}`
                    : `Sold: ${sale.productName} x${sale.quantity} to ${sale.buyerName}`,
                date: today(),
                createdAt: now,
            });

            // 5. Record in member's transactions
            batch.set(doc(collection(db, `clubs/${club.id}/members/${sale.buyerId}/transactions`)), {
                type: "debit",
                amount: sale.totalAmount,
                reason: "product",
                description: sale.isGift
                    ? `Gift received: ${sale.productName} x${sale.quantity}`
                    : `Purchased: ${sale.productName} x${sale.quantity}`,
                productSaleId: saleId,
                productName: sale.productName,
                paymentMethod: sale.paymentMethod,
                createdAt: now,
            });

            await batch.commit();

            // Write GST invoice (skip if gift — no money changed hands)
            if (!sale.isGift && sale.totalAmount > 0) {
                try {
                    await logInvoice(club.id, sale.buyerId, {
                        type: "product_sale",
                        title: `Product Sale — ${sale.productName}`,
                        items: [{
                            description: `${sale.productName} (${sale.quantity} ${sale.unit})`,
                            qty: sale.quantity,
                            rate: sale.price,
                            amount: sale.totalAmount,
                        }],
                        paymentMethod: sale.paymentMethod,
                        notes: `Verified by ${sale.accountantVerifiedBy}`,
                    });
                } catch (e) {
                    console.warn("Invoice write failed", e);
                }
            }

            return saleId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
            qc.invalidateQueries({ queryKey: ["product-sales"] });
            qc.invalidateQueries({ queryKey: ["inventory-logs"] });
        },
    });
}

// ─── useUpdateInventoryQuantities (bulk update for inventory manager) ──

export function useUpdateInventoryQuantities() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ updates, verifiedBy }: {
            updates: { productId: string; productName: string; oldQty: number; newQty: number }[];
            verifiedBy: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const batch = writeBatch(db);

            for (const u of updates) {
                if (u.oldQty === u.newQty) continue;
                batch.update(doc(db, `clubs/${club.id}/inventory`, u.productId), {
                    quantity: u.newQty,
                    updatedAt: now,
                });

                const logId = genId("log");
                batch.set(doc(db, `clubs/${club.id}/inventoryLogs`, logId), {
                    id: logId,
                    clubId: club.id,
                    type: "manual_update",
                    productId: u.productId,
                    productName: u.productName,
                    quantityChange: u.newQty - u.oldQty,
                    quantityBefore: u.oldQty,
                    quantityAfter: u.newQty,
                    performedBy: verifiedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
            qc.invalidateQueries({ queryKey: ["inventory-logs"] });
        },
    });
}

// ─── useVirtualProductSets ────────────────────────────────────────────

export function useVirtualProductSets() {
    const { club } = useClubContext();
    const [sets, setSets] = useState<VirtualProductSet[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/virtualProductSets`),
            (snap) => {
                setSets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VirtualProductSet));
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { sets, loading };
}

// ─── useSaveVirtualProductSet ─────────────────────────────────────────

export function useSaveVirtualProductSet() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (data: {
            id?: string;
            name: string;
            items: { productId: string; productName: string; quantity: number; unit: string }[];
            isActive: boolean;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const setId = data.id || genId("vps");
            await setDoc(doc(db, `clubs/${club.id}/virtualProductSets`, setId), {
                id: setId,
                clubId: club.id,
                name: data.name,
                items: data.items,
                isActive: data.isActive,
                createdAt: data.id ? undefined : now,
                updatedAt: now,
            }, { merge: true });
            return setId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["virtual-product-sets"] });
        },
    });
}

// ─── useDeductVirtualProductSet ───────────────────────────────────────

export function useDeductVirtualProductSet() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ setId, memberName }: { setId: string; memberName: string }) => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();

            // Get the set
            const setSnap = await getDoc(doc(db, `clubs/${club.id}/virtualProductSets`, setId));
            if (!setSnap.exists()) throw new Error("Virtual product set not found");
            const vps = setSnap.data() as VirtualProductSet;

            const batch = writeBatch(db);

            for (const item of vps.items) {
                const prodRef = doc(db, `clubs/${club.id}/inventory`, item.productId);
                const prodSnap = await getDoc(prodRef);
                if (!prodSnap.exists()) continue;
                const current = prodSnap.data().quantity ?? 0;
                const newQty = Math.max(0, current - item.quantity);

                batch.update(prodRef, { quantity: newQty, updatedAt: now });

                const logId = genId("log");
                batch.set(doc(db, `clubs/${club.id}/inventoryLogs`, logId), {
                    id: logId,
                    clubId: club.id,
                    type: "virtual_deduction",
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: -item.quantity,
                    quantityBefore: current,
                    quantityAfter: newQty,
                    referenceId: setId,
                    performedBy: `Virtual: ${memberName}`,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
            qc.invalidateQueries({ queryKey: ["inventory-logs"] });
        },
    });
}

// ─── useInventoryLogs ─────────────────────────────────────────────────

export function useInventoryLogs(dateFilter?: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["inventory-logs", club?.id, dateFilter],
        queryFn: async () => {
            let q;
            if (dateFilter) {
                q = query(
                    collection(db, `clubs/${club!.id}/inventoryLogs`),
                    where("date", "==", dateFilter)
                );
            } else {
                q = collection(db, `clubs/${club!.id}/inventoryLogs`);
            }
            const snap = await getDocs(q);
            const logs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as InventoryLog) }));
            logs.sort((a, b) => {
                const at = (a.createdAt as any)?.toMillis?.() ?? 0;
                const bt = (b.createdAt as any)?.toMillis?.() ?? 0;
                return bt - at;
            });
            return logs;
        },
        enabled: !!club,
    });
}

// ─── useProductSales ──────────────────────────────────────────────────

export function useProductSales(startDate?: string, endDate?: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["product-sales", club?.id, startDate, endDate],
        queryFn: async () => {
            let q;
            if (startDate && endDate) {
                q = query(
                    collection(db, `clubs/${club!.id}/productSales`),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate)
                );
            } else {
                q = collection(db, `clubs/${club!.id}/productSales`);
            }
            const snap = await getDocs(q);
            const sales = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ProductSale) }));
            sales.sort((a, b) => {
                const at = (a.createdAt as any)?.toMillis?.() ?? 0;
                const bt = (b.createdAt as any)?.toMillis?.() ?? 0;
                return bt - at;
            });
            return sales;
        },
        enabled: !!club,
    });
}

// ─── useTodayKitchenUsage ─────────────────────────────────────────────

export function useTodayKitchenUsage() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["kitchen-usage", club?.id, today()],
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${club!.id}/kitchenUsage`),
                where("date", "==", today())
            );
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as KitchenUsage);
        },
        enabled: !!club,
    });
}
