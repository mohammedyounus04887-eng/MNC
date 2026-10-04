/**
 * Sends ESC/POS formatted text to a thermal printer via the RawBT Android app.
 * Uses Android Intent URL scheme — no window.print() dialog.
 *
 * RawBT app: https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter
 *
 * Uses the `rawbt:base64,<...>` URL form because the plain `rawbt:<urlencoded>`
 * form is unreliable for content containing ESC/POS control bytes — it gets
 * truncated by Android's intent dispatcher and produces broken/wrapped output
 * on the printer (e.g. each word of a date on its own line).
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * ESC/POS command byte sequences start with ESC (\x1B) or GS (\x1D).
 * '\n' (LF = 0x0A) is also treated as a command so the join logic doesn't
 * insert extra newlines around it.
 */
const isEscPosCommand = (s: string): boolean =>
    s.length > 0 && (
        s.charCodeAt(0) === 0x1B ||
        s.charCodeAt(0) === 0x1D ||
        s === '\n'
    );

/**
 * UTF-8 safe base64 encoder. Plain `btoa` throws on chars > 0xFF (emoji,
 * em-dashes, etc.) so we encode to UTF-8 bytes first.
 */
const toBase64 = (input: string): string => {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
};

/**
 * Print an array of ESC/POS lines via RawBT intent.
 * @param lines - Array of ESC/POS formatted strings (including commands).
 */
export const printViaRawBT = (lines: string[] | string): void => {
    try {
        // Join: commands and LFs append directly; consecutive plain text items
        // get a single \n between them. If a text item already ends with \n,
        // do NOT add another one (avoids double-blank-lines).
        let content: string;
        if (Array.isArray(lines)) {
            content = lines.reduce((acc, cur, i) => {
                if (i === 0) return cur;
                const prev = lines[i - 1];
                if (isEscPosCommand(prev) || isEscPosCommand(cur)) {
                    return acc + cur;
                }
                if (prev.endsWith('\n')) {
                    return acc + cur;
                }
                return acc + '\n' + cur;
            }, '');
        } else {
            content = lines;
        }

        // Use base64 form — reliable for binary ESC/POS payloads.
        const intentUrl = 'rawbt:base64,' + toBase64(content);

        // Open RawBT
        window.location.href = intentUrl;

    } catch (error) {
        console.error('Print error:', error);
        alert('Print failed. Please check RawBT app is installed and printer is connected.');
    }
};

/**
 * Generate a transaction ID in the format TXN20260307-4821
 */
export const generateTxnId = (): string => {
    const now = new Date();
    const datePart =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TXN${datePart}-${rand}`;
};

/**
 * Format amount in Indian locale.
 */
export const formatINR = (amount: number): string => {
    return `Rs. ${amount.toLocaleString('en-IN')}`;
};

type ClubPrintInfo = {
    name: string;
    address: string;
    phone: string;
    email: string;
    gstNumber: string;
};

// Module-level cache of club print data. Pages that already have a live
// onSnapshot subscription on the club doc (e.g. Reception, Kitchen) call
// `primeClubPrintCache` whenever the snapshot fires. That makes printing
// instant — no extra round-trip to fetch club name/address/GSTIN every
// time we hit "print". For pages without a subscription, the cache is
// populated lazily by the first `fetchClubAndPrint` call and reused for
// CACHE_TTL_MS afterward.
const CACHE_TTL_MS = 5 * 60 * 1000;
const clubPrintCache = new Map<string, { data: ClubPrintInfo; expires: number }>();

const normalizeClub = (raw: Record<string, unknown> | null | undefined): ClubPrintInfo => ({
    name:      (raw?.clubName as string) || (raw?.name as string) || 'Nutrition Club',
    address:   ((raw?.address as string) ?? '') as string,
    phone:     ((raw?.phone as string) ?? (raw?.ownerPhone as string) ?? '') as string,
    email:     ((raw?.email as string) ?? (raw?.ownerEmail as string) ?? '') as string,
    gstNumber: ((raw?.gstNumber as string) ?? '') as string,
});

/**
 * Inject fresh club data into the print cache so subsequent prints don't
 * need a Firestore round-trip. Call this from any page already subscribed
 * to the club doc — Reception's onSnapshot effect, for example.
 */
export const primeClubPrintCache = (clubId: string, raw: Record<string, unknown> | null | undefined): void => {
    if (!clubId) return;
    clubPrintCache.set(clubId, {
        data: normalizeClub(raw),
        expires: Date.now() + CACHE_TTL_MS,
    });
};

/**
 * Build and print a receipt. Uses the cached club data when available
 * (populated by `primeClubPrintCache` or by an earlier print). Falls back
 * to a one-shot `getDoc` if no cache is present, then stores the result.
 */
export const fetchClubAndPrint = async (
    clubId: string,
    buildReceipt: (club: ClubPrintInfo) => string | string[],
): Promise<void> => {
    try {
        let club: ClubPrintInfo;
        const cached = clubPrintCache.get(clubId);
        if (cached && cached.expires > Date.now()) {
            club = cached.data;
        } else {
            const clubSnap = await getDoc(doc(db, 'clubs', clubId));
            const raw = clubSnap.exists() ? (clubSnap.data() as Record<string, unknown>) : {};
            club = normalizeClub(raw);
            clubPrintCache.set(clubId, { data: club, expires: Date.now() + CACHE_TTL_MS });
        }
        printViaRawBT(buildReceipt(club));
    } catch (err) {
        console.error('[fetchClubAndPrint]', err);
        alert('Could not load club details. Check internet connection.');
    }
};

// ──────────────────────────────────────────────────────────────────────
// Shake-token / refreshment-token print toggles (per-club setting)
//
// Two booleans on the club doc let the owner control which slips get
// auto-printed when a member checks in / orders a shake:
//   - clubs/{clubId}.printShakeToken        (default: true)
//   - clubs/{clubId}.printRefreshmentToken  (default: true)
//
// Reception's club onSnapshot effect calls `primeShakeTokenToggles` so
// repeated prints are synchronous; flows that don't subscribe (e.g.
// KitchenDisplay reprint) fall back to a one-shot getDoc with caching.
// ──────────────────────────────────────────────────────────────────────
type ShakeTokenToggles = {
    printShakeToken: boolean;
    printRefreshmentToken: boolean;
};

const TOKEN_TOGGLES_TTL_MS = 5 * 60 * 1000;
const tokenTogglesCache = new Map<string, { data: ShakeTokenToggles; expires: number }>();

const normalizeToggles = (raw: Record<string, unknown> | null | undefined): ShakeTokenToggles => ({
    // Default both to ON — matches pre-existing behaviour. The owner has
    // to explicitly turn one off in Settings.
    printShakeToken:       raw?.printShakeToken !== false,
    printRefreshmentToken: raw?.printRefreshmentToken !== false,
});

/** Inject the toggles from a live club snapshot into the cache. */
export const primeShakeTokenToggles = (clubId: string, raw: Record<string, unknown> | null | undefined): void => {
    if (!clubId) return;
    tokenTogglesCache.set(clubId, {
        data: normalizeToggles(raw),
        expires: Date.now() + TOKEN_TOGGLES_TTL_MS,
    });
};

/**
 * Synchronous read of the cached toggles. Falls back to {true, true} —
 * the pre-toggle default — when the cache is cold. Use this from print
 * call sites that build a mixed line array (e.g. shake + afresh + guest
 * receipt) where the toggles need to be checked synchronously inside a
 * builder callback. For caches that are likely cold, prefer the async
 * `printShakeAndAfresh` instead.
 */
export const getCachedShakeTokenToggles = (clubId: string): ShakeTokenToggles => {
    const cached = tokenTogglesCache.get(clubId);
    if (cached && cached.expires > Date.now()) return cached.data;
    return { printShakeToken: true, printRefreshmentToken: true };
};

/**
 * Async read with one-shot Firestore fallback when the cache is cold.
 * Use from call sites that build a mixed line array and don't run from
 * a page that primes the cache (e.g. ManualEntryModal, GuestWizard).
 */
export const fetchShakeTokenToggles = async (clubId: string): Promise<ShakeTokenToggles> => {
    const cached = tokenTogglesCache.get(clubId);
    if (cached && cached.expires > Date.now()) return cached.data;
    try {
        const snap = await getDoc(doc(db, 'clubs', clubId));
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const toggles = normalizeToggles(raw);
        tokenTogglesCache.set(clubId, { data: toggles, expires: Date.now() + TOKEN_TOGGLES_TTL_MS });
        return toggles;
    } catch {
        return { printShakeToken: true, printRefreshmentToken: true };
    }
};

/**
 * Print the shake-kitchen token + afresh-counter token, respecting the
 * per-club toggles. Pass each set of pre-built ESC/POS lines; this
 * helper joins only the enabled ones into a single RawBT job.
 */
export const printShakeAndAfresh = async (
    clubId: string,
    parts: { shake?: string[]; afresh?: string[] },
): Promise<void> => {
    try {
        const toggles = await fetchShakeTokenToggles(clubId);
        const lines: string[] = [];
        if (toggles.printShakeToken && parts.shake)        lines.push(...parts.shake);
        if (toggles.printRefreshmentToken && parts.afresh) lines.push(...parts.afresh);
        if (lines.length === 0) return;
        printViaRawBT(lines);
    } catch (err) {
        console.error('[printShakeAndAfresh]', err);
    }
};

// ── Legacy export for backward compatibility (no-op if called) ──
/** @deprecated Use printViaRawBT instead */
export function printReceipt(): void {
    console.warn('printReceipt() is deprecated. Use printViaRawBT() instead.');
}
