import { useEffect, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, query, where, onSnapshot,
    setDoc, updateDoc, serverTimestamp, increment, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { todayLocal } from "@/lib/clubDay";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TodaysSpecialItem {
    itemId: string;
    itemName: string;
    itemEmoji: string;
    category: string;
    imageUrl: string | null;
    isActive: boolean;
    stockType: "unlimited" | "limited";
    totalStock: number | null;
    remainingStock: number | null;
    date: string;
    addedAt?: any;
    updatedAt?: any;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// The club day is a LOCAL date. toISOString() is UTC, which files anything
// before 05:30 IST under the previous day — the specials set for today then
// read as yesterday's, and the member's menu comes up empty.
export function getTodayStr() {
    return todayLocal();
}

export function getCategoryEmoji(category: string): string {
    if (category === "shake" || category === "drink") return "🥤";
    if (category === "tea") return "🍵";
    if (category === "supplement") return "💊";
    if (category === "snack") return "🍿";
    return "🍽️";
}

// ─── Real-time listener for today's specials ────────────────────────────────

export function useTodaysSpecials(clubId: string | null) {
    const [specials, setSpecials] = useState<Record<string, TodaysSpecialItem>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) return;
        const todayStr = getTodayStr();
        const q = query(
            collection(db, "clubs", clubId, "todaysSpecial"),
            where("date", "==", todayStr)
        );
        const unsub = onSnapshot(q, (snap) => {
            const map: Record<string, TodaysSpecialItem> = {};
            snap.docs.forEach((d) => {
                map[d.id] = { itemId: d.id, ...d.data() } as TodaysSpecialItem;
            });
            setSpecials(map);
            setLoading(false);
        }, () => setLoading(false));
        return () => unsub();
    }, [clubId]);

    return { specials, loading };
}

// ─── Toggle item on/off for today's special ─────────────────────────────────

export function useToggleTodaysSpecial() {
    return useMutation({
        mutationFn: async ({
            clubId, item, currentData,
        }: {
            clubId: string;
            item: { id: string; name: string; category: string; imageUrl?: string | null; emoji?: string };
            currentData?: TodaysSpecialItem | null;
        }) => {
            const todayStr = getTodayStr();
            const docRef = doc(db, "clubs", clubId, "todaysSpecial", item.id);
            const emoji = item.emoji || getCategoryEmoji(item.category);

            if (!currentData) {
                // New document — toggle ON
                await setDoc(docRef, {
                    itemId: item.id,
                    itemName: item.name,
                    itemEmoji: emoji,
                    category: item.category,
                    imageUrl: item.imageUrl || null,
                    isActive: true,
                    stockType: "unlimited",
                    totalStock: null,
                    remainingStock: null,
                    date: todayStr,
                    addedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            } else {
                // Toggle isActive
                await updateDoc(docRef, {
                    isActive: !currentData.isActive,
                    updatedAt: serverTimestamp(),
                });
            }
        },
    });
}

// ─── Update stock type ───────────────────────────────────────────────────────

export function useSetSpecialStockType() {
    return useMutation({
        mutationFn: async ({
            clubId, itemId, stockType, quantity,
        }: {
            clubId: string;
            itemId: string;
            stockType: "unlimited" | "limited";
            quantity?: number;
        }) => {
            const docRef = doc(db, "clubs", clubId, "todaysSpecial", itemId);
            if (stockType === "unlimited") {
                await updateDoc(docRef, {
                    stockType: "unlimited",
                    totalStock: null,
                    remainingStock: null,
                    updatedAt: serverTimestamp(),
                });
            } else {
                const qty = quantity ?? 10;
                await updateDoc(docRef, {
                    stockType: "limited",
                    totalStock: qty,
                    remainingStock: qty,
                    updatedAt: serverTimestamp(),
                });
            }
        },
    });
}

// ─── Set quantity for limited stock ─────────────────────────────────────────

export function useSetSpecialQuantity() {
    return useMutation({
        mutationFn: async ({
            clubId, itemId, quantity,
        }: {
            clubId: string; itemId: string; quantity: number;
        }) => {
            await updateDoc(doc(db, "clubs", clubId, "todaysSpecial", itemId), {
                totalStock: quantity,
                remainingStock: quantity,
                updatedAt: serverTimestamp(),
            });
        },
    });
}

// ─── Deduct stock on order placed ───────────────────────────────────────────

export async function deductTodaysSpecialStock(
    clubId: string,
    items: { productId: string; productName: string; quantity: number }[]
) {
    const todayStr = getTodayStr();
    for (const item of items) {
        const docRef = doc(db, "clubs", clubId, "todaysSpecial", item.productId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) continue;
        const data = snap.data() as TodaysSpecialItem;
        if (data.date !== todayStr) continue;
        if (data.stockType !== "limited") continue;
        if ((data.remainingStock ?? 0) <= 0) continue;

        const newRemaining = Math.max(0, (data.remainingStock ?? 0) - item.quantity);
        await updateDoc(docRef, {
            remainingStock: increment(-item.quantity),
            updatedAt: serverTimestamp(),
        });

        // If sold out, deactivate
        if (newRemaining <= 0) {
            await updateDoc(docRef, {
                isActive: false,
                remainingStock: 0,
                updatedAt: serverTimestamp(),
            });
        }
    }
}

// ─── Stock badge info ────────────────────────────────────────────────────────

export function getStockBadgeInfo(special: TodaysSpecialItem | null | undefined) {
    if (!special || !special.isActive) return null;
    if (special.stockType === "unlimited") {
        return { label: "✅ Available", cls: "in-stock" };
    }
    const r = special.remainingStock ?? 0;
    if (r <= 0) return { label: "⛔ Sold Out", cls: "sold-out" };
    if (r === 1) return { label: "🔴 Last one!", cls: "low-stock" };
    if (r <= 3) return { label: `🔴 Only ${r} left`, cls: "low-stock" };
    return { label: `✅ ${r} available`, cls: "in-stock" };
}
