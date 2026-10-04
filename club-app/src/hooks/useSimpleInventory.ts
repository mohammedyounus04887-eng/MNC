/**
 * useSimpleInventory — admin-side "boxed inventory" system.
 *
 * Separate from the legacy kitchen/recipe/sales inventory. Stores boxed
 * products and an append-only ledger of stock movements (additions, daily
 * club usage, event give-aways).
 *
 * Collections (per club):
 *   - clubs/{clubId}/simpleProducts       — product catalogue
 *   - clubs/{clubId}/stockMovements       — append-only history log
 *
 * Stock balance is the sum of all movement.delta for a product (positive
 * for inflow, negative for outflow). We also denormalise `currentStock`
 * onto the product doc so list views don't have to aggregate.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, addDoc, updateDoc, deleteDoc,
    runTransaction, Timestamp, query, orderBy, getDocs, getDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────

export type MovementType =
    | "product_added"
    | "stock_added"
    | "club_usage"
    | "event_give"
    | "give_to_person"
    | "borrow_returned";

export interface SimpleProduct {
    id: string;
    name: string;
    flavor: string;
    size: string;
    imageUrl: string;
    currentStock: number;     // denormalised box count
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface StockMovement {
    id: string;
    type: MovementType;
    productId: string;
    productName: string;     // denormalised (so deleted products still show)
    productFlavor: string;   // denormalised
    productSize: string;     // denormalised
    delta: number;           // +N for inflow, -N for outflow
    eventName?: string;      // for type === "event_give"
    personName?: string;     // for type === "give_to_person" / "borrow_returned"
    batchId?: string;        // groups multi-product event entries together
    borrowId?: string;       // links to a personalBorrows doc
    notes?: string;
    createdAt: Timestamp;
}

// ─── Personal borrow ──────────────────────────────────────────────────────
// One document per "Give to Person" event. Stock movements are logged in
// parallel so the History page stays the single source of truth for audit.

export interface BorrowItem {
    productId: string;
    productName: string;
    productFlavor: string;
    productSize: string;
    quantity: number;
}

export interface PersonalBorrow {
    id: string;
    personName: string;
    personPhone?: string;
    notes?: string;
    returnDeadline: string;   // YYYY-MM-DD
    status: "pending" | "returned";
    items: BorrowItem[];
    totalBoxes: number;       // sum of item.quantity, denormalised
    createdAt: Timestamp;
    returnedAt?: Timestamp | null;
}

// ─── Paths ───────────────────────────────────────────────────────────────

const productsPath = (clubId: string) => `clubs/${clubId}/simpleProducts`;
const movementsPath = (clubId: string) => `clubs/${clubId}/stockMovements`;
const borrowsPath = (clubId: string) => `clubs/${clubId}/personalBorrows`;

// ─── Queries ─────────────────────────────────────────────────────────────

export function useSimpleProducts(clubId: string | null) {
    return useQuery({
        queryKey: ["simpleProducts", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const snap = await getDocs(query(
                collection(db, productsPath(clubId!)),
                orderBy("name"),
            ));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as SimpleProduct));
        },
    });
}

export function useStockMovements(clubId: string | null) {
    return useQuery({
        queryKey: ["stockMovements", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const snap = await getDocs(query(
                collection(db, movementsPath(clubId!)),
                orderBy("createdAt", "desc"),
            ));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as StockMovement));
        },
    });
}

// ─── Mutations ───────────────────────────────────────────────────────────

export function useAddSimpleProduct() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            clubId: string;
            name: string;
            flavor: string;
            size: string;
            imageFile?: File | null;
            imageUrl?: string;        // pasted URL alternative to uploading a file
        }) => {
            const now = Timestamp.now();
            const ref0 = await addDoc(collection(db, productsPath(input.clubId)), {
                name: input.name.trim(),
                flavor: input.flavor.trim(),
                size: input.size.trim(),
                imageUrl: input.imageUrl?.trim() || "",
                currentStock: 0,
                createdAt: now,
                updatedAt: now,
            });

            if (input.imageFile) {
                const storageRef = ref(storage, `clubs/${input.clubId}/simpleProducts/${ref0.id}`);
                await uploadBytes(storageRef, input.imageFile);
                const url = await getDownloadURL(storageRef);
                await updateDoc(ref0, { imageUrl: url });
            }

            // Log a "product_added" movement (delta 0 — no stock impact, just audit).
            await addDoc(collection(db, movementsPath(input.clubId)), {
                type: "product_added",
                productId: ref0.id,
                productName: input.name.trim(),
                productFlavor: input.flavor.trim(),
                productSize: input.size.trim(),
                delta: 0,
                createdAt: now,
            });
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
        },
    });
}

export function useDeleteSimpleProduct() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, productId }: { clubId: string; productId: string }) => {
            await deleteDoc(doc(db, productsPath(clubId), productId));
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
        },
    });
}

// Generic helper: apply a delta to a product's currentStock and log a
// movement, atomically. Used by add-stock / club-usage / event-give.
async function applyMovement(
    clubId: string,
    product: Pick<SimpleProduct, "id" | "name" | "flavor" | "size">,
    delta: number,
    extra: {
        type: MovementType;
        eventName?: string;
        personName?: string;
        batchId?: string;
        borrowId?: string;
        notes?: string;
    },
) {
    const pRef = doc(db, productsPath(clubId), product.id);
    const mRef = doc(collection(db, movementsPath(clubId))); // pre-allocate id

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(pRef);
        if (!snap.exists()) throw new Error("Product not found");
        const current = Number(snap.data().currentStock) || 0;
        const next = current + delta;
        if (next < 0) throw new Error(`Not enough stock for ${product.name} (have ${current}, need ${-delta})`);
        tx.update(pRef, { currentStock: next, updatedAt: Timestamp.now() });
        tx.set(mRef, {
            type: extra.type,
            productId: product.id,
            productName: product.name,
            productFlavor: product.flavor,
            productSize: product.size,
            delta,
            eventName: extra.eventName ?? null,
            personName: extra.personName ?? null,
            batchId: extra.batchId ?? null,
            borrowId: extra.borrowId ?? null,
            notes: extra.notes ?? null,
            createdAt: Timestamp.now(),
        });
    });
}

export function useAddStock() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            clubId: string;
            product: Pick<SimpleProduct, "id" | "name" | "flavor" | "size">;
            quantity: number;
            notes?: string;
        }) => {
            if (input.quantity <= 0) throw new Error("Quantity must be greater than zero");
            await applyMovement(input.clubId, input.product, input.quantity, {
                type: "stock_added",
                notes: input.notes,
            });
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
        },
    });
}

export function useRecordClubUsage() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            clubId: string;
            product: Pick<SimpleProduct, "id" | "name" | "flavor" | "size">;
            quantity: number;
            notes?: string;
        }) => {
            if (input.quantity <= 0) throw new Error("Quantity must be greater than zero");
            await applyMovement(input.clubId, input.product, -input.quantity, {
                type: "club_usage",
                notes: input.notes,
            });
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
        },
    });
}

export function useGiveForEvent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            clubId: string;
            eventName: string;
            items: Array<{
                product: Pick<SimpleProduct, "id" | "name" | "flavor" | "size">;
                quantity: number;
            }>;
            notes?: string;
        }) => {
            if (!input.eventName.trim()) throw new Error("Event name is required");
            const valid = input.items.filter(i => i.quantity > 0);
            if (valid.length === 0) throw new Error("Add at least one product with quantity > 0");

            // Single shared batchId so history groups them together
            const batchId = doc(collection(db, movementsPath(input.clubId))).id;

            // Apply sequentially (each is its own transaction). If any fails
            // the earlier ones are already persisted — for v1 that's
            // acceptable; surface the error so the manager can correct.
            for (const item of valid) {
                await applyMovement(input.clubId, item.product, -item.quantity, {
                    type: "event_give",
                    eventName: input.eventName.trim(),
                    batchId,
                    notes: input.notes,
                });
            }
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
        },
    });
}

// ─── Personal borrows ────────────────────────────────────────────────────

export function usePersonalBorrows(clubId: string | null) {
    return useQuery({
        queryKey: ["personalBorrows", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const snap = await getDocs(query(
                collection(db, borrowsPath(clubId!)),
                orderBy("returnDeadline"),
            ));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalBorrow));
        },
    });
}

export function useGiveToPerson() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: {
            clubId: string;
            personName: string;
            personPhone?: string;
            notes?: string;
            returnDeadline: string;       // YYYY-MM-DD
            items: Array<{
                product: Pick<SimpleProduct, "id" | "name" | "flavor" | "size">;
                quantity: number;
            }>;
        }) => {
            if (!input.personName.trim()) throw new Error("Person name is required");
            if (!input.returnDeadline) throw new Error("Return deadline is required");
            const valid = input.items.filter(i => i.quantity > 0);
            if (valid.length === 0) throw new Error("Add at least one product with quantity > 0");

            // 1. Create the borrow record first so we have a stable borrowId
            //    to link movements against.
            const borrowRef = await addDoc(collection(db, borrowsPath(input.clubId)), {
                personName: input.personName.trim(),
                personPhone: input.personPhone?.trim() || null,
                notes: input.notes?.trim() || null,
                returnDeadline: input.returnDeadline,
                status: "pending" as const,
                items: valid.map(v => ({
                    productId: v.product.id,
                    productName: v.product.name,
                    productFlavor: v.product.flavor,
                    productSize: v.product.size,
                    quantity: v.quantity,
                })),
                totalBoxes: valid.reduce((s, v) => s + v.quantity, 0),
                createdAt: Timestamp.now(),
                returnedAt: null,
            });

            // 2. Apply stock deductions. If any fails, the borrow doc is left
            //    in place — surface the error so the manager can correct.
            for (const item of valid) {
                await applyMovement(input.clubId, item.product, -item.quantity, {
                    type: "give_to_person",
                    personName: input.personName.trim(),
                    borrowId: borrowRef.id,
                    batchId: borrowRef.id,    // double-duty so history groups them
                    notes: input.notes,
                });
            }
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["personalBorrows", vars.clubId] });
        },
    });
}

// Mark a borrow as returned. Adds quantities back to product stock, logs
// a "borrow_returned" movement per item, and flips the borrow doc status.
export function useMarkBorrowReturned() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { clubId: string; borrowId: string }) => {
            const bRef = doc(db, borrowsPath(input.clubId), input.borrowId);
            const bSnap = await getDoc(bRef);
            if (!bSnap.exists()) throw new Error("Borrow record not found");
            const borrow = bSnap.data() as Omit<PersonalBorrow, "id">;
            if (borrow.status === "returned") throw new Error("Already marked as returned");

            // Restock each item + log the return movement
            for (const item of borrow.items) {
                await applyMovement(
                    input.clubId,
                    {
                        id: item.productId,
                        name: item.productName,
                        flavor: item.productFlavor,
                        size: item.productSize,
                    },
                    item.quantity,
                    {
                        type: "borrow_returned",
                        personName: borrow.personName,
                        borrowId: input.borrowId,
                        batchId: input.borrowId,
                    },
                );
            }

            // Flip the borrow status
            await updateDoc(bRef, {
                status: "returned",
                returnedAt: Timestamp.now(),
            });
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["simpleProducts", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["stockMovements", vars.clubId] });
            qc.invalidateQueries({ queryKey: ["personalBorrows", vars.clubId] });
        },
    });
}
