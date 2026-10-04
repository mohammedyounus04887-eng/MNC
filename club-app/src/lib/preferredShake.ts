/**
 * Preferred shake.
 *
 * Members are creatures of habit: most order the same thing on the same day of
 * the week. Rather than ask them to set a preference from scratch, work it out
 * from what they have actually been ordering — "on Mondays you nearly always
 * take Orange" — and let them override it.
 *
 * A member's own choice always wins over the derived one.
 */

import { collection, getDocs, query, where, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** name -> how many times it was ordered on that weekday */
export type WeekdayCounts = Record<number, Record<string, number>>;

export interface PreferredShake {
    /** Index 0-6 (Sunday first) -> shake name. */
    byWeekday: Record<number, string>;
    /** Where each entry came from, for the UI to explain itself. */
    source: "member" | "history" | "club" | "none";
}

const isCancelled = (o: any) => o?.status === "cancelled" || o?.status === "rejected";

/**
 * Work out what this member usually orders, per weekday, from their order
 * history. Looks at the order date rather than the created timestamp so it
 * matches the day the club actually served them.
 */
export async function deriveFromHistory(clubId: string, memberId: string, sinceDays = 100): Promise<Record<number, string>> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDays);

    const snap = await getDocs(query(collection(db, "clubs", clubId, "orders"), where("memberId", "==", memberId)));

    const counts: WeekdayCounts = {};
    snap.docs.forEach(d => {
        const o: any = d.data();
        if (isCancelled(o)) return;
        if (!o.date) return;
        const when = new Date(`${o.date}T00:00:00`);
        if (isNaN(when.getTime()) || when < cutoff) return;
        const wd = when.getDay();

        for (const it of (o.items || []) as any[]) {
            const name = (it.productName || it.itemName || it.name || "").trim();
            if (!name) continue;
            counts[wd] = counts[wd] || {};
            counts[wd][name] = (counts[wd][name] || 0) + (Number(it.quantity ?? it.qty) || 1);
        }
    });

    const out: Record<number, string> = {};
    for (const wd of Object.keys(counts)) {
        const day = Number(wd);
        const best = Object.entries(counts[day]).sort((a, b) => b[1] - a[1])[0];
        // One order on a given weekday isn't a habit — require at least two.
        if (best && best[1] >= 2) out[day] = best[0];
    }
    return out;
}

/** The club's most-ordered shake per weekday — the fallback for new members. */
export async function deriveClubFavourites(clubId: string, sinceDays = 60): Promise<Record<number, string>> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDays);

    const snap = await getDocs(collection(db, "clubs", clubId, "orders"));
    const counts: WeekdayCounts = {};
    snap.docs.forEach(d => {
        const o: any = d.data();
        if (isCancelled(o) || !o.date) return;
        const when = new Date(`${o.date}T00:00:00`);
        if (isNaN(when.getTime()) || when < cutoff) return;
        const wd = when.getDay();
        for (const it of (o.items || []) as any[]) {
            const name = (it.productName || it.itemName || it.name || "").trim();
            if (!name) continue;
            counts[wd] = counts[wd] || {};
            counts[wd][name] = (counts[wd][name] || 0) + (Number(it.quantity ?? it.qty) || 1);
        }
    });

    const out: Record<number, string> = {};
    for (const wd of Object.keys(counts)) {
        const day = Number(wd);
        const best = Object.entries(counts[day]).sort((a, b) => b[1] - a[1])[0];
        if (best) out[day] = best[0];
    }
    return out;
}

/**
 * A member's explicitly chosen shake per weekday.
 *
 * TWO BUGS MET HERE, which is why a member's chosen shake never once appeared
 * at the scan station.
 *
 * 1. This read from clubs/{clubId}/members/{memberId}/settings/preferredShake —
 *    four levels below the club. firestore.rules gives the members block
 *    explicit rules for wallet, transactions, weighIns, attendance,
 *    notifications and invoices, but never one for `settings`, and rules do not
 *    cascade. The read was denied, the catch swallowed it, and {} came back.
 *
 * 2. Nothing ever wrote there anyway. `saveMemberChoice` had no callers: the
 *    only editor, features/preferences/ShakePreferencesEditor, writes a
 *    DIFFERENT field in a DIFFERENT shape — `shakePreferences` on the member
 *    document itself, keyed by day NAME with `{ productId, productName }`
 *    values, where this expects weekday NUMBERS and plain strings.
 *
 * So the screen that sets the preference and the code that reads it were never
 * connected. This now reads what the editor actually saves, and converts.
 */
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Convert the editor's `shakePreferences` map into weekday-number → name. */
export function memberChoiceOf(member: any): Record<number, string> {
    const prefs = member?.shakePreferences;
    if (!prefs) return {};
    const out: Record<number, string> = {};
    for (let wd = 0; wd < 7; wd++) {
        const entry = prefs[DAY_NAMES[wd]];
        const name = typeof entry === "string" ? entry : entry?.productName;
        if (name) out[wd] = name;
    }
    return out;
}

export async function loadMemberChoice(clubId: string, memberId: string): Promise<Record<number, string>> {
    try {
        const s = await getDoc(doc(db, "clubs", clubId, "members", memberId));
        return s.exists() ? memberChoiceOf(s.data()) : {};
    } catch {
        return {};
    }
}

/**
 * Write in the editor's shape, onto the member document — the one place that is
 * both writable under the live rules and actually read back.
 */
export async function saveMemberChoice(clubId: string, memberId: string, byWeekday: Record<number, string>) {
    const shakePreferences: Record<string, { productId: string; productName: string }> = {};
    for (const [wd, name] of Object.entries(byWeekday)) {
        if (name) shakePreferences[DAY_NAMES[Number(wd)]] = { productId: "", productName: name };
    }
    await setDoc(
        doc(db, "clubs", clubId, "members", memberId),
        { shakePreferences, preferredShakeUpdatedAt: new Date().toISOString() },
        { merge: true },
    );
}

/**
 * The shake to put on the counter when this member walks in.
 *
 * Order of preference: what they chose > what they usually order on this
 * weekday > what the club orders most on this weekday > nothing, and reception
 * asks.
 */
export async function resolvePreferredShake(
    clubId: string,
    memberId: string,
    when: Date = new Date(),
    clubFavourites?: Record<number, string>,
): Promise<{ name: string | null; source: PreferredShake["source"] }> {
    const wd = when.getDay();

    const chosen = await loadMemberChoice(clubId, memberId);
    if (chosen[wd]) return { name: chosen[wd], source: "member" };

    const history = await deriveFromHistory(clubId, memberId);
    if (history[wd]) return { name: history[wd], source: "history" };

    const club = clubFavourites ?? (await deriveClubFavourites(clubId));
    if (club[wd]) return { name: club[wd], source: "club" };

    return { name: null, source: "none" };
}
