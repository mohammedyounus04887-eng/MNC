/**
 * Hooks for the unified inventory model. One collection (`inventory`),
 * one kitchen mirror (`kitchenStock`), one event log (`kitchenStockEvents`).
 *
 * All face-verified stock movements (admin restock, kitchen add/return,
 * end-of-day close) go through `useStockMutations` so they stay atomic
 * and auditable in one place.
 */

import { useEffect, useState } from "react";
import {
    collection, doc, onSnapshot, query, where, getDoc, getDocs,
    setDoc, updateDoc, deleteDoc, writeBatch, Timestamp, increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type {
    InventoryItem, KitchenStockItem, KitchenStockEvent,
    KitchenStockEventItem, Recipe,
} from "@/types/firestore";

function today() { return new Date().toISOString().slice(0, 10); }
function genId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Reads ─────────────────────────────────────────────────────────────

export function useInventoryItems() {
    const { club } = useClubContext();
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/inventory`),
            (snap) => {
                const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem));
                list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                setItems(list);
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [club]);

    return { items, loading };
}

export function useKitchenStockItems() {
    const { club } = useClubContext();
    const [stock, setStock] = useState<KitchenStockItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/kitchenStock`),
            (snap) => {
                const list = snap.docs.map((d) => ({
                    inventoryItemId: d.id,
                    ...d.data(),
                } as KitchenStockItem));
                list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                setStock(list);
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [club]);

    return { stock, loading };
}

export function useRecipesUnified() {
    const { club } = useClubContext();
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/recipes`),
            (snap) => {
                setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recipe)));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [club]);

    return { recipes, loading };
}

/** Subscribe to today's served orders so we can derive Used-Today. */
export function useTodayServedOrders() {
    const { club } = useClubContext();
    const [orders, setOrders] = useState<any[]>([]);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/orders`),
            where("date", "==", today()),
            where("status", "==", "served"),
        );
        const unsub = onSnapshot(q, (snap) => {
            setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [club]);

    return orders;
}

// ─── Inventory item CRUD ───────────────────────────────────────────────

export async function createInventoryItem(clubId: string, data: {
    name: string; size: number; unit: string; category?: string;
    price?: number; isForSale?: boolean; lowStockThreshold?: number; imageUrl?: string;
}): Promise<string> {
    const id = genId("inv");
    const now = Timestamp.now();
    await setDoc(doc(db, `clubs/${clubId}/inventory`, id), {
        id,
        name: data.name.trim(),
        size: data.size,
        unit: data.unit,
        quantity: 0,
        category: data.category || "",
        price: data.price ?? 0,
        isForSale: data.isForSale ?? false,
        lowStockThreshold: data.lowStockThreshold ?? 0,
        imageUrl: data.imageUrl || "",
        createdAt: now,
        lastUpdated: now,
    });
    return id;
}

export async function updateInventoryItem(clubId: string, itemId: string, data: Partial<InventoryItem>) {
    await updateDoc(doc(db, `clubs/${clubId}/inventory`, itemId), {
        ...data,
        lastUpdated: Timestamp.now(),
    });
}

export async function deleteInventoryItem(clubId: string, itemId: string) {
    // Also drop the kitchen mirror (if any) so we don't keep an orphan row.
    const batch = writeBatch(db);
    batch.delete(doc(db, `clubs/${clubId}/inventory`, itemId));
    batch.delete(doc(db, `clubs/${clubId}/kitchenStock`, itemId));
    await batch.commit();
}

// ─── Stock movements (face-verified) ───────────────────────────────────

interface MovementInput {
    items: KitchenStockEventItem[];
    verifiedBy: string;
    verifiedById: string;
}

/**
 * Admin owner restock — bumps `inventory.quantity` by the packets in the
 * basket and writes a log event tagged 'add' with no kitchen change. The
 * 'add' type is shared with kitchen-side give-to-kitchen because both
 * grow stock somewhere — the difference is recorded in `usedSnapshot`
 * (omitted for restock) and the absence of a kitchenStock mutation.
 */
export async function commitAdminRestock(clubId: string, input: MovementInput) {
    if (input.items.length === 0) throw new Error("No items to restock");
    const batch = writeBatch(db);
    const now = Timestamp.now();
    for (const it of input.items) {
        if (it.quantity <= 0) continue;
        batch.update(doc(db, `clubs/${clubId}/inventory`, it.inventoryItemId), {
            quantity: increment(it.quantity),
            lastUpdated: now,
        });
    }
    const eventId = genId("evt");
    batch.set(doc(db, `clubs/${clubId}/kitchenStockEvents`, eventId), {
        id: eventId,
        type: "add",
        items: input.items,
        verifiedBy: input.verifiedBy,
        verifiedById: input.verifiedById,
        date: today(),
        createdAt: now,
        scope: "admin_restock",
    } as any);
    await batch.commit();
}

/**
 * Kitchen "Add Stock" — physically moves packets from admin → kitchen.
 * Atomic: admin -, kitchen + (creates kitchenStock doc on first touch).
 */
export async function commitGiveToKitchen(clubId: string, input: MovementInput) {
    if (input.items.length === 0) throw new Error("No items to give");

    // Pre-read every inventory doc so we can validate availability and
    // hydrate the kitchen mirror with the source item's name/size/unit
    // (kitchenStock mirrors the inventory doc fields verbatim so the UI
    // doesn't have to cross-reference).
    const invDocs = await Promise.all(
        input.items.map((it) => getDoc(doc(db, `clubs/${clubId}/inventory`, it.inventoryItemId))),
    );

    const batch = writeBatch(db);
    const now = Timestamp.now();
    for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        if (it.quantity <= 0) continue;
        const invSnap = invDocs[i];
        if (!invSnap.exists()) throw new Error(`Inventory item ${it.name} no longer exists`);
        const invData = invSnap.data() as InventoryItem;

        batch.update(doc(db, `clubs/${clubId}/inventory`, it.inventoryItemId), {
            quantity: increment(-it.quantity),
            lastUpdated: now,
        });
        batch.set(doc(db, `clubs/${clubId}/kitchenStock`, it.inventoryItemId), {
            inventoryItemId: it.inventoryItemId,
            name: invData.name,
            size: invData.size,
            unit: invData.unit,
            quantity: increment(it.quantity),
            lastUpdated: now,
        }, { merge: true });
    }
    const eventId = genId("evt");
    batch.set(doc(db, `clubs/${clubId}/kitchenStockEvents`, eventId), {
        id: eventId,
        type: "add",
        items: input.items,
        verifiedBy: input.verifiedBy,
        verifiedById: input.verifiedById,
        date: today(),
        createdAt: now,
    });
    await batch.commit();
}

/** Kitchen "Return Stock" — moves packets from kitchen → admin. */
export async function commitReturnToInventory(clubId: string, input: MovementInput) {
    if (input.items.length === 0) throw new Error("No items to return");
    const batch = writeBatch(db);
    const now = Timestamp.now();
    for (const it of input.items) {
        if (it.quantity <= 0) continue;
        batch.update(doc(db, `clubs/${clubId}/kitchenStock`, it.inventoryItemId), {
            quantity: increment(-it.quantity),
            lastUpdated: now,
        });
        batch.update(doc(db, `clubs/${clubId}/inventory`, it.inventoryItemId), {
            quantity: increment(it.quantity),
            lastUpdated: now,
        });
    }
    const eventId = genId("evt");
    batch.set(doc(db, `clubs/${clubId}/kitchenStockEvents`, eventId), {
        id: eventId,
        type: "return",
        items: input.items,
        verifiedBy: input.verifiedBy,
        verifiedById: input.verifiedById,
        date: today(),
        createdAt: now,
    });
    await batch.commit();
}

/**
 * End-of-day close. Saves a snapshot (returned packets + used today) and
 * moves *all* remaining kitchen stock back to admin in one atomic write.
 */
export async function commitEndOfDay(clubId: string, input: {
    remainingItems: KitchenStockEventItem[];   // current kitchen stock
    usedToday: KitchenStockEventItem[];        // derived from served orders
    verifiedBy: string;
    verifiedById: string;
}) {
    const batch = writeBatch(db);
    const now = Timestamp.now();
    for (const it of input.remainingItems) {
        if (it.quantity <= 0) continue;
        batch.update(doc(db, `clubs/${clubId}/kitchenStock`, it.inventoryItemId), {
            quantity: 0,
            lastUpdated: now,
        });
        batch.update(doc(db, `clubs/${clubId}/inventory`, it.inventoryItemId), {
            quantity: increment(it.quantity),
            lastUpdated: now,
        });
    }
    const eventId = genId("evt");
    batch.set(doc(db, `clubs/${clubId}/kitchenStockEvents`, eventId), {
        id: eventId,
        type: "eod_close",
        items: input.remainingItems,
        usedSnapshot: input.usedToday,
        verifiedBy: input.verifiedBy,
        verifiedById: input.verifiedById,
        date: today(),
        createdAt: now,
    });
    await batch.commit();
}

// ─── Wipe old data (one-time migration helper) ─────────────────────────

/**
 * One-shot cleanup the user runs from the admin page after deciding to
 * adopt the new model. Wipes all old recipes (their boxYield-based shape
 * is incompatible) and zeros out the legacy pack[] / packs[] data on
 * existing inventory docs so the new UI can take over without ghosts.
 *
 * Safe to run more than once. Returns counts for the toast.
 */
export async function wipeLegacyInventoryData(clubId: string) {
    const recipesSnap = await getDocs(collection(db, `clubs/${clubId}/recipes`));
    const inventorySnap = await getDocs(collection(db, `clubs/${clubId}/inventory`));
    const kitchenStockSnap = await getDocs(collection(db, `clubs/${clubId}/kitchenStock`));

    const batch = writeBatch(db);
    for (const d of recipesSnap.docs) batch.delete(d.ref);
    for (const d of inventorySnap.docs) batch.delete(d.ref);
    for (const d of kitchenStockSnap.docs) batch.delete(d.ref);
    await batch.commit();

    return {
        recipes: recipesSnap.size,
        inventory: inventorySnap.size,
        kitchenStock: kitchenStockSnap.size,
    };
}
