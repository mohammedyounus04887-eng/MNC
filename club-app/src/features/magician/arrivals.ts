import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User as Member, Product } from "@/types/firestore";

// ─── Per-member shake-for-today resolver ──────────────────────────────
// Used by Magician's "X has arrived" intent. Picks the right shake for
// a member given today's day-of-week, with this precedence:
//
//   1. member.shakePreferences[today]    — explicit per-day preference
//   2. history fallback                  — most-ordered shake on the
//                                          same weekday in the last
//                                          ~8 weeks
//   3. null                              — caller should fall back to
//                                          attendance-only OR ask the
//                                          receptionist via the card

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function todayWeekdayKey(): typeof DAY_KEYS[number] {
    return DAY_KEYS[new Date().getDay()];
}

export function getMemberPreference(member: Member): { productId: string; productName: string } | null {
    const day = todayWeekdayKey();
    const pref = (member.shakePreferences as any)?.[day] ?? null;
    if (pref && pref.productId) return pref;
    return null;
}

// ─── history fallback ──────────────────────────────────────────────────
// Look at this member's orders from the last 8 same-weekday dates. Pick
// the productName they ordered most often. Caller then resolves that
// name to today's available shake (or any menu item).

const HISTORY_WEEKS = 8;

export async function getHistoryShakeForToday(
    clubId: string,
    memberId: string,
): Promise<{ productId: string | null; productName: string | null } | null> {
    const day = new Date().getDay();
    // Build the list of YYYY-MM-DD strings for the same weekday over the
    // last HISTORY_WEEKS weeks (exclusive of today).
    const dates: string[] = [];
    const now = new Date();
    for (let i = 1; i <= HISTORY_WEEKS; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i * 7);
        if (d.getDay() === day) dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length === 0) return null;

    try {
        // Firestore `where in` is capped at 30 — we'll be way under.
        const snap = await getDocs(
            query(
                collection(db, `clubs/${clubId}/orders`),
                where("memberId", "==", memberId),
                where("date", "in", dates),
            )
        );
        const counts = new Map<string, { name: string; productId: string | null; count: number }>();
        snap.docs.forEach((d) => {
            const data = d.data() as any;
            for (const it of (data.items ?? [])) {
                const name = (it.productName || it.itemName || "").trim();
                if (!name) continue;
                const key = name.toLowerCase();
                const cur = counts.get(key);
                if (cur) cur.count++;
                else counts.set(key, { name, productId: it.productId ?? null, count: 1 });
            }
        });
        if (counts.size === 0) return null;
        const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
        return { productId: top.productId, productName: top.name };
    } catch (err) {
        console.warn("[magician arrivals] history lookup failed", err);
        return null;
    }
}

// ─── resolve a preference name → today's actual product ───────────────
// Preferences store the productId at the time of saving — but menus
// can change. Match by id first, then by name (case-insensitive). If
// nothing matches today's available products, falls back to ANY menu
// item with that name (which kitchen will still recognise).

export function resolveProduct(
    nameOrId: { productId: string | null; productName: string | null },
    todaysSpecials: Product[],
    allMenu: Product[],
): Product | null {
    if (!nameOrId.productName && !nameOrId.productId) return null;
    const id = nameOrId.productId;
    const name = (nameOrId.productName || "").toLowerCase().trim();

    if (id) {
        const byId = todaysSpecials.find((p) => p.id === id) ?? allMenu.find((p) => p.id === id);
        if (byId) return byId;
    }
    if (name) {
        const inSpecials = todaysSpecials.find((p) => (p.name || "").toLowerCase() === name);
        if (inSpecials) return inSpecials;
        const inMenu = allMenu.find((p) => (p.name || "").toLowerCase() === name);
        if (inMenu) return inMenu;
    }
    return null;
}
