/**
 * Atomic per-club, per-day order/token counter.
 *
 * Used to assign sequential numbers (001, 002, 003 ...) to shake orders so
 * the printed token slip and the kitchen display share the same identifier.
 * Resets each day automatically because the counter doc is keyed by date.
 */

import { doc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const pad = (n: number, width = 3) => String(n).padStart(width, '0');

export const getNextOrderNumber = async (
    clubId: string,
    dateStr?: string,
): Promise<string> => {
    const [n] = await getNextOrderNumbers(clubId, 1, dateStr);
    return n;
};

/**
 * Atomically reserve `count` sequential token numbers. Used when a single
 * checkout creates multiple kitchen orders (e.g. a guest ordering 5 shakes).
 * Returns the numbers in order, zero-padded to 3 digits.
 */
export const getNextOrderNumbers = async (
    clubId: string,
    count: number,
    dateStr?: string,
): Promise<string[]> => {
    if (count <= 0) return [];
    const date = dateStr ?? new Date().toISOString().slice(0, 10);
    const counterRef = doc(db, 'clubs', clubId, 'counters', `orders_${date}`);

    const startSeq = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const current = (snap.exists() ? (snap.data().seq as number) : 0) || 0;
        tx.set(counterRef, { seq: current + count, date, updatedAt: new Date() }, { merge: true });
        return current + 1;
    });

    return Array.from({ length: count }, (_, i) => pad(startSeq + i));
};
