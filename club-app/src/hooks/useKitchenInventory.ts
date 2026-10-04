import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
    query, where, onSnapshot, writeBatch, increment,
    Timestamp, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type {
    Recipe, RecipeIngredient, KitchenStockItem,
    KitchenRequest, KitchenRequestItem, KitchenReturn,
    InventoryProduct,
} from "@/types/firestore";

function today() {
    return new Date().toISOString().slice(0, 10);
}

// ─── useRecipes (real-time) ─────────────────────────────────────────────

export function useRecipes() {
    const { club } = useClubContext();
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/recipes`),
            (snap) => {
                setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe)));
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { recipes, loading };
}

// ─── useCreateRecipe ────────────────────────────────────────────────────

export function useCreateRecipe() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            name: string;
            menuItemId: string;
            menuItemName: string;
            ingredients: RecipeIngredient[];
        }) => {
            if (!club) throw new Error("Club not loaded");
            const id = "recipe_" + Date.now();
            await setDoc(doc(db, `clubs/${club.id}/recipes`, id), {
                id,
                ...input,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
    });
}

// ─── useUpdateRecipe ────────────────────────────────────────────────────

export function useUpdateRecipe() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ recipeId, data }: { recipeId: string; data: Partial<Recipe> }) => {
            if (!club) throw new Error("Club not loaded");
            await updateDoc(doc(db, `clubs/${club.id}/recipes`, recipeId), {
                ...data,
                updatedAt: Timestamp.now(),
            } as any);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
    });
}

// ─── useKitchenStock (real-time) ────────────────────────────────────────

export function useKitchenStock() {
    const { club } = useClubContext();
    const [stock, setStock] = useState<KitchenStockItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/kitchenStock`),
            (snap) => {
                setStock(snap.docs.map(d => ({ productId: d.id, ...d.data() } as KitchenStockItem)));
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { stock, loading };
}

// ─── useKitchenRequests (real-time, today) ──────────────────────────────

export function useKitchenRequests() {
    const { club } = useClubContext();
    const [requests, setRequests] = useState<KitchenRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/kitchenRequests`),
            where("date", "==", today())
        );
        const unsub = onSnapshot(q, (snap) => {
            setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as KitchenRequest)));
            setLoading(false);
        }, () => setLoading(false));
        return () => unsub();
    }, [club]);

    return { requests, loading };
}

// ─── useCreateKitchenRequest ────────────────────────────────────────────

export function useCreateKitchenRequest() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            items: KitchenRequestItem[];
            estimatedShakes: number;
            requestedBy: string;
            isEmergency?: boolean;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const id = "kreq_" + Date.now();
            await setDoc(doc(db, `clubs/${club.id}/kitchenRequests`, id), {
                id,
                items: input.items,
                estimatedShakes: input.estimatedShakes,
                status: 'pending',
                isEmergency: input.isEmergency || false,
                requestedBy: input.requestedBy,
                requestedAt: Timestamp.now(),
                resolvedBy: null,
                resolvedAt: null,
                date: today(),
            });
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
    });
}

// ─── useApproveKitchenRequest ───────────────────────────────────────────
// Approves request, deducts from main inventory, adds to kitchen stock

export function useApproveKitchenRequest() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ requestId, issuedItems, resolvedBy }: {
            requestId: string;
            issuedItems: { productId: string; productName: string; issuedQty: number; unit: string }[];
            resolvedBy: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const batch = writeBatch(db);
            const now = Timestamp.now();

            // Update request status
            batch.update(doc(db, `clubs/${club.id}/kitchenRequests`, requestId), {
                status: 'approved',
                resolvedBy,
                resolvedAt: now,
                items: issuedItems.map(it => ({
                    productId: it.productId,
                    productName: it.productName,
                    requestedQty: it.issuedQty, // keep original
                    issuedQty: it.issuedQty,
                    unit: it.unit,
                })),
            });

            for (const item of issuedItems) {
                if (item.issuedQty <= 0) continue;

                // Deduct from main (unified) inventory
                batch.update(doc(db, `clubs/${club.id}/inventory`, item.productId), {
                    quantity: increment(-item.issuedQty),
                    lastUpdated: now,
                });

                // Add to kitchen stock — use the unified shape (inventoryItemId
                // keys the doc; size & unit mirror the source item).
                const ksRef = doc(db, `clubs/${club.id}/kitchenStock`, item.productId);
                batch.set(ksRef, {
                    inventoryItemId: item.productId,
                    name: item.productName,
                    quantity: increment(item.issuedQty),
                    unit: item.unit,
                    lastUpdated: now,
                }, { merge: true });

                // Inventory log
                const logRef = doc(collection(db, `clubs/${club.id}/inventoryLogs`));
                batch.set(logRef, {
                    id: logRef.id,
                    clubId: club.id,
                    type: 'kitchen_usage',
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: -item.issuedQty,
                    quantityBefore: 0, // can't read in batch, approximation
                    quantityAfter: 0,
                    referenceId: requestId,
                    performedBy: resolvedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["kitchen"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── useCreateAndApproveKitchenRequest ──────────────────────────────────
// Single-step variant used by the new Kitchen → Request flow.
// Kitchen fills out estimates → collects items physically → inventory
// manager (accountant) verifies via face scan at the kitchen machine.
// On successful face match, we both CREATE the request and APPROVE it
// in one batch, so the pending → approved intermediate step (which was
// the whole point of the old two-step UI) is no longer a UX hop.

export function useCreateAndApproveKitchenRequest() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            items: KitchenRequestItem[];
            estimatedShakes: number;
            requestedBy: string;
            resolvedBy: string;          // accountant/inventory-manager name
            resolvedById?: string;       // optional id for audit
            isEmergency?: boolean;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const batch = writeBatch(db);
            const now = Timestamp.now();
            const id = "kreq_" + Date.now();

            // Persist the request as already approved
            batch.set(doc(db, `clubs/${club.id}/kitchenRequests`, id), {
                id,
                items: input.items.map(it => ({
                    productId: it.productId,
                    productName: it.productName,
                    requestedQty: it.requestedQty,
                    issuedQty: it.requestedQty, // full issuance by default
                    unit: it.unit,
                })),
                estimatedShakes: input.estimatedShakes,
                status: 'approved',
                isEmergency: input.isEmergency || false,
                requestedBy: input.requestedBy,
                requestedAt: now,
                resolvedBy: input.resolvedBy,
                resolvedById: input.resolvedById ?? null,
                resolvedAt: now,
                date: today(),
            });

            // Read current state of each inventory item + its kitchen mirror
            // so the audit log captures real before/after values and we can
            // bail early if any item is short.
            type Resolved = {
                exists: boolean;
                mainBefore: number;
                kitchenBefore: number;
                size: number;
                unit: string;
                source?: string;
            };
            const resolved: Record<string, Resolved> = {};
            for (const item of input.items) {
                if (item.requestedQty <= 0) {
                    resolved[item.productId] = { exists: false, mainBefore: 0, kitchenBefore: 0, size: 0, unit: item.unit };
                    continue;
                }
                const invSnap = await getDoc(doc(db, `clubs/${club.id}/inventory`, item.productId));
                const ksSnap = await getDoc(doc(db, `clubs/${club.id}/kitchenStock`, item.productId));
                const exists = invSnap.exists();
                const mainBefore = exists ? ((invSnap.data().quantity as number) ?? 0) : 0;
                const size = exists ? ((invSnap.data().size as number) ?? 1) : 1;
                const unit = exists ? ((invSnap.data().unit as string) ?? item.unit) : item.unit;
                const kitchenBefore = ksSnap.exists() ? ((ksSnap.data().quantity as number) ?? 0) : 0;
                resolved[item.productId] = { exists, mainBefore, kitchenBefore, size, unit };
                if (exists && mainBefore < item.requestedQty) {
                    throw new Error(
                        `Not enough ${item.productName} in inventory. Have ${mainBefore}, need ${item.requestedQty}.`
                    );
                }
            }

            for (const item of input.items) {
                const qty = item.requestedQty;
                if (qty <= 0) continue;
                const r = resolved[item.productId];
                const mainAfter = r.mainBefore - qty;
                const kitchenAfter = r.kitchenBefore + qty;

                if (r.exists) {
                    batch.update(doc(db, `clubs/${club.id}/inventory`, item.productId), {
                        quantity: mainAfter,
                        lastUpdated: now,
                    });
                }

                batch.set(doc(db, `clubs/${club.id}/kitchenStock`, item.productId), {
                    inventoryItemId: item.productId,
                    name: item.productName,
                    size: r.size,
                    unit: r.unit,
                    quantity: kitchenAfter,
                    lastUpdated: now,
                }, { merge: true });

                const mainLogRef = doc(collection(db, `clubs/${club.id}/inventoryLogs`));
                batch.set(mainLogRef, {
                    id: mainLogRef.id,
                    clubId: club.id,
                    type: "kitchen_issue",
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: -qty,
                    quantityBefore: r.mainBefore,
                    quantityAfter: mainAfter,
                    referenceId: id,
                    performedBy: input.resolvedBy,
                    date: today(),
                    createdAt: now,
                });

                const ksLogRef = doc(collection(db, `clubs/${club.id}/inventoryLogs`));
                batch.set(ksLogRef, {
                    id: ksLogRef.id,
                    clubId: club.id,
                    type: "kitchen_receive",
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: qty,
                    quantityBefore: r.kitchenBefore,
                    quantityAfter: kitchenAfter,
                    referenceId: id,
                    performedBy: input.resolvedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
            return id;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["kitchen"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── useRejectKitchenRequest ────────────────────────────────────────────

export function useRejectKitchenRequest() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ requestId, resolvedBy }: { requestId: string; resolvedBy: string }) => {
            if (!club) throw new Error("Club not loaded");
            await updateDoc(doc(db, `clubs/${club.id}/kitchenRequests`, requestId), {
                status: 'rejected',
                resolvedBy,
                resolvedAt: Timestamp.now(),
            });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
    });
}

// ─── useEmergencyKitchenUse ─────────────────────────────────────────────
// Direct kitchen usage without prior request (flagged as emergency)

export function useEmergencyKitchenUse() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            items: { productId: string; productName: string; quantity: number; unit: string }[];
            usedBy: string;
            verifiedBy: string;            // accountant who face-verified the emergency
            verifiedById?: string;
            reason?: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            if (!input.verifiedBy?.trim()) {
                throw new Error("Emergency kitchen use requires accountant verification.");
            }
            const now = Timestamp.now();
            const reqId = "kreq_emg_" + Date.now();

            // Read current state of each inventory item + its kitchen mirror.
            type Resolved = {
                exists: boolean;
                mainBefore: number;
                kitchenBefore: number;
                size: number;
                unit: string;
                source?: string;
            };
            const resolved: Record<string, Resolved> = {};
            for (const item of input.items) {
                if (item.quantity <= 0) {
                    resolved[item.productId] = { exists: false, mainBefore: 0, kitchenBefore: 0, size: 0, unit: item.unit };
                    continue;
                }
                const invSnap = await getDoc(doc(db, `clubs/${club.id}/inventory`, item.productId));
                const ksSnap = await getDoc(doc(db, `clubs/${club.id}/kitchenStock`, item.productId));
                const exists = invSnap.exists();
                const mainBefore = exists ? ((invSnap.data().quantity as number) ?? 0) : 0;
                const size = exists ? ((invSnap.data().size as number) ?? 1) : 1;
                const unit = exists ? ((invSnap.data().unit as string) ?? item.unit) : item.unit;
                const kitchenBefore = ksSnap.exists() ? ((ksSnap.data().quantity as number) ?? 0) : 0;
                resolved[item.productId] = { exists, mainBefore, kitchenBefore, size, unit };
                if (exists && mainBefore < item.quantity) {
                    throw new Error(
                        `Not enough ${item.productName} in inventory. Have ${mainBefore}, need ${item.quantity}.`
                    );
                }
            }

            const batch = writeBatch(db);
            batch.set(doc(db, `clubs/${club.id}/kitchenRequests`, reqId), {
                id: reqId,
                items: input.items.map(it => ({
                    productId: it.productId,
                    productName: it.productName,
                    requestedQty: it.quantity,
                    issuedQty: it.quantity,
                    unit: it.unit,
                })),
                estimatedShakes: 0,
                status: 'approved',
                isEmergency: true,
                reason: input.reason ?? "",
                requestedBy: input.usedBy,
                requestedAt: now,
                resolvedBy: input.verifiedBy,
                resolvedById: input.verifiedById ?? null,
                resolvedAt: now,
                date: today(),
            });

            for (const item of input.items) {
                if (item.quantity <= 0) continue;
                const r = resolved[item.productId];
                const mainAfter = r.mainBefore - item.quantity;
                const kitchenAfter = r.kitchenBefore + item.quantity;

                if (r.exists) {
                    batch.update(doc(db, `clubs/${club.id}/inventory`, item.productId), {
                        quantity: mainAfter, lastUpdated: now,
                    });
                }

                batch.set(doc(db, `clubs/${club.id}/kitchenStock`, item.productId), {
                    inventoryItemId: item.productId,
                    name: item.productName,
                    size: r.size,
                    unit: r.unit,
                    quantity: kitchenAfter,
                    lastUpdated: now,
                }, { merge: true });

                const logRef = doc(collection(db, `clubs/${club.id}/inventoryLogs`));
                batch.set(logRef, {
                    id: logRef.id,
                    clubId: club.id,
                    type: "emergency_kitchen_use",
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: -item.quantity,
                    quantityBefore: r.mainBefore,
                    quantityAfter: mainAfter,
                    referenceId: reqId,
                    performedBy: input.usedBy,
                    verifiedBy: input.verifiedBy,
                    reason: input.reason ?? "",
                    date: today(),
                    createdAt: now,
                    sourceCollection: r.source ?? "missing",
                });
            }

            await batch.commit();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["kitchen"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── useReturnKitchenStock ──────────────────────────────────────────────
// End-of-day return: move stock from kitchen back to main inventory

export function useReturnKitchenStock() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            items: { productId: string; productName: string; quantity: number; unit: string }[];
            verifiedBy: string;
            verifiedById: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const batch = writeBatch(db);
            const now = Timestamp.now();

            // Create return record
            const retId = "kret_" + Date.now();
            batch.set(doc(db, `clubs/${club.id}/kitchenReturns`, retId), {
                id: retId,
                items: input.items.filter(it => it.quantity > 0).map(it => ({
                    productId: it.productId,
                    productName: it.productName,
                    quantity: it.quantity,
                    unit: it.unit,
                })),
                verifiedBy: input.verifiedBy,
                verifiedById: input.verifiedById,
                date: today(),
                createdAt: now,
            });

            for (const item of input.items) {
                if (item.quantity <= 0) continue;

                // Add back to main (unified) inventory
                batch.update(doc(db, `clubs/${club.id}/inventory`, item.productId), {
                    quantity: increment(item.quantity),
                    lastUpdated: now,
                });

                // Deduct from kitchen stock
                batch.update(doc(db, `clubs/${club.id}/kitchenStock`, item.productId), {
                    quantity: increment(-item.quantity),
                    lastUpdated: now,
                });

                // Inventory log
                const logRef = doc(collection(db, `clubs/${club.id}/inventoryLogs`));
                batch.set(logRef, {
                    id: logRef.id,
                    clubId: club.id,
                    type: 'restock',
                    productId: item.productId,
                    productName: item.productName,
                    quantityChange: item.quantity,
                    quantityBefore: 0,
                    quantityAfter: 0,
                    referenceId: retId,
                    performedBy: input.verifiedBy,
                    date: today(),
                    createdAt: now,
                });
            }

            await batch.commit();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["kitchen"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
        },
    });
}

// ─── deductKitchenStockForOrder ─────────────────────────────────────────
// Called when an order is marked served. Looks up the unified recipe for
// each menu item, totals the base-unit consumption per pinned inventory
// item, converts to fractional packets via that item's `size`, and
// decrements `kitchenStock.quantity` accordingly.
//
// The new model has no graceLimit — stock is allowed to go negative
// (the kitchen team handles low-stock conversations verbally; we don't
// block orders on it).

export async function deductKitchenStockForOrder(
    clubId: string,
    orderItems: { productId: string; productName: string; quantity: number }[]
) {
    try {
        const recipesSnap = await getDocs(collection(db, `clubs/${clubId}/recipes`));
        const recipes = recipesSnap.docs.map(d => d.data() as Recipe);

        // Pass 1: per inventory item, total base-unit amount consumed.
        type Agg = { name: string; unit: string; amount: number };
        const aggByItem = new Map<string, Agg>();
        const missingRecipeItems: typeof orderItems = [];

        for (const item of orderItems) {
            const recipe = recipes.find(r =>
                r.isActive !== false && (r.menuItemId === item.productId || r.menuItemName === item.productName)
            );
            if (!recipe) { missingRecipeItems.push(item); continue; }
            for (const ing of recipe.ingredients) {
                // New shape requires inventoryItemId + amountPerServing. Skip any
                // legacy boxYield rows that survived the migration window.
                if (!ing.inventoryItemId || !ing.amountPerServing || ing.amountPerServing <= 0) continue;
                const amount = ing.amountPerServing * item.quantity;
                const prev = aggByItem.get(ing.inventoryItemId);
                if (prev) prev.amount += amount;
                else aggByItem.set(ing.inventoryItemId, {
                    name: ing.inventoryItemName,
                    unit: ing.unit,
                    amount,
                });
            }
        }

        if (aggByItem.size === 0 && missingRecipeItems.length === 0) return;

        // Pass 2: read kitchenStock docs in parallel to convert
        // base-unit amounts → fractional packet counts using each item's
        // `size`. Parallelizing keeps the critical-path latency flat
        // regardless of recipe length.
        const entries = Array.from(aggByItem.entries());
        const ksRefs = entries.map(([itemId]) =>
            doc(db, `clubs/${clubId}/kitchenStock`, itemId)
        );
        const ksSnaps = await Promise.all(ksRefs.map(ref => getDoc(ref)));

        const now = Timestamp.now();
        const todayStr = today();
        const batch = writeBatch(db);
        let hasWrites = false;

        for (let i = 0; i < entries.length; i++) {
            const [itemId, agg] = entries[i];
            const ksRef = ksRefs[i];
            const ksSnap = ksSnaps[i];
            // No kitchen-stock row → operator never gave this item to the
            // kitchen. Log it so it's visible, but don't create a phantom row.
            if (!ksSnap.exists()) {
                const logRef = doc(collection(db, `clubs/${clubId}/inventoryLogs`));
                batch.set(logRef, {
                    id: logRef.id,
                    clubId,
                    type: "shake_production_no_stock",
                    productId: itemId,
                    productName: agg.name,
                    note: `Recipe needs ${agg.amount} ${agg.unit} but ${agg.name} was never given to the kitchen.`,
                    performedBy: "kitchen_auto",
                    date: todayStr,
                    createdAt: now,
                });
                hasWrites = true;
                continue;
            }
            const data = ksSnap.data() as KitchenStockItem;
            const size = data.size > 0 ? data.size : 1;
            const packetsToDeduct = agg.amount / size;
            const before = (data.quantity ?? 0);
            const after = before - packetsToDeduct;

            batch.update(ksRef, {
                quantity: after,
                lastUpdated: now,
            });

            const logRef = doc(collection(db, `clubs/${clubId}/inventoryLogs`));
            batch.set(logRef, {
                id: logRef.id,
                clubId,
                type: "shake_production",
                productId: itemId,
                productName: agg.name,
                amountUsed: agg.amount,         // raw base-unit consumption
                amountUnit: agg.unit,
                packetsBefore: before,
                packetsAfter: after,
                packetsChange: -packetsToDeduct,
                performedBy: "kitchen_auto",
                date: todayStr,
                createdAt: now,
            });
            hasWrites = true;
        }

        for (const missing of missingRecipeItems) {
            const logRef = doc(collection(db, `clubs/${clubId}/inventoryLogs`));
            batch.set(logRef, {
                id: logRef.id,
                clubId,
                type: "missing_recipe",
                productId: missing.productId,
                productName: missing.productName,
                note: `No active recipe for "${missing.productName}" — ${missing.quantity} shake(s) served without deduction.`,
                performedBy: "kitchen_auto",
                date: todayStr,
                createdAt: now,
            });
            hasWrites = true;
        }

        if (hasWrites) await batch.commit();
    } catch (err) {
        // Non-blocking: don't fail the order if kitchen stock deduction fails
        console.error("[KitchenStock] Auto-deduction failed:", err);
    }
}

// ─── useRecordShiftHandover ─────────────────────────────────────────────
// Records a shift change between kitchen staff. Captures current kitchen
// stock as a snapshot so the incoming person has a recorded baseline and
// the outgoing person is on the hook for any discrepancy against it.

export function useRecordShiftHandover() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            outgoingName: string;
            incomingName: string;
            incomingId?: string;           // optional — present when verified via accountant
            servedCountToday: number;      // number of orders served during the outgoing shift
            stockSnapshot: { productId: string; productName: string; quantity: number; unit: string }[];
            notes?: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const id = "handover_" + Date.now();
            await setDoc(doc(db, `clubs/${club.id}/kitchenShiftHandovers`, id), {
                id,
                outgoingName: input.outgoingName,
                incomingName: input.incomingName,
                incomingId: input.incomingId ?? null,
                servedCountToday: input.servedCountToday,
                stockSnapshot: input.stockSnapshot,
                notes: input.notes ?? "",
                date: today(),
                handedOverAt: Timestamp.now(),
            });
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
    });
}

// ─── restoreKitchenStockForOrder ────────────────────────────────────────
// Reverse of deductKitchenStockForOrder — called when an order is rejected
// so the kitchen team is not charged for shakes they never prepared.

export async function restoreKitchenStockForOrder(
    clubId: string,
    orderItems: { productId: string; productName: string; quantity: number }[]
): Promise<boolean> {
    try {
        const recipesSnap = await getDocs(collection(db, `clubs/${clubId}/recipes`));
        const recipes = recipesSnap.docs.map(d => d.data() as Recipe);

        const batch = writeBatch(db);
        let hasRestores = false;

        for (const item of orderItems) {
            const recipe = recipes.find(r =>
                r.isActive && (r.menuItemId === item.productId || r.menuItemName === item.productName)
            );
            if (!recipe) continue;

            for (const ingredient of recipe.ingredients) {
                if (ingredient.boxYield <= 0) continue;
                const consumption = item.quantity / ingredient.boxYield;
                if (consumption <= 0) continue;

                const ksRef = doc(db, `clubs/${clubId}/kitchenStock`, ingredient.productId);
                batch.set(ksRef, {
                    productId: ingredient.productId,
                    productName: ingredient.productName,
                    quantity: increment(consumption), // ← positive: restoring
                    unit: ingredient.unit,
                    graceLimit: -2,
                    lastUpdated: Timestamp.now(),
                }, { merge: true });
                hasRestores = true;
            }
        }

        if (hasRestores) await batch.commit();
        return hasRestores;
    } catch (err) {
        console.error("[KitchenStock] Restore-on-reject failed:", err);
        return false;
    }
}

// ─── calculateRequiredStock ─────────────────────────────────────────────
// Given today's shakes + estimated count, calculate required ingredients

export function calculateRequiredStock(
    recipes: Recipe[],
    shakeEstimates: { menuItemId: string; menuItemName: string; count: number }[]
): { productId: string; productName: string; requiredQty: number; unit: string }[] {
    const needs: Record<string, { productId: string; productName: string; qty: number; unit: string }> = {};

    for (const est of shakeEstimates) {
        const recipe = recipes.find(r =>
            r.isActive && (r.menuItemId === est.menuItemId || r.menuItemName === est.menuItemName)
        );
        if (!recipe) continue;

        for (const ing of recipe.ingredients) {
            if (ing.boxYield <= 0) continue;
            const required = Math.ceil(est.count / ing.boxYield);
            if (!needs[ing.productId]) {
                needs[ing.productId] = { productId: ing.productId, productName: ing.productName, qty: 0, unit: ing.unit };
            }
            needs[ing.productId].qty += required;
        }
    }

    return Object.values(needs).map(n => ({
        productId: n.productId,
        productName: n.productName,
        requiredQty: n.qty,
        unit: n.unit,
    }));
}
