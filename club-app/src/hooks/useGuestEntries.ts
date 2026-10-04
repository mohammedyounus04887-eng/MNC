import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    collection, query, where, onSnapshot, doc, getDoc, getDocs,
    writeBatch, Timestamp, limit,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { GuestEntry, GuestEntryItem } from "@/types/firestore";
import { getNextOrderNumbers } from "@/utils/orderNumber";
import { deleteGuestCascade } from "@/lib/cascadeService";
import { todayLocal } from "@/lib/clubDay";

/**
 * The club's day, not UTC.
 *
 * This used to be `new Date().toISOString().slice(0, 10)`, and that is why a paid
 * guest's money could vanish from Today's Report. Every guest entry AND the
 * `payments` record written beside it were stamped with the UTC date, while the
 * report queries `where("date", "==", todayLocal())` — the club's local day.
 *
 * IST is UTC+5:30, so between midnight and 05:30 the two disagree by a day: the
 * payment is filed under yesterday, a day that is already closed and reconciled,
 * and it is simply absent from today's cash count. The money is in Firestore the
 * whole time, which is what makes it so hard to find — the drawer is short and
 * nothing in the report is obviously wrong.
 *
 * `todayLocal()` is the rule in CLAUDE.md for exactly this reason. The report side
 * was corrected already; this is the writer that was still on the old form.
 */
function todayStr() { return todayLocal(); }

// ─── Real-time listener for today's guest entries ─────────────────────────

export function useTodayGuestEntriesLive(clubId: string | null) {
    const [entries, setEntries] = useState<GuestEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) return;
        const q = query(
            collection(db, `clubs/${clubId}/guestEntries`),
            where("date", "==", todayStr())
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                // Deleting a guest soft-deletes the entry. Nothing filtered on
                // that, so a deleted guest still showed in the day's list and
                // counts — the deletion looked like it had done nothing.
                const docs = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }) as GuestEntry)
                    .filter((g) => !(g as any).deleted);
                docs.sort((a, b) => {
                    const at = (a.createdAt as any)?.toMillis?.() ?? 0;
                    const bt = (b.createdAt as any)?.toMillis?.() ?? 0;
                    return at - bt;
                });
                setEntries(docs);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsub();
    }, [clubId]);

    return { entries, loading };
}

// ─── Fetch guest entries for a specific date (one-time) ───────────────────

export function useGuestEntriesByDate(clubId: string | null, date: string | null) {
    return useQuery({
        queryKey: ["guestEntries", clubId, date],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${clubId!}/guestEntries`),
                    where("date", "==", date!)
                )
            );
            const docs = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as GuestEntry)
                .filter((g) => !(g as any).deleted);
            docs.sort((a, b) => {
                const at = (a.createdAt as any)?.toMillis?.() ?? 0;
                const bt = (b.createdAt as any)?.toMillis?.() ?? 0;
                return at - bt;
            });
            return docs;
        },
        enabled: !!clubId && !!date,
    });
}

// ─── Phone autocomplete: find recent guests by phone prefix ───────────────

export interface GuestPhoneSuggestion {
    name: string;
    phone: string;
    lastDate: string;
}

/**
 * Prefix-match past guest entries on `guestPhone`. Used by the wizard's
 * phone input to suggest known guests so the receptionist doesn't re-type
 * the name. Dedupes by phone, keeps most recent name. Cheap Firestore
 * query (single-field range, no index setup needed).
 */
export async function lookupGuestsByPhone(
    clubId: string,
    phonePrefix: string,
): Promise<GuestPhoneSuggestion[]> {
    if (!clubId || !phonePrefix || phonePrefix.length < 3) return [];
    const snap = await getDocs(
        query(
            collection(db, `clubs/${clubId}/guestEntries`),
            where("guestPhone", ">=", phonePrefix),
            where("guestPhone", "<=", phonePrefix + "\uf8ff"),
            limit(25),
        ),
    );
    const byPhone = new Map<string, GuestPhoneSuggestion>();
    for (const d of snap.docs) {
        const data = d.data() as any;
        const phone = data.guestPhone as string;
        if (!phone) continue;
        const date = (data.date as string) || "";
        const existing = byPhone.get(phone);
        if (!existing || date > existing.lastDate) {
            byPhone.set(phone, { name: data.guestName, phone, lastDate: date });
        }
    }
    return Array.from(byPhone.values()).slice(0, 5);
}

// ─── Add guest entry mutation ─────────────────────────────────────────────

export interface AddGuestEntryItemInput {
    type: 'shake' | 'inventory_product' | 'membership_plan';
    productId: string;
    productName: string;
    qty: number;
    unitPrice: number;          // 0 for unpaid
    unit?: string;              // inventory products only
    icePreference?: string;     // shakes only ('with ice' | 'without ice')
    stockType?: 'limited' | 'unlimited'; // shakes only
    faceFiles?: File[];         // shakes only — length should equal qty
}

export interface AddGuestEntryInput {
    guestName: string;
    guestPhone: string;
    type: 'paid' | 'unpaid';
    items: AddGuestEntryItemInput[];
    totalAmount: number;
    amountPaid?: number;
    paymentMethod?: 'cash' | 'upi' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    recordedBy: string;
}

export interface AddGuestEntryResult {
    entryId: string;
    tokenNumbers: string[];
    /** Snapshot of data needed to drive the post-save print. */
    printData: {
        guestName: string;
        guestPhone: string;
        guestPhotoUrl?: string;
        shakes: Array<{ name: string; qty: number; ice?: string }>;
        items: Array<{ name: string; qty: number; unitPrice: number; total: number }>;
        totalAmount: number;
        amountPaid: number;
        paymentMethod: 'cash' | 'upi' | 'split' | 'complimentary';
        cashAmount?: number;
        upiAmount?: number;
        upiAccountName?: string;
        upiNumber?: string;
        tokenNumbers: string[];
        receiptNumber: string;
        timestamp: Date;
    };
}

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function uploadFace(clubId: string, entryId: string, idx: number, file: File): Promise<string> {
    const storageRef = ref(storage, `clubs/${clubId}/guests/${entryId}_${idx}`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
}

export function useAddGuestEntry() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: AddGuestEntryInput): Promise<AddGuestEntryResult> => {
            if (!club) throw new Error("Club not loaded");
            const clubId = club.id;
            const today = todayStr();
            const entryId = genId("guest");
            const timestamp = new Date();

            // ── 1. Upload all face photos for shakes ─────────────────────
            // Each shake instance can have its own face (for multi-person guests).
            const shakeItems = input.items.filter(i => i.type === 'shake');
            const totalShakeQty = shakeItems.reduce((s, i) => s + i.qty, 0);

            // Build flat list of face files in cart-order so they line up with
            // the per-shake order docs we create below.
            const flatFaceFiles: (File | null)[] = [];
            for (const it of shakeItems) {
                const files = it.faceFiles ?? [];
                for (let i = 0; i < it.qty; i++) {
                    flatFaceFiles.push(files[i] ?? null);
                }
            }

            const flatFaceUrls: string[] = [];
            for (let i = 0; i < flatFaceFiles.length; i++) {
                const f = flatFaceFiles[i];
                flatFaceUrls.push(f ? await uploadFace(clubId, entryId, i, f) : "");
            }

            // ── 2. Reserve token numbers ─────────────────────────────────
            const tokenNumbers = await getNextOrderNumbers(clubId, totalShakeQty);

            // ── 3. Build batch ───────────────────────────────────────────
            const batch = writeBatch(db);
            const allOrderIds: string[] = [];
            const itemDocs: GuestEntryItem[] = [];

            // Walk shake items, slicing the flat face/token arrays as we go.
            let shakeCursor = 0;
            for (const it of shakeItems) {
                const itemFaceUrls = flatFaceUrls.slice(shakeCursor, shakeCursor + it.qty);
                const itemTokens = tokenNumbers.slice(shakeCursor, shakeCursor + it.qty);
                const itemOrderIds: string[] = [];

                // Create one kitchen order per shake (qty=1 each) so each
                // gets its own face on the card and its own token.
                for (let k = 0; k < it.qty; k++) {
                    const orderId = genId("guest_ord");
                    itemOrderIds.push(orderId);
                    allOrderIds.push(orderId);
                    batch.set(doc(db, `clubs/${clubId}/orders`, orderId), {
                        id: orderId,
                        memberId: "guest",
                        memberName: input.guestName,
                        memberPhoto: itemFaceUrls[k] || "",
                        clubId,
                        staffId: input.recordedBy || "guest",
                        items: [{
                            productId: it.productId,
                            productName: it.productName,
                            itemName: it.productName,
                            quantity: 1,
                            qty: 1,
                            pricePerUnit: it.unitPrice,
                            price: it.unitPrice,
                            notes: it.icePreference || (input.type === "paid" ? "Paid guest" : "Unpaid guest"),
                        }],
                        totalCost: it.unitPrice,
                        totalAmount: it.unitPrice,
                        paymentMethod: input.type === "paid" ? (input.paymentMethod ?? "cash") : "guest_credit",
                        orderedFrom: "guest",
                        source: "guest",
                        walletDeducted: false,
                        creditsUsed: 0,
                        status: "pending",
                        rating: null,
                        ratingNote: null,
                        tokenNumber: itemTokens[k],
                        date: today,
                        createdAt: Timestamp.now(),
                        servedAt: null,
                    });
                }

                // Decrement todaysSpecial.remainingStock for limited items
                if (it.stockType === "limited") {
                    const specialRef = doc(db, `clubs/${clubId}/todaysSpecial`, it.productId);
                    const specialSnap = await getDoc(specialRef);
                    if (specialSnap.exists()) {
                        const sd = specialSnap.data() as any;
                        const newRem = Math.max(0, (sd.remainingStock ?? 0) - it.qty);
                        batch.update(specialRef, {
                            remainingStock: newRem,
                            ...(newRem <= 0 ? { isActive: false } : {}),
                            updatedAt: Timestamp.now(),
                        });
                    }
                }

                // Decrement menu.stock if the menu doc exists (back-compat)
                const menuRef = doc(db, `clubs/${clubId}/menu`, it.productId);
                const menuSnap = await getDoc(menuRef);
                if (menuSnap.exists()) {
                    const cur = (menuSnap.data().stock as number) ?? 0;
                    batch.update(menuRef, { stock: Math.max(0, cur - it.qty), updatedAt: Timestamp.now() });
                }

                itemDocs.push({
                    type: 'shake',
                    productId: it.productId,
                    productName: it.productName,
                    qty: it.qty,
                    unitPrice: it.unitPrice,
                    total: it.unitPrice * it.qty,
                    faceUrls: itemFaceUrls,
                    orderIds: itemOrderIds,
                    tokenNumbers: itemTokens,
                });
                shakeCursor += it.qty;
            }

            // ── Inventory products ───────────────────────────────────────
            const productItems = input.items.filter(i => i.type === 'inventory_product');
            for (const it of productItems) {
                const invRef = doc(db, `clubs/${clubId}/inventory`, it.productId);
                const invSnap = await getDoc(invRef);
                if (invSnap.exists()) {
                    const cur = (invSnap.data().quantity as number) ?? 0;
                    const newQty = Math.max(0, cur - it.qty);
                    batch.update(invRef, { quantity: newQty, lastUpdated: Timestamp.now() });

                    const logId = genId("invlog_guest");
                    batch.set(doc(db, `clubs/${clubId}/inventoryLogs`, logId), {
                        id: logId,
                        clubId,
                        type: "product_sale",
                        productId: it.productId,
                        productName: it.productName,
                        quantityChange: -it.qty,
                        quantityBefore: cur,
                        quantityAfter: newQty,
                        referenceId: entryId,
                        performedBy: input.recordedBy,
                        date: today,
                        createdAt: Timestamp.now(),
                    });
                }
                itemDocs.push({
                    type: 'inventory_product',
                    productId: it.productId,
                    productName: it.productName,
                    qty: it.qty,
                    unitPrice: it.unitPrice,
                    total: it.unitPrice * it.qty,
                    unit: it.unit,
                });
            }

            // ── Membership plans (rare in guest flow but supported) ─────
            const planItems = input.items.filter(i => i.type === 'membership_plan');
            for (const it of planItems) {
                itemDocs.push({
                    type: 'membership_plan',
                    productId: it.productId,
                    productName: it.productName,
                    qty: it.qty,
                    unitPrice: it.unitPrice,
                    total: it.unitPrice * it.qty,
                });
            }

            // ── 4. Payment record (paid only) ────────────────────────────
            if (input.type === "paid" && (input.amountPaid ?? 0) > 0) {
                const paymentId = genId("guest_pay");
                const method = input.paymentMethod ?? "cash";
                batch.set(doc(db, `clubs/${clubId}/payments`, paymentId), {
                    id: paymentId,
                    type: "guest_payment",
                    guestName: input.guestName,
                    guestPhone: input.guestPhone,
                    amount: input.amountPaid ?? 0,
                    paymentMethod: method,
                    // Always store cashAmount/upiAmount so daily-total queries
                    // don't have to special-case the method to know how much
                    // landed in each tender.
                    cashAmount: method === "cash" ? (input.amountPaid ?? 0)
                              : method === "split" ? (input.cashAmount ?? 0)
                              : 0,
                    upiAmount: method === "upi" ? (input.amountPaid ?? 0)
                             : method === "split" ? (input.upiAmount ?? 0)
                             : 0,
                    ...(method !== "cash" && input.upiAccountId ? {
                        upiAccountId: input.upiAccountId,
                        upiAccountName: input.upiAccountName ?? null,
                        upiNumber: input.upiNumber ?? null,
                    } : {}),
                    description: `Guest: ${itemDocs.map(i => `${i.productName}×${i.qty}`).join(", ")}`,
                    date: today,
                    createdAt: Timestamp.now(),
                    referenceId: entryId,
                });
            }

            // ── 5. Guest entry doc ───────────────────────────────────────
            const primaryPhoto = flatFaceUrls.find(u => !!u);
            const entryData: Record<string, any> = {
                id: entryId,
                clubId,
                guestName: input.guestName,
                guestPhone: input.guestPhone,
                type: input.type,
                items: itemDocs,
                totalAmount: input.totalAmount,
                orderIds: allOrderIds,
                tokenNumbers,
                date: today,
                recordedBy: input.recordedBy,
                createdAt: Timestamp.now(),
            };
            if (primaryPhoto) entryData.guestPhoto = primaryPhoto;
            if (input.type === "paid") {
                const method = input.paymentMethod ?? "cash";
                entryData.amountPaid = input.amountPaid ?? 0;
                entryData.paymentMethod = method;
                entryData.cashAmount = method === "cash" ? (input.amountPaid ?? 0)
                                     : method === "split" ? (input.cashAmount ?? 0)
                                     : 0;
                entryData.upiAmount = method === "upi" ? (input.amountPaid ?? 0)
                                    : method === "split" ? (input.upiAmount ?? 0)
                                    : 0;
                if (method !== "cash" && input.upiAccountId) {
                    entryData.upiAccountId = input.upiAccountId;
                    if (input.upiAccountName) entryData.upiAccountName = input.upiAccountName;
                    if (input.upiNumber) entryData.upiNumber = input.upiNumber;
                }
            }

            batch.set(doc(db, `clubs/${clubId}/guestEntries`, entryId), entryData);

            await batch.commit();

            // ── 6. Build print payload ───────────────────────────────────
            const shakesForPrint = itemDocs
                .filter(i => i.type === 'shake')
                .map(i => {
                    // Pull ice preference from the original input (not stored on the item doc)
                    const orig = input.items.find(x => x.productId === i.productId && x.type === 'shake');
                    return { name: i.productName, qty: i.qty, ice: orig?.icePreference };
                });
            const itemsForPrint = itemDocs.map(i => ({
                name: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.total,
            }));

            const printMethod: 'cash' | 'upi' | 'split' | 'complimentary' =
                input.type === "paid" ? (input.paymentMethod ?? "cash") : "complimentary";
            return {
                entryId,
                tokenNumbers,
                printData: {
                    guestName: input.guestName,
                    guestPhone: input.guestPhone,
                    guestPhotoUrl: primaryPhoto,
                    shakes: shakesForPrint,
                    items: itemsForPrint,
                    totalAmount: input.totalAmount,
                    amountPaid: input.type === "paid" ? (input.amountPaid ?? 0) : 0,
                    paymentMethod: printMethod,
                    cashAmount: printMethod === "split" ? input.cashAmount
                              : printMethod === "cash" ? (input.amountPaid ?? 0)
                              : undefined,
                    upiAmount: printMethod === "split" ? input.upiAmount
                             : printMethod === "upi" ? (input.amountPaid ?? 0)
                             : undefined,
                    upiAccountName: (printMethod === "upi" || printMethod === "split") ? input.upiAccountName : undefined,
                    upiNumber: (printMethod === "upi" || printMethod === "split") ? input.upiNumber : undefined,
                    tokenNumbers,
                    receiptNumber: `G-${today.replace(/-/g, "")}-${entryId.slice(-4).toUpperCase()}`,
                    timestamp,
                },
            };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["orders"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
            qc.invalidateQueries({ queryKey: ["guestEntries"] });
        },
    });
}

// ─── Update guest entry ───────────────────────────────────────────────────
// For multi-item entries we only support editing the top-level fields
// (name, phone, type, payment). To change items, delete & re-add.

export interface UpdateGuestEntryInput {
    entryId: string;
    clubId: string;
    guestName: string;
    guestPhone: string;
    type: 'paid' | 'unpaid';
    amountPaid?: number;
    paymentMethod?: 'cash' | 'upi' | 'split';
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    existingEntry: GuestEntry;
}

export function useUpdateGuestEntry() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: UpdateGuestEntryInput) => {
            const clubId = input.clubId || club?.id;
            if (!clubId) throw new Error("Club not loaded");
            const batch = writeBatch(db);
            const old = input.existingEntry;

            // Update memberName on every kitchen order linked to this entry
            const orderIds = old.orderIds && old.orderIds.length > 0
                ? old.orderIds
                : (old.orderId ? [old.orderId] : []);
            for (const oid of orderIds) {
                const orderRef = doc(db, `clubs/${clubId}/orders`, oid);
                const orderSnap = await getDoc(orderRef);
                if (orderSnap.exists()) {
                    batch.update(orderRef, { memberName: input.guestName });
                }
            }

            // Sync payment record(s)
            const paySnap = await getDocs(
                query(collection(db, `clubs/${clubId}/payments`), where("referenceId", "==", input.entryId))
            );

            const splitForRecord = (method: 'cash' | 'upi' | 'split', amount: number) => ({
                paymentMethod: method,
                cashAmount: method === "cash" ? amount : method === "split" ? (input.cashAmount ?? 0) : 0,
                upiAmount: method === "upi" ? amount : method === "split" ? (input.upiAmount ?? 0) : 0,
                ...(method !== "cash" && input.upiAccountId ? {
                    upiAccountId: input.upiAccountId,
                    upiAccountName: input.upiAccountName ?? null,
                    upiNumber: input.upiNumber ?? null,
                } : {}),
            });

            if (old.type === "paid" && input.type === "unpaid") {
                paySnap.docs.forEach((d) => batch.delete(d.ref));
            } else if (old.type === "unpaid" && input.type === "paid") {
                const paymentId = genId("guest_pay");
                const method = input.paymentMethod ?? "cash";
                const amt = input.amountPaid ?? 0;
                batch.set(doc(db, `clubs/${clubId}/payments`, paymentId), {
                    id: paymentId,
                    type: "guest_payment",
                    guestName: input.guestName,
                    guestPhone: input.guestPhone,
                    amount: amt,
                    ...splitForRecord(method, amt),
                    description: `Guest: ${(old.items ?? []).map(i => `${i.productName}×${i.qty}`).join(", ") || old.shakeProductName || ""}`,
                    date: old.date,
                    createdAt: Timestamp.now(),
                    referenceId: input.entryId,
                });
            } else if (input.type === "paid" && paySnap.docs.length > 0) {
                const method = input.paymentMethod ?? "cash";
                const amt = input.amountPaid ?? 0;
                paySnap.docs.forEach((d) =>
                    batch.update(d.ref, {
                        guestName: input.guestName,
                        guestPhone: input.guestPhone,
                        amount: amt,
                        ...splitForRecord(method, amt),
                    })
                );
            }

            // Update the entry doc
            const updateData: Record<string, any> = {
                guestName: input.guestName,
                guestPhone: input.guestPhone,
                type: input.type,
                updatedAt: Timestamp.now(),
            };
            if (input.type === "paid") {
                const method = input.paymentMethod ?? "cash";
                const amt = input.amountPaid ?? 0;
                updateData.amountPaid = amt;
                Object.assign(updateData, splitForRecord(method, amt));
            } else {
                updateData.amountPaid = 0;
                updateData.cashAmount = 0;
                updateData.upiAmount = 0;
            }

            batch.update(doc(db, `clubs/${clubId}/guestEntries`, input.entryId), updateData);
            await batch.commit();
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ["orders"] });
            qc.invalidateQueries({ queryKey: ["guestEntries", vars.clubId] });
        },
    });
}

// ─── Delete guest entry (one pipe: cascadeService) ──────────────────────────────

// This used to carry its own rollback, which had drifted from the one in
// lib/cascadeService: this one HARD-deleted the entry, its payment and its
// inventory logs, while the Reports page only soft-deleted the entry and left
// everything else standing. Same button, two different outcomes, and the hard
// delete left no audit trail. Both now go through deleteGuestCascade.
export function useDeleteGuestEntry() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ entryId, clubId: cId }: { entryId: string; clubId?: string }) => {
            const clubId = cId || club?.id;
            if (!clubId) throw new Error("Club not loaded");

            const entryRef = doc(db, `clubs/${clubId}/guestEntries`, entryId);
            const entrySnap = await getDoc(entryRef);
            if (!entrySnap.exists()) throw new Error("Guest entry not found");

            const res = await deleteGuestCascade(clubId, { id: entrySnap.id, ...entrySnap.data() });
            if (!res.ok) throw new Error(res.errorMessage || "Could not delete the guest entry");
            return res;
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ["orders"] });
            qc.invalidateQueries({ queryKey: ["inventory"] });
            qc.invalidateQueries({ queryKey: ["guestEntries", vars.clubId || club?.id] });
        },
    });
}
