/**
 * Unit helpers for the unified inventory model.
 *
 * Each inventory item has a packet `size` and a `unit` (e.g. 1000 g, 1 L,
 * 1 pcs). `quantity` tracks the packet count in admin/kitchen — it can go
 * fractional after recipe deductions (e.g. 5 packets - 10 g consumed of a
 * 1000 g packet = 4.99 packets).
 *
 * Display rule: split into whole packets + remainder of the size unit, so
 * staff see "4 packets + 990 g" instead of "4.99 packets".
 */

export const UNIT_OPTIONS = ["g", "kg", "ml", "L", "pcs"] as const;
export type Unit = (typeof UNIT_OPTIONS)[number];

export interface DisplayParts {
    whole: number;
    remainder: number;       // in the item's base unit (e.g. grams)
    remainderUnit: string;   // same as item's unit
}

/**
 * Split a fractional packet count into whole packets + leftover of the
 * size unit. Negative quantities (allowed when stock dips below zero) are
 * preserved on the whole part so the staff can see the deficit.
 */
export function splitPackets(quantity: number, size: number): DisplayParts {
    if (!Number.isFinite(quantity) || !Number.isFinite(size) || size <= 0) {
        return { whole: 0, remainder: 0, remainderUnit: "" };
    }
    const whole = Math.trunc(quantity);
    const remainderPackets = quantity - whole;
    const remainder = Math.round(remainderPackets * size * 1000) / 1000;
    return { whole, remainder, remainderUnit: "" };
}

/** Format like "4 packets + 990 g" or "5 packets" or "990 g". */
export function formatStock(quantity: number, size: number, unit: string): string {
    const { whole, remainder } = splitPackets(quantity, size);
    if (whole !== 0 && remainder !== 0) {
        return `${whole} pkt + ${formatUnitAmount(remainder, unit)}`;
    }
    if (whole !== 0) {
        return `${whole} pkt`;
    }
    if (remainder !== 0) {
        return formatUnitAmount(remainder, unit);
    }
    return "0";
}

/** Format a base-unit amount with sensible precision for the unit. */
export function formatUnitAmount(amount: number, unit: string): string {
    if (!Number.isFinite(amount)) return `0 ${unit}`;
    if (unit === "pcs") return `${Math.round(amount)} ${unit}`;
    // g and ml: integers. kg and L: 2 decimals.
    if (unit === "g" || unit === "ml") return `${Math.round(amount)} ${unit}`;
    return `${amount.toFixed(2)} ${unit}`;
}

/** Total base-unit amount available across N packets of `size`. */
export function totalBaseAmount(quantity: number, size: number): number {
    return quantity * size;
}

/** Convert base-unit amount → fractional packet count. */
export function baseAmountToPackets(amount: number, size: number): number {
    if (size <= 0) return 0;
    return amount / size;
}
