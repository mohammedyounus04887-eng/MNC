/**
 * Inventory v2 — clean rewrite of the inventory model.
 *
 * Replaces the messy parallel state of useInventoryManagement +
 * useKitchenInventory + useInventory (legacy) + useUnifiedInventory
 * with a single hook + single event log.
 *
 * Collections used:
 *   clubs/{clubId}/inventory/{id}            — current stock (same as before)
 *   clubs/{clubId}/inventoryEvents/{id}      — NEW unified event log
 *   clubs/{clubId}/inventoryRecipients/{id}  — saved recipients (people /
 *                                              groups / clubs we've lent to,
 *                                              for autocomplete)
 *
 * Per owner spec:
 *   - No PIN gate (security comes later).
 *   - Stock-out can target a member OR a free-form named recipient.
 *   - Each "stock out" event can carry multiple line-items.
 *   - History is a single chronological feed across all subtypes.
 */

import { useEffect, useState } from "react";
import {
    addDoc, collection, doc, increment, onSnapshot, query,
    serverTimestamp, setDoc, Timestamp, updateDoc, where, orderBy, limit,
    writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { withAuthRefresh } from "@/lib/firestoreSafe";

// ─── Types ───────────────────────────────────────────────────────────────

export interface InventoryItem {
    id: string;
    name: string;             // e.g. "Formula 1 Chocolate"
    category?: string;        // "Shake Mix" / "Tea" / "Protein" / "Aloe" / "Other"
    size?: string;            // "550g" / "1L"
    unit?: string;            // free text: "box" / "bottle" / "tin"
    quantity: number;         // current stock count (in `unit`)
    lowStockThreshold?: number;
    pricePerUnit?: number;    // optional, for valuation
    photoUrl?: string;
    notes?: string;
    createdAt?: any;
    updatedAt?: any;
}

export type EventSubtype =
    | "restock"             // stock-in: add to an existing item
    | "new_product"         // stock-in: brand-new item with initial qty
    | "today_usage"         // stock-out: today's internal consumption
    | "member_given"        // stock-out: given to a specific member
    | "recipient_given"     // stock-out: given to a named recipient (group/event/club)
    | "virtual_collection"  // stock-out: virtual member collecting paid-for products
    | "adjustment";         // stock-out OR stock-in: manual correction

export interface EventItem {
    itemId: string;
    itemName: string;    // snapshot at write time
    qty: number;         // always positive; direction comes from `type`
}

export interface InventoryRecipient {
    id: string;
    name: string;
    notes?: string;
    lastUsedAt?: any;
    transactionsCount?: number;
}

export interface InventoryEvent {
    id: string;
    type: "in" | "out";
    subtype: EventSubtype;
    items: EventItem[];
    recipient?: { kind: "member" | "named" | "virtual"; id?: string; name: string; phone?: string };
    supplier?: string;     // for stock-in restock
    invoiceNo?: string;    // for stock-in restock
    notes?: string;
    date: string;          // YYYY-MM-DD — admin-pickable, not necessarily today
    createdAt: any;
    createdBy?: string;
}

// ─── Live items subscription ─────────────────────────────────────────────

export function useInventoryItems(clubId: string | null) {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setItems([]); setLoading(false); return; }
        const u = onSnapshot(
            collection(db, `clubs/${clubId}/inventory`),
            (snap) => {
                setItems(snap.docs
                    .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
                    // hide deleted ones — soft delete via deleted:true flag
                    .filter(it => !(it as any).deleted)
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                );
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => u();
    }, [clubId]);

    return { items, loading };
}

// ─── Live events subscription (limited & filtered) ──────────────────────

export function useInventoryEvents(clubId: string | null, limitN = 200) {
    const [events, setEvents] = useState<InventoryEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setEvents([]); setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/inventoryEvents`),
            orderBy("createdAt", "desc"),
            limit(limitN),
        );
        const u = onSnapshot(q,
            (snap) => {
                setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryEvent)));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => u();
    }, [clubId, limitN]);

    return { events, loading };
}

// ─── Saved recipients (for autocomplete) ─────────────────────────────────

export function useInventoryRecipients(clubId: string | null) {
    const [recipients, setRecipients] = useState<InventoryRecipient[]>([]);

    useEffect(() => {
        if (!clubId) { setRecipients([]); return; }
        const u = onSnapshot(
            query(collection(db, `clubs/${clubId}/inventoryRecipients`), orderBy("lastUsedAt", "desc")),
            (snap) => setRecipients(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryRecipient))),
            () => {},
        );
        return () => u();
    }, [clubId]);

    return recipients;
}

// ─── Mutations ───────────────────────────────────────────────────────────

/** Create a brand-new product line. Writes the inventory doc + a
 *  matching `new_product` stock-in event so the history shows when it
 *  was introduced. */
export async function createInventoryItem(
    clubId: string,
    input: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
): Promise<{ ok: boolean; id?: string; errorMessage?: string }> {
    try {
        let docId = "";
        await withAuthRefresh(async () => {
            const ref = await addDoc(collection(db, `clubs/${clubId}/inventory`), {
                ...input,
                quantity: Number(input.quantity) || 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            docId = ref.id;
            // Log a new_product event so it appears in history
            if ((Number(input.quantity) || 0) > 0) {
                await addDoc(collection(db, `clubs/${clubId}/inventoryEvents`), {
                    type: "in",
                    subtype: "new_product",
                    items: [{ itemId: docId, itemName: input.name, qty: Number(input.quantity) || 0 }],
                    date: new Date().toISOString().slice(0, 10),
                    createdAt: serverTimestamp(),
                    createdBy: "owner_admin",
                });
            }
        });
        return { ok: true, id: docId };
    } catch (e: any) {
        console.error("[inventoryV2] createItem", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Update an existing inventory item (rename / change threshold / etc.). */
export async function updateInventoryItem(
    clubId: string,
    itemId: string,
    updates: Partial<InventoryItem>,
): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
        await withAuthRefresh(async () => {
            await updateDoc(doc(db, `clubs/${clubId}/inventory`, itemId), {
                ...updates,
                updatedAt: serverTimestamp(),
            });
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[inventoryV2] updateItem", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Soft-delete an inventory item. The doc stays for history continuity. */
export async function deleteInventoryItem(
    clubId: string,
    itemId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
        await withAuthRefresh(async () => {
            await updateDoc(doc(db, `clubs/${clubId}/inventory`, itemId), {
                deleted: true,
                deletedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[inventoryV2] deleteItem", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Restock — add quantity to an existing item. Batches the inventory
 *  increment + event write. */
export async function restockItems(
    clubId: string,
    lines: Array<{ itemId: string; itemName: string; qty: number }>,
    meta: { supplier?: string; invoiceNo?: string; notes?: string; date?: string } = {},
): Promise<{ ok: boolean; errorMessage?: string }> {
    if (lines.length === 0) return { ok: false, errorMessage: "No items to restock" };
    try {
        await withAuthRefresh(async () => {
            const batch = writeBatch(db);
            for (const ln of lines) {
                if (!ln.itemId || !ln.qty) continue;
                batch.update(doc(db, `clubs/${clubId}/inventory`, ln.itemId), {
                    quantity: increment(Number(ln.qty)),
                    updatedAt: serverTimestamp(),
                });
            }
            const eventRef = doc(collection(db, `clubs/${clubId}/inventoryEvents`));
            batch.set(eventRef, {
                type: "in",
                subtype: "restock",
                items: lines,
                supplier: meta.supplier || null,
                invoiceNo: meta.invoiceNo || null,
                notes: meta.notes || null,
                date: meta.date || new Date().toISOString().slice(0, 10),
                createdAt: serverTimestamp(),
                createdBy: "owner_admin",
            });
            await batch.commit();
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[inventoryV2] restock", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Stock-out — for today's usage, member-given, recipient-given, or
 *  adjustment. Subtype determines downstream reporting. */
export async function recordStockOut(
    clubId: string,
    lines: Array<{ itemId: string; itemName: string; qty: number }>,
    subtype: "today_usage" | "member_given" | "recipient_given" | "virtual_collection" | "adjustment",
    recipient: { kind: "member" | "named" | "virtual"; id?: string; name: string; phone?: string } | null,
    meta: { notes?: string; date?: string } = {},
): Promise<{ ok: boolean; errorMessage?: string }> {
    if (lines.length === 0) return { ok: false, errorMessage: "No items to record" };
    try {
        await withAuthRefresh(async () => {
            const batch = writeBatch(db);
            for (const ln of lines) {
                if (!ln.itemId || !ln.qty) continue;
                batch.update(doc(db, `clubs/${clubId}/inventory`, ln.itemId), {
                    quantity: increment(-Number(ln.qty)),
                    updatedAt: serverTimestamp(),
                });
            }
            const eventRef = doc(collection(db, `clubs/${clubId}/inventoryEvents`));
            batch.set(eventRef, {
                type: "out",
                subtype,
                items: lines,
                ...(recipient ? { recipient } : {}),
                notes: meta.notes || null,
                date: meta.date || new Date().toISOString().slice(0, 10),
                createdAt: serverTimestamp(),
                createdBy: "owner_admin",
            });

            // Bump the named recipient's lastUsedAt for autocomplete ranking.
            if (recipient?.kind === "named" && recipient.name) {
                const id = recipientIdFor(recipient.name);
                const recipientRef = doc(db, `clubs/${clubId}/inventoryRecipients`, id);
                batch.set(recipientRef, {
                    name: recipient.name,
                    lastUsedAt: serverTimestamp(),
                    transactionsCount: increment(1),
                }, { merge: true });
            }

            await batch.commit();
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[inventoryV2] stockOut", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Stable id for a free-form recipient name (so re-using the same name
 *  doesn't create a new doc each time). */
function recipientIdFor(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "unnamed";
}

/** Save a recipient explicitly (admin can add one without using it yet). */
export async function saveRecipient(
    clubId: string,
    name: string,
    notes?: string,
): Promise<{ ok: boolean; id?: string; errorMessage?: string }> {
    if (!name.trim()) return { ok: false, errorMessage: "Name required" };
    try {
        const id = recipientIdFor(name);
        await withAuthRefresh(async () => {
            await setDoc(doc(db, `clubs/${clubId}/inventoryRecipients`, id), {
                name: name.trim(),
                notes: notes || null,
                lastUsedAt: serverTimestamp(),
                transactionsCount: 0,
            }, { merge: true });
        });
        return { ok: true, id };
    } catch (e: any) {
        console.error("[inventoryV2] saveRecipient", e);
        return { ok: false, errorMessage: e?.message || "Unknown error" };
    }
}

/** Convenience: classify subtype for filtering UIs. */
export function isStockIn(s: EventSubtype): boolean {
    return s === "restock" || s === "new_product";
}
export function isStockOut(s: EventSubtype): boolean {
    return s === "today_usage" || s === "member_given" || s === "recipient_given" || s === "adjustment";
}

// Silence unused-import warnings for future use
void Timestamp;
