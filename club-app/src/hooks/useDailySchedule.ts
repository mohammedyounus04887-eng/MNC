import { useEffect } from "react";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";

/**
 * Global hook that auto-applies the weekly schedule for today's specials.
 * Runs once per day per club — the first page load (any page) triggers it.
 * Uses localStorage to avoid re-applying on the same day.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayKey = typeof DAYS[number];

function todayDayKey(): DayKey {
    return DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
}

export function useDailyScheduleApply() {
    const { club } = useClubContext();

    useEffect(() => {
        const clubId = club?.id;
        if (!clubId) return;

        const todayStr = new Date().toISOString().split("T")[0];
        const storageKey = `dailyScheduleApplied_${clubId}`;

        // Already applied today? Skip.
        if (localStorage.getItem(storageKey) === todayStr) return;

        (async () => {
            try {
                // Check if today already has active specials
                const specialsSnap = await getDocs(
                    query(collection(db, "clubs", clubId, "todaysSpecial"), where("date", "==", todayStr), where("isActive", "==", true))
                );
                if (!specialsSnap.empty) {
                    // Already has specials for today — mark as applied
                    localStorage.setItem(storageKey, todayStr);
                    return;
                }

                // Load weekly schedule
                const schedSnap = await getDoc(doc(db, "clubs", clubId, "settings", "weeklySchedule"));
                if (!schedSnap.exists()) {
                    localStorage.setItem(storageKey, todayStr);
                    return;
                }

                const schedule = schedSnap.data() as Record<DayKey, { id: string; name: string; category: string; imageUrl: string | null; emoji: string }[]>;
                const dayKey = todayDayKey();
                const items = schedule[dayKey] ?? [];

                if (items.length === 0) {
                    localStorage.setItem(storageKey, todayStr);
                    return;
                }

                // Clean up yesterday's specials
                const oldSnap = await getDocs(
                    query(collection(db, "clubs", clubId, "todaysSpecial"), where("isActive", "==", true))
                );
                if (!oldSnap.empty) {
                    const batch = writeBatch(db);
                    oldSnap.docs.forEach(d => {
                        if (d.data().date !== todayStr) batch.delete(d.ref);
                    });
                    await batch.commit();
                }

                // Apply today's schedule
                for (const item of items) {
                    const docRef = doc(db, "clubs", clubId, "todaysSpecial", item.id);
                    const existing = await getDoc(docRef);
                    if (existing.exists() && existing.data().date === todayStr) {
                        if (!existing.data().isActive) {
                            await updateDoc(docRef, { isActive: true, updatedAt: serverTimestamp() });
                        }
                        continue;
                    }
                    await setDoc(docRef, {
                        itemId: item.id,
                        itemName: item.name,
                        itemEmoji: item.emoji,
                        category: item.category,
                        imageUrl: item.imageUrl,
                        isActive: true,
                        stockType: "unlimited",
                        totalStock: null,
                        remainingStock: null,
                        date: todayStr,
                        addedAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                }

                localStorage.setItem(storageKey, todayStr);
                console.log(`[DailySchedule] Applied ${items.length} specials for ${dayKey} (${todayStr})`);
            } catch (e) {
                console.error("[DailySchedule] Error:", e);
            }
        })();
    }, [club?.id]);
}
